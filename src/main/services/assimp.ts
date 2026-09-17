/**
 * Tools (module 07) — the assimp backend.
 *
 * The forge has its own mesh readers and its own FBX writer, and they stay the
 * default. This module adds the other half of the problem: the ~40 formats
 * nobody is going to hand-write a parser for, and the parts of the formats we do
 * read that a hand parser gives up on — material libraries, texture references,
 * deep node graphs, the binary dialects.
 *
 * ## Why a process and not a library
 *
 * The suite ships with zero runtime dependencies. Linking assimp means a native
 * addon, which means node-gyp, a MSVC toolchain and a rebuild against every
 * Electron ABI — a build system, permanently, for one optional feature. A child
 * process costs a `CreateProcess` per file and nothing else, and when assimp is
 * absent the forge is exactly what it was before.
 *
 * ## What comes back
 *
 * assimp is asked for *binary* FBX regardless of what the user picked, because
 * this app then owns the last step: the document is parsed with `fbxbin.ts`,
 * scale and the Z-up correction are applied to the vertex arrays, and it is
 * re-encoded to binary or ASCII by the writers in `fbx.ts`. That is what keeps
 * the option panel meaning the same thing on both engines — and it is only
 * possible because the reader understands FBX 7500, which is what assimp emits.
 *
 * ## Trust
 *
 * The executable path never comes from the renderer, exactly as in `npp.ts`.
 * It is resolved here, from settings the user filled through a native dialog or
 * from the places assimp installs itself, and it is probed before it is believed:
 * a file called `assimp.exe` earns nothing until it answers `assimp version`.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { delimiter, dirname, join, normalize } from 'node:path'
import type { AppSettings, AssimpStatus } from '../../shared/types'
import { exists, isDir } from './fsx'

const EXE = process.platform === 'win32' ? 'assimp.exe' : 'assimp'

/** A probe is three short spawns; a conversion run must not pay for it per file. */
const PROBE_TIMEOUT = 15_000
/** Ceiling for one file. A model assimp cannot finish in this is not worth waiting on. */
const EXPORT_TIMEOUT = 180_000
const MAX_OUTPUT = 4 * 1024 * 1024

/**
 * Extensions assimp claims but the forge will not hand it on sight.
 *
 * `listext` is a list of what assimp will *attempt*, and several entries are
 * containers rather than model formats. Letting `.xml` through would classify
 * every layout file in a mod as a mesh, and `.zip` would do the same to every
 * archive — both then fail per file instead of being carried as capsules, which
 * is the honest outcome for a file that is not a model. The formats on this list
 * are still convertible; they just have to be picked deliberately.
 */
const AMBIGUOUS = new Set(['xml', 'zip', 'pk3', 'raw', 'prj', 'uc', 'scn', 'txt', 'md5camera'])

/* ----------------------------------------------------------------- run ---- */

interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** True when the child was terminated prematurely (signal or timeout). */
  killed: boolean
}

/**
 * In-flight children, so a cancelled queue does not wait for the current file.
 *
 * `convertFiles` checks its cancel flag between items, which is the right
 * granularity for an in-process conversion that takes milliseconds. A child
 * process can take a minute on a large model, so cancelling has to reach it.
 */
const running = new Set<AbortController>()

/** Abort every assimp process this app started. Safe to call when none are. */
export function cancelAssimp(): void {
  for (const controller of running) controller.abort()
  running.clear()
}

function run(exe: string, args: string[], timeout: number): Promise<RunResult> {
  const controller = new AbortController()
  running.add(controller)
  return new Promise<RunResult>((resolve) => {
    execFile(
      exe,
      args,
      { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT, signal: controller.signal },
      (error, stdout, stderr) => {
        running.delete(controller)
        const failure = error as (Error & { code?: number | string; killed?: boolean }) | null
        resolve({
          // `code` is a number on a normal exit and a string like `ENOENT` when
          // the binary is missing; both mean "not zero" to every caller here.
          code: failure ? (typeof failure.code === 'number' ? failure.code : 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          killed: failure?.killed === true || controller.signal.aborted
        })
      }
    )
  })
}

/**
 * The line worth showing a user.
 *
 * assimp narrates progress as a column of bare percentages and prints its banner
 * on every invocation; the reason a run failed is one line buried in that. The
 * last line that is neither is as close to a diagnosis as the CLI offers.
 */
function lastMeaningfulLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[\d.]+\s*%$/.test(l) && !/^-{4,}$/.test(l))
  return lines.length > 0 ? lines[lines.length - 1] : undefined
}

/* ------------------------------------------------------------ discovery ---- */

