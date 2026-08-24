/**
 * Workbench validator: static checks over a mod folder.
 *
 * Strictly read-only. Findings are emitted as stable rule ids plus parameters,
 * never as prose, so the renderer can render them in the active language.
 *
 * The Lua and script checks are hand-written scanners, not real parsers. They
 * are built to have no false *errors*: anything that could legitimately appear
 * in valid content is reported as a warning at most. A validator that cries
 * wolf gets switched off.
 */
import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type {
  ValidateOptions,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
  WorkbenchProgress
} from '../../shared/types'
import { extOf, pLimit, readdirSafe, readTextSafe, stripBom } from './fsx'
import { all, first, parseModInfo } from './modinfo'

const MAX_FILES = 4000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_DEPTH = 24
/** Per-rule cap per file, so one broken file cannot flood the report. */
const MAX_PER_RULE = 3

type Progress = (p: WorkbenchProgress) => void

interface Collected {
  /** Absolute paths of `.lua` files. */
  lua: string[]
  /** Absolute paths of `media/scripts/**` text files. */
  scripts: string[]
  /** Absolute paths of `Translate/<LANG>/*.txt` files. */
  translate: string[]
  /** Lowercased file names found under any `media/textures`. */
  textures: Set<string>
  /** Directories that exist but hold nothing, relative to the mod root. */
  emptyDirs: string[]
  /** `media` folders whose casing is wrong for a Linux server. */
  miscasedMedia: string[]
  /** Files whose names contain characters outside printable ASCII. */
  nonAscii: string[]
  hasMedia: boolean
  truncated: boolean
}

/** Directory names that are never part of a shipped mod. */
const SKIP_DIRS = new Set(['.git', '.svn', '.hg', '.vs', '.vscode', '.idea', 'node_modules'])

/* ---------------------------------------------------------------- collect -- */

async function collect(root: string): Promise<Collected> {
  const out: Collected = {
    lua: [],
    scripts: [],
    translate: [],
    textures: new Set(),
    emptyDirs: [],
    miscasedMedia: [],
    nonAscii: [],
    hasMedia: false,
    truncated: false
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let seen = 0

  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    const entries = await readdirSafe(current.dir)
    const rel = relative(root, current.dir)
    const relPosix = rel ? rel.split(sep).join('/') : ''

    if (entries.length === 0 && rel) out.emptyDirs.push(relPosix)

    // `media/` must be lowercase: PZ's Linux dedicated server is case sensitive
    // and silently loads nothing from `Media/`. Report the miscased folder
    // itself, not every path through it — one mistake, one finding.
    const leaf = relPosix ? (relPosix.split('/').pop() ?? '') : ''
    if (leaf.toLowerCase() === 'media' && leaf !== 'media') out.miscasedMedia.push(relPosix)

    const inTextures = /(^|\/)media\/textures(\/|$)/i.test(relPosix)
    const inScripts = /(^|\/)media\/scripts(\/|$)/i.test(relPosix)
    const translateMatch = /(^|\/)Translate\/([^/]+)$/i.exec(relPosix)

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(current.dir, entry.name)

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.toLowerCase() === 'media') out.hasMedia = true
        if (current.depth < MAX_DEPTH) stack.push({ dir: abs, depth: current.depth + 1 })
        continue
      }

      seen++
      if (seen > MAX_FILES * 4) {
        out.truncated = true
        return out
      }

      // Steam's uploader and PZ's own file handling both trip over names
      // outside printable ASCII, and the failure surfaces far from the cause.
      if (/[^\x20-\x7e]/.test(entry.name)) out.nonAscii.push(relative(root, abs))

      const ext = extOf(entry.name)
      if (inTextures) out.textures.add(entry.name.toLowerCase())
      if (ext === 'lua') out.lua.push(abs)
      else if (ext === 'txt' && inScripts) out.scripts.push(abs)
      // B41 translations are `.txt`, B42 moved them to `.json`, and a mod can
      // ship both at once while it supports two builds.
      if (translateMatch && (ext === 'txt' || ext === 'json')) out.translate.push(abs)
    }
  }

  out.lua.sort()
  out.scripts.sort()
  out.translate.sort()
  return out
}

/* --------------------------------------------------------------- mod.info -- */

const KNOWN_INFO_KEYS = new Set([
  'name', 'id', 'description', 'author', 'authors', 'modversion', 'version',
  'pzversion', 'versionmin', 'versionmax', 'url', 'poster', 'icon', 'require',
  'requires', 'tags', 'category', 'pack', 'tiledef', 'mappath', 'mapfolder',
  'excludetranslations'
])

