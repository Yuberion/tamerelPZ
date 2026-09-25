import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type {
  AppSettings,
  JavaDecompileResult,
  LogCleanResult,
  LogDiffItem,
  LogDiffResult,
  LogReadResult,
  LogSource,
  SourceResolution,
  SourceSnippetResult
} from '../../shared/types'
import { exists, isDir, pLimit, readdirSafe, readTailSafe, readTextSafe } from './fsx'
import { detectGameDir, detectZomboidDir } from './paths'

const runExec = promisify(execFile)

/**
 * Ledger (module 09) — read-only log reader.
 *
 * Two sources, both under the Zomboid user directory:
 *
 *  - `Zomboid\console.txt` — the live log of the session that is running now.
 *    The game holds it open and appends to it, so every read is a snapshot.
 *  - `Zomboid\Logs\*.txt` — one set of files per launch, named after the moment
 *    the game started (`26-08-26_14-30-00_DebugLog.txt` and friends).
 *
 * Nothing here writes, and nothing here takes a path from the renderer: the
 * renderer sends an opaque id and this module resolves it, the same contract
 * `loadout.ts` uses. `allowedRoots()` already contains the Zomboid dir, so the
 * shared guard lets the renderer reveal these files without any new rule.
 */

const CONSOLE_NAME = 'console.txt'
const LOGS_DIR = 'Logs'

/** How much of a log's tail is handed to the renderer at once. */
const LOG_TAIL_MAX = 1024 * 1024

/**
 * Log file name accepted from the renderer.
 *
 * Deliberately narrower than the filesystem allows: no separators, no `..`, no
 * drive letters, and a `.txt` suffix. A name that passes this still has to
 * appear in an actual listing of `Logs` before it is opened — the same
 * belt-and-braces shape as `SAFE_SERVER_NAME` in `loadout.ts`.
 */
const SAFE_LOG_NAME = /^[\w.\-]{1,120}\.txt$/i

const statLimit = pLimit(24)

async function statOf(path: string): Promise<{ size: number; mtime: number } | undefined> {
  try {
    const st = await fs.stat(path)
    return { size: st.size, mtime: st.mtimeMs }
  } catch {
    return undefined
  }
}

/** Archived log names as they exist on disk right now. */
async function logNames(logsDir: string): Promise<string[]> {
  return (await readdirSafe(logsDir))
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
    .map((e) => e.name)
}

export async function listLogSources(settings: AppSettings): Promise<LogSource[]> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return []

  const consolePath = join(zomboidDir, CONSOLE_NAME)
  const consoleStat = await statOf(consolePath)
  const out: LogSource[] = [
    {
      id: 'console',
      kind: 'console',
      name: CONSOLE_NAME,
      path: consolePath,
      // An empty console.txt still exists, and the module has to say so rather
      // than report "no logs" — so ask the filesystem, not the stat result.
      exists: await exists(consolePath),
      size: consoleStat?.size ?? 0,
      mtime: consoleStat?.mtime ?? 0
    }
  ]

  const logsDir = join(zomboidDir, LOGS_DIR)
  const names = await logNames(logsDir)
  const archived = await Promise.all(
    names.map((name) =>
      statLimit(async (): Promise<LogSource> => {
        const path = join(logsDir, name)
        const st = await statOf(path)
        return {
          id: `log:${name}`,
          kind: 'log',
          name,
          path,
          exists: true,
          size: st?.size ?? 0,
          mtime: st?.mtime ?? 0
        }
      })
    )
  )

  // Freshest first, by mtime rather than by name: PZ stamps its log names
  // `dd-MM-yy_HH-mm-ss`, which does not sort chronologically as text.
  archived.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
  out.push(...archived)
  return out
}

