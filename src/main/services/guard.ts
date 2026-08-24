import { normalize, sep } from 'node:path'
import { allowedRoots, writableRoots } from './paths'
import { getSettings } from './settings'

let cached: { at: number; roots: string[] } | undefined
let cachedWrite: { at: number; roots: string[] } | undefined
const TTL = 30_000

async function roots(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL) return cached.roots
  const settings = await getSettings()
  const list = await allowedRoots(settings)
  cached = { at: Date.now(), roots: list }
  return list
}

async function writeRoots(): Promise<string[]> {
  if (cachedWrite && Date.now() - cachedWrite.at < TTL) return cachedWrite.roots
  const settings = await getSettings()
  const list = await writableRoots(settings)
  cachedWrite = { at: Date.now(), roots: list }
  return list
}

export function invalidateGuard(): void {
  cached = undefined
  cachedWrite = undefined
}

/** True when `target` is inside `roots` (case-insensitive, `..`-rejecting). */
function withinRoots(target: string, roots: string[]): boolean {
  if (!target) return false
  const normalised = normalize(target).toLowerCase()
  if (normalised.includes('..')) return false
  for (const root of roots) {
    if (normalised === root) return true
    if (normalised.startsWith(root.endsWith(sep) ? root : root + sep)) return true
  }
  return false
}

/**
 * Renderer-supplied paths are untrusted. Only allow filesystem access inside
 * the detected Zomboid / Steam / user-configured roots.
 */
export async function isPathAllowed(target: string): Promise<boolean> {
  return withinRoots(target, await roots())
}

export async function assertPathAllowed(target: string): Promise<string> {
  if (!(await isPathAllowed(target))) {
    throw new Error(`Path outside of the allowed mod roots: ${target}`)
  }
  return normalize(target)
}

/**
 * Writes are held to a stricter allowlist than reads: only the user-owned mod
 * containers (`Zomboid\mods`, `Zomboid\Workshop`, custom sources) qualify, so
 * the Workbench can never modify the game install or Steam-managed Workshop
 * content. See `writableRoots` in services/paths.ts.
 */
export async function isPathWritable(target: string): Promise<boolean> {
  return withinRoots(target, await writeRoots())
}

export async function assertPathWritable(target: string): Promise<string> {
  if (!(await isPathWritable(target))) {
    throw new Error(`Path is not inside a writable mod root: ${target}`)
  }
  return normalize(target)
}
