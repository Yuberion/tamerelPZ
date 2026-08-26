/**
 * Workbench pack service: turn a mod folder into something uploadable.
 *
 * Two outputs:
 *  - `workshop` stages `<out>/<Project>/Contents/mods/<Mod>` plus `workshop.txt`
 *    and `preview.png`, which is exactly the layout the in-game Workshop
 *    uploader reads.
 *  - `zip` writes a single archive for manual distribution.
 *
 * Both refuse to delete anything. Staging overwrites files it owns and leaves
 * everything else alone, so a stale file from a previous pack survives — that
 * is deliberate: silently removing files from a directory the user may have
 * pointed at their own work is not a risk worth taking for convenience.
 */
import { promises as fs } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type {
  AppSettings,
  PackBuilds,
  PackOptions,
  PackResult,
  WorkbenchProgress
} from '../../shared/types'
import { assertSafeName, workshopTxt } from './authoring'
import { buildZip, type ZipEntry } from './binfmt'
import { exists, isDir, readdirSafe } from './fsx'
import { assertPathAllowed, assertPathWritable } from './guard'
import { detectZomboidDir } from './paths'

type Progress = (p: WorkbenchProgress) => void

/** Never shipped: version control, editor state, OS clutter, our own backups. */
const DEFAULT_EXCLUDE = [
  '.git', '.gitignore', '.gitattributes', '.svn', '.hg', '.vs', '.vscode', '.idea',
  'node_modules', 'thumbs.db', 'desktop.ini', '.ds_store', '*.bak', '*.tmp',
  '*.pzm-tmp', '*.orig', '*.rej', '*.log'
]

const MAX_FILES = 20_000
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024 * 1024
/** In-memory zip ceiling — the staging path handles anything larger. */
const MAX_ZIP_BYTES = 512 * 1024 * 1024

/** Build sub-folder names, as used by the B42 layout. */
const VERSION_DIR_RE = /^(?:common|4[0-9](?:\.\d+)*)$/i

/** Case-insensitive match with `*` as the only wildcard. */
function matchesPattern(name: string, pattern: string): boolean {
  const lower = name.toLowerCase()
  const p = pattern.trim().toLowerCase()
  if (!p) return false
  if (!p.includes('*')) return lower === p
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(lower)
}

/** Should this build sub-folder reach the output? */
function buildAllowed(name: string, builds: PackBuilds): boolean {
  if (builds === 'all') return true
  if (!VERSION_DIR_RE.test(name)) return true
  const lower = name.toLowerCase()
  if (lower === 'common') return builds === 'b42'
  if (lower.startsWith('41')) return builds === 'b41'
  if (lower.startsWith('42')) return builds === 'b42'
  return true
}

interface FileRef {
  abs: string
  /** Forward-slashed path relative to the mod root. */
  rel: string
  size: number
  mtime: Date
}

interface Collected {
  files: FileRef[]
  dirs: string[]
  bytes: number
  skipped: number
}

async function collectFiles(
  root: string,
  builds: PackBuilds,
  exclude: string[]
): Promise<Collected> {
  const patterns = [...DEFAULT_EXCLUDE, ...exclude.map((e) => e.trim()).filter(Boolean)]
  const excluded = (name: string): boolean => patterns.some((p) => matchesPattern(name, p))

  const out: Collected = { files: [], dirs: [], bytes: 0, skipped: 0 }
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (stack.length) {
    const current = stack.pop()
    if (!current) break

    for (const entry of await readdirSafe(current.dir)) {
      if (entry.isSymbolicLink()) {
        out.skipped++
        continue
      }
      const abs = join(current.dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')

      if (excluded(entry.name)) {
        out.skipped++
        continue
      }
      // Build filtering only applies at the mod root, where version folders live.
      if (current.depth === 0 && entry.isDirectory() && !buildAllowed(entry.name, builds)) {
        out.skipped++
        continue
      }

      if (entry.isDirectory()) {
        out.dirs.push(rel)
        if (current.depth < 32) stack.push({ dir: abs, depth: current.depth + 1 })
        continue
      }

      let size = 0
      let mtime = new Date()
      try {
        const st = await fs.stat(abs)
        size = st.size
        mtime = st.mtime
      } catch {
        out.skipped++
        continue
      }
      if (size > MAX_FILE_BYTES) {
        throw new Error(`${rel} is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB file limit`)
      }
      out.files.push({ abs, rel, size, mtime })
      out.bytes += size
      if (out.files.length > MAX_FILES) {
        throw new Error(`Mod holds more than ${MAX_FILES} files — pack it manually`)
      }
      if (out.bytes > MAX_TOTAL_BYTES) {
        throw new Error('Mod is larger than 2 GB — pack it manually')
      }
    }
  }

  out.files.sort((a, b) => a.rel.localeCompare(b.rel))
  out.dirs.sort()
  return out
}

/** Where packs land when the caller does not say. */
export async function defaultOutputDir(settings: AppSettings): Promise<string> {
  const zomboid = await detectZomboidDir(settings)
  if (!zomboid) throw new Error('Zomboid user directory not found — set an output folder')
  return join(zomboid, 'Workshop')
}

/** The mod folder's poster, for the project-level `preview.png`. */
async function findPoster(modPath: string): Promise<string | undefined> {
  const names = ['poster.png', 'preview.png', 'thumbnail.png', 'poster.jpg']
  const dirs = [modPath]
  for (const entry of await readdirSafe(modPath)) {
    if (entry.isDirectory() && VERSION_DIR_RE.test(entry.name)) dirs.push(join(modPath, entry.name))
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (await exists(candidate)) return candidate
    }
  }
  return undefined
}

