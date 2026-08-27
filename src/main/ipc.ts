import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { extname, join } from 'node:path'
import { IPC } from '../shared/ipc'
import type {
  AppInfo,
  AppSettings,
  BatchPackRequest,
  ConvertOptions,
  ConvertProgress,
  LoadoutApplyOptions,
  PackOptions,
  ScaffoldOptions,
  ScanProgress,
  ValidateOptions,
  WorkbenchProgress,
  WriteModInfoRequest
} from '../shared/types'
import { listAuthoringTargets, readModInfoDraft, scaffoldMod, writeModInfo } from './services/authoring'
import {
  assertForgePath,
  collectConvertible,
  convertFiles,
  inspectInputs,
  rememberPickedDir,
  rememberPickedFiles
} from './services/convert'
import { assertPathAllowed, invalidateGuard } from './services/guard'
import { applyLoadout, listLoadoutFiles } from './services/loadout'
import { buildTree, exists, isDir, listDir, readPreview, walkStats } from './services/fsx'
import { listLogSources, readLog } from './services/logs'
import {
  installNppPack,
  looksLikeNpp,
  nppPathFor,
  nppStatus,
  openInNpp,
  previewNppPack
} from './services/npp'
import { packMod } from './services/pack'
import { detectPaths } from './services/paths'
import { scanMods, type ScanOptions } from './services/scanner'
import { getSettings, setSettings } from './services/settings'
import { shovelMods } from './services/shovel'
import { validateMod } from './services/validate'

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

/**
 * Cancellation flag owned by the shove handler closure. A run clears it on
 * start; `wbShoveCancel` flips it and the service checks it between items.
 */
let shoveCancelled = false

/** Same contract for the FBX forge, which walks its queue one file at a time. */
let convertCancelled = false

