import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AppSettings,
  ApplyMemoryRequest,
  ApplyMemoryResult,
  GameConfigFileInfo,
  MemoryReport,
  SessionMemoryTelemetry,
  SetEnvOptionsResult,
  SystemMemoryInfo,
  ToggleReadOnlyRequest,
  ToggleReadOnlyResult,
  WindowsEnvOptions
} from '../../shared/types'
import { exists, readTextSafe } from './fsx'
import { detectGameDir, detectZomboidDir } from './paths'

const run = promisify(execFile)

/** Read a Windows registry value string; returns undefined if missing. */
async function regQuery(key: string, name: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  try {
    const { stdout } = await run('reg', ['query', key, '/v', name], { windowsHide: true })
    const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

/** Check environment variable _JAVA_OPTIONS in User and Machine hives. */
async function readEnvOptions(): Promise<WindowsEnvOptions> {
  const user = await regQuery('HKCU\\Environment', '_JAVA_OPTIONS')
  const machine = await regQuery(
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    '_JAVA_OPTIONS'
  )
  const isOverriding = Boolean(user || machine)
  return { user, machine, isOverriding }
}

/** Parse memory in megabytes from string like "8192m", "8g", "10240M", "10G". */
function parseMemoryMb(raw: string | undefined): number {
  if (!raw) return 0
  const m = raw.match(/(\d+)\s*([mMgG])?/i)
  if (!m) return 0
  const val = parseInt(m[1], 10)
  const unit = (m[2] ?? 'm').toLowerCase()
  return unit === 'g' ? val * 1024 : val
}

/** Check if a file has the Read-Only attribute on Windows. */
export async function isFileReadOnly(filePath: string): Promise<boolean> {
  if (!(await exists(filePath))) return false
  try {
    const st = await fs.stat(filePath)
    return (st.mode & 0o200) === 0
  } catch {
    return false
  }
}

/** Set or remove Read-Only attribute on a file. */
export async function setFileReadOnly(filePath: string, readOnly: boolean): Promise<void> {
  if (!(await exists(filePath))) return
  try {
    // 0o444 = read-only, 0o666 = readable and writable
    await fs.chmod(filePath, readOnly ? 0o444 : 0o666)
  } catch {
    // Fallback to attrib.exe on Windows
    if (process.platform === 'win32') {
      try {
        await run('attrib', [readOnly ? '+r' : '-r', filePath], { windowsHide: true })
      } catch {
        // Ignore fallback error
      }
    }
  }
}

/** Parse telemetry from the beginning of console.txt. */
async function parseConsoleTelemetry(zomboidDir?: string): Promise<SessionMemoryTelemetry | undefined> {
  if (!zomboidDir) return undefined
  const consolePath = join(zomboidDir, 'console.txt')
  if (!(await exists(consolePath))) return undefined

  try {
    const text = await readTextSafe(consolePath, 16384)
    if (!text) return undefined

    let jvmMaxMb = 0
    let jvmTotalMb = 0
    let jvmFreeMb = 0
    let systemRamMb = 0
    let vramMb: number | undefined
    let timestamp: string | undefined

    const tsMatch = text.match(/LOG\s+:\s+General\s+f:\d+>\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/)
    if (tsMatch) timestamp = tsMatch[1]

    const ramMatch = text.match(/RAM:\s+(\d+)\s*Mb/i)
    if (ramMatch) systemRamMb = parseInt(ramMatch[1], 10)

    const vramMatch = text.match(/video memory:\s+(\d+)\s*Mb/i)
    if (vramMatch) vramMb = parseInt(vramMatch[1], 10)

    const jvmMatch = text.match(/JVM\s*\(free:\s*(\d+)\s*Mb,\s*max:\s*(\d+)\s*Mb,\s*total available:\s*(\d+)\s*Mb\)/i)
    if (jvmMatch) {
      jvmFreeMb = parseInt(jvmMatch[1], 10)
      jvmMaxMb = parseInt(jvmMatch[2], 10)
      jvmTotalMb = parseInt(jvmMatch[3], 10)
    }

    if (jvmMaxMb > 0 || systemRamMb > 0) {
      return { jvmMaxMb, jvmTotalMb, jvmFreeMb, systemRamMb, vramMb, timestamp }
    }
  } catch {
    // Ignore telemetry parse errors
  }
  return undefined
}

/** Parse ProjectZomboid64.json memory args. */
async function parseJsonConfig(gameDir?: string): Promise<GameConfigFileInfo | undefined> {
  if (!gameDir) return undefined
  const p = join(gameDir, 'ProjectZomboid64.json')
  if (!(await exists(p))) {
    return { path: p, exists: false, xmxMb: 0, rawXmx: '' }
  }

  try {
    const isReadOnly = await isFileReadOnly(p)
    const raw = await readTextSafe(p, 32768)
    if (!raw) return { path: p, exists: true, xmxMb: 0, rawXmx: '', isReadOnly }
    const parsed = JSON.parse(raw)
    const vmArgs: string[] = Array.isArray(parsed.vmArgs) ? parsed.vmArgs : []

    let rawXmx = ''
    let rawXms: string | undefined
    for (const arg of vmArgs) {
      if (typeof arg === 'string') {
        if (arg.startsWith('-Xmx')) rawXmx = arg
        if (arg.startsWith('-Xms')) rawXms = arg
      }
    }

    const xmxMb = parseMemoryMb(rawXmx.replace('-Xmx', ''))
    const xmsMb = rawXms ? parseMemoryMb(rawXms.replace('-Xms', '')) : undefined

    return { path: p, exists: true, xmxMb, xmsMb, rawXmx, rawXms, isReadOnly }
  } catch {
    const isReadOnly = await isFileReadOnly(p)
    return { path: p, exists: true, xmxMb: 0, rawXmx: '', isReadOnly }
  }
}

/** Parse a BAT file's -Xmx value. */
async function parseBatConfig(gameDir: string | undefined, batName: string): Promise<GameConfigFileInfo | undefined> {
  if (!gameDir) return undefined
  const p = join(gameDir, batName)
  if (!(await exists(p))) {
    return { path: p, exists: false, xmxMb: 0, rawXmx: '' }
  }

  try {
    const isReadOnly = await isFileReadOnly(p)
    const raw = await readTextSafe(p, 32768)
    if (!raw) return { path: p, exists: true, xmxMb: 0, rawXmx: '', isReadOnly }

    const match = raw.match(/-Xmx(\d+[mgMG])/i)
    const rawXmx = match ? `-Xmx${match[1]}` : ''
    const xmxMb = match ? parseMemoryMb(match[1]) : 0

    return { path: p, exists: true, xmxMb, rawXmx, isReadOnly }
  } catch {
    const isReadOnly = await isFileReadOnly(p)
    return { path: p, exists: true, xmxMb: 0, rawXmx: '', isReadOnly }
  }
}

/** Gather system memory information. */
function getSystemMemoryInfo(): SystemMemoryInfo {
  const totalBytes = totalmem()
  const freeBytes = freemem()
  const totalMb = Math.round(totalBytes / (1024 * 1024))
  const freeMb = Math.round(freeBytes / (1024 * 1024))

  // Recommended min is 4 GB (or total if less)
  const recommendedMinMb = Math.min(4096, totalMb)
  // Recommended max: keep at least 2.5-3 GB for Windows OS and background tasks, max 75%
  const recommendedMaxMb = Math.max(2048, Math.min(Math.round(totalMb * 0.75), totalMb - 2560))

  return { totalBytes, freeBytes, totalMb, freeMb, recommendedMinMb, recommendedMaxMb }
}

/** Complete report of memory settings, telemetry and system capacities. */
export async function getMemoryReport(settings: AppSettings): Promise<MemoryReport> {
  const gameDir = await detectGameDir(settings)
  const zomboidDir = await detectZomboidDir(settings)

  const system = getSystemMemoryInfo()
  const lastSession = await parseConsoleTelemetry(zomboidDir)
  const clientJson = await parseJsonConfig(gameDir)
  const clientBat = await parseBatConfig(gameDir, 'ProjectZomboid64.bat')
  const serverBat = await parseBatConfig(gameDir, 'ProjectZomboidServer.bat')
  const envJavaOptions = await readEnvOptions()

  return {
    system,
    lastSession,
    clientJson,
    clientBat,
    serverBat,
    envJavaOptions,
    gameDir
  }
}

/** Backup file with .bak extension if not already backed up. */
async function ensureBackup(filePath: string): Promise<void> {
  const bakPath = `${filePath}.bak`
  if (!(await exists(bakPath)) && (await exists(filePath))) {
    // If bak exists as read-only, ensure we can write it
    await setFileReadOnly(bakPath, false)
    await fs.copyFile(filePath, bakPath)
  }
}

/** Apply memory parameters to game files, safely handling Read-Only protection. */
export async function applyGameMemory(
  settings: AppSettings,
  req: ApplyMemoryRequest
): Promise<ApplyMemoryResult> {
  const gameDir = await detectGameDir(settings)
  if (!gameDir) {
    return { ok: false, updatedFiles: [], error: 'Project Zomboid game directory not found' }
  }

  const system = getSystemMemoryInfo()
  if (req.xmxMb > system.totalMb) {
    return {
      ok: false,
      updatedFiles: [],
      error: `Selected memory (${req.xmxMb} MB) exceeds physical system RAM (${system.totalMb} MB)`
    }
  }

  const updatedFiles: string[] = []
  const newXmxArg = `-Xmx${req.xmxMb}m`
  const newXmsArg = req.xmsMb ? `-Xms${req.xmsMb}m` : undefined

  try {
    // 1. Update ProjectZomboid64.json
    if (req.targetJson) {
      const jsonPath = join(gameDir, 'ProjectZomboid64.json')
      if (await exists(jsonPath)) {
        // Temporarily lift read-only so write won't fail with EPERM
        await setFileReadOnly(jsonPath, false)
        await ensureBackup(jsonPath)

        const content = await fs.readFile(jsonPath, 'utf8')
        const data = JSON.parse(content)
        if (Array.isArray(data.vmArgs)) {
          let hasXmx = false
          let hasXms = false
          data.vmArgs = data.vmArgs.map((arg: unknown) => {
            if (typeof arg === 'string') {
              if (arg.startsWith('-Xmx')) {
                hasXmx = true
                return newXmxArg
              }
              if (newXmsArg && arg.startsWith('-Xms')) {
                hasXms = true
                return newXmsArg
              }
            }
            return arg
          })
          if (!hasXmx) data.vmArgs.push(newXmxArg)
          if (newXmsArg && !hasXms) data.vmArgs.push(newXmsArg)

          await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8')

          // Apply Read-Only protection if requested
          if (req.protectReadOnly) {
            await setFileReadOnly(jsonPath, true)
          }

          updatedFiles.push('ProjectZomboid64.json')
        }
      }
    }

    // 2. Update ProjectZomboid64.bat and ShowConsole.bat
    if (req.targetBat) {
      const batFiles = ['ProjectZomboid64.bat', 'ProjectZomboid64ShowConsole.bat']
      for (const batName of batFiles) {
        const batPath = join(gameDir, batName)
        if (await exists(batPath)) {
          await setFileReadOnly(batPath, false)
          await ensureBackup(batPath)
          let content = await fs.readFile(batPath, 'utf8')
          if (content.match(/-Xmx\d+[mgMG]/i)) {
            content = content.replace(/-Xmx\d+[mgMG]/gi, newXmxArg)
            await fs.writeFile(batPath, content, 'utf8')
            if (req.protectReadOnly) {
              await setFileReadOnly(batPath, true)
            }
            updatedFiles.push(batName)
          }
        }
      }
    }

    // 3. Update ProjectZomboidServer.bat
    if (req.targetServerBat) {
      const srvPath = join(gameDir, 'ProjectZomboidServer.bat')
      if (await exists(srvPath)) {
        await setFileReadOnly(srvPath, false)
        await ensureBackup(srvPath)
        let content = await fs.readFile(srvPath, 'utf8')
        if (content.match(/-Xmx\d+[mgMG]/i)) {
          content = content.replace(/-Xmx\d+[mgMG]/gi, newXmxArg)
          await fs.writeFile(srvPath, content, 'utf8')
          if (req.protectReadOnly) {
            await setFileReadOnly(srvPath, true)
          }
          updatedFiles.push('ProjectZomboidServer.bat')
        }
      }
    }

    return { ok: true, updatedFiles }
  } catch (e) {
    return {
      ok: false,
      updatedFiles,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Set or delete _JAVA_OPTIONS in user environment. */
export async function setEnvJavaOptions(val: string | null): Promise<SetEnvOptionsResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Environment variables management is only supported on Windows' }
  }

  try {
    if (val && val.trim().length > 0) {
      const cleanVal = val.trim()
      await run('reg', ['add', 'HKCU\\Environment', '/v', '_JAVA_OPTIONS', '/t', 'REG_SZ', '/d', cleanVal, '/f'], {
        windowsHide: true
      })
      return { ok: true, currentValue: cleanVal }
    } else {
      try {
        await run('reg', ['delete', 'HKCU\\Environment', '/v', '_JAVA_OPTIONS', '/f'], {
          windowsHide: true
        })
      } catch {
        // Ignored if key doesn't exist
      }
      return { ok: true, currentValue: undefined }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Explicitly toggle the Read-Only protection attribute on game files. */
export async function toggleGameFilesReadOnly(
  settings: AppSettings,
  req: ToggleReadOnlyRequest
): Promise<ToggleReadOnlyResult> {
  const gameDir = await detectGameDir(settings)
  if (!gameDir) {
    return { ok: false, updatedFiles: [], error: 'Project Zomboid game directory not found' }
  }

  const updatedFiles: string[] = []
  try {
    if (req.targetJson !== false) {
      const p = join(gameDir, 'ProjectZomboid64.json')
      if (await exists(p)) {
        await setFileReadOnly(p, req.readOnly)
        updatedFiles.push('ProjectZomboid64.json')
      }
    }
    if (req.targetBat !== false) {
      const batFiles = ['ProjectZomboid64.bat', 'ProjectZomboid64ShowConsole.bat']
      for (const b of batFiles) {
        const p = join(gameDir, b)
        if (await exists(p)) {
          await setFileReadOnly(p, req.readOnly)
          updatedFiles.push(b)
        }
      }
    }
    if (req.targetServerBat) {
      const p = join(gameDir, 'ProjectZomboidServer.bat')
      if (await exists(p)) {
        await setFileReadOnly(p, req.readOnly)
        updatedFiles.push('ProjectZomboidServer.bat')
      }
    }
    return { ok: true, updatedFiles }
  } catch (e) {
    return {
      ok: false,
      updatedFiles,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