export async function packMod(
  settings: AppSettings,
  opts: PackOptions,
  onProgress: Progress
): Promise<PackResult> {
  const started = Date.now()
  const modPath = await assertPathAllowed(opts.modPath)
  if (!(await isDir(modPath))) throw new Error(`Not a directory: ${modPath}`)

  const outputName = assertSafeName(opts.outputName, 'Output name')
  const container = await assertPathWritable(opts.outputDir ?? (await defaultOutputDir(settings)))

  onProgress({ task: 'pack', phase: 'collect', done: 0, total: 0, label: '' })
  const collected = await collectFiles(modPath, opts.builds, opts.exclude)
  if (collected.files.length === 0) {
    throw new Error('Nothing to pack: every file was filtered out')
  }

  const result =
    opts.mode === 'zip'
      ? await packZip(modPath, container, outputName, collected, onProgress)
      : await packWorkshop(modPath, container, outputName, collected, opts, onProgress)

  onProgress({ task: 'pack', phase: 'done', done: collected.files.length, total: collected.files.length, label: '' })
  return { ...result, durationMs: Date.now() - started }
}

/* -------------------------------------------------------------------- zip -- */

async function packZip(
  modPath: string,
  container: string,
  outputName: string,
  collected: Collected,
  onProgress: Progress
): Promise<Omit<PackResult, 'durationMs'>> {
  // buildZip assembles the archive in memory, so the ceiling here is far lower
  // than the staging path's. Failing loudly beats an out-of-memory crash.
  if (collected.bytes > MAX_ZIP_BYTES) {
    throw new Error(
      `Mod is ${Math.round(collected.bytes / 1024 / 1024)} MB — over the ${
        MAX_ZIP_BYTES / 1024 / 1024
      } MB zip limit. Stage it as a Workshop project instead.`
    )
  }
  if (collected.files.length + collected.dirs.length > 0xffff) {
    throw new Error('Zip format is limited to 65535 entries — stage it as a Workshop project instead')
  }

  const modFolder = basename(modPath)
  const entries: ZipEntry[] = []
  const total = collected.files.length
  let done = 0

  // Wrap everything in a folder named after the mod: an archive that explodes
  // loose files into the extraction directory is a support ticket waiting.
  for (const dir of collected.dirs) entries.push({ name: `${modFolder}/${dir}/` })

  for (const file of collected.files) {
    const data = await fs.readFile(file.abs)
    entries.push({ name: `${modFolder}/${file.rel}`, data, mtime: file.mtime })
    done++
    if (done % 25 === 0 || done === total) {
      onProgress({ task: 'pack', phase: 'read', done, total, label: file.rel })
    }
  }

  onProgress({ task: 'pack', phase: 'write', done: total, total, label: `${outputName}.zip` })
  const archive = buildZip(entries)
  const output = await assertPathWritable(join(container, `${outputName}.zip`))
  await fs.mkdir(container, { recursive: true })
  const tmp = `${output}.pzm-tmp`
  await fs.writeFile(tmp, archive)
  await fs.rename(tmp, output)

  return {
    mode: 'zip',
    output,
    files: collected.files.length,
    bytes: collected.bytes,
    writtenBytes: archive.length,
    skipped: collected.skipped
  }
}

/* --------------------------------------------------------------- workshop -- */

async function packWorkshop(
  modPath: string,
  container: string,
  outputName: string,
  collected: Collected,
  opts: PackOptions,
  onProgress: Progress
): Promise<Omit<PackResult, 'durationMs'>> {
  const modFolder = basename(modPath)
  const projectRoot = await assertPathWritable(join(container, outputName))
  const modsRoot = await assertPathWritable(join(projectRoot, 'Contents', 'mods', modFolder))

  // Refuse to stage a mod on top of a *different* mod: a Contents/mods holding
  // other folders is somebody else's project, not a stale copy of this one.
  const existingMods = join(projectRoot, 'Contents', 'mods')
  if (await isDir(existingMods)) {
    const siblings = (await readdirSafe(existingMods)).filter((e) => e.isDirectory())
    const foreign = siblings.filter((e) => e.name.toLowerCase() !== modFolder.toLowerCase())
    if (foreign.length > 0) {
      throw new Error(
        `${outputName} already stages ${foreign.map((f) => f.name).join(', ')} — pick another project name`
      )
    }
  }

  await fs.mkdir(modsRoot, { recursive: true })
  for (const dir of collected.dirs) {
    await fs.mkdir(join(modsRoot, ...dir.split('/')), { recursive: true })
  }

  const total = collected.files.length
  let done = 0
  let writtenBytes = 0

  for (const file of collected.files) {
    const dest = join(modsRoot, ...file.rel.split('/'))
    await fs.copyFile(file.abs, dest)
    writtenBytes += file.size
    done++
    if (done % 25 === 0 || done === total) {
      onProgress({ task: 'pack', phase: 'write', done, total, label: file.rel })
    }
  }

  const meta = opts.workshop
  if (meta) {
    const txt = workshopTxt(meta)
    await fs.writeFile(join(projectRoot, 'workshop.txt'), Buffer.from(txt, 'utf8'))
    writtenBytes += Buffer.byteLength(txt, 'utf8')
  }

  if (opts.preview) {
    const poster = await findPoster(modPath)
    if (poster) {
      await fs.copyFile(poster, join(projectRoot, 'preview.png'))
    }
  }

  return {
    mode: 'workshop',
    output: projectRoot,
    files: collected.files.length,
    bytes: collected.bytes,
    writtenBytes,
    skipped: collected.skipped
  }
}
