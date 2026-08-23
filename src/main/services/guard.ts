import { normalize, sep } from 'node:path'
import { allowedRoots } from './paths'
import { getSettings } from './settings'

let cached: { at: number; roots: string[] } | undefined
const TTL = 30_000

async function roots(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL) return cached.roots
  const settings = await getSettings()
  const list = await allowedRoots(settings)
  cached = { at: Date.now(), roots: list }
  return list
}

export function invalidateGuard(): void {
  cached = undefined
}

/**
 * Renderer-supplied paths are untrusted. Only allow filesystem access inside
 * the detected Zomboid / Steam / user-configured roots.
 */
export async function isPathAllowed(target: string): Promise<boolean> {
  if (!target) return false
  const normalised = normalize(target).toLowerCase()
  if (normalised.includes('..')) return false
  for (const root of await roots()) {
    if (normalised === root) return true
    if (normalised.startsWith(root.endsWith(sep) ? root : root + sep)) return true
  }
  return false
}

export async function assertPathAllowed(target: string): Promise<string> {
  if (!(await isPathAllowed(target))) {
    throw new Error(`Path outside of the allowed mod roots: ${target}`)
  }
  return normalize(target)
}
