import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { extname, join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppInfo, AppSettings, ScanProgress } from '../shared/types'
import { assertPathAllowed, invalidateGuard } from './services/guard'
import { buildTree, exists, listDir, readPreview, walkStats } from './services/fsx'
import { detectPaths } from './services/paths'
import { scanMods, type ScanOptions } from './services/scanner'
import { getSettings, setSettings } from './services/settings'

/**
 * Extensions Windows *executes* rather than opens.
 *
 * `assertPathAllowed` only proves a path sits inside a known mod root — and mod roots
 * are exactly where untrusted third-party Workshop content lives. `shell.openPath` is
 * ShellExecute, so pointing it at one of these runs the file: a mod shipping
 * `readme.exe` would otherwise execute from a single click in the file inspector.
 */
const EXECUTABLE_EXTS = new Set([
  'exe', 'com', 'bat', 'cmd', 'pif', 'scr', 'scf', 'cpl', 'msc', 'msi', 'msp', 'mst',
  'hta', 'jar', 'lnk', 'url', 'inf', 'ins', 'isp', 'its', 'reg', 'sct', 'shb', 'shs',
  'ps1', 'ps1xml', 'psc1', 'psc2', 'psm1', 'psd1', 'msh', 'msh1', 'msh2', 'mshxml',
  'vb', 'vbs', 'vbe', 'vsw', 'vxd', 'ws', 'wsf', 'wsc', 'wsh', 'js', 'jse', 'jnlp',
  'dll', 'ocx', 'sys', 'drv', 'gadget', 'application', 'appref-ms', 'appx', 'appxbundle',
  'chm', 'sh', 'bash', 'py', 'pyw', 'pl', 'rb', 'php'
])

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      name: 'PZ MANAGEMENT',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    }
  })

  ipcMain.handle(IPC.windowMinimize, (e) => senderWindow(e)?.minimize())
  ipcMain.handle(IPC.windowMaximize, (e) => {
    const win = senderWindow(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (e) => senderWindow(e)?.close())

  ipcMain.handle(IPC.pathsDetect, async () => detectPaths(await getSettings()))

  ipcMain.handle(IPC.pathsPickFolder, async (e, title?: string) => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: title ?? 'Select a folder',
      properties: ['openDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle(IPC.modsScan, async (e, opts: ScanOptions = {}) => {
    const settings = await getSettings()
    const sender = e.sender
    let last = 0
    const onProgress = (p: ScanProgress): void => {
      // Throttle progress traffic; always let the terminal states through.
      const now = Date.now()
      if (p.phase === 'done' || now - last > 60) {
        last = now
        if (!sender.isDestroyed()) sender.send(IPC.modsProgress, p)
      }
    }
    return scanMods(settings, opts, onProgress)
  })

  ipcMain.handle(IPC.modsStats, async (_e, path: string) => {
    return walkStats(await assertPathAllowed(path))
  })

  ipcMain.handle(IPC.fsList, async (_e, path: string) => {
    return listDir(await assertPathAllowed(path))
  })

  ipcMain.handle(IPC.fsTree, async (_e, path: string, depth = 2) => {
    return buildTree(await assertPathAllowed(path), Math.max(1, Math.min(depth, 6)))
  })

  ipcMain.handle(IPC.fsPreview, async (_e, path: string) => {
    return readPreview(await assertPathAllowed(path))
  })

  ipcMain.handle(IPC.shellReveal, async (_e, path: string) => {
    shell.showItemInFolder(await assertPathAllowed(path))
  })

  ipcMain.handle(IPC.shellOpen, async (_e, path: string) => {
    const target = await assertPathAllowed(path)
    const ext = extname(target).slice(1).toLowerCase()
    if (ext && EXECUTABLE_EXTS.has(ext)) {
      // Same contract as shell.openPath: a non-empty string is the failure reason.
      shell.showItemInFolder(target)
      return `Refused to launch .${ext} from a mod folder. Revealed it in Explorer instead.`
    }
    return shell.openPath(target)
  })

  ipcMain.handle(IPC.shellExternal, async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) urls can be opened')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.shellTerminal, async (_e, path: string) => {
    const cwd = await assertPathAllowed(path)
    if (process.platform !== 'win32') return
    // Absolute interpreter path on purpose. `cmd /c start powershell.exe` resolves the
    // name through ShellExecute, which searches the working directory before System32
    // and PATH — and the working directory here is an untrusted mod folder that may
    // ship its own powershell.exe. Spawning the binary directly skips that lookup
    // entirely; `detached` still gives the child its own console window on Windows.
    const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')
    const powershell = join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const usePowershell = await exists(powershell)
    const child = spawn(usePowershell ? powershell : join(system32, 'cmd.exe'), usePowershell ? ['-NoExit'] : [], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<AppSettings>) => {
    const next = await setSettings(patch)
    // Path-related changes alter which roots the renderer may read.
    invalidateGuard()
    return next
  })
}