/**
 * Keys where a repeat really does lose data.
 *
 * Most of `mod.info` is list-shaped: the loader appends every `description=`
 * into one string and treats `poster`, `require`, `pack` and `tiledef` as
 * collections, so mods repeat them deliberately — a bilingual mod with one
 * `description=` per language is correct, not a mistake. `name` and `id` are
 * the only keys read as a single value, where a second line is dead weight.
 */
const SINGLE_INFO_KEYS = ['name', 'id'] as const

async function checkModInfo(
  root: string,
  infoFile: string | undefined,
  knownIds: Set<string>,
  add: (issue: ValidationIssue) => void
): Promise<void> {
  if (!infoFile) {
    add({ rule: 'modinfo.missing', severity: 'error' })
    return
  }

  const raw = (await readTextSafe(infoFile, 64 * 1024)) ?? ''
  const fields = parseModInfo(raw)

  if (raw.charCodeAt(0) === 0xfeff) {
    add({ rule: 'modinfo.bom', severity: 'warn', file: infoFile, line: 1 })
  }

  const name = first(fields, 'name')
  const id = first(fields, 'id')
  if (!name) add({ rule: 'modinfo.no-name', severity: 'error', file: infoFile })
  if (!id) add({ rule: 'modinfo.no-id', severity: 'error', file: infoFile })

  if (id) {
    // Build 42 workshop ids are written `<workshopId>/<ModId>`.
    const bare = /^\d+\/(.+)$/.exec(id.trim())?.[1]?.trim() ?? id.trim()
    const folder = root.split(sep).filter(Boolean).pop() ?? ''
    if (folder && bare.toLowerCase() !== folder.toLowerCase()) {
      add({
        rule: 'modinfo.id-folder-mismatch',
        severity: 'info',
        file: infoFile,
        params: { id: bare, folder }
      })
    }
    if (all(fields, 'require', 'requires').some((r) => r.trim() === bare)) {
      add({ rule: 'modinfo.self-require', severity: 'warn', file: infoFile, params: { id: bare } })
    }
  }

  // Only `name` and `id` are genuinely single-valued. `description` lines are
  // concatenated, and `poster`, `require`, `pack` and `tiledef` are list keys
  // that mods repeat on purpose — reporting those was a false positive.
  for (const key of SINGLE_INFO_KEYS) {
    const n = fields[key]?.length ?? 0
    if (n > 1) {
      add({
        rule: 'modinfo.duplicate-key',
        severity: 'warn',
        file: infoFile,
        params: { key, n }
      })
    }
  }

  for (const key of Object.keys(fields)) {
    if (!KNOWN_INFO_KEYS.has(key)) {
      add({ rule: 'modinfo.unknown-key', severity: 'info', file: infoFile, params: { key } })
    }
  }

  if (!first(fields, 'description')) {
    add({ rule: 'modinfo.no-description', severity: 'info', file: infoFile })
  }
  if (!first(fields, 'pzversion', 'versionmin')) {
    add({ rule: 'modinfo.no-pzversion', severity: 'info', file: infoFile })
  }

  const infoDir = join(infoFile, '..')
  // `poster` is a list key, so check every entry rather than just the first —
  // a mod that ships two posters can be missing only the second one.
  const posters = all(fields, 'poster').map((v) => v.trim()).filter(Boolean)
  if (posters.length === 0) {
    add({ rule: 'modinfo.no-poster', severity: 'info', file: infoFile })
  } else {
    for (const poster of posters) {
      if (await fileExists(join(infoDir, poster))) continue
      if (await fileExists(join(root, poster))) continue
      add({
        rule: 'modinfo.poster-missing',
        severity: 'error',
        file: infoFile,
        params: { file: poster }
      })
    }
  }

  const icon = first(fields, 'icon')
  if (icon && !(await fileExists(join(infoDir, icon))) && !(await fileExists(join(root, icon)))) {
    add({ rule: 'modinfo.icon-missing', severity: 'warn', file: infoFile, params: { file: icon } })
  }

  for (const req of all(fields, 'require', 'requires').flatMap((v) => v.split(/[,;]/))) {
    const trimmed = req.trim()
    if (!trimmed) continue
    const bare = /^\d+\/(.+)$/.exec(trimmed)?.[1]?.trim() ?? trimmed
    if (!knownIds.has(bare.toLowerCase())) {
      add({
        rule: 'modinfo.require-missing',
        severity: 'warn',
        file: infoFile,
        params: { id: bare }
      })
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * The build folder a script belongs to, used to scope duplicate-item detection.
 *
 * `common/`, `41.x/` and `42.x/` are alternative trees; the game loads one per
 * run, so an item defined in two of them is not a clash. Everything sharing a
 * build root (or the mod root, for a Build 41 layout) is a real namespace.
 */
function buildScope(file: string, modPath: string): string {
  const rel = relative(modPath, file).split(sep)
  const head = rel[0] ?? ''
  return /^(?:common|4[0-9](?:\.\d+)*)$/i.test(head) ? head.toLowerCase() : ''
}

/* -------------------------------------------------------------------- lua -- */

type LuaBlock = 'function' | 'if' | 'do' | 'repeat'

/**
 * Scan a Lua file for lexical damage.
 *
 * Runs a real lexer over strings, long strings and both comment forms, then
 * checks bracket balance and `end`/`until` block balance on what is left. The
 * block check is reported as a warning: Lua has enough shapes (`goto`, nested
 * long strings, `function` in table constructors) that a mismatch is evidence,
 * not proof.
 */
function checkLua(text: string, file: string, add: (issue: ValidationIssue) => void): void {
  if (!text.trim()) {
    add({ rule: 'lua.empty', severity: 'info', file })
    return
  }

  const brackets: Record<string, { open: number; line: number }> = {
    '()': { open: 0, line: 0 },
    '[]': { open: 0, line: 0 },
    '{}': { open: 0, line: 0 }
  }
  const pairOf: Record<string, string> = {
    '(': '()', ')': '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}'
  }
  const stack: Array<{ kind: LuaBlock; line: number }> = []
  const reported = new Map<string, number>()

  const emit = (rule: string, severity: ValidationSeverity, line: number, params?: Record<string, string | number>): void => {
    const seen = reported.get(rule) ?? 0
    if (seen >= MAX_PER_RULE) return
    reported.set(rule, seen + 1)
    add(params ? { rule, severity, file, line, params } : { rule, severity, file, line })
  }

  let i = 0
  let line = 1
  let word = ''

  const flushWord = (): void => {
    if (!word) return
    const w = word
    word = ''
    if (w === 'function' || w === 'if' || w === 'do' || w === 'repeat') {
      stack.push({ kind: w, line })
      return
    }
    if (w === 'end') {
      const top = stack.pop()
      if (!top) emit('lua.block-extra-end', 'error', line)
      return
    }
    if (w === 'until') {
      if (stack.length && stack[stack.length - 1]!.kind === 'repeat') stack.pop()
    }
  }

  /** `[[` / `[==[` opener at `i`; returns the `=` count or -1. */
  const longBracketLevel = (): number => {
    if (text[i] !== '[') return -1
    let j = i + 1
    let level = 0
    while (text[j] === '=') {
      level++
      j++
    }
    return text[j] === '[' ? level : -1
  }

  const skipLongBracket = (level: number, startLine: number, rule: string): void => {
    const closer = `]${'='.repeat(level)}]`
    const end = text.indexOf(closer, i)
    if (end < 0) {
      emit(rule, 'error', startLine)
      i = text.length
      return
    }
    for (let k = i; k < end; k++) if (text[k] === '\n') line++
    i = end + closer.length
  }

  while (i < text.length) {
    const ch = text[i] as string

    // comments
    if (ch === '-' && text[i + 1] === '-') {
      flushWord()
      i += 2
      const level = longBracketLevel()
      if (level >= 0) {
        const startLine = line
        i += level + 2
        skipLongBracket(level, startLine, 'lua.unterminated-comment')
        continue
      }
      while (i < text.length && text[i] !== '\n') i++
      continue
    }

    // short strings
    if (ch === '"' || ch === "'") {
      flushWord()
      const quote = ch
      const startLine = line
      i++
      let closed = false
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') {
          // A backslash-newline is a legal line continuation inside a string.
          if (text[i + 1] === '\n') line++
          i += 2
          continue
        }
        if (c === '\n') break
        if (c === quote) {
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) emit('lua.unterminated-string', 'error', startLine)
      continue
    }

    // long strings
    if (ch === '[') {
      const level = longBracketLevel()
      if (level >= 0) {
        flushWord()
        const startLine = line
        i += level + 2
        skipLongBracket(level, startLine, 'lua.unterminated-string')
        continue
      }
    }

    if (ch === '\n') {
      flushWord()
      line++
      i++
      continue
    }

    if (/[A-Za-z0-9_]/.test(ch)) {
      word += ch
      i++
      continue
    }

    flushWord()

    const key = pairOf[ch]
    if (key) {
      const slot = brackets[key]!
      if (ch === '(' || ch === '[' || ch === '{') {
        slot.open++
        slot.line = line
      } else if (slot.open === 0) {
        emit('lua.bracket-unbalanced', 'error', line, { bracket: key, delta: -1 })
      } else {
        slot.open--
      }
    }
    i++
  }
  flushWord()

  for (const [key, slot] of Object.entries(brackets)) {
    if (slot.open > 0) {
      emit('lua.bracket-unbalanced', 'error', slot.line, { bracket: key, delta: slot.open })
    }
  }
  if (stack.length > 0) {
    emit('lua.block-unclosed', 'warn', stack[0]!.line, { n: stack.length })
  }
}

/* ---------------------------------------------------------------- scripts -- */

/** Block types PZ's ScriptManager understands at module level. */
const KNOWN_BLOCKS = new Set([
  'imports', 'item', 'recipe', 'craftrecipe', 'evolvedrecipe', 'uniquerecipe',
  'researchrecipe', 'fixing', 'vehicle', 'template', 'model', 'animation',
  'animationsmesh', 'sound', 'soundtimeline', 'ragdoll', 'entity', 'component',
  'multistagebuild', 'physicshape', 'mannequin', 'vehicleengine', 'vehicletemplate',
  'clothingitem', 'body', 'skill', 'trait', 'profession', 'timedaction', 'material',
  'grainlot', 'farming', 'mapdefine'
])

interface ScriptBlock {
  type: string
  name: string
  line: number
  props: Map<string, string>
}

/** Strip `//` line comments and `/* *\/` blocks; PZ scripts allow both. */
function stripScriptComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const chunk = end < 0 ? text.slice(i) : text.slice(i, end + 2)
      // Preserve newlines so line numbers survive the strip.
      out += chunk.replace(/[^\n]/g, '')
      if (end < 0) break
      i = end + 2
      continue
    }
    out += text[i]
    i++
  }
  return out
}

