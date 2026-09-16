import { contextBridge, ipcRenderer } from 'electron'
import type { PzApi, ScanRequest } from '../shared/api'
import { IPC } from '../shared/ipc'
import type {
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

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PzApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    onState: (cb) => subscribe<{ maximized: boolean }>(IPC.windowState, cb)
  },
  paths: {
    detect: () => ipcRenderer.invoke(IPC.pathsDetect),
    pickFolder: (title?: string) => ipcRenderer.invoke(IPC.pathsPickFolder, title)
  },
  mods: {
    scan: (req: ScanRequest = {}) => ipcRenderer.invoke(IPC.modsScan, req),
    stats: (path: string) => ipcRenderer.invoke(IPC.modsStats, path),
    onProgress: (cb) => subscribe<ScanProgress>(IPC.modsProgress, cb)
  },
  fs: {
    list: (path: string) => ipcRenderer.invoke(IPC.fsList, path),
    tree: (path: string, depth?: number) => ipcRenderer.invoke(IPC.fsTree, path, depth),
    preview: (path: string) => ipcRenderer.invoke(IPC.fsPreview, path)
  },
  shell: {
    reveal: (path: string) => ipcRenderer.invoke(IPC.shellReveal, path),
    open: (path: string) => ipcRenderer.invoke(IPC.shellOpen, path),
    external: (url: string) => ipcRenderer.invoke(IPC.shellExternal, url),
    terminal: (path: string) => ipcRenderer.invoke(IPC.shellTerminal, path)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  workbench: {
    targets: () => ipcRenderer.invoke(IPC.wbTargets),
    scaffold: (opts: ScaffoldOptions) => ipcRenderer.invoke(IPC.wbScaffold, opts),
    readInfo: (modPath: string) => ipcRenderer.invoke(IPC.wbReadInfo, modPath),
    writeInfo: (req: WriteModInfoRequest) => ipcRenderer.invoke(IPC.wbWriteInfo, req),
    validate: (modPath: string, opts: ValidateOptions = {}) =>
      ipcRenderer.invoke(IPC.wbValidate, modPath, opts),
    pack: (opts: PackOptions) => ipcRenderer.invoke(IPC.wbPack, opts),
    shove: (req: BatchPackRequest) => ipcRenderer.invoke(IPC.wbShove, req),
    shoveCancel: () => ipcRenderer.invoke(IPC.wbShoveCancel),
    onProgress: (cb) => subscribe<WorkbenchProgress>(IPC.wbProgress, cb)
  },
  loadout: {
    files: () => ipcRenderer.invoke(IPC.loFiles),
    apply: (opts: LoadoutApplyOptions) => ipcRenderer.invoke(IPC.loApply, opts)
  },
  logs: {
    list: () => ipcRenderer.invoke(IPC.logList),
    read: (id: string) => ipcRenderer.invoke(IPC.logRead, id)
  },
  tools: {
    pick: () => ipcRenderer.invoke(IPC.toolsPick),
    pickFolder: () => ipcRenderer.invoke(IPC.toolsPickFolder),
    pickOutput: () => ipcRenderer.invoke(IPC.toolsPickOutput),
    convert: (opts: ConvertOptions) => ipcRenderer.invoke(IPC.toolsConvert, opts),
    cancel: () => ipcRenderer.invoke(IPC.toolsCancel),
    onProgress: (cb) => subscribe<ConvertProgress>(IPC.toolsProgress, cb),
    reveal: (path: string) => ipcRenderer.invoke(IPC.toolsReveal, path),
    assimpStatus: () => ipcRenderer.invoke(IPC.toolsAssimpStatus),
    assimpLocate: () => ipcRenderer.invoke(IPC.toolsAssimpLocate)
  },
  npp: {
    status: () => ipcRenderer.invoke(IPC.nppStatus),
    locate: () => ipcRenderer.invoke(IPC.nppLocate),
    install: () => ipcRenderer.invoke(IPC.nppInstall),
    preview: () => ipcRenderer.invoke(IPC.nppPreview),
    open: (path: string, line?: number) => ipcRenderer.invoke(IPC.nppOpen, path, line),
    reveal: (target: 'exe' | 'udl') => ipcRenderer.invoke(IPC.nppReveal, target)
  }
}

contextBridge.exposeInMainWorld('pz', api)
