import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import type {
  ResetPlayerRequest,
  ResetPlayerResult,
  SavegameCellInfo,
  SavegameInfo,
  WipeChunksRequest,
  WipeChunksResult
} from '../../shared/types'
import { pzFileUrl } from '../../shared/ipc'
import { exists, isDir, readTextSafe, readdirSafe } from './fsx'
import { detectZomboidDir } from './paths'
import { getSettings } from './settings'

/** Open SQLite database using Node built-in node:sqlite safely */
function getSqliteDb(dbPath: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite')
    return new DatabaseSync(dbPath)
  } catch {
    return null
  }
}

/** Verify path is inside user's Zomboid Saves directory */
async function assertSavePath(savePath: string): Promise<void> {
  const zomboidDir = await detectZomboidDir(await getSettings())
  if (!zomboidDir) throw new Error('Could not detect Zomboid directory.')
  const savesRoot = join(zomboidDir, 'Saves').toLowerCase()
  const normalised = savePath.toLowerCase()
  if (!normalised.startsWith(savesRoot)) {
    throw new Error(`Unauthorized save path outside Zomboid/Saves: ${savePath}`)
  }
}

/**
 * Scan all Project Zomboid savegames across all game modes (Sandbox, Survivor, Apocalypse, etc.).
 */
export async function scanSavegames(): Promise<SavegameInfo[]> {
  const zomboidDir = await detectZomboidDir(await getSettings())
  if (!zomboidDir) return []
  const savesDir = join(zomboidDir, 'Saves')

  if (!(await isDir(savesDir))) {
    return []
  }

  const results: SavegameInfo[] = []
  const modeDirs = await readdirSafe(savesDir)

  for (const mEntry of modeDirs) {
    if (!mEntry.isDirectory()) continue
    const modePath = join(savesDir, mEntry.name)
    const saveDirs = await readdirSafe(modePath)

    for (const sEntry of saveDirs) {
      if (!sEntry.isDirectory()) continue
      const savePath = join(modePath, sEntry.name)

      try {
        const info = await inspectSingleSave(sEntry.name, mEntry.name, savePath)
        if (info) results.push(info)
      } catch (err) {
        console.warn(`[savegame] Failed inspecting save ${savePath}:`, err)
      }
    }
  }

  // Sort by latest modified date
  results.sort((a, b) => b.lastModified - a.lastModified)
  return results
}

