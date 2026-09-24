import type {
  AppInfo,
  AppSettings,
  AssimpStatus,
  AuthoringTarget,
  BatchPackRequest,
  BatchPackResult,
  ConvertOptions,
  ConvertProgress,
  ConvertResult,
  FilePreview,
  ForgeInput,
  FsNode,
  LoadoutApplyOptions,
  LoadoutApplyResult,
  LoadoutFile,
  SortingRule,
  LogReadResult,
  LogSource,
  ModInfoDraft,
  ModStats,
  NppInstallResult,
  NppPackPreview,
  NppStatus,
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
    /** Pack many mods in one run with a shared set of options. */
    shove(req: BatchPackRequest): Promise<BatchPackResult>
    shoveCancel(): Promise<void>
    onProgress(cb: (p: WorkbenchProgress) => void): () => void
  }
  /**
   * Load order & profiles. Reads the game's own mod-list configs and writes
   * them back; the write goes through the same guarded paths as Workbench.
   */
  loadout: {
    /** Every config the module can edit (client default.txt + saves + server inis). */
    files(): Promise<LoadoutFile[]>
    apply(opts: LoadoutApplyOptions): Promise<LoadoutApplyResult>
    getRules(): Promise<Record<string, SortingRule>>
    saveRules(rules: Record<string, SortingRule>): Promise<boolean>
    getGamePresets(): Promise<Record<string, string[]>>
    saveGamePresets(presets: Record<string, string[]>): Promise<boolean>
    getLuaDeps(): Promise<Record<string, string[]>>
  }
  /**
   * Crash logs and console output. Read-only: there is no write counterpart, and
   * like Loadout no call here accepts a renderer path — the renderer sends an
   * opaque source id and main resolves it under the detected Zomboid user dir.
   */
  logs: {
    /** console.txt plus every Logs\*.txt, freshest first. */
    list(): Promise<LogSource[]>
    /** Read the tail of one source by its opaque id. */
    read(id: string): Promise<LogReadResult>
  }
  /**
   * The FBX forge.
   *
   * Conversion reads files the user picked in a native dialog (or files that are
   * already inside a mod root) and writes `.fbx` beside them or into the output
   * container recorded in settings. The renderer never supplies the output path:
   * `pickOutput` is the only way it changes, and it changes in main.
   */
  tools: {
    /** Native file dialog. The chosen paths become convertible for this session. */
    pick(): Promise<ForgeInput[]>
    /** Native folder dialog: every convertible file under it, recursively. */
    pickFolder(): Promise<ForgeInput[]>
    /** Native folder dialog for the output container; persists into settings. */
    pickOutput(): Promise<string | undefined>
    convert(opts: ConvertOptions): Promise<ConvertResult>
    cancel(): Promise<void>
    onProgress(cb: (p: ConvertProgress) => void): () => void
    /**
     * Show a converted file in Explorer, or open the output folder.
     *
     * Separate from `shell.reveal` because the forge writes outside the mod
     * roots the shared guard covers; this one accepts a path the user picked (or
     * a folder they picked) and nothing else.
     */
    reveal(path: string): Promise<void>
    /**
     * Whether the assimp command-line tool is present and usable.
     *
     * The renderer only ever reads this. The executable is resolved in main, and
     * `assimpLocate` opens a dialog there and probes what comes back, so no path
     * from this window can become something the forge will execute.
     */
    assimpStatus(): Promise<AssimpStatus>
    /** Ask the user where assimp lives, probe it, then re-report. */
    assimpLocate(): Promise<AssimpStatus>
  }
  /**
   * Notepad++, tuned for Project Zomboid.
   *
   * `install` writes the syntax pack into `%APPDATA%\Notepad++\userDefineLangs`,
   * a path main derives on its own — nothing here takes a destination, and
   * nothing here takes an executable path either.
   */
  npp: {
    status(): Promise<NppStatus>
    /** Ask the user where Notepad++ lives, then re-probe. */
    locate(): Promise<NppStatus>
    install(): Promise<NppInstallResult>
    /** The pack's XML as it would be written, for inspection before installing. */
    preview(): Promise<NppPackPreview[]>
    /** Open one file in Notepad++, optionally at a line. */
    open(path: string, line?: number): Promise<void>
    /**
     * Reveal the executable, or open the folder the pack installs into.
     *
     * Asked for by name rather than by path: both live outside every mod root,
     * so main resolves them itself instead of taking a path from the renderer.
     */
    reveal(target: 'exe' | 'udl'): Promise<void>
  }
}
