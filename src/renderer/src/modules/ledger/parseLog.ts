import type { ModEntry } from '@shared/types'

/**
 * Log parsing for the Ledger module.
 *
 * Pure functions on purpose: main hands over a block of text, and everything
 * about what that text *means* is decided here, where it can be reasoned about
 * (and where the mod index from the last scan already lives).
 *
 * The heuristics are deliberately conservative, the same stance the Workbench
 * validator takes: a line that is not confidently a problem is left as ordinary
 * output. Under-reporting is recoverable — the log is right there — while a wall
 * of false errors makes the module useless.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/** Ordered so a soft signal can only ever raise a line's level, never lower it. */
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * One logical entry: a leading line plus everything that continues it.
 *
 * A Java exception with forty stack frames, or a PZ Lua error block fenced by
 * dashed rules, is one incident — not forty rows to scroll past.
 */
export interface LogIncident {
  id: number
  level: LogLevel
  /** 1-based line number within the tail that was read. */
  line: number
  /** Subsystem PZ tagged the line with, e.g. `General`, `Lua`, `Mod`. */
  category?: string
  /** Call site PZ blamed, e.g. `XuiSkin$EntityUiStyle.Load`. */
  origin?: string
  /** Leading line, stripped of the timestamp, level, category and counter columns. */
  head: string
  /** The leading line exactly as it appears in the file, for copy-out. */
  raw: string
  /** Continuation lines, kept verbatim — indentation is part of a stack trace. */
  body: string[]
  /** `ModEntry.key` of the mod this incident was traced to, when one was found. */
  modKey?: string
  modName?: string
  modId?: string
  modPath?: string
}

export interface ParsedLog {
  incidents: LogIncident[]
  counts: Record<LogLevel, number>
  /** Index of the first `error` incident, or -1. Drives the "jump to first" button. */
  firstError: number
  /** Physical lines the tail held. */
  lines: number
}

export const EMPTY_PARSE: ParsedLog = {
  incidents: [],
  counts: { error: 0, warn: 0, info: 0, debug: 0 },
  firstError: -1,
  lines: 0
}

/* ------------------------------------------------------------- line shapes -- */

/*
 * Build 42 writes three shapes of header, and all three are handled here
 * because the module offers every one of those files side by side:
 *
 *   console.txt          ERROR: General      f:0 at FluidContainerScript.load  > message
 *   Logs\*_DebugLog.txt  [25-08-26 20:20:17.457] LOG  : General      f:0> message
 *   Logs\*_chat*.txt     [25-08-26 20:24:06.571][info] message
 *
 * Build 41 printed numeric columns instead of `f:<frame>` —
 * `LOG  : General     , 1690000000000> 1,234> message` — so that spelling is
 * consumed as well rather than leaking into the message.
 */

