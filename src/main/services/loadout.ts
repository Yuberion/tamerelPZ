import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  AppSettings,
  LoadoutApplyOptions,
  LoadoutApplyResult,
  LoadoutFile,
  MapCellInfo,
  MapConflict,
  MapScanResult,
  ModEntry,
  ModFileOverwrite,
  ModOverwritesSummary,
  SortingRule
} from '../../shared/types'
import { exists, isDir, readdirSafe, readTextSafe } from './fsx'
import { invalidateGuard } from './guard'
import { detectZomboidDir } from './paths'
import { getCachedMods } from './scanner'

/**
 * Load order, profiles, saves & rules (module 02).
 *
 * Supports:
 *  - client: `Zomboid\mods\default.txt` (Build 42).
 *    VERSION = 1,
 *    mods { mod = <ModId>, }
 *    maps { map = <MapName>, }
 *  - save: `Zomboid\Saves\<mode>\<save>\mods.txt` (identical format to default.txt).
 *  - server: `Zomboid\Server\<name>.ini` with `Mods=` and `WorkshopItems=`.
 *  - sorting rules: `Zomboid\sorting_rules.txt` (MLOS format) + auto backup.
 *  - lua soft dependencies: scans media/lua files for require expressions.
 */

const CLIENT_REL = join('mods', 'default.txt')
const RULES_FILENAME = 'sorting_rules.txt'
const RULES_BACKUP_FILENAME = 'backup_1.1.2_sorting_rules.txt'
const GAME_PRESETS_REL = join('Lua', 'pz_modlist_settings.cfg')

const SAFE_SERVER_NAME = /^[\w][\w .-]{0,63}$/
const SAFE_SAVE_PART = /^[\w][\w ._-]{0,128}$/

