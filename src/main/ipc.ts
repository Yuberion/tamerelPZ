import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { IPC } from '../shared/ipc'
import type { AppInfo, AppSettings, ScanProgress } from '../shared/types'
import { assertPathAllowed, invalidateGuard } from './services/guard'
import { buildTree, listDir, readPreview, walkStats } from './services/fsx'
import { detectPaths } from './services/paths'
import { scanMods, type ScanOptions } from './services/scanner'
import { getSettings, setSettings } from './services/settings'

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
    return shell.openPath(await assertPathAllowed(path))
  })

  ipcMain.handle(IPC.shellExternal, async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) urls can be opened')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.shellTerminal, async (_e, path: string) => {
    const cwd = await assertPathAllowed(path)
    if (process.platform !== 'win32') return
    const child = spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit'], {
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
