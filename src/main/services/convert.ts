/**
 * Tools (module 07) — the FBX forge.
 *
 * Turns a file into an `.fbx`. Three routes, picked by what the file actually is:
 *
 *  - **mesh** — OBJ, STL, PLY, DirectX `.x`, Collada, glTF/GLB are parsed into
 *    real geometry and re-emitted as FBX meshes.
 *  - **image** — a texture becomes the one mesh a texture can honestly become: a
 *    correctly proportioned quad with the picture on it, embedded in the file.
 *  - **capsule** — anything else becomes a named null carrying the source's
 *    metadata as custom properties, with the original bytes as embedded media.
 *    No geometry is invented; the file is transported, not reinterpreted.
 *
 * A fourth route, **transcode**, handles an `.fbx` input: binary in, ASCII out.
 *
 * ## Why the writes are allowed at all
 *
 * Every other write in this suite lands in a mod container. This one writes
 * wherever the user pointed a native dialog, which needs its own rule, so:
 *
 *  - an input is readable when the user picked it in *this* session's dialog, or
 *    when it already sits inside a scanned mod root;
 *  - an output directory is writable when it is a mod container the user owns
 *    (`isPathWritable`), or a directory outside every known root that the user
 *    picked themselves. A folder inside the game install or Steam's Workshop
 *    cache is refused outright — the read allowlist is wider than the write one
 *    on purpose, and the forge does not get to widen it.
 *
 * The renderer can therefore never talk the forge into writing somewhere the
 * user has not physically navigated to.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, normalize } from 'node:path'
import type {
  AppSettings,
  ConvertItemResult,
  ConvertOptions,
  ConvertProgress,
  ConvertResult,
  ForgeInput,
  ForgeKind
} from '../../shared/types'
import { decodeFbxBinary, encodeFbxAscii } from './fbxbin'
import { FBX_VERSION, verifyFbxBinary, writeFbx, type FbxMeshPart, type FbxScene } from './fbx'
import { exists, extOf, isDir, readdirSafe } from './fsx'
import { isPathAllowed, isPathWritable } from './guard'
import { applyGeometryPass, importObj, importPly, importStl, meshName, type MeshImport } from './mesh'
import { importCollada, importDirectX, importGltf } from './meshdcc'

/** Largest file the forge will read into memory. */
const MAX_INPUT = 256 * 1024 * 1024
/** Largest payload embedded inside an FBX. Above this the file is referenced. */
const MAX_EMBED = 96 * 1024 * 1024

const MESH_EXTS = new Set(['obj', 'stl', 'ply', 'x', 'dae', 'gltf', 'glb'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tga', 'dds', 'webp'])

/* ------------------------------------------------------------- consent ---- */

/**
 * Paths the user pointed at in a native dialog during this session.
 *
 * Session-scoped on purpose: nothing here is persisted, so a path cannot become
 * quietly writable again on the next launch. The one exception is the output
 * directory, which lives in settings precisely because it also got there through
 * a dialog.
 */
const consentedFiles = new Set<string>()
const consentedDirs = new Set<string>()

function key(path: string): string {
  return normalize(path).toLowerCase()
}

export function rememberPickedFiles(paths: string[]): void {
  for (const path of paths) {
    consentedFiles.add(key(path))
    consentedDirs.add(key(dirname(path)))
  }
}

export function rememberPickedDir(path: string): void {
  consentedDirs.add(key(path))
}

/**
 * Re-admit the persisted output directory.
 *
 * `toolsOutputDir` can only have reached settings through this module's folder
 * dialog, so it carries the same consent as a fresh pick — but the in-memory set
 * is empty after a restart, and without this the remembered folder would be
 * rejected until the user picked it again.
 */
function seedFromSettings(settings: AppSettings): void {
  if (settings.toolsOutputDir) consentedDirs.add(key(settings.toolsOutputDir))
}

/** Stable code + message pair, so the renderer can localise the common cases. */
function fail(code: string, detail?: string): Error {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code })
}

async function assertReadable(path: string): Promise<string> {
  if (consentedFiles.has(key(path))) return normalize(path)
  if (await isPathAllowed(path)) return normalize(path)
  throw fail('notConsented', path)
}

