import type {
  AppInfo,
  AppSettings,
  AuthoringTarget,
  FilePreview,
  FsNode,
  ModInfoDraft,
  ModStats,
  PackOptions,
  PackResult,
  PathsReport,
  ScaffoldOptions,
  ScaffoldResult,
  ScanProgress,
  ScanResult,
  ValidateOptions,
  ValidationReport,
  WorkbenchProgress,
  WriteModInfoRequest,
  WriteModInfoResult
} from './types'

export interface ScanRequest {
  force?: boolean
  sourceIds?: string[]
}

/** The complete surface exposed to the renderer through `window.pz`. */
export interface PzApi {
  app: {
    info(): Promise<AppInfo>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    onState(cb: (state: { maximized: boolean }) => void): () => void
  }
  paths: {
    detect(): Promise<PathsReport>
    pickFolder(title?: string): Promise<string | undefined>
  }
  mods: {
    scan(req?: ScanRequest): Promise<ScanResult>
    stats(path: string): Promise<ModStats>
    onProgress(cb: (p: ScanProgress) => void): () => void
  }
  fs: {
    list(path: string): Promise<FsNode[]>
    tree(path: string, depth?: number): Promise<FsNode[]>
    preview(path: string): Promise<FilePreview>
  }
  shell: {
    /** Opens Windows Explorer with the item selected. */
    reveal(path: string): Promise<void>
    /** Opens the folder/file with the OS default handler. */
    open(path: string): Promise<string | void>
    external(url: string): Promise<void>
    terminal(path: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  /**
   * Authoring tools. Every call here is guarded by a write allowlist that is
   * narrower than the read one — the game install and Steam Workshop content
   * are never writable.
   */
  workbench: {
    /** Containers new mods may be created in. */
    targets(): Promise<AuthoringTarget[]>
    scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult>
    readInfo(modPath: string): Promise<ModInfoDraft>
    writeInfo(req: WriteModInfoRequest): Promise<WriteModInfoResult>
    validate(modPath: string, opts?: ValidateOptions): Promise<ValidationReport>
    pack(opts: PackOptions): Promise<PackResult>
    onProgress(cb: (p: WorkbenchProgress) => void): () => void
  }
}
