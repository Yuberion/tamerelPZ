import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type { AppSettings, ModSource, PathsReport } from '../../shared/types'
import { exists, isDir, readTextSafe } from './fsx'

const run = promisify(execFile)

export const PZ_APP_ID = '108600'

/** Query a Windows registry value; returns undefined on any failure. */
async function regValue(key: string, name: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  try {
    const { stdout } = await run('reg', ['query', key, '/v', name], { windowsHide: true })
    const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

let steamRootCache: string | undefined | null = null

export async function detectSteamRoot(): Promise<string | undefined> {
  if (steamRootCache !== null) return steamRootCache ?? undefined

  const candidates: string[] = []
  const fromHkcu = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  if (fromHkcu) candidates.push(normalize(fromHkcu))
  const fromHklm = await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (fromHklm) candidates.push(normalize(fromHklm))
  candidates.push(
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Steam'),
    join(homedir(), '.steam', 'steam')
  )

  for (const c of candidates) {
    if (await isDir(c)) {
      steamRootCache = c
      return c
    }
  }
  steamRootCache = undefined
  return undefined
}

/** All Steam library roots, parsed from libraryfolders.vdf. */
export async function detectSteamLibraries(): Promise<string[]> {
  const root = await detectSteamRoot()
  if (!root) return []
  const libs = new Set<string>([root])

  for (const rel of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
    const text = await readTextSafe(join(root, normalize(rel)))
    if (!text) continue
    for (const m of text.matchAll(/"path"\s*"([^"]+)"/g)) {
      const p = m[1]
      if (p) libs.add(normalize(p.replace(/\\\\/g, '\\')))
    }
  }

  const out: string[] = []
  for (const l of libs) if (await isDir(l)) out.push(l)
  return out
}

/** `%USERPROFILE%\Zomboid` (user data: local mods, saves, logs). */
export async function detectZomboidDir(settings: AppSettings): Promise<string | undefined> {
  const candidates = [
    settings.zomboidDirOverride,
    join(homedir(), 'Zomboid'),
    join(process.env['USERPROFILE'] ?? homedir(), 'Zomboid'),
    join(homedir(), 'OneDrive', 'Zomboid')
  ].filter((v): v is string => Boolean(v))
  for (const c of candidates) if (await isDir(c)) return c
  return undefined
}

/** Project Zomboid install directory (Steam or manual override). */
export async function detectGameDir(settings: AppSettings): Promise<string | undefined> {
  if (settings.gameDirOverride && (await isDir(settings.gameDirOverride))) {
    return settings.gameDirOverride
  }
  for (const lib of await detectSteamLibraries()) {
    const p = join(lib, 'steamapps', 'common', 'ProjectZomboid')
    if (await isDir(p)) return p
  }
  const gog = await regValue('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1509241932', 'path')
  if (gog && (await isDir(gog))) return gog
  return undefined
}

export async function detectPaths(settings: AppSettings): Promise<PathsReport> {
  const steamRoot = await detectSteamRoot()
  const steamLibraries = await detectSteamLibraries()
  const gameDir = await detectGameDir(settings)
  const zomboidDir = await detectZomboidDir(settings)

  const workshopDirs: string[] = []
  for (const lib of steamLibraries) {
    const p = join(lib, 'steamapps', 'workshop', 'content', PZ_APP_ID)
    if (await isDir(p)) workshopDirs.push(p)
  }

  let gameVersion: string | undefined
  if (zomboidDir) {
    const v = await readTextSafe(join(zomboidDir, 'version.txt'), 512)
    gameVersion = v?.split(/\r?\n/)[0]?.trim()
  }

  return { homeDir: homedir(), zomboidDir, steamRoot, steamLibraries, gameDir, gameVersion, workshopDirs }
}

/**
 * Build the list of mod containers to scan.
 *
 * Layouts handled downstream by the scanner:
 *  - `local` / `game`   : `<container>/<ModName>`
 *  - `workshop`         : `<container>/<workshopId>/mods/<ModName>`
 *  - `project`          : `<container>/<Project>/Contents/mods/<ModName>`
 */
export async function buildSources(settings: AppSettings): Promise<ModSource[]> {
  const paths = await detectPaths(settings)
  const disabled = new Set(settings.disabledSources)
  const sources: ModSource[] = []

  const push = (s: Omit<ModSource, 'enabled' | 'modCount' | 'exists'> & { exists: boolean }): void => {
    sources.push({ ...s, modCount: 0, enabled: !disabled.has(s.id) })
  }

  if (paths.zomboidDir) {
    const local = join(paths.zomboidDir, 'mods')
    push({
      id: 'local',
      kind: 'local',
      label: 'Local mods',
      hint: local,
      path: local,
      exists: await isDir(local)
    })
  }

  for (const ws of paths.workshopDirs) {
    push({
      id: `workshop:${ws}`,
      kind: 'workshop',
      label: 'Workshop',
      hint: ws,
      path: ws,
      exists: true
    })
  }

  if (paths.gameDir) {
    for (const rel of ['mods', join('media', 'mods')]) {
      const p = join(paths.gameDir, rel)
      if (await isDir(p)) {
        push({
          id: `game:${p}`,
          kind: 'game',
          label: rel === 'mods' ? 'Game mods' : 'Game media mods',
          hint: p,
          path: p,
          exists: true
        })
      }
    }
  }

  if (paths.zomboidDir) {
    const proj = join(paths.zomboidDir, 'Workshop')
    if (await isDir(proj)) {
      push({
        id: 'project',
        kind: 'project',
        label: 'Workshop projects',
        hint: proj,
        path: proj,
        exists: true
      })
    }
  }

  for (const c of settings.customSources) {
    push({
      id: `custom:${c.id}`,
      kind: c.kind,
      label: c.label,
      hint: c.path,
      path: c.path,
      exists: await isDir(c.path)
    })
  }

  return sources
}

/** Roots the renderer is allowed to load images from via the `pzfile://` protocol. */
export async function allowedRoots(settings: AppSettings): Promise<string[]> {
  const paths = await detectPaths(settings)
  const roots = new Set<string>()
  if (paths.zomboidDir) roots.add(paths.zomboidDir)
  if (paths.gameDir) roots.add(paths.gameDir)
  for (const l of paths.steamLibraries) roots.add(l)
  for (const c of settings.customSources) roots.add(c.path)
  const out: string[] = []
  for (const r of roots) if (await exists(r)) out.push(normalize(r).toLowerCase())
  return out
}