async function assertWritableTarget(dir: string): Promise<string> {
  if (await isPathAllowed(dir)) {
    if (!(await isPathWritable(dir))) throw fail('readOnlyTarget', dir)
    return normalize(dir)
  }
  if (!consentedDirs.has(key(dir))) throw fail('notConsented', dir)
  return normalize(dir)
}

/**
 * Gate for showing a forge path in Explorer.
 *
 * The shared `shell:*` handlers run the read allowlist, which by design does not
 * cover a folder on the desktop — so revealing a file the forge just wrote there
 * would be refused. This is the narrower equivalent: a path qualifies if the user
 * picked it, if it sits in a folder they picked, or if the normal guard already
 * allows it. Nothing is executed either way; the caller only reveals or opens.
 */
export async function assertForgePath(settings: AppSettings, path: string): Promise<string> {
  seedFromSettings(settings)
  const own = key(path)
  if (consentedFiles.has(own) || consentedDirs.has(own)) return normalize(path)
  if (consentedDirs.has(key(dirname(path)))) return normalize(path)
  if (await isPathAllowed(path)) return normalize(path)
  throw fail('notConsented', path)
}

/* ------------------------------------------------------------- classify ---- */

function classifyExt(ext: string): ForgeKind {
  if (ext === 'fbx') return 'transcode'
  if (MESH_EXTS.has(ext)) return 'mesh'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'capsule'
}

/**
 * Describe one input without converting it.
 *
 * Cheap by design — a stat plus, for the formats where the extension lies, a
 * short header read. A `.x` file that turns out to be a compressed flavour is
 * reported as unsupported *here*, so the queue shows it before anyone presses
 * convert.
 */
export async function inspectInputs(paths: string[]): Promise<ForgeInput[]> {
  const out: ForgeInput[] = []
  for (const raw of paths) {
    const path = await assertReadable(raw)
    let size = 0
    let mtime = 0
    try {
      const st = await fs.stat(path)
      if (st.isDirectory()) continue
      size = st.size
      mtime = st.mtimeMs
    } catch {
      continue
    }

    const ext = extOf(path)
    const kind = classifyExt(ext)
    const input: ForgeInput = {
      path,
      name: basename(path),
      ext,
      size,
      mtime,
      kind,
      format: kind === 'capsule' ? 'raw' : ext,
      supported: true
    }

    if (size > MAX_INPUT) {
      input.supported = false
      input.note = 'tooLarge'
    } else if (ext === 'x') {
      // `.x` comes in four flavours and the extension says nothing about which.
      const head = await readHead(path, 16)
      const flavour = head?.toString('latin1', 8, 12) ?? ''
      if (!head?.toString('latin1', 0, 4).startsWith('xof ')) {
        input.kind = 'capsule'
        input.format = 'raw'
      } else if (flavour === 'bin ') {
        input.format = 'x-binary'
      } else if (flavour !== 'txt ') {
        input.supported = false
        input.note = 'compressedX'
      }
    } else if (ext === 'fbx') {
      const head = await readHead(path, 21)
      const binary = head?.toString('latin1', 0, 18) === 'Kaydara FBX Binary'
      if (!binary) {
        input.supported = false
        input.note = 'asciiFbx'
      }
    }

    out.push(input)
  }
  return out
}