function checkScript(
  raw: string,
  file: string,
  scope: string,
  textures: Set<string>,
  seenItems: Map<string, string>,
  add: (issue: ValidationIssue) => void
): void {
  const text = stripScriptComments(raw)
  const stack: ScriptBlock[] = []
  const reported = new Map<string, number>()
  let pending = ''
  let line = 1
  let depth = 0
  let sawModule = false
  let extraClose = false

  const emit = (rule: string, severity: ValidationSeverity, at: number, params?: Record<string, string | number>): void => {
    const seen = reported.get(rule) ?? 0
    if (seen >= MAX_PER_RULE) return
    reported.set(rule, seen + 1)
    add(params ? { rule, severity, file, line: at, params } : { rule, severity, file, line: at })
  }

  /** A `Key = Value` statement terminated by `,` or by the closing brace. */
  const flushStatement = (): void => {
    const stmt = pending.trim()
    pending = ''
    if (!stmt) return
    const eq = stmt.indexOf('=')
    if (eq <= 0) return
    const block = stack[stack.length - 1]
    if (!block) return
    const key = stmt.slice(0, eq).trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      block.props.set(key.toLowerCase(), stmt.slice(eq + 1).trim())
    }
  }

  const closeBlock = (block: ScriptBlock): void => {
    if (block.type !== 'item') return
    const name = block.name
    if (!name) return

    if (!block.props.has('displayname')) {
      emit('script.item-no-display-name', 'warn', block.line, { name })
    }
    if (!block.props.has('type')) {
      emit('script.item-no-type', 'warn', block.line, { name })
    }

    const icon = block.props.get('icon')
    if (icon && textures.size > 0) {
      const bare = icon.includes('.') ? (icon.split('.').pop() as string) : icon
      const wanted = `item_${bare.trim().toLowerCase()}.png`
      if (!textures.has(wanted)) {
        emit('script.icon-missing', 'warn', block.line, { name, texture: `Item_${bare.trim()}.png` })
      }
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string

    if (ch === '\n') {
      line++
      pending += ' '
      continue
    }

    if (ch === '{') {
      const header = pending.trim().replace(/\s+/g, ' ')
      pending = ''
      const parts = header.split(' ')
      const type = (parts[0] ?? '').toLowerCase()
      const name = parts.slice(1).join(' ')

      if (depth === 0) {
        if (type === 'module') sawModule = true
        else if (header) emit('script.unknown-block', 'info', line, { block: header })
      } else if (depth === 1 && type && !KNOWN_BLOCKS.has(type)) {
        emit('script.unknown-block', 'info', line, { block: parts[0] ?? header })
      }

      if (depth === 1 && type === 'item' && name) {
        const moduleName = stack[0]?.name ?? 'Base'
        // Scoped per build folder: `common/` and `41/` are alternative trees and
        // only one is ever loaded, so the same item in both is correct, not a clash.
        const fullName = `${scope}\u0000${moduleName}.${name}`.toLowerCase()
        const previous = seenItems.get(fullName)
        if (previous) {
          emit('script.duplicate-item', 'error', line, { name: `${moduleName}.${name}` })
        } else {
          seenItems.set(fullName, file)
        }
      }

      stack.push({ type, name, line, props: new Map() })
      depth++
      continue
    }

    if (ch === '}') {
      flushStatement()
      const block = stack.pop()
      if (block) closeBlock(block)
      depth--
      if (depth < 0) {
        if (!extraClose) {
          extraClose = true
          emit('script.brace-unbalanced', 'error', line, { delta: -1 })
        }
        depth = 0
      }
      continue
    }

    if (ch === ',') {
      flushStatement()
      continue
    }

    pending += ch
  }

  if (depth > 0) emit('script.brace-unbalanced', 'error', line, { delta: depth })
  if (!sawModule && text.trim()) emit('script.no-module', 'warn', 1)
}