export async function readLog(
  settings: AppSettings,
  id: string,
  full = false
): Promise<LogReadResult> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) throw new Error('Zomboid user directory not found')

  let path: string
  if (id === 'console') {
    path = join(zomboidDir, CONSOLE_NAME)
  } else if (id.startsWith('log:')) {
    const name = id.slice(4)
    if (!SAFE_LOG_NAME.test(name)) throw new Error(`Refusing log name "${name}"`)
    const logsDir = join(zomboidDir, LOGS_DIR)
    if (!(await logNames(logsDir)).includes(name)) throw new Error(`Unknown log: ${name}`)
    path = join(logsDir, name)
  } else {
    throw new Error(`Unknown log source: ${id}`)
  }

  const maxBytes = full ? 50 * 1024 * 1024 : LOG_TAIL_MAX
  const tail = await readTailSafe(path, maxBytes)
  if (!tail) throw new Error(`Cannot read log: ${path}`)
  return {
    id,
    path,
    text: tail.text,
    size: tail.size,
    mtime: tail.mtime,
    truncated: tail.truncated,
    isFull: full
  }
}

export async function probeLog(
  settings: AppSettings,
  id: string
): Promise<{ size: number; mtime: number } | undefined> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return undefined

  let path: string
  if (id === 'console') {
    path = join(zomboidDir, CONSOLE_NAME)
  } else if (id.startsWith('log:')) {
    const name = id.slice(4)
    if (!SAFE_LOG_NAME.test(name)) return undefined
    path = join(zomboidDir, LOGS_DIR, name)
  } else {
    return undefined
  }

  return statOf(path)
}

export async function cleanArchivedLogs(
  settings: AppSettings,
  keepCount = 10
): Promise<LogCleanResult> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) throw new Error('Zomboid user directory not found')

  const logsDir = join(zomboidDir, LOGS_DIR)
  const names = await logNames(logsDir)
  if (names.length <= keepCount) {
    return { deleted: 0, freedBytes: 0 }
  }

  const archived = await Promise.all(
    names.map(async (name) => {
      const path = join(logsDir, name)
      const st = await statOf(path)
      return {
        name,
        path,
        size: st?.size ?? 0,
        mtime: st?.mtime ?? 0
      }
    })
  )

  archived.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
  const toDelete = archived.slice(Math.max(0, keepCount))

  let deleted = 0
  let freedBytes = 0

  for (const item of toDelete) {
    try {
      await fs.unlink(item.path)
      deleted++
      freedBytes += item.size
    } catch {
      // Ignore individual file unlink errors
    }
  }

  return { deleted, freedBytes }
}

const resolutionCache = new Map<string, SourceResolution | null>()

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function collectFilesRecursively(
  dir: string,
  extFilter: (name: string) => boolean,
  maxDepth = 6
): Promise<string[]> {
  const result: string[] = []
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    const entries = await readdirSafe(current)
    const subdirs: string[] = []
    for (const entry of entries) {
      if (entry.isFile() && extFilter(entry.name)) {
        result.push(join(current, entry.name))
      } else if (entry.isDirectory()) {
        subdirs.push(join(current, entry.name))
      }
    }
    for (const sub of subdirs) {
      await walk(sub, depth + 1)
    }
  }
  await walk(dir, 0)
  return result
}

/**
 * Fast search for an entity, item, vehicle, recipe, or symbol definition in script or lua files.
 */