/** File dialog filters for the forge: what it can actually read, then everything. */
const FORGE_FILTERS: Electron.FileFilter[] = [
  { name: 'Meshes (obj, stl, ply, x, dae, gltf, glb)', extensions: ['obj', 'stl', 'ply', 'x', 'dae', 'gltf', 'glb'] },
  { name: 'Images (png, jpg, bmp, tga, dds)', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tga', 'dds', 'webp'] },
  { name: 'FBX', extensions: ['fbx'] },
  { name: 'All files', extensions: ['*'] }
]

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

  // --- Workbench (authoring: the only handlers that write to mod folders) ---

  ipcMain.handle(IPC.wbTargets, async () => listAuthoringTargets(await getSettings()))

  ipcMain.handle(IPC.wbScaffold, async (_e, opts: ScaffoldOptions) => {
    const result = await scaffoldMod(await getSettings(), opts)
    // A freshly created folder becomes a new allowed root for later reads.
    invalidateGuard()
    return result
  })

  ipcMain.handle(IPC.wbReadInfo, async (_e, modPath: string) => {
    // Reading metadata only needs read access, so the wider allowlist applies.
    return readModInfoDraft(await assertPathAllowed(modPath))
  })

  ipcMain.handle(IPC.wbWriteInfo, async (_e, req: WriteModInfoRequest) => {
    // writeModInfo re-checks the path against the strict write allowlist.
    return writeModInfo(req)
  })

  ipcMain.handle(IPC.wbValidate, async (e, modPath: string, opts: ValidateOptions = {}) => {
    const target = await assertPathAllowed(modPath)
    const sender = e.sender
    let last = 0
    const onProgress = (p: WorkbenchProgress): void => {
      const now = Date.now()
      if (p.phase === 'done' || now - last > 60) {
        last = now
        if (!sender.isDestroyed()) sender.send(IPC.wbProgress, p)
      }
    }
    return validateMod(target, opts, onProgress)
  })

  ipcMain.handle(IPC.wbPack, async (e, opts: PackOptions) => {
    const settings = await getSettings()
    const sender = e.sender
    let last = 0
    const onProgress = (p: WorkbenchProgress): void => {
      const now = Date.now()
      if (p.phase === 'done' || now - last > 60) {
        last = now
        if (!sender.isDestroyed()) sender.send(IPC.wbProgress, p)
      }
    }
    const result = await packMod(settings, opts, onProgress)
    invalidateGuard()
    return result
  })

  ipcMain.handle(IPC.wbShove, async (e, req: BatchPackRequest) => {
    const settings = await getSettings()
    const sender = e.sender
    let last = 0
    shoveCancelled = false
    const onProgress = (p: WorkbenchProgress): void => {
      const now = Date.now()
      if (p.phase === 'done' || now - last > 60) {
        last = now
        if (!sender.isDestroyed()) sender.send(IPC.wbProgress, p)
      }
    }
    const result = await shovelMods({
      request: req,
      settings,
      onProgress,
      isCancelled: () => shoveCancelled
    })
    invalidateGuard()
    return result
  })

  ipcMain.handle(IPC.wbShoveCancel, async () => {
    shoveCancelled = true
  })

  // --- Loadout (module 02): reads and writes the game's own mod lists -------

  ipcMain.handle(IPC.loFiles, async () => listLoadoutFiles(await getSettings()))

  ipcMain.handle(IPC.loApply, async (_e, opts: LoadoutApplyOptions) => {
    // applyLoadout validates the target name itself; the write roots are the
    // Zomboid user dir's config files, which no other handler may touch.
    const result = await applyLoadout(await getSettings(), opts)
    invalidateGuard()
    return result
  })

  // --- Ledger (module 09): read-only log reader -----------------------------
  // No guard call and no invalidateGuard: readLog builds the path itself from
  // the detected user dir, and nothing here writes.

  ipcMain.handle(IPC.logList, async () => listLogSources(await getSettings()))

  ipcMain.handle(IPC.logRead, async (_e, id: string) => readLog(await getSettings(), id))

  // --- Tools (module 07): the FBX forge --------------------------------------
  // The dialog handlers are the only way a path outside the mod roots enters the
  // forge, which is what makes the writes defensible: `convert.ts` accepts an
  // input only if it was picked here or already lives inside a scanned mod.

  ipcMain.handle(IPC.toolsPick, async (e) => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick files to convert to FBX',
      properties: ['openFile', 'multiSelections'],
      filters: FORGE_FILTERS
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return []
    rememberPickedFiles(result.filePaths)
    return inspectInputs(result.filePaths)
  })

  ipcMain.handle(IPC.toolsPickFolder, async (e) => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick a folder of files to convert',
      properties: ['openDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (!picked) return []
    // The folder itself is consented too, so "beside the source" can write there.
    rememberPickedDir(picked)
    const found = await collectConvertible(picked)
    if (found.length === 0) return []
    rememberPickedFiles(found)
    return inspectInputs(found)
  })

  ipcMain.handle(IPC.toolsPickOutput, async (e) => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick the folder converted files are written to',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (!picked) return undefined
    // Persisted so the choice survives a restart; consented so it is writable.
    rememberPickedDir(picked)
    await setSettings({ toolsOutputDir: picked })
    return picked
  })

  ipcMain.handle(IPC.toolsConvert, async (e, opts: ConvertOptions) => {
    const settings = await getSettings()
    const sender = e.sender
    let last = 0
    convertCancelled = false
    const onProgress = (p: ConvertProgress): void => {
      const now = Date.now()
      if (p.phase === 'done' || now - last > 60) {
        last = now
        if (!sender.isDestroyed()) sender.send(IPC.toolsProgress, p)
      }
    }
    const result = await convertFiles(settings, opts, onProgress, () => convertCancelled)
    // A new .fbx may have landed inside a mod folder the guard has cached.
    invalidateGuard()
    return result
  })

  ipcMain.handle(IPC.toolsCancel, async () => {
    convertCancelled = true
  })

  ipcMain.handle(IPC.toolsReveal, async (_e, path: string) => {
    // Not `shell:open`: the forge writes outside the read allowlist, and this
    // gate is the picked-path rule instead. A directory opens, a file is
    // revealed with the item selected — and neither is ever executed.
    const target = await assertForgePath(await getSettings(), path)
    if (await isDir(target)) await shell.openPath(target)
    else shell.showItemInFolder(target)
  })

  // --- Tools (module 07): the Notepad++ bridge -------------------------------
  // No channel here takes an executable path or a destination: `npp.ts` derives
  // both, so this cannot become a way around the `shell:open` .exe refusal.

  ipcMain.handle(IPC.nppStatus, async () => nppStatus(await getSettings()))

  ipcMain.handle(IPC.nppLocate, async (e) => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick the Notepad++ install folder',
      properties: ['openDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (picked && (await looksLikeNpp(picked))) {
      await setSettings({ nppPathOverride: picked })
    }
    return nppStatus(await getSettings())
  })

  ipcMain.handle(IPC.nppInstall, async () => installNppPack(await getSettings()))

  ipcMain.handle(IPC.nppPreview, () => previewNppPack())

  ipcMain.handle(IPC.nppOpen, async (_e, path: string, line?: number) => {
    // Reading is guarded exactly like `shell:open`; only the launcher differs.
    const target = await assertPathAllowed(path)
    await openInNpp(await getSettings(), target, line)
  })

  ipcMain.handle(IPC.nppReveal, async (_e, target: 'exe' | 'udl') => {
    const path = await nppPathFor(await getSettings(), target)
    if (target === 'udl') await shell.openPath(path)
    else shell.showItemInFolder(path)
  })
}