async function readHead(path: string, bytes: number): Promise<Buffer | undefined> {
  try {
    const handle = await fs.open(path, 'r')
    try {
      const buf = Buffer.alloc(bytes)
      const { bytesRead } = await handle.read(buf, 0, bytes, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

/** Most files a folder pick will queue in one go. */
const MAX_FOLDER_FILES = 2000
const MAX_FOLDER_DEPTH = 6

/**
 * Every convertible file under `dir`, recursively.
 *
 * Only the extensions the forge actually *reads* are collected. Adding a folder
 * is a request to convert its models, not to wrap its readme in an FBX capsule —
 * and a capsule is always one file-pick away for anyone who wants one.
 *
 * Breadth-first with a depth and count cap, and symlinks are skipped, so pointing
 * this at a drive root walks a bounded slice of it instead of never returning.
 */
export async function collectConvertible(dir: string): Promise<string[]> {
  const out: string[] = []
  let frontier: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }]

  while (frontier.length > 0 && out.length < MAX_FOLDER_FILES) {
    const next: Array<{ path: string; depth: number }> = []
    for (const entry of frontier) {
      for (const child of await readdirSafe(entry.path)) {
        if (child.isSymbolicLink()) continue
        const path = join(entry.path, child.name)
        if (child.isDirectory()) {
          if (entry.depth + 1 < MAX_FOLDER_DEPTH) next.push({ path, depth: entry.depth + 1 })
          continue
        }
        const ext = extOf(child.name)
        if (MESH_EXTS.has(ext) || IMAGE_EXTS.has(ext) || ext === 'fbx') out.push(path)
        if (out.length >= MAX_FOLDER_FILES) break
      }
      if (out.length >= MAX_FOLDER_FILES) break
    }
    frontier = next
  }

  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  return out
}

/* ---------------------------------------------------------------- image ---- */

/** Intrinsic size from a header, no decoding. Falls back to a square. */
function imageSize(buf: Buffer, ext: string): { width: number; height: number } {
  try {
    if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
      return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
    }
    if (buf.length >= 20 && buf.toString('ascii', 0, 4) === 'DDS ') {
      return { width: buf.readUInt32LE(16), height: buf.readUInt32LE(12) }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        i += 2 + len
      }
    }
    if (ext === 'tga' && buf.length >= 18) {
      return { width: buf.readUInt16LE(12), height: buf.readUInt16LE(14) }
    }
  } catch {
    /* a truncated header is not worth an exception */
  }
  return { width: 0, height: 0 }
}

/**
 * A quad the shape of the image, 100 units on its longest side.
 *
 * 100 because FBX's unit is the centimetre and a metre-ish plane is what every
 * viewer frames sensibly. The aspect ratio is the part that matters: a 2048x512
 * PZ tilesheet arrives as a 4:1 strip, not a square.
 */
function imageQuad(name: string, width: number, height: number): FbxMeshPart {
  const aspect = width > 0 && height > 0 ? width / height : 1
  const halfW = (aspect >= 1 ? 100 : 100 * aspect) / 2
  const halfH = (aspect >= 1 ? 100 / aspect : 100) / 2
  return {
    name,
    positions: [-halfW, -halfH, 0, halfW, -halfH, 0, halfW, halfH, 0, -halfW, halfH, 0],
    polygons: [[0, 1, 2, 3]],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    polygonMaterials: [],
    materials: [name]
  }
}

/* ---------------------------------------------------------------- import --- */

async function runImporter(path: string, buf: Buffer, ext: string): Promise<MeshImport> {
  const name = meshName(path)
  switch (ext) {
    case 'obj':
      return importObj(buf.toString('utf8'), name)
    case 'stl':
      return importStl(buf, name)
    case 'ply':
      return importPly(buf, name)
    case 'x':
      return importDirectX(buf, name)
    case 'dae':
      return importCollada(buf.toString('utf8'), name)
    case 'gltf':
    case 'glb':
      return importGltf(buf, name, path)
    default:
      throw fail('unknownFormat', ext)
  }
}

/* ---------------------------------------------------------------- output --- */

async function resolveOutputDir(settings: AppSettings, opts: ConvertOptions, input: string): Promise<string> {
  if (opts.outputMode === 'custom') {
    const dir = settings.toolsOutputDir
    if (!dir) throw fail('noOutputDir')
    if (!(await isDir(dir))) throw fail('noOutputDir', dir)
    return assertWritableTarget(dir)
  }
  return assertWritableTarget(dirname(input))
}

function outputName(input: string, kind: ForgeKind, encoding: string): string {
  const base = basename(input, extname(input))
  // A transcode would otherwise write over the file it just read.
  return kind === 'transcode' ? `${base}.${encoding}.fbx` : `${base}.fbx`
}

/** Write to a temp file and rename, so a failed write cannot truncate a good file. */
async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, path)
}