async function findSymbolInRoot(
  root: string,
  symbol: string
): Promise<SourceResolution | undefined> {
  const cleanSymbol = symbol.trim().replace(/^['"]|['"]$/g, '')
  if (!cleanSymbol || cleanSymbol.length < 2) return undefined

  // Strip namespace if present for matching (e.g. "Base.Axe" -> "Axe")
  const shortSym = cleanSymbol.includes('.') ? (cleanSymbol.split('.').pop() ?? cleanSymbol) : cleanSymbol
  const escShort = escapeRegex(shortSym)
  const escFull = escapeRegex(cleanSymbol)

  // 1. Check media/scripts (for entity, item, vehicle, recipe, template)
  const scriptsDir = join(root, 'media', 'scripts')
  if (await exists(scriptsDir)) {
    const txtFiles = await collectFilesRecursively(scriptsDir, (n) => n.toLowerCase().endsWith('.txt'), 5)
    // Sort so files containing name parts come first
    const needle = shortSym.toLowerCase()
    txtFiles.sort((a, b) => {
      const aHit = a.toLowerCase().includes(needle) ? 1 : 0
      const bHit = b.toLowerCase().includes(needle) ? 1 : 0
      return bHit - aHit
    })

    const exactEntityRe = new RegExp(`^\\s*entity\\s+(${escShort}|${escFull})\\b`, 'i')
    const itemOrOtherRe = new RegExp(`^\\s*(?:item|vehicle|recipe|template)\\s+(${escShort}|${escFull})\\b`, 'i')
    const generalRe = new RegExp(`\\b(${escShort}|${escFull})\\b`, 'i')

    for (const file of txtFiles) {
      const content = await readTextSafe(file, 512 * 1024)
      if (!content || !content.toLowerCase().includes(needle)) continue
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (exactEntityRe.test(line) || itemOrOtherRe.test(line)) {
          return { path: normalize(file), line: i + 1 }
        }
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (generalRe.test(line)) {
          return { path: normalize(file), line: i + 1 }
        }
      }
    }
  }

  // 2. Check media/lua (for containers, distributions, global definitions)
  const luaDir = join(root, 'media', 'lua')
  if (await exists(luaDir)) {
    const luaFiles = await collectFilesRecursively(luaDir, (n) => n.toLowerCase().endsWith('.lua'), 6)
    const needle = shortSym.toLowerCase()
    luaFiles.sort((a, b) => {
      const aLower = a.toLowerCase()
      const bLower = b.toLowerCase()
      const aPrio = aLower.includes('distribution') || aLower.includes('container') || aLower.includes(needle) ? 1 : 0
      const bPrio = bLower.includes('distribution') || bLower.includes('container') || bLower.includes(needle) ? 1 : 0
      return bPrio - aPrio
    })

    const assignRe = new RegExp(`^\\s*(${escShort}|${escFull})\\s*=`, 'i')
    const fieldRe = new RegExp(`\\b(${escShort}|${escFull})\\s*=`, 'i')
    const strRe = new RegExp(`["'](${escShort}|${escFull})["']`, 'i')

    for (const file of luaFiles) {
      const content = await readTextSafe(file, 512 * 1024)
      if (!content || !content.toLowerCase().includes(needle)) continue
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (assignRe.test(line) || fieldRe.test(line)) {
          return { path: normalize(file), line: i + 1 }
        }
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (strRe.test(line)) {
          return { path: normalize(file), line: i + 1 }
        }
      }
    }
  }

  return undefined
}

async function findFileRecursively(
  dir: string,
  targetName: string,
  maxDepth = 6
): Promise<string | undefined> {
  const lowerTarget = targetName.toLowerCase()
  async function walk(current: string, depth: number): Promise<string | undefined> {
    if (depth > maxDepth) return undefined
    const entries = await readdirSafe(current)
    const subdirs: string[] = []
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === lowerTarget) {
        return join(current, entry.name)
      }
      if (entry.isDirectory()) {
        subdirs.push(join(current, entry.name))
      }
    }
    for (const sub of subdirs) {
      const found = await walk(sub, depth + 1)
      if (found) return found
    }
    return undefined
  }
  return walk(dir, 0)
}

/**
 * Locate the real source file on disk corresponding to a log call-site.
 * Searches inside the mod directory (including versioned subfolders `42/`, `common/`, etc.)
 * or inside the vanilla game directory.
 * Returns the exact file path and line number, never a folder.
 */
