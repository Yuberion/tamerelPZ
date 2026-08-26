import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, LogReadResult, LogSource } from '../../shared/types'
import { exists, pLimit, readdirSafe, readTailSafe } from './fsx'
import { detectZomboidDir } from './paths'

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

export async function readLog(settings: AppSettings, id: string): Promise<LogReadResult> {
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

  const tail = await readTailSafe(path, LOG_TAIL_MAX)
  if (!tail) throw new Error(`Cannot read log: ${path}`)
  return {
    id,
    path,
    text: tail.text,
    size: tail.size,
    mtime: tail.mtime,
    truncated: tail.truncated
  }
}