/** Inspect metadata, chunk files, and database records of a single save */
async function inspectSingleSave(
  saveName: string,
  gameMode: string,
  savePath: string
): Promise<SavegameInfo | null> {
  const stat = await fs.stat(savePath).catch(() => null)
  if (!stat) return null

  // Thumbnail
  const thumbPath = join(savePath, 'thumb.png')
  const thumbUrl = (await exists(thumbPath)) ? pzFileUrl(thumbPath) : undefined

  // Active mods from mods.txt
  const modsPath = join(savePath, 'mods.txt')
  const modsContent = await readTextSafe(modsPath)
  const activeMods = modsContent
    ? modsContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
    : []

  // Scan chunks and explored cells
  const cellMap = new Map<string, SavegameCellInfo>()
  let totalChunks = 0
  let totalSizeBytes = 0

  const mapDir = join(savePath, 'map')
  const isB42MapDir = await isDir(mapDir)

  if (isB42MapDir) {
    // B42 chunk folder hierarchy: map/<ChunkX>/<ChunkY>.bin
    const chunkXDirs = await readdirSafe(mapDir)
    for (const xDir of chunkXDirs) {
      if (!xDir.isDirectory()) continue
      const chunkX = parseInt(xDir.name, 10)
      if (Number.isNaN(chunkX)) continue

      const xDirPath = join(mapDir, xDir.name)
      const chunkYFiles = await readdirSafe(xDirPath)

      for (const yFile of chunkYFiles) {
        if (!yFile.isFile() || !yFile.name.endsWith('.bin')) continue
        const chunkY = parseInt(yFile.name.replace('.bin', ''), 10)
        if (Number.isNaN(chunkY)) continue

        totalChunks++
        const cellX = Math.floor(chunkX / 30)
        const cellY = Math.floor(chunkY / 30)
        const key = `${cellX},${cellY}`

        const existing = cellMap.get(key)
        if (existing) {
          existing.chunkCount++
        } else {
          cellMap.set(key, { cellX, cellY, chunkCount: 1 })
        }
      }
    }
  } else {
    // B41 flat chunk files: map_<ChunkX>_<ChunkY>.bin
    const files = await readdirSafe(savePath)
    const CHUNK_RE = /^map_(\d+)_(\d+)\.bin$/i

    for (const f of files) {
      if (!f.isFile()) continue
      const match = CHUNK_RE.exec(f.name)
      if (match) {
        const chunkX = parseInt(match[1]!, 10)
        const chunkY = parseInt(match[2]!, 10)
        totalChunks++

        const cellX = Math.floor(chunkX / 30)
        const cellY = Math.floor(chunkY / 30)
        const key = `${cellX},${cellY}`

        const existing = cellMap.get(key)
        if (existing) {
          existing.chunkCount++
        } else {
          cellMap.set(key, { cellX, cellY, chunkCount: 1 })
        }
      }
    }
  }

  // Count players and vehicles via SQLite
  let playerCount: number | undefined
  let vehicleCount: number | undefined

  const playersDbPath = join(savePath, 'players.db')
  if (await exists(playersDbPath)) {
    const db = getSqliteDb(playersDbPath)
    if (db) {
      try {
        const row = db.prepare('SELECT COUNT(*) as count FROM localPlayers').get() as any
        if (row && typeof row.count === 'number') playerCount = row.count
      } catch {
        // ignore
      } finally {
        try {
          db.close()
        } catch {
          // ignore
        }
      }
    }
  }

  const vehiclesDbPath = join(savePath, 'vehicles.db')
  if (await exists(vehiclesDbPath)) {
    const db = getSqliteDb(vehiclesDbPath)
    if (db) {
      try {
        const row = db.prepare('SELECT COUNT(*) as count FROM vehicles').get() as any
        if (row && typeof row.count === 'number') vehicleCount = row.count
      } catch {
        // ignore
      } finally {
        try {
          db.close()
        } catch {
          // ignore
        }
      }
    }
  }

  // Approximate size from save directory stat
  totalSizeBytes = stat.size

  const exploredCells = Array.from(cellMap.values()).sort((a, b) => b.chunkCount - a.chunkCount)

  return {
    id: `${gameMode}/${saveName}`,
    name: saveName,
    gameMode,
    folderPath: savePath,
    lastModified: stat.mtimeMs,
    thumbUrl,
    totalSizeBytes,
    activeMods,
    exploredCells,
    totalChunks,
    playerCount,
    vehicleCount
  }
}

/**
 * Wipe all exterior chunks outside of the user's protected cells.
 * Creates a backup before modifying any files.
 */
