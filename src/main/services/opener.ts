import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { shell } from 'electron'
import { exists } from './fsx'
import { detectSteamRoot } from './paths'

/**
 * Robust launcher for external URLs and protocols (Steam, web browsers).
 * Bypasses Windows DDE / ShellExecuteEx deadlocks in Electron by using direct
 * binary spawning and cmd /c start fallbacks.
 */
export async function openExternal(url: string): Promise<boolean> {
  const trimmed = url.trim()
  if (!/^(https?|steam):\/\//i.test(trimmed)) {
    throw new Error('Only http(s) or steam urls can be opened')
  }

  // If opening a steam:// protocol URL on Windows, try launching Steam.exe directly
  if (process.platform === 'win32' && /^steam:\/\//i.test(trimmed)) {
    try {
      const steamRoot = await detectSteamRoot()
      if (steamRoot) {
        const steamExe = join(steamRoot, 'Steam.exe')
        if (await exists(steamExe)) {
          const child = spawn(steamExe, [trimmed], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.unref()
          return true
        }
      }
    } catch (err) {
      console.warn('[opener] Direct Steam.exe launch failed:', err)
    }

    try {
      const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')
      const cmdExe = join(system32, 'cmd.exe')
      const child = spawn(cmdExe, ['/c', 'start', '""', trimmed], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      return true
    } catch (cmdErr) {
      console.warn('[opener] cmd start steam:// failed:', cmdErr)
    }
  }

  // Try electron shell.openExternal with a safety timeout (600ms)
  let electronOk = false
  try {
    const electronPromise = shell.openExternal(trimmed, { activate: true }).then(() => {
      electronOk = true
      return true
    })
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 600))
    const winner = await Promise.race([electronPromise, timeout])
    if (winner && electronOk) return true
  } catch (err) {
    console.warn('[opener] shell.openExternal failed:', err)
  }

  // Windows system fallback: cmd.exe /c start "" "<url>"
  if (process.platform === 'win32') {
    try {
      const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')
      const cmdExe = join(system32, 'cmd.exe')
      const child = spawn(cmdExe, ['/c', 'start', '""', trimmed], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      return true
    } catch (cmdErr) {
      console.warn('[opener] cmd.exe /c start failed, trying PowerShell:', cmdErr)
    }

    try {
      const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')
      const psExe = join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const child = spawn(
        psExe,
        ['-NoProfile', '-NonInteractive', '-Command', `Start-Process "${trimmed.replace(/"/g, '`"')}"`],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }
      )
      child.unref()
      return true
    } catch (psErr) {
      console.error('[opener] PowerShell Start-Process fallback failed:', psErr)
    }
  }

  return electronOk
}

/**
 * Open a Steam Workshop item directly in the Steam client, falling back to browser.
 */
export async function openWorkshopInSteam(publishedFileId: string): Promise<boolean> {
  const cleanId = String(publishedFileId).trim().match(/\d+/)?.[0]
  if (!cleanId) return false

  const steamUrl = `steam://url/CommunityFilePage/${cleanId}`
  const webUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${cleanId}`

  // 1. Direct Steam client launch
  if (process.platform === 'win32') {
    try {
      const steamRoot = await detectSteamRoot()
      if (steamRoot) {
        const steamExe = join(steamRoot, 'Steam.exe')
        if (await exists(steamExe)) {
          const child = spawn(steamExe, [steamUrl], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.unref()
          return true
        }
      }
    } catch (err) {
      console.warn('[opener] Direct Steam.exe launch for workshop failed:', err)
    }
  }

  // 2. Try steam:// protocol via openExternal
  const steamOk = await openExternal(steamUrl)
  if (steamOk) return true

  // 3. Fallback to web URL
  return openExternal(webUrl)
}