/* -------------------------------------------------------------- translate -- */

/**
 * Language folders the game ships translations for.
 *
 * Taken from `media/lua/shared/Translate` in Build 42, plus the older codes
 * (`CZ`, `DK`, `PH`, `TW`) that B41 mods still use. Listing a retired code
 * only costs a missed note; omitting a live one produces a false finding.
 */
const KNOWN_LANGS = new Set([
  'AR', 'CA', 'CH', 'CN', 'CS', 'CZ', 'DA', 'DE', 'DK', 'EN', 'ES', 'ES_CL',
  'ES_MX', 'FI', 'FR', 'HU', 'ID', 'IT', 'JP', 'KO', 'NL', 'NO', 'PH', 'PL',
  'PT', 'PTBR', 'RO', 'RU', 'STREW', 'TH', 'TR', 'TW', 'UA'
])

/** The language code a translation file sits under, e.g. `EN`. */
function langOf(file: string): string {
  const parts = file.split(sep)
  return parts[parts.length - 2] ?? ''
}

/** 1-based line of a character offset, for locating a JSON syntax error. */
function lineAt(text: string, position: number): number {
  let line = 1
  const stop = Math.min(position, text.length)
  for (let i = 0; i < stop; i++) if (text[i] === '\n') line++
  return line
}

