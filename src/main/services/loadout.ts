import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AppSettings,
  LoadoutApplyOptions,
  LoadoutApplyResult,
  LoadoutFile
} from '../../shared/types'
import { exists, readdirSafe, readTextSafe } from './fsx'
import { invalidateGuard } from './guard'
import { detectZomboidDir } from './paths'

/**
 * Load order & profiles (module 02).
 *
 * Two on-disk formats are handled; both keep the rest of the file intact and
 * rewrite only the lines this module owns:
 *
 *  - client: `Zomboid\mods\default.txt` (Build 42). A `VERSION = 1,` line plus
 *    two Lua-ish blocks, `mods { ... }` / `maps { ... }`, one bare token per
 *    line. The game also keeps per-save copies under `Saves\...\mods.txt` in
 *    the same shape — those are never touched from here.
 *  - server: `Zomboid\Server\<name>.ini`. Flat `key=value` lines, no sections.
 *    `Mods=` holds semicolon-separated mod.info text ids and `WorkshopItems=`
 *    numeric Steam Workshop ids. Order inside the values is load order.
 */

/** Client list path relative to the Zomboid user dir. */
const CLIENT_REL = join('mods', 'default.txt')

/**
 * Server config names that may be written. The shared write guard's allowlist
 * covers mod containers only, so ini writes carry their own narrow rule: a
 * plain base name with no separators or traversal.
 */
const SAFE_SERVER_NAME = /^[\w][\w .-]{0,63}$/