export async function resolveLogSourceFile(
  file: string,
  modPath?: string,
  gameDir?: string,
  line?: number
): Promise<SourceResolution | undefined> {
  if (!file || typeof file !== 'string') return undefined

  let target = file.trim()
  let lineNum = line
  // If e.g. "ISVehicleMenu.lua:210"
  const lineSuffix = /:(\d+)$/.exec(target)
  if (lineSuffix) {
    if (!lineNum) lineNum = Number(lineSuffix[1])
    target = target.slice(0, lineSuffix.index).trim()
  }

  const cacheKey = `${target}::${lineNum ?? ''}::${modPath ?? ''}::${gameDir ?? ''}`
  if (resolutionCache.has(cacheKey)) {
    const cached = resolutionCache.get(cacheKey)
    return cached ?? undefined
  }

  async function finish(res: SourceResolution | undefined): Promise<SourceResolution | undefined> {
    if (res && (await exists(res.path)) && !(await isDir(res.path))) {
      resolutionCache.set(cacheKey, res)
      return res
    }
    resolutionCache.set(cacheKey, null)
    return undefined
  }

  // 1. If absolute path on Windows
  if (/^[A-Za-z]:[\\/]/.test(target)) {
    if ((await exists(target)) && !(await isDir(target))) {
      return finish({ path: normalize(target), line: lineNum })
    }
  }

  const clean = target.replace(/\\/g, '/').replace(/^[./\\]+/, '')
  const base = basename(clean)
  const hasExt = base.includes('.') && /\.(lua|txt|xml|json|png|ogg|wav)$/i.test(base)

  async function testCandidate(root: string, rel: string): Promise<string | undefined> {
    const candidates = [
      join(root, rel),
      join(root, 'media', rel),
      join(root, 'media', 'lua', rel),
      join(root, 'media', 'scripts', rel)
    ]
    for (const c of candidates) {
      if ((await exists(c)) && !(await isDir(c))) return normalize(c)
    }
    return undefined
  }

  // 2. Direct file lookup with extension
  if (hasExt) {
    // 2a. Mod folder lookup
    if (modPath && (await exists(modPath))) {
      const direct = await testCandidate(modPath, clean)
      if (direct) return finish({ path: direct, line: lineNum })

      for (const v of ['42', 'common', '42.13', '42.14', '42.15', '41']) {
        const vDir = join(modPath, v)
        if (await exists(vDir)) {
          const vDirect = await testCandidate(vDir, clean)
          if (vDirect) return finish({ path: vDirect, line: lineNum })
        }
      }

      const foundInMod = await findFileRecursively(modPath, base, 5)
      if (foundInMod && !(await isDir(foundInMod))) {
        return finish({ path: normalize(foundInMod), line: lineNum })
      }
    }

    // 2b. Vanilla game folder lookup
    if (gameDir && (await exists(gameDir))) {
      const directGame = await testCandidate(gameDir, clean)
      if (directGame) return finish({ path: directGame, line: lineNum })

      const gameLuaDir = join(gameDir, 'media', 'lua')
      if (await exists(gameLuaDir)) {
        const foundInGame = await findFileRecursively(gameLuaDir, base, 6)
        if (foundInGame && !(await isDir(foundInGame))) {
          return finish({ path: normalize(foundInGame), line: lineNum })
        }
      }

      const gameScriptsDir = join(gameDir, 'media', 'scripts')
      if (await exists(gameScriptsDir)) {
        const foundInScripts = await findFileRecursively(gameScriptsDir, base, 5)
        if (foundInScripts && !(await isDir(foundInScripts))) {
          return finish({ path: normalize(foundInScripts), line: lineNum })
        }
      }

      const gameMediaDir = join(gameDir, 'media')
      if (await exists(gameMediaDir)) {
        const foundInMedia = await findFileRecursively(gameMediaDir, base, 6)
        if (foundInMedia && !(await isDir(foundInMedia))) {
          return finish({ path: normalize(foundInMedia), line: lineNum })
        }
      }
    }
  }

  // 3. Symbol / Entity / Object definition lookup (e.g. Wooden_Windows, inventoryfemale)
  if (modPath && (await exists(modPath))) {
    const symInMod = await findSymbolInRoot(modPath, target)
    if (symInMod) return finish(symInMod)

    for (const v of ['42', 'common', '42.13', '42.14', '42.15', '41']) {
      const vDir = join(modPath, v)
      if (await exists(vDir)) {
        const vSym = await findSymbolInRoot(vDir, target)
        if (vSym) return finish(vSym)
      }
    }
  }

  if (gameDir && (await exists(gameDir))) {
    const symInGame = await findSymbolInRoot(gameDir, target)
    if (symInGame) return finish(symInGame)
  }

  return finish(undefined)
}