/**
 * Build 42 translations: a flat JSON object of `"Prefix.Key": "Text"`.
 *
 * B42 replaced the Lua-table `.txt` files with JSON — the stock `Translate/EN`
 * folder is now `ItemName.json`, `Recipes.json` and friends, with only
 * `IG_UI_EN.txt` and `UI_EN.txt` left in the old form. The game still loads
 * both, so the two checkers coexist rather than replace each other.
 */
function checkTranslateJson(
  text: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    // The engine's own wording is English-only prose, so only the position it
    // reports is carried over — the rule id supplies the localised message.
    const at = /position (\d+)/.exec(err instanceof Error ? err.message : '')?.[1]
    add({
      rule: 'translate.json-invalid',
      severity: 'error',
      file,
      line: at ? lineAt(text, Number(at)) : undefined
    })
    return
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    add({ rule: 'translate.json-not-object', severity: 'error', file })
    return
  }

  // Every entry has to be a plain string; a nested object or a number means
  // the file was written against the wrong shape and those keys never resolve.
  const bad = Object.entries(parsed as Record<string, unknown>)
    .filter(([, value]) => typeof value !== 'string')
    .map(([key]) => key)
  if (bad.length > 0) {
    add({
      rule: 'translate.json-non-string',
      severity: 'warn',
      file,
      params: { key: bad[0] ?? '', n: bad.length }
    })
  }
}