export async function wipeSavegameChunks(req: WipeChunksRequest): Promise<WipeChunksResult> {
  const { savePath, protectedCells, createBackup } = req
  await assertSavePath(savePath)

  if (!protectedCells || protectedCells.length === 0) {
    return {
      ok: false,
      wipedChunks: 0,
      bytesFreed: 0,
      error: 'At least one protected cell (player safehouse/base) must be selected!'
    }
  }

  const protectedSet = new Set<string>()
  for (const c of protectedCells) {
    protectedSet.add(`${c.cellX},${c.cellY}`)
  }

  let backupPath: string | undefined
  if (createBackup) {
    const backupDirName = `${basename(savePath)}_backup_${Date.now()}`
    backupPath = join(savePath, '..', backupDirName)
    await fs.cp(savePath, backupPath, { recursive: true })
  }

  let wipedChunks = 0
  let bytesFreed = 0

  const mapDir = join(savePath, 'map')
  const isB42 = await isDir(mapDir)

  if (isB42) {
    // B42 folder hierarchy
    const chunkDirs = ['map', 'chunkdata', 'zpop', 'apop']
    const xDirs = await readdirSafe(mapDir)

    for (const xDir of xDirs) {
      if (!xDir.isDirectory()) continue
      const chunkX = parseInt(xDir.name, 10)
      if (Number.isNaN(chunkX)) continue

      const xDirPath = join(mapDir, xDir.name)
      const yFiles = await readdirSafe(xDirPath)

      for (const yFile of yFiles) {
        if (!yFile.isFile() || !yFile.name.endsWith('.bin')) continue
        const chunkY = parseInt(yFile.name.replace('.bin', ''), 10)
        if (Number.isNaN(chunkY)) continue

        const cellX = Math.floor(chunkX / 30)
        const cellY = Math.floor(chunkY / 30)

        if (!protectedSet.has(`${cellX},${cellY}`)) {
          // Wipe this chunk across all chunk dirs
          for (const dName of chunkDirs) {
            const chunkFilePath = join(savePath, dName, xDir.name, yFile.name)
            try {
              const fileStat = await fs.stat(chunkFilePath).catch(() => null)
              if (fileStat) {
                bytesFreed += fileStat.size
                await fs.unlink(chunkFilePath)
                if (dName === 'map') wipedChunks++
              }
            } catch {
              // ignore individual delete failure
            }
          }
        }
      }
    }
  } else {
    // B41 flat files
    const files = await readdirSafe(savePath)
    const CHUNK_RE = /^(?:map|chunkdata|zpop)_(\d+)_(\d+)\.bin$/i

    for (const f of files) {
      if (!f.isFile()) continue
      const match = CHUNK_RE.exec(f.name)
      if (match) {
        const chunkX = parseInt(match[1]!, 10)
        const chunkY = parseInt(match[2]!, 10)
        const cellX = Math.floor(chunkX / 30)
        const cellY = Math.floor(chunkY / 30)

        if (!protectedSet.has(`${cellX},${cellY}`)) {
          const filePath = join(savePath, f.name)
          try {
            const fileStat = await fs.stat(filePath).catch(() => null)
            if (fileStat) {
              bytesFreed += fileStat.size
              await fs.unlink(filePath)
              if (f.name.startsWith('map_')) wipedChunks++
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return {
    ok: true,
    wipedChunks,
    bytesFreed,
    backupPath
  }
}

/**
 * Reset player position in players.db (fixes black screen / stuck in bad chunk).
 */
export async function resetPlayerPosition(req: ResetPlayerRequest): Promise<ResetPlayerResult> {
  const { savePath, targetX = 10800, targetY = 10100, targetZ = 0 } = req
  await assertSavePath(savePath)

  const playersDbPath = join(savePath, 'players.db')
  if (!(await exists(playersDbPath))) {
    return { ok: false, message: 'players.db not found in this save folder.' }
  }

  // Backup players.db before altering
  const bakPath = join(savePath, `players.db.bak_${Date.now()}`)
  await fs.copyFile(playersDbPath, bakPath)

  const db = getSqliteDb(playersDbPath)
  if (!db) {
    return { ok: false, message: 'SQLite database engine is unavailable.' }
  }

  try {
    const wx = Math.floor(targetX / 300)
    const wy = Math.floor(targetY / 300)

    db.exec(`
      UPDATE localPlayers
      SET x = ${targetX}, y = ${targetY}, z = ${targetZ}, wx = ${wx}, wy = ${wy}, isDead = 0;
    `)

    return {
      ok: true,
      message: `Координаты персонажа успешно сброшены в безопасную точку (${targetX}, ${targetY}, ${targetZ}). Резервная копия базы сохранена в players.db.bak.`
    }
  } catch (err) {
    return {
      ok: false,
      message: 'Ошибка при обновлении базы игроков',
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
}