/**
 * Read code snippet around targetLine for inline viewing in Ledger.
 */
export async function readSourceSnippet(
  filePath: string,
  targetLine: number,
  radius = 12
): Promise<SourceSnippetResult | undefined> {
  if (!filePath || !(await exists(filePath)) || (await isDir(filePath))) {
    return undefined
  }
  const text = await readTextSafe(filePath, 2 * 1024 * 1024)
  if (text === undefined) return undefined

  const allLines = text.split(/\r?\n/)
  const total = allLines.length
  if (total === 0) return undefined

  const safeTarget = Math.max(1, Math.min(total, Math.trunc(targetLine)))
  const startLine = Math.max(1, safeTarget - radius)
  const endLine = Math.min(total, safeTarget + radius)

  const lines = []
  for (let i = startLine - 1; i < endLine; i++) {
    lines.push({
      num: i + 1,
      text: allLines[i] ?? '',
      isTarget: i + 1 === safeTarget
    })
  }

  const lower = filePath.toLowerCase()
  let lang: 'lua' | 'txt' | 'json' | 'plain' = 'plain'
  if (lower.endsWith('.lua')) lang = 'lua'
  else if (lower.endsWith('.txt')) lang = 'txt'
  else if (lower.endsWith('.json')) lang = 'json'

  return {
    path: normalize(filePath),
    targetLine: safeTarget,
    startLine,
    endLine,
    lines,
    lang
  }
}

const decompileCache = new Map<string, JavaDecompileResult>()

const COMMON_PZ_PACKAGES = [
  'zombie.characters',
  'zombie.vehicles',
  'zombie.iso',
  'zombie.iso.objects',
  'zombie.iso.areas',
  'zombie.inventory',
  'zombie.inventory.types',
  'zombie.gameStates',
  'zombie.ui',
  'zombie.core',
  'zombie.core.skinnedmodel',
  'zombie.network',
  'zombie.world',
  'zombie.worldMap',
  'zombie.scripting',
  'zombie.scripting.objects',
  'zombie.audio',
  'zombie',
  'se.krka.kahlua.vm',
  'se.krka.kahlua.stdlib'
]

async function findGameJar(settings: AppSettings): Promise<string | undefined> {
  const gameDir = await detectGameDir(settings)
  if (gameDir) {
    const jarCandidate = join(gameDir, 'projectzomboid.jar')
    if (await exists(jarCandidate)) return jarCandidate
  }
  const fallback = 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\projectzomboid.jar'
  if (await exists(fallback)) return fallback
  return undefined
}