/** Build 41 translations: a Lua table named after its language folder. */
function checkTranslateTxt(
  text: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  let depth = 0
  for (const ch of text) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  if (depth !== 0) {
    add({ rule: 'translate.brace-unbalanced', severity: 'error', file, params: { delta: depth } })
  }

  // The table name must end in the language code of its folder, otherwise the
  // game loads the file and then discards every entry in it.
  const header = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(text)
  const table = header?.[1]
  if (table) {
    const suffix = table.slice(table.lastIndexOf('_') + 1).toUpperCase()
    const upper = langOf(file).toUpperCase()
    if (table.includes('_') && suffix !== upper) {
      add({
        rule: 'translate.header-mismatch',
        severity: 'warn',
        file,
        params: { expected: upper, found: suffix }
      })
    }
  }
}

/** Routes a translation file to the checker for its format. */
function checkTranslate(
  raw: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  const langDir = langOf(file)
  if (!KNOWN_LANGS.has(langDir.toUpperCase())) {
    add({ rule: 'translate.unknown-language', severity: 'info', file, params: { dir: langDir } })
  }

  const text = stripBom(raw)
  if (!text.trim()) {
    add({ rule: 'translate.empty', severity: 'info', file })
    return
  }

  if (extOf(file) === 'json') checkTranslateJson(text, file, add)
  else checkTranslateTxt(text, file, add)
}

/* ------------------------------------------------------------------ entry -- */

export async function validateMod(
  modPath: string,
  opts: ValidateOptions,
  onProgress: Progress
): Promise<ValidationReport> {
  const started = Date.now()
  const issues: ValidationIssue[] = []
  const add = (issue: ValidationIssue): void => {
    issues.push(issue)
  }

  onProgress({ task: 'validate', phase: 'collect', done: 0, total: 0, label: '' })
  const found = await collect(modPath)

  if (!found.hasMedia) add({ rule: 'layout.no-media', severity: 'error' })
  for (const dir of found.miscasedMedia.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.media-case', severity: 'warn', params: { dir } })
  }
  for (const file of found.nonAscii.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.non-ascii-name', severity: 'warn', params: { file } })
  }
  for (const dir of found.emptyDirs.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.empty-dir', severity: 'info', params: { dir } })
  }

  const infoFile = opts.infoFile ?? (await resolveInfo(modPath))
  const knownIds = new Set((opts.knownIds ?? []).map((id) => id.toLowerCase()))
  await checkModInfo(modPath, infoFile, knownIds, add)

  const queue = [...found.lua, ...found.scripts, ...found.translate].slice(0, MAX_FILES)
  const total = queue.length
  if (queue.length < found.lua.length + found.scripts.length + found.translate.length) {
    found.truncated = true
  }

  const scriptSet = new Set(found.scripts)
  const translateSet = new Set(found.translate)
  const seenItems = new Map<string, string>()

  // Leaf reads only — this limiter is never awaited from inside a task it owns.
  const limit = pLimit(16)
  let done = 0
  let bytesChecked = 0
  let budgetSpent = false

  await Promise.all(
    queue.map((file) =>
      limit(async () => {
        if (!budgetSpent) {
          const text = await readTextSafe(file, MAX_FILE_BYTES)
          if (text !== undefined) {
            bytesChecked += Buffer.byteLength(text, 'utf8')
            if (bytesChecked > MAX_TOTAL_BYTES) {
              budgetSpent = true
              found.truncated = true
            }
            if (translateSet.has(file)) checkTranslate(text, file, add)
            if (scriptSet.has(file)) checkScript(text, file, buildScope(file, modPath), found.textures, seenItems, add)
            else if (!translateSet.has(file)) checkLua(text, file, add)
          }
        }
        done++
        if (done % 20 === 0 || done === total) {
          onProgress({
            task: 'validate',
            phase: 'read',
            done,
            total,
            label: file.split(sep).pop() ?? ''
          })
        }
      })
    )
  )

  onProgress({ task: 'validate', phase: 'done', done: total, total, label: '' })

  const rank: Record<ValidationSeverity, number> = { error: 0, warn: 1, info: 2 }
  issues.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule)
  )

  return {
    modPath,
    durationMs: Date.now() - started,
    filesChecked: total,
    bytesChecked,
    issues,
    truncated: found.truncated
  }
}

/** Fallback when the caller has no scanner result to hand. */
async function resolveInfo(modPath: string): Promise<string | undefined> {
  const root = join(modPath, 'mod.info')
  if (await fileExists(root)) return root
  for (const entry of await readdirSafe(modPath)) {
    if (!entry.isDirectory()) continue
    if (!/^(?:common|4[0-9](?:\.\d+)*)$/i.test(entry.name)) continue
    const candidate = join(modPath, entry.name, 'mod.info')
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}