function parseClientList(text: string): { mods: string[]; maps: string[]; version?: string } {
  const mods: string[] = []
  const maps: string[] = []
  let version: string | undefined
  let block = ''
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (/^VERSION\s*=/i.test(t)) {
      version = t
      continue
    }
    if (/^mods\s*\{$/i.test(t)) {
      block = 'mods'
      continue
    }
    if (/^maps\s*\{$/i.test(t)) {
      block = 'maps'
      continue
    }
    if (t === '}') {
      block = ''
      continue
    }
    if (!t || !block) continue
    const token = t.replace(/,$/, '').trim()
    ;(block === 'mods' ? mods : maps).push(token)
  }
  return { mods, maps, version }
}

/**
 * Rebuild the whole file. The client list has no other content to preserve —
 * except the `VERSION` line, which is echoed back exactly as it was found so a
 * future format bump is not silently downgraded to `1`.
 */
function renderClientList(mods: string[], maps: string[], version?: string): string {
  const out: string[] = [version ?? 'VERSION = 1,', '', 'mods {']
  for (const m of mods) out.push(`\t${m}`)
  out.push('}', '', 'maps {')
  for (const m of maps) out.push(`\t${m}`)
  out.push('}')
  return `${out.join('\r\n')}\r\n`
}

/** One physical line of a flat ini; comments and blanks pass through verbatim. */
interface IniLine {
  kind: 'pair' | 'other'
  key?: string
  value?: string
  raw: string
}

function parseIniLines(text: string): IniLine[] {
  return text.split(/\r?\n/).map((raw) => {
    const t = raw.trim()
    if (!t || t.startsWith('#') || t.startsWith(';')) return { kind: 'other' as const, raw }
    const eq = t.indexOf('=')
    if (eq <= 0) return { kind: 'other' as const, raw }
    return {
      kind: 'pair' as const,
      key: t.slice(0, eq).trim().toLowerCase(),
      value: t.slice(eq + 1).trim(),
      raw
    }
  })
}

function splitIniList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function listLoadoutFiles(settings: AppSettings): Promise<LoadoutFile[]> {
  const zomboidDir = await detectZomboidDir(settings)

  const clientPath = zomboidDir ? join(zomboidDir, CLIENT_REL) : ''
  const clientText = clientPath ? await readTextSafe(clientPath) : undefined
  const parsed = parseClientList(clientText ?? '')
  const files: LoadoutFile[] = [
    {
      id: 'client',
      kind: 'client',
      path: clientPath,
      // An existing but empty default.txt still exists; `readTextSafe` cannot tell
      // that apart from a missing file, so ask the filesystem directly.
      exists: clientPath ? await exists(clientPath) : false,
      mods: parsed.mods,
      maps: parsed.maps,
      workshopItems: []
    }
  ]

  if (zomboidDir) {
    const serversDir = join(zomboidDir, 'Server')
    const names = (await readdirSafe(serversDir))
      .map((e) => e.name)
      .filter((n) => n.toLowerCase().endsWith('.ini'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    for (const name of names) {
      const path = join(serversDir, name)
      const text = await readTextSafe(path)
      const mods: string[] = []
      const workshopItems: string[] = []
      for (const line of parseIniLines(text ?? '')) {
        if (line.kind !== 'pair') continue
        if (line.key === 'mods') mods.push(...splitIniList(line.value))
        else if (line.key === 'workshopitems') workshopItems.push(...splitIniList(line.value))
        // Repeated keys would be merged in order; PZ itself writes one of each.
      }
      const base = name.replace(/\.ini$/i, '')
      files.push({
        id: `server:${base}`,
        kind: 'server',
        path,
        exists: true,
        serverName: base,
        mods,
        maps: [],
        workshopItems
      })
    }
  }

  return files
}

export async function applyLoadout(
  settings: AppSettings,
  opts: LoadoutApplyOptions
): Promise<LoadoutApplyResult> {
  const startedAt = Date.now()
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) throw new Error('Zomboid user directory not found')

  const baseName = opts.targetId.startsWith('server:') ? opts.targetId.slice(7) : undefined
  const isClient = opts.targetId === 'client'
  if (!isClient && !baseName) throw new Error(`Unknown loadout target: ${opts.targetId}`)
  if (baseName && !SAFE_SERVER_NAME.test(baseName)) {
    throw new Error(`Refusing to write server config named "${baseName}"`)
  }

  const path = isClient ? join(zomboidDir, CLIENT_REL) : join(zomboidDir, 'Server', `${baseName}.ini`)
  const prev = await readTextSafe(path)

  let next: string
  if (isClient) {
    next = renderClientList(opts.mods, opts.maps ?? [], parseClientList(prev ?? '').version)
  } else {
    // Rewrite only the two owned keys in place; every other line survives.
    const body = parseIniLines(prev ?? '').map((l) => l.raw)
    const setKey = (key: string, value: string[]): void => {
      const line = `${key}=${value.join(';')}`
      // `parseIniLines` lowercases keys, so the comparison has to as well —
      // matching against the canonical `Mods` / `WorkshopItems` spelling never
      // hits, and the value would be appended as a second, losing duplicate.
      const wanted = key.toLowerCase()
      const kept: string[] = []
      let wrote = false
      for (const raw of body) {
        const t = raw.trim()
        const eq = t.indexOf('=')
        if (eq > 0 && t.slice(0, eq).trim().toLowerCase() === wanted) {
          // A hand-edited file may hold the key twice. Keep the first slot and
          // drop the rest: leaving them would let a stale line win at load time.
          if (!wrote) {
            kept.push(line)
            wrote = true
          }
          continue
        }
        kept.push(raw)
      }
      if (!wrote) kept.push(line)
      body.splice(0, body.length, ...kept)
    }
    setKey('Mods', opts.mods)
    setKey('WorkshopItems', opts.workshopItems ?? [])
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    next = `${body.join('\r\n')}\r\n`
  }

  await fs.mkdir(dirname(path), { recursive: true })
  let backupPath: string | undefined
  if (opts.backup && prev !== undefined) {
    backupPath = `${path}.bak`
    await fs.writeFile(backupPath, prev, 'utf8')
  }
  await fs.writeFile(path, next, 'utf8')

  invalidateGuard()

  return {
    path,
    bytes: Buffer.byteLength(next, 'utf8'),
    backupPath,
    durationMs: Date.now() - startedAt
  }
}