/* --------------------------------------------------------------- convert --- */

interface ItemPlan {
  scene: FbxScene
  kind: ForgeKind
  format: string
  vertices: number
  polygons: number
  materials: number
  /** The source bytes, kept so a transcode does not read the file twice. */
  buf: Buffer
  /** Importer caveat worth showing next to a *successful* row, e.g. `truncated`. */
  note?: string
}

async function planItem(path: string, opts: ConvertOptions): Promise<ItemPlan> {
  const ext = extOf(path)
  const kind = classifyExt(ext)
  const stat = await fs.stat(path)
  if (stat.size > MAX_INPUT) throw fail('tooLarge')
  if (stat.size === 0) throw fail('empty')
  const buf = await fs.readFile(path)
  const name = meshName(path)

  const meta: Array<[string, string]> = [
    ['PZM_Source', basename(path)],
    ['PZM_SourceKind', kind],
    ['PZM_SourceBytes', String(stat.size)],
    ['PZM_SourceModified', new Date(stat.mtimeMs).toISOString()],
    ['PZM_Sha256', createHash('sha256').update(buf).digest('hex')],
    ['PZM_Generator', 'PZ MANAGEMENT — Tools / FBX forge']
  ]
  const creator = `PZ MANAGEMENT — Tools (FBX ${FBX_VERSION / 1000})`

  if (kind === 'mesh') {
    const imported = await runImporter(path, buf, ext)
    applyGeometryPass(imported, {
      scale: opts.scale,
      assumeZup: opts.yUp,
      weld: opts.weld,
      rebuildNormals: opts.rebuildNormals
    })
    if (imported.meshes.length === 0) throw fail('noGeometry')
    const parts: FbxMeshPart[] = imported.meshes.map((m) => ({
      name: m.name,
      positions: m.positions,
      polygons: m.polygons,
      normals: m.normals,
      uvs: m.uvs,
      polygonMaterials: m.polygonMaterials,
      materials: m.materials.length > 0 ? m.materials : [`${m.name}_mat`]
    }))
    meta.push(['PZM_SourceFormat', imported.format])
    return {
      kind,
      format: imported.format,
      buf,
      note: imported.note,
      scene: { rootName: name, creator, meshes: parts, meta, unitScale: 1, sourcePath: path },
      vertices: parts.reduce((n, p) => n + p.positions.length / 3, 0),
      polygons: parts.reduce((n, p) => n + p.polygons.length, 0),
      materials: new Set(parts.flatMap((p) => p.materials)).size
    }
  }

  if (kind === 'image') {
    const { width, height } = imageSize(buf, ext)
    meta.push(['PZM_ImageWidth', String(width)], ['PZM_ImageHeight', String(height)])
    const quad = imageQuad(name, width, height)
    return {
      kind,
      format: ext,
      buf,
      scene: {
        rootName: name,
        creator,
        meshes: [quad],
        meta,
        unitScale: 1,
        sourcePath: path,
        media: {
          name,
          fileName: basename(path),
          absolutePath: path,
          data: opts.embed && buf.length <= MAX_EMBED ? buf : undefined
        }
      },
      vertices: 4,
      polygons: 1,
      materials: 1
    }
  }

  if (kind === 'transcode') {
    // Binary in, ASCII out. The reverse needs an ASCII *parser*, which this
    // build does not have, so it is refused rather than half-attempted.
    if (opts.encoding !== 'ascii') throw fail('sameFormat')
    if (buf.toString('latin1', 0, 18) !== 'Kaydara FBX Binary') throw fail('asciiFbx')
    return {
      kind,
      format: 'fbx',
      buf,
      scene: { rootName: name, creator, meshes: [], meta, unitScale: 1, sourcePath: path },
      vertices: 0,
      polygons: 0,
      materials: 0
    }
  }

  return {
    kind: 'capsule',
    format: 'raw',
    buf,
    scene: {
      rootName: name,
      creator,
      meshes: [],
      meta,
      unitScale: 1,
      sourcePath: path,
      // The media node is written either way: with the bytes when embedding is
      // on, and as a plain reference to the file when it is off or the payload is
      // over the cap. Dropping it entirely would lose the last pointer back to
      // the source, which is the one thing a capsule exists to keep.
      media: {
        name,
        fileName: basename(path),
        absolutePath: path,
        data: opts.embed && buf.length <= MAX_EMBED ? buf : undefined
      }
    },
    vertices: 0,
    polygons: 0,
    materials: 0
  }
}