export function parseClientList(text: string): { mods: string[]; maps: string[]; version?: string } {
  const mods: string[] = []
  const maps: string[] = []
  let version: string | undefined
  let block: 'mods' | 'maps' | '' = ''

  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t) continue

    if (/^VERSION\s*=/i.test(t)) {
      version = t
      continue
    }
    if (/^mods\s*\{?$/i.test(t)) {
      block = 'mods'
      continue
    }
    if (/^maps\s*\{?$/i.test(t)) {
      block = 'maps'
      continue
    }
    if (t === '{') continue
    if (t === '}') {
      block = ''
      continue
    }
    if (!block) continue

    if (block === 'mods') {
      if (t.startsWith('//') || t.startsWith('#')) {
        const comment = t.replace(/^\/\/\s*|#\s*/, '').trim()
        if (comment.startsWith('__SEP__:') || comment.startsWith('---')) {
          const sep = comment.startsWith('__SEP__:') ? comment : `__SEP__:${comment.replace(/^-+\s*|\s*-+$/g, '')}`
          mods.push(sep)
        }
        continue
      }
      const m = /^\s*mod\s*=\s*(.*?)\s*,?\s*$/i.exec(t)
      const token = (m ? m[1] : t.replace(/,$/, '')).trim().replace(/^\\/, '')
      if (token) mods.push(token)
    } else if (block === 'maps') {
      const m = /^\s*map\s*=\s*(.*?)\s*,?\s*$/i.exec(t)
      const token = (m ? m[1] : t.replace(/,$/, '')).trim()
      if (token) maps.push(token)
    }
  }

  return { mods, maps, version }
}

export function renderClientList(mods: string[], maps: string[], version?: string): string {
  const out: string[] = [version ?? 'VERSION = 1,', '', 'mods', '{']
  for (const m of mods) {
    if (m.startsWith('__SEP__:')) {
      out.push(`    // ${m}`)
    } else {
      out.push(`    mod = ${m},`)
    }
  }
  out.push('}', '', 'maps', '{')
  for (const m of maps) out.push(`    map = ${m},`)
  out.push('}', '')
  return `${out.join('\r\n')}\r\n`
}

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
      exists: clientPath ? await exists(clientPath) : false,
      mods: parsed.mods,
      maps: parsed.maps,
      workshopItems: []
    }
  ]

  if (zomboidDir) {
    // 1. Scan player saves: Zomboid/Saves/<mode>/<save>/mods.txt
    const savesRoot = join(zomboidDir, 'Saves')
    if (await isDir(savesRoot)) {
      const modes = await readdirSafe(savesRoot)
      for (const m of modes) {
        if (!m.isDirectory()) continue
        const modePath = join(savesRoot, m.name)
        const saveDirs = await readdirSafe(modePath)
        for (const s of saveDirs) {
          if (!s.isDirectory()) continue
          const modsTxtPath = join(modePath, s.name, 'mods.txt')
          if (await exists(modsTxtPath)) {
            const saveText = await readTextSafe(modsTxtPath)
            const saveParsed = parseClientList(saveText ?? '')
            files.push({
              id: `save:${m.name}/${s.name}`,
              kind: 'save',
              path: modsTxtPath,
              exists: true,
              saveMode: m.name,
              saveName: s.name,
              mods: saveParsed.mods,
              maps: saveParsed.maps,
              workshopItems: []
            })
          }
        }
      }
    }

    // 2. Scan server configs: Zomboid/Server/*.ini
    const serversDir = join(zomboidDir, 'Server')
    const names = (await readdirSafe(serversDir))
      .map((e) => e.name)
      .filter((n) => n.toLowerCase().endsWith('.ini'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    for (const name of names) {
      const path = join(serversDir, name)
      const text = await readTextSafe(path)
      const mods: string[] = []
      const maps: string[] = []
      const workshopItems: string[] = []
      for (const line of parseIniLines(text ?? '')) {
        if (line.kind !== 'pair') continue
        if (line.key === 'mods') mods.push(...splitIniList(line.value))
        else if (line.key === 'workshopitems') workshopItems.push(...splitIniList(line.value))
        else if (line.key === 'map') maps.push(...splitIniList(line.value))
      }
      const base = name.replace(/\.ini$/i, '')
      files.push({
        id: `server:${base}`,
        kind: 'server',
        path,
        exists: true,
        serverName: base,
        mods,
        maps,
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

  const isClient = opts.targetId === 'client'
  const isSave = opts.targetId.startsWith('save:')
  const isServer = opts.targetId.startsWith('server:')

  let path: string

  if (isClient) {
    path = join(zomboidDir, CLIENT_REL)
  } else if (isSave) {
    const rawParts = opts.targetId.slice(5).split('/')
    if (rawParts.length !== 2) throw new Error(`Invalid save target format: ${opts.targetId}`)
    const [mode, saveName] = rawParts
    if (!SAFE_SAVE_PART.test(mode) || !SAFE_SAVE_PART.test(saveName)) {
      throw new Error(`Refusing to write save with invalid folder name: ${mode}/${saveName}`)
    }
    path = join(zomboidDir, 'Saves', mode, saveName, 'mods.txt')
  } else if (isServer) {
    const baseName = opts.targetId.slice(7)
    if (!SAFE_SERVER_NAME.test(baseName)) {
      throw new Error(`Refusing to write server config named "${baseName}"`)
    }
    path = join(zomboidDir, 'Server', `${baseName}.ini`)
  } else {
    throw new Error(`Unknown loadout target: ${opts.targetId}`)
  }

  const prev = await readTextSafe(path)

  let next: string
  if (isClient || isSave) {
    next = renderClientList(opts.mods, opts.maps ?? [], parseClientList(prev ?? '').version)
  } else {
    // Server flat INI: rewrite only Mods= and WorkshopItems= keys
    const body = parseIniLines(prev ?? '').map((l) => l.raw)
    const setKey = (key: string, value: string[]): void => {
      const line = `${key}=${value.join(';')}${value.length > 0 ? ';' : ''}`
      const wanted = key.toLowerCase()
      const kept: string[] = []
      let wrote = false
      for (const raw of body) {
        const t = raw.trim()
        const eq = t.indexOf('=')
        if (eq > 0 && t.slice(0, eq).trim().toLowerCase() === wanted) {
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
    const cleanMods = opts.mods.filter((m) => !m.startsWith('__SEP__:'))
    setKey('Mods', cleanMods)
    setKey('WorkshopItems', opts.workshopItems ?? [])
    if (opts.maps && opts.maps.length > 0) {
      setKey('Map', opts.maps)
    }
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

/* =========================================================================
   Sorting Rules (sorting_rules.txt)
   ========================================================================= */

function splitCsvList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().replace(/^\\/, ''))
    .filter(Boolean)
}

function parseRulesText(text: string): Record<string, SortingRule> {
  const rules: Record<string, SortingRule> = {}
  let currentId: string | undefined

  const sectionRe = /^\s*\[\s*(.*?)\s*\]\s*$/
  const kvRe = /^\s*(.*?)\s*=\s*(.*?)\s*$/

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim()
    if (!stripped) continue

    const sm = sectionRe.exec(stripped)
    if (sm) {
      currentId = sm[1].replace(/^\\/, '').trim()
      rules[currentId] ??= {
        loadAfter: [],
        loadBefore: [],
        incompatibleMods: [],
        loadFirst: 'off',
        loadLast: 'off'
      }
      continue
    }

    if (!currentId) continue

    const kv = kvRe.exec(stripped)
    if (!kv) continue

    const key = kv[1].toLowerCase().trim()
    const val = kv[2].trim()
    const rule = rules[currentId]

    if (key === 'loadafter' || key === 'loadmodafter') {
      rule.loadAfter.push(...splitCsvList(val))
    } else if (key === 'loadbefore' || key === 'loadmodbefore') {
      rule.loadBefore.push(...splitCsvList(val))
    } else if (key === 'incompatiblemods' || key === 'incompatible') {
      rule.incompatibleMods.push(...splitCsvList(val))
    } else if (key === 'loadfirst') {
      const v = val.toLowerCase()
      rule.loadFirst = v === 'on' || v === 'category' ? v : 'off'
    } else if (key === 'loadlast') {
      const v = val.toLowerCase()
      rule.loadLast = v === 'on' || v === 'category' ? v : 'off'
    } else if (key === 'category') {
      rule.category = val || undefined
    }
  }

  // Deduplicate and filter out empty rules
  const result: Record<string, SortingRule> = {}
  for (const [id, r] of Object.entries(rules)) {
    r.loadAfter = [...new Set(r.loadAfter)]
    r.loadBefore = [...new Set(r.loadBefore)]
    r.incompatibleMods = [...new Set(r.incompatibleMods)]
    const empty =
      r.loadAfter.length === 0 &&
      r.loadBefore.length === 0 &&
      r.incompatibleMods.length === 0 &&
      r.loadFirst === 'off' &&
      r.loadLast === 'off' &&
      !r.category
    if (!empty) result[id] = r
  }
  return result
}

function dumpRulesText(rules: Record<string, SortingRule>): string {
  const lines: string[] = []
  for (const modId of Object.keys(rules).sort((a, b) => a.localeCompare(b))) {
    const r = rules[modId]
    lines.push(`[${modId}]`)
    if (r.loadAfter.length) lines.push(`loadAfter=${r.loadAfter.join(',')}`)
    if (r.loadBefore.length) lines.push(`loadBefore=${r.loadBefore.join(',')}`)
    if (r.incompatibleMods.length) lines.push(`incompatibleMods=${r.incompatibleMods.join(',')}`)
    if (r.loadFirst !== 'off') lines.push(`loadFirst=${r.loadFirst}`)
    if (r.loadLast !== 'off') lines.push(`loadLast=${r.loadLast}`)
    if (r.category) lines.push(`category=${r.category}`)
    lines.push('')
  }
  return lines.join('\r\n')
}

export async function readSortingRules(settings: AppSettings): Promise<Record<string, SortingRule>> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return {}

  const rulesPath = join(zomboidDir, RULES_FILENAME)
  const backupPath = join(zomboidDir, RULES_BACKUP_FILENAME)

  if (await exists(rulesPath)) {
    // Create initial backup if not already present
    if (!(await exists(backupPath))) {
      try {
        await fs.copyFile(rulesPath, backupPath)
      } catch {
        // non-fatal
      }
    }
    const text = await readTextSafe(rulesPath)
    return parseRulesText(text ?? '')
  }
  return {}
}

export async function saveSortingRules(
  settings: AppSettings,
  rules: Record<string, SortingRule>
): Promise<boolean> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return false

  const rulesPath = join(zomboidDir, RULES_FILENAME)
  const text = dumpRulesText(rules)
  try {
    await fs.mkdir(dirname(rulesPath), { recursive: true })
    await fs.writeFile(rulesPath, text, 'utf8')
    invalidateGuard()
    return true
  } catch {
    return false
  }
}

/* =========================================================================
   In-game Presets ([B42] Mod Manager: pz_modlist_settings.cfg)
   ========================================================================= */

export async function readGamePresets(settings: AppSettings): Promise<Record<string, string[]>> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return {}

  const cfgPath = join(zomboidDir, GAME_PRESETS_REL)
  if (!(await exists(cfgPath))) return {}

  const text = await readTextSafe(cfgPath)
  if (!text) return {}

  const presets: Record<string, string[]> = {}
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim()
    if (!stripped || stripped.startsWith('!fav!')) continue
    const sep = stripped.indexOf(':')
    if (sep <= 0) continue

    const name = stripped.slice(0, sep).trim()
    const raw = stripped.slice(sep + 1)
    if (!name) continue

    const ids: string[] = []
    for (const part of raw.replace(/,/g, ';').split(';')) {
      const p = part.trim().replace(/^\\/, '')
      if (p) ids.push(p)
    }
    if (ids.length > 0) presets[name] = ids
  }
  return presets
}

export async function saveGamePresets(
  settings: AppSettings,
  presets: Record<string, string[]>
): Promise<boolean> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return false

  const cfgPath = join(zomboidDir, GAME_PRESETS_REL)
  const lines: string[] = []
  for (const [name, ids] of Object.entries(presets)) {
    if (!name || ids.length === 0) continue
    lines.push(`${name}:${ids.join(';')};`)
  }
  const text = lines.join('\r\n') + '\r\n'

  try {
    await fs.mkdir(dirname(cfgPath), { recursive: true })
    await fs.writeFile(cfgPath, text, 'utf8')
    invalidateGuard()
    return true
  } catch {
    return false
  }
}

/* =========================================================================
   Lua Soft Dependencies Scanner
   ========================================================================= */

const PZ_LUA_STDLIB = new Set([
  'string', 'table', 'math', 'os', 'io', 'coroutine', 'debug', 'utf8',
  'package', 'bit', 'bit32', 'lpeg', 'luautils', 'util', 'utils',
  'defines', 'logger', 'log', 'errors', 'debugtools', 'textutils',
  'sanity', 'rng', 'rand', 'calldeinfo', 'callfunc', 'iso',
  'zombie', 'isoplayer', 'isozombie', 'isoobject', 'isogridsquare',
  'isocell', 'isoscene', 'isomap', 'isonet', 'isoserver', 'isoclient',
  'isodin', 'isobuilding', 'isodamage', 'isoinventory', 'isovehicle',
  'isowindow', 'isodoor', 'isofurniture', 'isometaldetector', 'isonpc',
  'event', 'events', 'sandboxvars', 'getcore', 'gettext', 'getkey',
  'getmonth', 'getclock', 'getgametime', 'getworld', 'getplayer',
  'getcell', 'getwindowmanager', 'getmodmanager', 'moddata', 'modinfo',
  'require', 'inspect', 'serpent', 'pl', 'penlight', 'commander',
  'chatmanager', 'workshop', 'steam', 'gameclient', 'gameserver'
])

const REQUIRE_RE = /\brequire\s*(?:\(\s*)?["']([A-Za-z0-9_\-./\\]+)["']/g

interface LuaDepsCacheEntry {
  mtime: number
  deps: string[]
}

const luaDepsCache = new Map<string, LuaDepsCacheEntry>()

function normalizeRequireToken(token: string): string {
  const clean = token.replace(/\\/g, '/').split('/').pop() ?? ''
  return clean.replace(/\.(lua|txt|module)$/i, '').trim().toLowerCase()
}

async function collectLuaFiles(dir: string, maxFiles = 500, maxDepth = 6): Promise<string[]> {
  const result: string[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }]

  while (queue.length > 0 && result.length < maxFiles) {
    const item = queue.shift()!
    const entries = await readdirSafe(item.path)
    for (const e of entries) {
      if (result.length >= maxFiles) break
      const full = join(item.path, e.name)
      if (e.isFile() && e.name.toLowerCase().endsWith('.lua')) {
        result.push(full)
      } else if (e.isDirectory() && item.depth < maxDepth && !e.name.startsWith('.')) {
        queue.push({ path: full, depth: item.depth + 1 })
      }
    }
  }
  return result
}

export async function scanLuaSoftDeps(mods?: ModEntry[]): Promise<Record<string, string[]>> {
  const allMods = mods ?? getCachedMods()
  if (!allMods || allMods.length === 0) return {}

  // Build lookup: normalized name -> modId
  const known = new Map<string, string>()
  for (const m of allMods) {
    if (m.modId) {
      known.set(m.modId.toLowerCase(), m.modId)
      known.set(basename(m.path).toLowerCase(), m.modId)
      if (m.folderName) known.set(m.folderName.toLowerCase(), m.modId)
    }
  }

  const results: Record<string, string[]> = {}

  for (const mod of allMods) {
    if (!mod.modId || !mod.path) continue
    const modId = mod.modId

    const cached = luaDepsCache.get(mod.path)
    if (cached && cached.mtime === mod.mtime) {
      results[modId] = cached.deps
      continue
    }

    const candidateDirs = [
      join(mod.path, 'media', 'lua'),
      join(mod.path, 'common', 'media', 'lua'),
      join(mod.path, '42', 'media', 'lua')
    ]

    const luaFiles: string[] = []
    for (const d of candidateDirs) {
      if (await isDir(d)) {
        luaFiles.push(...(await collectLuaFiles(d, 300, 5)))
      }
    }

    const matchedDeps = new Set<string>()

    for (const file of luaFiles) {
      const text = await readTextSafe(file, 256 * 1024)
      if (!text) continue
      let match: RegExpExecArray | null
      while ((match = REQUIRE_RE.exec(text)) !== null) {
        const norm = normalizeRequireToken(match[1])
        if (!norm || PZ_LUA_STDLIB.has(norm)) continue
        const targetMod = known.get(norm)
        if (targetMod && targetMod.toLowerCase() !== modId.toLowerCase()) {
          matchedDeps.add(targetMod)
        }
      }
    }

    const depList = Array.from(matchedDeps)
    luaDepsCache.set(mod.path, { mtime: mod.mtime, deps: depList })
    results[modId] = depList
  }

  return results
}

/* =========================================================================
   File Overwrite Matrix (module 02 - Point 7)
   ========================================================================= */

async function collectMediaRelativeFiles(
  modPath: string,
  maxFiles = 2500,
  maxDepth = 7
): Promise<string[]> {
  const result: string[] = []
  const prefixes = [
    { base: join(modPath, 'media'), relPrefix: 'media' },
    { base: join(modPath, 'common', 'media'), relPrefix: 'media' },
    { base: join(modPath, '42', 'media'), relPrefix: 'media' }
  ]

  for (const { base, relPrefix } of prefixes) {
    if (!(await isDir(base))) continue
    const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: base, rel: relPrefix, depth: 0 }]
    while (queue.length > 0 && result.length < maxFiles) {
      const item = queue.shift()!
      const entries = await readdirSafe(item.dir)
      for (const e of entries) {
        if (result.length >= maxFiles) break
        const childPath = join(item.dir, e.name)
        const childRel = `${item.rel}/${e.name}`.toLowerCase().replace(/\\/g, '/')
        if (e.isFile()) {
          result.push(childRel)
        } else if (e.isDirectory() && item.depth < maxDepth && !e.name.startsWith('.')) {
          queue.push({ dir: childPath, rel: childRel, depth: item.depth + 1 })
        }
      }
    }
  }
  return result
}

export async function scanFileOverwrites(activeModIds: string[]): Promise<ModOverwritesSummary> {
  const allMods = getCachedMods()
  const modMap = new Map<string, ModEntry>()
  for (const m of allMods) {
    if (m.modId) modMap.set(m.modId.toLowerCase(), m)
    if (m.rawModId) modMap.set(m.rawModId.toLowerCase(), m)
    if (m.folderName) modMap.set(m.folderName.toLowerCase(), m)
  }

  const cleanIds = activeModIds.filter((id) => !id.startsWith('__SEP__:'))
  const filesByRel = new Map<string, string[]>()
  const overwritesOthers: Record<string, number> = {}
  const overwrittenByOthers: Record<string, number> = {}

  for (const rawId of cleanIds) {
    const norm = rawId.trim().toLowerCase().replace(/^\d+\//, '')
    const mod = modMap.get(norm)
    if (!mod || !mod.path) continue

    const files = await collectMediaRelativeFiles(mod.path)
    for (const rel of files) {
      const list = filesByRel.get(rel) ?? []
      if (!list.includes(rawId)) {
        list.push(rawId)
        filesByRel.set(rel, list)
      }
    }
  }

  const collisions: ModFileOverwrite[] = []

  for (const [relPath, providers] of filesByRel.entries()) {
    if (providers.length <= 1) continue
    const winner = providers[providers.length - 1]
    collisions.push({ relPath, providers, winner })

    overwritesOthers[winner] = (overwritesOthers[winner] ?? 0) + 1
    for (let i = 0; i < providers.length - 1; i++) {
      const prev = providers[i]
      overwrittenByOthers[prev] = (overwrittenByOthers[prev] ?? 0) + 1
    }
  }

  return { overwritesOthers, overwrittenByOthers, collisions }
}

/* =========================================================================
   Map Conflicts & Cells Inspector (module 02 - Point 6)
   ========================================================================= */

const LOTPACK_RE = /^(?:world_)?(\d+)_(\d+)\.lotpack$/i

export async function scanMapCells(activeModIds: string[]): Promise<MapScanResult> {
  const allMods = getCachedMods()
  const modMap = new Map<string, ModEntry>()
  for (const m of allMods) {
    if (m.modId) modMap.set(m.modId.toLowerCase(), m)
    if (m.rawModId) modMap.set(m.rawModId.toLowerCase(), m)
    if (m.folderName) modMap.set(m.folderName.toLowerCase(), m)
  }

  const cleanIds = activeModIds.filter((id) => !id.startsWith('__SEP__:'))
  const maps: MapCellInfo[] = []

  for (const rawId of cleanIds) {
    const norm = rawId.trim().toLowerCase().replace(/^\d+\//, '')
    const mod = modMap.get(norm)
    if (!mod || !mod.path) continue

    const mapCandidates = [
      join(mod.path, 'media', 'maps'),
      join(mod.path, 'common', 'media', 'maps'),
      join(mod.path, '42', 'media', 'maps')
    ]

    for (const candidate of mapCandidates) {
      if (!(await isDir(candidate))) continue
      const mapFolders = await readdirSafe(candidate)
      for (const mf of mapFolders) {
        if (!mf.isDirectory() || mf.name.startsWith('.')) continue
        const mapFolder = join(candidate, mf.name)
        const mapInfoText = await readTextSafe(join(mapFolder, 'map.info'), 16 * 1024)

        let title: string | undefined
        let lots: string | undefined
        if (mapInfoText) {
          for (const line of mapInfoText.split(/\r?\n/)) {
            const tm = /^\s*title\s*=\s*(.*?)\s*$/i.exec(line)
            if (tm) title = tm[1]
            const lm = /^\s*lots\s*=\s*(.*?)\s*$/i.exec(line)
            if (lm) lots = lm[1]
          }
        }

        const files = await readdirSafe(mapFolder)
        const cellsSet = new Set<string>()
        for (const f of files) {
          const m = LOTPACK_RE.exec(f.name)
          if (m) {
            cellsSet.add(`${m[1]}_${m[2]}`)
          }
        }

        const cells = Array.from(cellsSet).sort()
        maps.push({
          mapName: mf.name,
          folderName: mf.name,
          modId: rawId,
          cells,
          title: title ?? mf.name,
          lots
        })
      }
    }
  }

  // Detect cell overlaps
  const cellUsage = new Map<string, Array<{ mapName: string; modId: string; title?: string }>>()
  for (const map of maps) {
    for (const cell of map.cells) {
      const list = cellUsage.get(cell) ?? []
      list.push({ mapName: map.mapName, modId: map.modId, title: map.title })
      cellUsage.set(cell, list)
    }
  }

  const conflicts: MapConflict[] = []
  for (const [cell, sharing] of cellUsage.entries()) {
    if (sharing.length > 1) {
      const winningMap = sharing[sharing.length - 1].mapName
      conflicts.push({ cell, maps: sharing, winningMap })
    }
  }

  return { maps, conflicts }
}