export async function decompileJavaClass(
  settings: AppSettings,
  rawClassName: string,
  methodName?: string
): Promise<JavaDecompileResult> {
  let cleanName = rawClassName.trim().replace(/\.java$/i, '').replace(/^[./\\]+/, '')
  const methodMatch = /([a-zA-Z0-9_$.]+)\.([a-zA-Z0-9_$]+)(?:\(|$)/.exec(cleanName)
  let filterMethod = methodName
  if (methodMatch && cleanName.includes('.')) {
    const parts = cleanName.split('.')
    if (parts.length > 2 && /^[a-z]/.test(parts[parts.length - 1]!)) {
      filterMethod = parts.pop()
      cleanName = parts.join('.')
    }
  }

  const cacheKey = `${cleanName}::${filterMethod ?? ''}`
  if (decompileCache.has(cacheKey)) {
    return decompileCache.get(cacheKey)!
  }

  const jarPath = await findGameJar(settings)
  if (!jarPath) {
    return {
      className: cleanName,
      decompiled: '',
      error: 'projectzomboid.jar was not found'
    }
  }

  const candidates: string[] = []
  if (cleanName.includes('.')) {
    candidates.push(cleanName)
  } else {
    for (const pkg of COMMON_PZ_PACKAGES) {
      candidates.push(`${pkg}.${cleanName}`)
    }
    candidates.push(cleanName)
  }

  for (const candidate of candidates) {
    try {
      const { stdout } = await runExec('javap', ['-cp', jarPath, '-p', candidate], {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      })

      if (stdout && !stdout.includes('Error: class not found')) {
        let finalDecompiled = stdout
        const methodsCount = (stdout.match(/\b(?:public|protected|private)\s+[^;{]+;/g) ?? []).length

        if (filterMethod) {
          const filterRe = new RegExp(`\\b${filterMethod}\\s*\\(`, 'i')
          const lines = stdout.split(/\r?\n/)
          const matching = lines.filter((l) => filterRe.test(l))
          if (matching.length > 0) {
            finalDecompiled = `// Method matches for "${filterMethod}":\n\n` +
              matching.join('\n') +
              '\n\n// Full class signature:\n\n' +
              stdout
          }
        }

        const result: JavaDecompileResult = {
          className: cleanName,
          fullClassName: candidate,
          decompiled: finalDecompiled,
          methodsCount
        }
        decompileCache.set(cacheKey, result)
        return result
      }
    } catch {
      // Continue to next package candidate
    }
  }

  return {
    className: cleanName,
    decompiled: '',
    error: `Class "${cleanName}" was not found in projectzomboid.jar`
  }
}

export async function diffLogs(
  settings: AppSettings,
  baseId: string,
  targetId: string
): Promise<LogDiffResult> {
  const [baseLog, targetLog] = await Promise.all([
    readLog(settings, baseId),
    readLog(settings, targetId)
  ])

  function extractSignatures(text: string): Map<string, LogDiffItem> {
    const map = new Map<string, LogDiffItem>()
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!/ERROR|WARN/i.test(line)) continue
      const isErr = /ERROR|FATAL|SEVERE/i.test(line)
      const level: 'error' | 'warn' = isErr ? 'error' : 'warn'

      const clean = line
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/^(?:LOG|WARN|ERROR)\s*:\s*[A-Za-z0-9_$,\s>]+>\s*/, '')
        .trim()
      if (!clean || clean.length < 5) continue

      const key = clean.slice(0, 80).toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.count++
      } else {
        const modMatch = /\bMOD:\s*([^|)\]\r\n]+)/i.exec(line)
        map.set(key, {
          id: key,
          level,
          head: clean,
          modName: modMatch?.[1]?.trim(),
          count: 1
        })
      }
    }
    return map
  }

  const baseMap = extractSignatures(baseLog.text)
  const targetMap = extractSignatures(targetLog.text)

  const newErrors: LogDiffItem[] = []
  const recurringErrors: LogDiffItem[] = []
  const resolvedErrors: LogDiffItem[] = []

  for (const [key, item] of targetMap.entries()) {
    if (baseMap.has(key)) {
      recurringErrors.push(item)
    } else {
      newErrors.push(item)
    }
  }

  for (const [key, item] of baseMap.entries()) {
    if (!targetMap.has(key)) {
      resolvedErrors.push(item)
    }
  }

  return {
    baseId,
    targetId,
    newErrors,
    resolvedErrors,
    recurringErrors,
    newErrorsCount: newErrors.filter((e) => e.level === 'error').length,
    resolvedErrorsCount: resolvedErrors.filter((e) => e.level === 'error').length
  }
}