/** Leading `[25-08-26 20:20:17.457]` stamp of the Logs files. */
const STAMP_RE = /^\[[^\]\r\n]{1,48}\]\s*/
const LEVEL_RE = /^(LOG|DEBUG|TRACE|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\s*:\s*/i
/** The bracketed level the chat and per-feature logs use instead. */
const BRACKET_LEVEL_RE = /^\[(log|debug|trace|info|warn|warning|error|fatal|severe)\]\s*/i
/** Subsystem, with B41's trailing comma tolerated. */
const CATEGORY_RE = /^([A-Za-z][\w$.-]{0,31})\s*,?\s*/
/** B42 frame counter. */
const FRAME_RE = /^f:\d+\s*/
/** `at Some.method` call site; always followed by the `>` separator. */
const ORIGIN_RE = /^at\s+([^>\r\n]*?)\s*(?=>)/
/** B41 epoch / frame columns, each closed by `>`. */
const COLUMN_RE = /^[\d,]+>\s*/
const SEPARATOR_RE = /^>\s?/

const LEVEL_BY_PREFIX: Record<string, LogLevel> = {
  log: 'info',
  info: 'info',
  trace: 'debug',
  debug: 'debug',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'error',
  severe: 'error'
}

/**
 * Text that means "something broke" regardless of the level PZ used.
 *
 * This matters because PZ logs most Lua failures at `LOG` level: without these
 * signals the single most important thing in the file — the mod that threw —
 * would be filed as ordinary output. Every pattern is deliberately specific: a
 * bare `error` would match `FMOD_System_Create() result: No errors`, of which a
 * normal launch prints dozens.
 */
const ERROR_SIGNAL =
  /\bjava\.[\w.$]*(?:Exception|Error)\b|\b(?:LuaException|NullPointerException|StackOverflowError|OutOfMemoryError|ClassNotFoundException|NoSuchMethodError|IllegalStateException)\b|^Caused by:|\bstack traceback\b|\battempted (?:to (?:call|index)|index)\b|\ba nil value\b/i

/** Continuation of an unprefixed block: stack frames and dumps. */
const RAW_CONTINUATION = /^(?:\s+\S|at\s|java\.[\w.$]|Caused by:|\.{3}\s*\d+\s*more\b|\t)/

/**
 * Continuation *inside* PZ's prefixed stream.
 *
 * A Lua failure is printed as a run of same-level lines fenced by dashed rules,
 * so the fence and the frame lines are folded into the incident that opened it.
 */
const LUA_CONTINUATION =
  /^(?:-{5,}|={5,}|function:\s|at\s|stack traceback|callframe|\[File\s|Object dump|Lua\s+stack)/i

interface Line {
  raw: string
  level: LogLevel | undefined
  category: string | undefined
  origin: string | undefined
  text: string
  prefixed: boolean
}

function readLine(raw: string): Line {
  let rest = raw
  const stamp = STAMP_RE.exec(rest)
  if (stamp) rest = rest.slice(stamp[0].length)

  // `[info] …` carries a level but none of the columns that follow one.
  const bracketed = BRACKET_LEVEL_RE.exec(rest)
  if (bracketed) {
    return {
      raw,
      level: LEVEL_BY_PREFIX[(bracketed[1] as string).toLowerCase()] ?? 'info',
      category: undefined,
      origin: undefined,
      text: rest.slice(bracketed[0].length),
      prefixed: true
    }
  }

  const level = LEVEL_RE.exec(rest)
  if (!level) {
    return {
      raw,
      level: undefined,
      category: undefined,
      origin: undefined,
      text: raw,
      prefixed: false
    }
  }
  rest = rest.slice(level[0].length)

  const category = CATEGORY_RE.exec(rest)
  if (category) rest = rest.slice(category[0].length)

  const frame = FRAME_RE.exec(rest)
  if (frame) rest = rest.slice(frame[0].length)

  const origin = ORIGIN_RE.exec(rest)
  if (origin) rest = rest.slice(origin[0].length)

  // B41 prints one or two numeric columns; drop each in turn rather than
  // assuming how many there are, because the second only appears in-game.
  for (;;) {
    const column = COLUMN_RE.exec(rest)
    if (!column) break
    rest = rest.slice(column[0].length)
  }
  const separator = SEPARATOR_RE.exec(rest)
  if (separator) rest = rest.slice(separator[0].length)

  return {
    raw,
    level: LEVEL_BY_PREFIX[(level[1] as string).toLowerCase()] ?? 'info',
    category: category?.[1],
    origin: origin?.[1]?.trim() || undefined,
    text: rest,
    prefixed: true
  }
}

/* ------------------------------------------------------------- mod linking -- */

export interface ModIndex {
  byFolder: Map<string, ModEntry>
  byName: Map<string, ModEntry>
  byId: Map<string, ModEntry>
  /**
   * Alternation over every known mod id, for the token scan of last resort.
   * Absent when there is nothing to scan for, or when the set is large enough
   * that a per-incident scan would cost more than the link is worth.
   */
  idScan: RegExp | undefined
}

export const EMPTY_MOD_INDEX: ModIndex = {
  byFolder: new Map(),
  byName: new Map(),
  byId: new Map(),
  idScan: undefined
}

/** Ids shorter than this match far too much ordinary log text to be evidence. */
const MIN_ID_LENGTH = 4

/** Above this, the alternation stops paying for itself. */
const MAX_SCANNED_IDS = 1200

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildModIndex(mods: ModEntry[]): ModIndex {
  const byFolder = new Map<string, ModEntry>()
  const byName = new Map<string, ModEntry>()
  const byId = new Map<string, ModEntry>()

  for (const mod of mods) {
    const folder = mod.folderName.toLowerCase()
    if (folder && !byFolder.has(folder)) byFolder.set(folder, mod)
    const name = mod.name.trim().toLowerCase()
    if (name && !byName.has(name)) byName.set(name, mod)
    for (const id of [mod.modId, mod.rawModId]) {
      const key = id?.trim().toLowerCase()
      if (key && !byId.has(key)) byId.set(key, mod)
    }
  }

  // Longest first, so `MyMod_Extra` wins over the `MyMod` it embeds.
  const tokens = [...byId.keys()]
    .filter((id) => id.length >= MIN_ID_LENGTH)
    .sort((a, b) => b.length - a.length)

  let idScan: RegExp | undefined
  if (tokens.length > 0 && tokens.length <= MAX_SCANNED_IDS) {
    idScan = new RegExp(`(?<![\\w-])(${tokens.map(escapeRe).join('|')})(?![\\w-])`, 'i')
  }

  return { byFolder, byName, byId, idScan }
}

const MOD_TAG_RE = /\bMOD:\s*([^|\r\n]+)/i
const MODS_PATH_RE = /[\\/]mods[\\/]([^\\/\r\n"']+)/i
const MEDIA_PATH_RE = /[\\/]([^\\/\r\n"']+)[\\/]media[\\/]/i

/**
 * Best guess at the mod behind one incident.
 *
 * Cheap, high-confidence evidence first: PZ's own `| MOD: <name>` tail on Lua
 * errors, then a path that walks through a mod container. The id token scan is
 * last because it is the only rule that can fire on prose.
 */
function linkMod(text: string, index: ModIndex, deep: boolean): ModEntry | undefined {
  const tag = MOD_TAG_RE.exec(text)
  if (tag) {
    const hit = index.byName.get((tag[1] as string).trim().toLowerCase())
    if (hit) return hit
  }

  const mods = MODS_PATH_RE.exec(text)
  if (mods) {
    const hit = index.byFolder.get((mods[1] as string).toLowerCase())
    if (hit) return hit
  }

  const media = MEDIA_PATH_RE.exec(text)
  if (media) {
    const hit = index.byFolder.get((media[1] as string).toLowerCase())
    if (hit) return hit
  }

  if (!deep || !index.idScan) return undefined
  const token = index.idScan.exec(text)
  return token ? index.byId.get((token[1] as string).toLowerCase()) : undefined
}

/* ------------------------------------------------------------------ parser -- */

/** How much of an incident is searched for a mod. Stack traces can be enormous. */
const LINK_SCAN_MAX = 4000

export function parseLog(text: string, index: ModIndex): ParsedLog {
  if (!text) return EMPTY_PARSE

  const rows = text.split(/\r?\n/)
  // A trailing newline yields one empty row; it is not a line of the log.
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()

  const incidents: LogIncident[] = []
  const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 }
  let open: LogIncident | undefined

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] as string
    if (!raw.trim()) {
      // A blank line ends whatever block was open but is not worth a row.
      open = undefined
      continue
    }

    const line = readLine(raw)
    const signalled = ERROR_SIGNAL.test(line.text)

    if (open) {
      const continues = line.prefixed
        ? // Only fold same-subsystem noise into an open problem, and only when
          // the shape says "frame", never when it says "new message".
          open.level !== 'info' &&
          open.level !== 'debug' &&
          line.category === open.category &&
          !signalled &&
          LUA_CONTINUATION.test(line.text)
        : RAW_CONTINUATION.test(raw) || signalled
      if (continues) {
        open.body.push(raw)
        if (signalled && RANK[open.level] < RANK.error) {
          counts[open.level]--
          open.level = 'error'
          counts.error++
        }
        continue
      }
    }

    const base = line.level ?? 'info'
    const level: LogLevel = signalled && RANK[base] < RANK.error ? 'error' : base
    const incident: LogIncident = {
      id: incidents.length,
      level,
      line: i + 1,
      category: line.category,
      origin: line.origin,
      head: line.text.trim() || raw.trim(),
      raw,
      body: []
    }
    incidents.push(incident)
    counts[level]++
    // An unprefixed line can only ever be continued by another unprefixed line,
    // so plain logs without PZ's columns still come out one row per line.
    open = level === 'error' || level === 'warn' || !line.prefixed ? incident : undefined
  }

  for (const incident of incidents) {
    const deep = incident.level === 'error' || incident.level === 'warn'
    // The raw head is used rather than the cleaned one: a mod path can appear in
    // any column PZ printed, including the call site that was stripped for display.
    const haystack =
      incident.body.length === 0
        ? incident.raw
        : [incident.raw, ...incident.body].join('\n').slice(0, LINK_SCAN_MAX)
    const mod = linkMod(haystack, index, deep)
    if (!mod) continue
    incident.modKey = mod.key
    incident.modName = mod.name
    incident.modId = mod.modId
    incident.modPath = mod.path
  }

  return {
    incidents,
    counts,
    firstError: incidents.findIndex((x) => x.level === 'error'),
    lines: rows.length
  }
}