async function convertOne(
  settings: AppSettings,
  path: string,
  opts: ConvertOptions,
  onPhase: (phase: ConvertProgress['phase']) => void
): Promise<ConvertItemResult> {
  const startedAt = Date.now()
  const base: ConvertItemResult = { input: path, name: basename(path), status: 'error', durationMs: 0 }

  try {
    const dir = await resolveOutputDir(settings, opts, path)
    const kind = classifyExt(extOf(path))
    const output = join(dir, outputName(path, kind, opts.encoding))
    if (key(output) === key(path)) throw fail('sameFile')
    if (!opts.overwrite && (await exists(output))) {
      return { ...base, status: 'skip', kind, output, message: 'exists', durationMs: Date.now() - startedAt }
    }

    const plan = await planItem(path, opts)
    let data: Buffer
    if (plan.kind === 'transcode') {
      const decoded = decodeFbxBinary(plan.buf)
      data = Buffer.from(encodeFbxAscii(decoded.root, decoded.version), 'utf8')
    } else {
      data = writeFbx(plan.scene, opts.encoding)
    }

    onPhase('write')
    await writeAtomic(output, data)

    let verified: boolean | undefined
    if (opts.verify && opts.encoding === 'binary' && plan.kind !== 'transcode') {
      onPhase('verify')
      const check = verifyFbxBinary(await fs.readFile(output), {
        meshes: plan.scene.meshes.length,
        positionFloats: plan.scene.meshes.reduce((n, m) => n + m.positions.length, 0),
        corners: plan.scene.meshes.reduce((n, m) => n + m.polygons.reduce((c, p) => c + p.length, 0), 0)
      })
      verified = check.ok
      if (!check.ok) throw fail('verifyFailed', check.problems.join('; '))
    }

    return {
      ...base,
      status: 'ok',
      kind: plan.kind,
      format: plan.format,
      output,
      bytes: data.length,
      vertices: plan.vertices,
      polygons: plan.polygons,
      materials: plan.materials,
      verified,
      // A caveat, not a failure: the file was written, and the row says why it
      // might not hold everything the source did.
      message: plan.note,
      durationMs: Date.now() - startedAt
    }
  } catch (e) {
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : undefined
    return {
      ...base,
      message: code ?? (e instanceof Error ? e.message : String(e)),
      durationMs: Date.now() - startedAt
    }
  }
}

export async function convertFiles(
  settings: AppSettings,
  opts: ConvertOptions,
  onProgress: (p: ConvertProgress) => void,
  isCancelled: () => boolean
): Promise<ConvertResult> {
  seedFromSettings(settings)
  const startedAt = Date.now()
  const items: ConvertItemResult[] = []
  const total = opts.inputs.length
  let cancelled = false

  for (let i = 0; i < total; i++) {
    if (isCancelled()) {
      cancelled = true
      break
    }
    const raw = opts.inputs[i]
    const name = basename(raw)
    onProgress({ phase: 'read', index: i, total, name })
    try {
      const path = await assertReadable(raw)
      onProgress({ phase: 'build', index: i, total, name })
      items.push(
        await convertOne(settings, path, opts, (phase) => onProgress({ phase, index: i, total, name }))
      )
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : undefined
      items.push({
        input: raw,
        name,
        status: 'error',
        message: code ?? (e instanceof Error ? e.message : String(e)),
        durationMs: 0
      })
    }
  }

  onProgress({ phase: 'done', index: total, total, name: '' })
  return {
    startedAt,
    durationMs: Date.now() - startedAt,
    cancelled,
    ok: items.filter((i) => i.status === 'ok').length,
    errors: items.filter((i) => i.status === 'error').length,
    skipped: items.filter((i) => i.status === 'skip').length,
    items
  }
}