/** Directories an assimp build plausibly sits in, most specific first. */
function knownDirs(): string[] {
  const out: string[] = []
  // Shipped next to the app, when a build chooses to carry it.
  if (process.resourcesPath) out.push(join(process.resourcesPath, 'assimp', 'bin'), join(process.resourcesPath, 'assimp'))
  out.push(join(process.cwd(), 'resources', 'assimp', 'bin'), join(process.cwd(), 'resources', 'assimp'))
  if (process.platform === 'win32') {
    out.push(
      'C:\\tools\\assimp\\bin',
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Assimp', 'bin'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Assimp', 'bin')
    )
  } else {
    out.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin')
  }
  return out
}

/** `PATH`, walked by hand: cheaper and quieter than shelling out to `where`. */
async function fromPath(): Promise<string | undefined> {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, EXE)
    if (await exists(candidate)) return normalize(candidate)
  }
  return undefined
}

interface Found {
  exePath: string
  source: NonNullable<AssimpStatus['source']>
}

async function locateExe(settings: AppSettings): Promise<Found | undefined> {
  const override = settings.assimpPath
  if (override) {
    // The override may name the executable, its `bin`, or the install root.
    const candidates = [override, join(override, EXE), join(override, 'bin', EXE)]
    for (const candidate of candidates) {
      if ((await exists(candidate)) && !(await isDir(candidate))) {
        return { exePath: normalize(candidate), source: 'override' }
      }
    }
  }

  for (const dir of knownDirs()) {
    const candidate = join(dir, EXE)
    if (await exists(candidate)) return { exePath: normalize(candidate), source: 'known' }
  }

  const onPath = await fromPath()
  return onPath ? { exePath: onPath, source: 'path' } : undefined
}

/* -------------------------------------------------------------- probe ----- */

/** Parsed capabilities, cached against the executable that produced them. */
interface Probe {
  version?: string
  importExts: Set<string>
  exportFormats: Set<string>
  canExportFbx: boolean
}

let cache: { exePath: string; mtimeMs: number; probe: Probe } | undefined
/** Last successful resolution, so the convert loop can stay synchronous. */
let ready: { exePath: string; probe: Probe } | undefined

/**
 * `*.3ds;*.blend;…` → a set of bare extensions.
 *
 * Compound extensions such as `*.mesh.xml` are reduced to their last segment,
 * which is what `extOf` produces for a real path; the ambiguous ones are then
 * dropped, so `mesh.xml` does not quietly enrol every `.xml` in a mod.
 */
function parseExts(stdout: string): Set<string> {
  const out = new Set<string>()
  for (const token of stdout.split(/[;\s]+/)) {
    const cleaned = token.trim().toLowerCase().replace(/^\*/, '')
    if (!cleaned.startsWith('.')) continue
    const ext = cleaned.slice(cleaned.lastIndexOf('.') + 1)
    if (ext.length === 0 || AMBIGUOUS.has(ext)) continue
    out.add(ext)
  }
  return out
}

function parseFormats(stdout: string): Set<string> {
  const out = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const token = line.trim().toLowerCase()
    if (/^[a-z][a-z0-9]*$/.test(token)) out.add(token)
  }
  return out
}

async function probe(exePath: string): Promise<Probe | undefined> {
  const version = await run(exePath, ['version'], PROBE_TIMEOUT)
  // A binary that cannot answer `version` is not assimp, whatever it is called.
  if (version.code !== 0) return undefined
  const banner = `${version.stdout}\n${version.stderr}`
  if (!/assimp/i.test(banner)) return undefined

  const [exts, formats] = await Promise.all([
    run(exePath, ['listext'], PROBE_TIMEOUT),
    run(exePath, ['listexport'], PROBE_TIMEOUT)
  ])
  const exportFormats = formats.code === 0 ? parseFormats(formats.stdout) : new Set<string>()

  return {
    version: banner.match(/Version\s+([0-9][^\s(]*)/i)?.[1],
    importExts: exts.code === 0 ? parseExts(exts.stdout) : new Set<string>(),
    exportFormats,
    canExportFbx: exportFormats.has('fbx')
  }
}

/**
 * Resolve and probe assimp, reusing the last answer when the binary has not moved.
 *
 * Keyed on path *and* mtime so replacing the executable in place is noticed,
 * which is the normal way a build gets updated.
 */
async function resolve(settings: AppSettings): Promise<{ exePath: string; probe: Probe } | undefined> {
  const found = await locateExe(settings)
  if (!found) {
    ready = undefined
    return undefined
  }

  let mtimeMs = 0
  try {
    mtimeMs = (await fs.stat(found.exePath)).mtimeMs
  } catch {
    ready = undefined
    return undefined
  }

  if (cache && cache.exePath === found.exePath && cache.mtimeMs === mtimeMs) {
    ready = { exePath: found.exePath, probe: cache.probe }
    return ready
  }

  const result = await probe(found.exePath)
  if (!result) {
    cache = undefined
    ready = undefined
    return undefined
  }
  cache = { exePath: found.exePath, mtimeMs, probe: result }
  ready = { exePath: found.exePath, probe: result }
  return ready
}

/** Full status for the Tools panel. Never throws; absence is a normal answer. */
export async function assimpStatus(settings: AppSettings): Promise<AssimpStatus> {
  const found = await locateExe(settings)
  if (!found) return { installed: false, ready: false, importExts: [], exportFormats: [] }

  const resolved = await resolve(settings)
  if (!resolved) {
    // The file is there but it did not answer as assimp: a stale path in
    // settings, a broken build, or a missing `assimp-vc143-mt.dll` beside it.
    return {
      installed: true,
      ready: false,
      exePath: found.exePath,
      dir: dirname(found.exePath),
      source: found.source,
      importExts: [],
      exportFormats: [],
      problem: 'unusable'
    }
  }

  return {
    installed: true,
    ready: resolved.probe.canExportFbx,
    exePath: resolved.exePath,
    dir: dirname(resolved.exePath),
    source: found.source,
    version: resolved.probe.version,
    importExts: [...resolved.probe.importExts].sort(),
    exportFormats: [...resolved.probe.exportFormats].sort(),
    problem: resolved.probe.canExportFbx ? undefined : 'noFbxExport'
  }
}

/** Validate a path the user picked, before it is written to settings. */
export async function looksLikeAssimp(path: string): Promise<boolean> {
  const candidates = [path, join(path, EXE), join(path, 'bin', EXE)]
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue
    if (await isDir(candidate)) continue
    if (await probe(candidate)) return true
  }
  return false
}

/**
 * Make assimp usable for a conversion run, once, before the queue starts.
 *
 * Returns the executable and the extensions it reads, or `undefined` when there
 * is no usable assimp — which callers treat as "use the built-in readers",
 * never as an error in itself.
 */
export async function prepareAssimp(settings: AppSettings): Promise<{ exePath: string } | undefined> {
  const resolved = await resolve(settings)
  return resolved && resolved.probe.canExportFbx ? { exePath: resolved.exePath } : undefined
}

/**
 * Extensions the last successful probe said assimp can read.
 *
 * Synchronous on purpose: `classifyExt` runs per file inside loops that are not
 * async, and the answer only changes when the binary does. Empty until something
 * has called `assimpStatus` or `prepareAssimp`, which both happen before any
 * classification that depends on it.
 */
export function assimpImportExts(): ReadonlySet<string> {
  return ready?.probe.importExts ?? new Set<string>()
}

/** True when a probed, FBX-capable assimp is on hand. */
export function assimpReady(): boolean {
  return ready?.probe.canExportFbx === true
}

/* ------------------------------------------------------------- convert ---- */

export interface AssimpExportOptions {
  /** Flat normals where the source carries none, matching the built-in pass. */
  rebuildNormals: boolean
  /** Merge coincident corners — assimp's JoinIdenticalVertices. */
  weld: boolean
}

export class AssimpError extends Error {
  readonly code: string
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

/**
 * Convert one file to binary FBX at `output`.
 *
 * Always binary, always FBX 7500: the caller re-encodes. `-gn` is
 * `aiProcess_GenNormals`, which is flat and only fires where normals are
 * missing — the same contract as `buildFlatNormals`, not assimp's smoothing
 * pass, which would invent shading the source never stated.
 *
 * Unrecognised flags are silently ignored by assimp_cmd rather than rejected, so
 * success is judged by the exit code and by the file actually appearing.
 */
export async function exportToFbx(
  exePath: string,
  input: string,
  output: string,
  opts: AssimpExportOptions
): Promise<void> {
  const args = ['export', input, output, '-ffbx']
  if (opts.rebuildNormals) args.push('-gn')
  if (opts.weld) args.push('-jiv')

  const result = await run(exePath, args, EXPORT_TIMEOUT)
  if (result.killed) throw new AssimpError('assimpCancelled')
  if (result.code !== 0) {
    throw new AssimpError('assimpFailed', lastMeaningfulLine(result.stderr || result.stdout))
  }
  if (!(await exists(output))) throw new AssimpError('assimpNoOutput')
}
