/**
 * Shared data contracts between the Electron main process and the renderer.
 * Keep this file free of any runtime dependency on `electron` or `node`.
 */

export type ModSourceKind = 'local' | 'workshop' | 'game' | 'project' | 'custom'

/**
 * Stable identifier for a built-in source label.
 *
 * Main emits this instead of display text so the renderer can localise it. Custom
 * sources have no key and keep their user-supplied `label` verbatim.
 */
export type ModSourceLabelKey =
  | 'local'
  | 'workshop'
  | 'gameMods'
  | 'gameMediaMods'
  | 'workshopProjects'

/** A root directory that holds Project Zomboid mods. */
export interface ModSource {
  /** Stable identifier, e.g. `local`, `workshop:E:\SteamLibrary`. */
  id: string
  kind: ModSourceKind
  /** English fallback text; prefer `labelKey` when it is set. */
  label: string
  /** Translation key for built-in sources. Absent for user-defined ones. */
  labelKey?: ModSourceLabelKey
  /** Absolute path of the container directory. */
  path: string
  /** Short hint shown under the label in the UI. */
  hint?: string
  exists: boolean
  /** Number of mods discovered in the last scan. */
  modCount: number
  /** Whether the source participates in scans. */
  enabled: boolean
}

export type ModCategory =
  | 'map'
  | 'vehicle'
  | 'weapon'
  | 'clothing'
  | 'item'
  | 'build'
  | 'translation'
  | 'library'
  | 'ui'
  | 'texture'
  | 'sound'
  | 'model'
  | 'balance'
  | 'server'
  | 'misc'

/** A build-specific sub-folder inside a mod (`common`, `42`, `42.20`, ...). */
export interface ModVersionFolder {
  name: string
  path: string
  hasModInfo: boolean
  /** Numeric weight used to pick the most relevant folder. */
  weight: number
}

/**
 * Non-fatal problem codes, not display text.
 *
 * Main emits codes so the renderer can render them in the active language; adding a
 * code here requires a matching `warn.*` entry in the renderer dictionary.
 */
export type ModWarning = 'no-modinfo' | 'no-id' | 'poster-missing'

/** One discovered mod. */
export interface ModEntry {
  /** Unique, stable key: `<sourceId>::<absolute path>`. */
  key: string
  /** Folder name on disk. */
  folderName: string
  /** Absolute path of the mod root. */
  path: string
  sourceId: string
  sourceKind: ModSourceKind
  /** Steam Workshop item id when the mod comes from the workshop. */
  workshopId?: string
  /** Display name (from mod.info, falls back to folder name). */
  name: string
  /** Normalised mod id (workshop prefix stripped). */
  modId?: string
  /** Raw id exactly as written in mod.info. */
  rawModId?: string
  description?: string
  authors?: string
  url?: string
  modVersion?: string
  pzVersion?: string
  posterPath?: string
  iconPath?: string
  requires: string[]
  loadAfter?: string[]
  loadBefore?: string[]
  incompatible?: string[]
  declaredCategory?: string
  tags: string[]
  /** Detected categories, most relevant first. */
  categories: ModCategory[]
  /** Supported builds, e.g. `['B41','B42']`. */
  builds: string[]
  versionFolders: ModVersionFolder[]
  /** `media/*` sub-directory names found anywhere in the mod. */
  mediaDirs: string[]
  /** Path of the mod.info that was parsed. */
  infoFile?: string
  hasInfo: boolean
  mtime: number
  /** Non-fatal problems found while analysing the mod. */
  warnings: ModWarning[]
}

export interface ScanProgress {
  phase: 'sources' | 'enumerate' | 'analyze' | 'done'
  done: number
  total: number
  label: string
}

export interface ScanIssues {
  /** Normalised mod id -> mod keys sharing it. */
  duplicateIds: Record<string, string[]>
  /** Mod key -> required ids that were not found in any source. */
  missingRequires: Record<string, string[]>
  /** Mod keys that have no readable mod.info. */
  missingInfo: string[]
}

export interface ScanResult {
  sources: ModSource[]
  mods: ModEntry[]
  issues: ScanIssues
  scannedAt: number
  durationMs: number
  fromCache: number
}

/** A node of the mod "skeleton" tree. */
export interface FsNode {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  /** Lowercase extension without the dot. */
  ext: string
  /** Number of direct children for directories. */
  childCount: number
  /** Direct children, present only once the directory has been expanded. */
  children?: FsNode[]
}

export interface ModStats {
  files: number
  dirs: number
  bytes: number
  /** Extension -> aggregated count/size, sorted by size on the renderer side. */
  byExt: Record<string, { n: number; bytes: number }>
  /** True when the walk hit its safety limit. */
  truncated: boolean
}

export interface FilePreview {
  path: string
  kind: 'text' | 'image' | 'audio' | 'binary'
  size: number
  mtime: number
  /** Present for `text`. */
  text?: string
  /** True when the text was cut off. */
  truncated?: boolean
  /** Present for `image`: intrinsic dimensions when detectable. */
  width?: number
  height?: number
  /** Detected language token for highlighting, e.g. `lua`. */
  lang?: string
}

export interface UserModAnnotation {
  favorite?: boolean
  tags?: string[]
  notes?: string
}

export interface PathsReport {
  homeDir: string
  /** `%USERPROFILE%\Zomboid` or the detected equivalent. */
  zomboidDir?: string
  steamRoot?: string
  steamLibraries: string[]
  gameDir?: string
  gameVersion?: string
  workshopDirs: string[]
}

export interface AppSettings {
  /** Source ids the user disabled. */
  disabledSources: string[]
  /** Extra mod container directories added by the user. */
  customSources: { id: string; label: string; path: string; kind: ModSourceKind }[]
  /** Manual override when auto-detection fails. */
  gameDirOverride?: string
  zomboidDirOverride?: string
  sortMode: SortMode
  groupMode: GroupMode
  lastModKey?: string
  lastSourceFilter?: string
  /** Named load orders saved from the Loadout module, newest first. */
  loadoutProfiles: LoadoutProfile[]
  /** User-defined tags, notes, and favorites per mod key. */
  modAnnotations?: Record<string, UserModAnnotation>
  /**
   * Output container for the Tools converter.
   *
   * Only ever written by `tools:pick-output`, i.e. by a path the user chose in a
   * native dialog. The renderer may select it but can never supply it, which is
   * what lets the convert handler write outside the mod roots at all.
   */
  toolsOutputDir?: string
  /**
   * Where the assimp command-line tool lives, when detection needs an answer.
   *
   * Only ever written by `tools:assimp-locate`, which probes the path before it
   * accepts it. Like `nppPathOverride` this names an executable, so it is never
   * taken from the renderer — see the header of `main/services/assimp.ts`.
   */
  assimpPath?: string
  /** Notepad++ install directory, when detection needs a manual answer. */
  nppPathOverride?: string
}

export type SortMode = 'name' | 'name-desc' | 'type' | 'recent' | 'id' | 'source'
export type GroupMode = 'type' | 'source' | 'build' | 'none'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/* =========================================================================
   Workbench (module 04) — authoring contracts
   =========================================================================
   Everything below drives the only part of the suite that writes to mod
   folders. The write allowlist is deliberately narrower than the read one:
   see `writableRoots()` in main/services/guard.ts.
   ========================================================================= */

/** A container directory the Workbench may create new mods inside. */
export interface AuthoringTarget {
  id: string
  kind: ModSourceKind
  /** English fallback text; prefer `labelKey` when set. */
  label: string
  labelKey?: ModSourceLabelKey
  path: string
  exists: boolean
}

/** `media` sub-trees the scaffolder can lay down. */
export type ScaffoldFolder =
  | 'lua-client'
  | 'lua-server'
  | 'lua-shared'
  | 'scripts'
  | 'textures'
  | 'sounds'
  | 'models'
  | 'translate'
  | 'maps'
  | 'ui'

/**
 * Build layout of a generated mod.
 *
 * `b41` puts `media/` at the mod root (Build 41 layout), `b42` puts it inside a
 * `common/` sub-folder, and `both` lays down `common/` plus a `41/` override so
 * one folder serves both builds.
 */
export type ScaffoldLayout = 'b41' | 'b42' | 'both'

export interface ScaffoldOptions {
  /** `AuthoringTarget.id` of the container to create the mod in. */
  targetId: string
  /** Folder name on disk. Sanitised and validated by the main process. */
  folderName: string
  modId: string
  name: string
  author: string
  description: string
  modVersion: string
  pzVersion: string
  url: string
  layout: ScaffoldLayout
  tags: string[]
  requires: string[]
  folders: ScaffoldFolder[]
  /** Write starter lua / script / translation files instead of bare folders. */
  examples: boolean
  /** Generate a placeholder `poster.png`. */
  poster: boolean
}

export interface ScaffoldResult {
  modPath: string
  infoFile: string
  /** Everything created, relative to `modPath`. Directories end with `/`. */
  created: string[]
  bytes: number
}

/** A `mod.info` key with no dedicated field, preserved verbatim on save. */
export interface ModInfoExtra {
  key: string
  value: string
}

/** Editable projection of a `mod.info` file. */
export interface ModInfoDraft {
  /** The file this draft came from. May not exist yet. */
  file: string
  modPath: string
  exists: boolean
  /** False when the file sits outside the Workbench write allowlist. */
  writable: boolean
  /** Verbatim file text, empty when the file does not exist. */
  raw: string
  name: string
  id: string
  description: string
  authors: string
  modVersion: string
  pzVersion: string
  url: string
  poster: string
  icon: string
  requires: string[]
  tags: string[]
  extra: ModInfoExtra[]
}

export interface WriteModInfoRequest {
  file: string
  /** When present this text is written verbatim and `draft` is ignored. */
  raw?: string
  draft?: ModInfoDraft
  /** Keep the previous content as `mod.info.bak`. */
  backup: boolean
}

export interface WriteModInfoResult {
  file: string
  bytes: number
  backupFile?: string
}

export type ValidationSeverity = 'error' | 'warn' | 'info'

/**
 * One validator finding.
 *
 * `rule` is a stable identifier, not display text — the renderer resolves it
 * through the `wbrule.*` dictionary and interpolates `params`.
 */
export interface ValidationIssue {
  rule: string
  severity: ValidationSeverity
  /** Absolute path of the offending file, when the finding is file-scoped. */
  file?: string
  /** 1-based line number. */
  line?: number
  params?: Record<string, string | number>
}

export interface ValidationReport {
  modPath: string
  durationMs: number
  filesChecked: number
  bytesChecked: number
  issues: ValidationIssue[]
  /** A scan limit was hit, so the report is incomplete. */
  truncated: boolean
}

/** Context the renderer already has, passed in so the validator need not rescan. */
export interface ValidateOptions {
  /** Normalised mod ids present on this machine, for `require=` resolution. */
  knownIds?: string[]
  /** The `mod.info` the scanner picked for this mod. */
  infoFile?: string
}

/** `workshop` stages an uploadable project tree; `zip` writes one archive. */
export type PackMode = 'workshop' | 'zip'

/** Which build sub-folders reach the output. */
export type PackBuilds = 'all' | 'b41' | 'b42'

/**
 * Workshop visibility, spelled the way the in-game uploader reads it back.
 *
 * These four tokens are the ones PZ maps onto the Steam API values — `public`
 * 0, `friendsOnly` 1, `private` 2, `unlisted` 3. The uploader matches the
 * string verbatim, so a near-miss like `friends` does not fail loudly: it
 * misses the match and the item is published with the default visibility.
 */
export type PackVisibility = 'public' | 'friendsOnly' | 'private' | 'unlisted'

/** Fields written into `workshop.txt` for the in-game uploader. */
export interface PackWorkshopMeta {
  title: string
  /** Free text. Newlines survive as separate `description=` lines. */
  description: string
  tags: string[]
  visibility: PackVisibility
  /** Existing Workshop item id; blank creates a new item. */
  id: string
}

export interface PackOptions {
  modPath: string
  mode: PackMode
  builds: PackBuilds
  /** Project folder name (`workshop`) or archive base name (`zip`). */
  outputName: string
  /** Output container. Defaults to `<Zomboid>\Workshop`. */
  outputDir?: string
  /** Case-insensitive name patterns to skip. `*` is the only wildcard. */
  exclude: string[]
  workshop?: PackWorkshopMeta
  /** Copy the mod poster to the project root as `preview.png`. */
  preview: boolean
}

export interface PackResult {
  mode: PackMode
  /** Archive file (`zip`) or staged project directory (`workshop`). */
  output: string
  files: number
  /** Total uncompressed bytes of the packed files. */
  bytes: number
  /** Bytes actually written — lower than `bytes` for a compressed archive. */
  writtenBytes: number
  skipped: number
  durationMs: number
}

export interface WorkbenchProgress {
  task: 'validate' | 'pack' | 'batch-pack'
  phase: 'collect' | 'read' | 'write' | 'done'
  done: number
  total: number
  /** Current file name. Data, not prose — the renderer localises `phase`. */
  label: string
  // Present when the event is part of a batch (shove) run, so the renderer can
  // draw a two-level progress bar. The wrapper uses task 'batch-pack'; inner
  // pack/validate phases carry the same fields tagged on by the service.
  itemIndex?: number
  itemCount?: number
  itemLabel?: string
}

/* --------------------------------------------------------------- batch ---- */

/** One mod the shove pipeline will attempt to pack. */
export interface BatchPackItem {
  /** Mod root to pack. */
  modPath: string
  /** Derived display name for reports (folder name). */
  label: string
}

/** How strictly each item is validated before it is packed. */
export type BatchValidationPolicy = 'none' | 'warn' | 'strict'

export interface BatchPackRequest {
  items: BatchPackItem[]
  mode: PackMode
  builds: PackBuilds
  /** Output container; defaults to `<Zomboid>\Workshop`. */
  outputDir?: string
  exclude: string[]
  preview: boolean
  /** Optional shared Workshop metadata template. */
  workshop?: PackWorkshopMeta
  validation: BatchValidationPolicy
  knownIds?: string[]
}

export type BatchItemStatus =
  | 'ok'
  | 'error'
  | 'skip'
  | 'cancel'

export interface BatchPackItemResult {
  modPath: string
  label: string
  status: BatchItemStatus
  /** Present when status === 'ok'. */
  output?: string
  result?: PackResult
  reason?:
    | 'collision'
    | 'validation-error'
    | 'validation-warn'
    | 'pack-failed'
    | 'cancelled'
  /** Stable code or short data; the renderer localises what it can. */
  message?: string
}

export interface BatchPackResult {
  mode: PackMode
  outputDir: string
  startedAt: number
  durationMs: number
  cancelled: boolean
  ok: number
  errors: number
  skipped: number
  items: BatchPackItemResult[]
}

/* =========================================================================
   Loadout (module 02) — load order & profiles
   ========================================================================= */

export type LoadoutKind = 'client' | 'server' | 'save'

/**
 * One mod-list config the Loadout module can read and write.
 *
 * `client` is Build 42's `Zomboid\mods\default.txt` — a `VERSION` line plus
 * `mods { }` and `maps { }` blocks, with `mod = <id>,` syntax.
 * `save` is `Zomboid\Saves\<mode>\<save>\mods.txt` sharing the same format.
 * `server` is a flat `Zomboid\Server\<name>.ini` where the interesting keys are
 * semicolon separated `Mods=` and `WorkshopItems=`.
 */
export interface LoadoutFile {
  /** Stable selector for `loadout.apply`: `client`, `server:<base name>`, or `save:<mode>/<saveName>`. */
  id: string
  kind: LoadoutKind
  path: string
  exists: boolean
  /** Config base name without `.ini`; present for server targets. */
  serverName?: string
  /** Save mode and save folder name; present for save targets. */
  saveMode?: string
  saveName?: string
  /** Mod ids in load order. */
  mods: string[]
  /** Client and save targets: the `maps { }` block, in load order. */
  maps: string[]
  /** Server only: numeric Workshop item ids from `WorkshopItems=`. */
  workshopItems: string[]
}

/** Rule from sorting_rules.txt (MLOS format). */
export interface SortingRule {
  loadAfter: string[]
  loadBefore: string[]
  incompatibleMods: string[]
  loadFirst: 'on' | 'category' | 'off'
  loadLast: 'on' | 'category' | 'off'
  category?: string
}

export type MLOSCategory =
  | 'coreRequirement'
  | 'tweaks'
  | 'resource'
  | 'map'
  | 'vehicle'
  | 'code'
  | 'clothes'
  | 'ui'
  | 'other'
  | 'translation'
  | 'undefined'

export interface OrderIssue {
  type: 'missing' | 'incompatible' | 'rule' | 'cycle'
  modId: string
  targetId?: string
  targetName?: string
  message: string
}

export interface OrderValidationResult {
  valid: boolean
  issues: OrderIssue[]
  cycles: string[][]
  issuesByMod?: Map<string, OrderIssue[]>
}

export interface ModFileOverwrite {
  relPath: string
  /** Mod IDs that provide this file, in active load order */
  providers: string[]
  /** The winning mod ID that actually takes effect */
  winner: string
}

export interface ModOverwritesSummary {
  /** Map of modId -> count of files this mod overwrites from earlier mods */
  overwritesOthers: Record<string, number>
  /** Map of modId -> count of files of this mod that are overwritten by later mods */
  overwrittenByOthers: Record<string, number>
  /** Detailed collision list */
  collisions: ModFileOverwrite[]
}

export interface MapCellInfo {
  mapName: string
  folderName: string
  modId: string
  cells: string[]
  title?: string
  lots?: string
}

export interface MapConflict {
  cell: string
  /** Maps sharing this cell in active order */
  maps: Array<{ mapName: string; modId: string; title?: string }>
  winningMap: string
}

export interface MapScanResult {
  maps: MapCellInfo[]
  conflicts: MapConflict[]
}

export interface MergePatchSelection {
  /** Relative path of the colliding file, e.g. "media/textures/jacket.png" */
  relPath: string
  /** Mod ID chosen as winner for this file, or '__MERGE__' for script merging */
  winnerModId: string
}

export type PatchBuildTarget = 'b42' | 'b41' | 'hybrid'

export interface CreateMergePatchRequest {
  /** Mod ID of the generated patch mod, strictly required to have `_Port` */
  patchModId?: string
  /** Display name of the patch */
  patchName?: string
  /** Target game build layout: 'b42' (strict B42 layout with 42/ & common/), 'b41', or 'hybrid' */
  buildTarget?: PatchBuildTarget
  /** File collision resolution selections */
  selections: MergePatchSelection[]
  /** Automatically append the new patch mod to the end of default.txt */
  addToLoadout?: boolean
}

export interface CreateMergePatchResult {
  modPath: string
  patchModId: string
  filesCopied: number
  scriptsMerged: number
  addedToLoadout: boolean
  errors?: string[]
}

export interface LoadoutApplyOptions {
  /** `LoadoutFile.id` of the config to write. */
  targetId: string
  mods: string[]
  /** Client only; ignored for server targets. */
  maps: string[]
  /** Server only; ignored for the client target. */
  workshopItems: string[]
  /** Keep the previous file as `<name>.bak` before overwriting. */
  backup: boolean
}

export interface LoadoutApplyResult {
  path: string
  bytes: number
  /** Present when a backup copy was requested and there was a file to back up. */
  backupPath?: string
  durationMs: number
}

/**
 * A named snapshot of one config's lists.
 *
 * Profiles live in `settings.json`, never in the game's own files: saving one
 * changes nothing the game reads, and applying one only fills the editor. `kind`
 * records where the snapshot came from, because `maps` is meaningless to a
 * server and `workshopItems` is meaningless to the client.
 */
export interface LoadoutProfile {
  id: string
  name: string
  kind: LoadoutKind
  mods: string[]
  maps: string[]
  workshopItems: string[]
  savedAt: number
}

/* =========================================================================
   Ledger (module 09) — log reader
   ========================================================================= */

/**
 * Where one log came from.
 *
 * `console` is the single live `Zomboid\console.txt` the running game appends to;
 * `log` is one archived file from `Zomboid\Logs`, which the game rotates per
 * launch and names after the moment it was opened.
 */
export type LogKind = 'console' | 'log'

/** One log file the Ledger module may read. */
export interface LogSource {
  /**
   * Opaque selector for `logs.read` — `console` or `log:<file name>`.
   *
   * The renderer never sends a path. Main owns the mapping from id to path, the
   * same contract Loadout uses for its config targets.
   */
  id: string
  kind: LogKind
  /** File name for the UI: `console.txt`, or the archived file's own name. */
  name: string
  /** Absolute path. Display and `shell:*` only — never sent back as a selector. */
  path: string
  exists: boolean
  size: number
  mtime: number
}

/** The tail of one log, as read for display. */
export interface LogReadResult {
  id: string
  path: string
  /** Text of the tail, at most `LOG_TAIL_MAX` bytes worth (or up to 50MB if full read requested). */
  text: string
  /** Full size on disk, which may be far larger than `text`. */
  size: number
  mtime: number
  /** True when the head of the file was skipped and only the tail is shown. */
  truncated: boolean
  /** True if this was read as a full log rather than a tail. */
  isFull?: boolean
}

export interface LogCleanResult {
  deleted: number
  freedBytes: number
}

export interface SourceResolution {
  path: string
  line?: number
}

export interface SourceSnippetLine {
  num: number
  text: string
  isTarget: boolean
}

export interface SourceSnippetResult {
  path: string
  targetLine: number
  startLine: number
  endLine: number
  lines: SourceSnippetLine[]
  lang: 'lua' | 'txt' | 'json' | 'plain'
}

export interface JavaDecompileResult {
  className: string
  fullClassName?: string
  bytecode?: string
  decompiled: string
  methodsCount?: number
  error?: string
}

export interface LogDiffItem {
  id: string
  level: 'error' | 'warn'
  head: string
  callSite?: string
  modName?: string
  count: number
}

export interface LogDiffResult {
  baseId: string
  targetId: string
  newErrors: LogDiffItem[]
  resolvedErrors: LogDiffItem[]
  recurringErrors: LogDiffItem[]
  newErrorsCount: number
  resolvedErrorsCount: number
}

export type LaunchStageId = 'engine' | 'scripts' | 'mods' | 'world' | 'game'

export interface LaunchStage {
  id: LaunchStageId
  label: string
  startLine: number
  endLine: number
  incidentCount: number
  errorCount: number
  warnCount: number
}

/* =========================================================================
   Tools (module 07) — FBX forge & the Notepad++ bridge
   ========================================================================= */

/**
 * How the forge will treat one input.
 *
 * `mesh` is a real geometry conversion: the source is parsed into vertices and
 * polygons and re-emitted as an FBX mesh. `image` builds a unit quad and hangs
 * the picture on it as a material, which is the only meaningful mesh a texture
 * can become. `transcode` re-encodes an FBX that is already an FBX — binary in,
 * ASCII out. `capsule` is the honest fallback for everything else — a named null
 * with the source's metadata as custom properties, optionally carrying the
 * original bytes as embedded media, so the file survives the trip without the
 * forge pretending to have understood it.
 */
export type ForgeKind = 'mesh' | 'image' | 'transcode' | 'capsule'

/**
 * FBX container encoding.
 *
 * `binary` is FBX 7.4 binary and the default: Blender's importer rejects ASCII
 * FBX outright. `ascii` is readable, diffable and what the Autodesk toolchain
 * and Unity accept, so it stays available for inspection.
 */
export type FbxEncoding = 'binary' | 'ascii'

/** Where a converted file lands. */
export type ForgeOutputMode = 'beside' | 'custom'

/**
 * Which reader turns a source file into geometry.
 *
 * `builtin` is this app's own importers and nothing else — no subprocess, the
 * behaviour the forge has always had. `assimp` hands the file to the assimp
 * command-line tool, which reads roughly forty formats and understands the
 * material libraries, texture references and scene graphs a hand-written parser
 * gives up on. `auto` prefers assimp and falls back to the built-in reader when
 * assimp is missing or refuses the file — which is not hypothetical: assimp
 * rejects Project Zomboid's own animated `.x` files, and the built-in parser
 * reads them.
 *
 * The FBX is written by this app either way. assimp is asked for binary FBX and
 * the container is re-encoded here, so encoding, scale and the Z-up correction
 * mean the same thing on both engines.
 */
export type ForgeEngine = 'auto' | 'assimp' | 'builtin'

/** The reader that actually produced a result row. */
export type ForgeEngineUsed = 'builtin' | 'assimp'

/** One file queued for conversion, already classified by main. */
export interface ForgeInput {
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  kind: ForgeKind
  /**
   * Importer that claimed the file (`obj`, `stl`, `x`, `png`, …) or `raw` when
   * nothing did. Display text; the renderer prints it verbatim.
   */
  format: string
  /**
   * False when the extension is known but this build cannot read that flavour of
   * it — binary DirectX `.x`, for one. Such an input converts as a capsule.
   */
  supported: boolean
  /** Stable note code the renderer localises, e.g. `binaryX`. */
  note?: string
}

export interface ConvertOptions {
  /** Inputs to convert. Every path must be user-picked or inside a mod root. */
  inputs: string[]
  outputMode: ForgeOutputMode
  encoding: FbxEncoding
  /** Which reader to use for mesh inputs. */
  engine: ForgeEngine
  /** Uniform scale applied to every vertex. */
  scale: number
  /** Rotate Z-up source data a quarter turn onto FBX's Y-up axis. */
  yUp: boolean
  /** Generate polygon normals when the source carries none. */
  rebuildNormals: boolean
  /** Merge vertices that land on the same point (STL and friends need it). */
  weld: boolean
  /** Embed the original bytes for `image` and `capsule` inputs. */
  embed: boolean
  /** Re-read every file that was written and check its node structure. */
  verify: boolean
  /** Overwrite an existing `.fbx` instead of skipping the input. */
  overwrite: boolean
}

export type ForgeItemStatus = 'ok' | 'error' | 'skip'

export interface ConvertItemResult {
  input: string
  name: string
  status: ForgeItemStatus
  kind?: ForgeKind
  format?: string
  /** Which reader produced this row. Absent for non-mesh routes. */
  engine?: ForgeEngineUsed
  /** True when assimp was tried first, refused the file, and `builtin` took it. */
  fellBack?: boolean
  /** Absolute path of the `.fbx` that was written. */
  output?: string
  bytes?: number
  vertices?: number
  polygons?: number
  materials?: number
  /** True when the written file was re-parsed and matched what was intended. */
  verified?: boolean
  durationMs: number
  /**
   * Stable failure/skip code the renderer localises (`exists`, `empty`,
   * `unreadable`, …). Anything unrecognised is printed verbatim.
   */
  message?: string
}

export interface ConvertResult {
  startedAt: number
  durationMs: number
  cancelled: boolean
  ok: number
  errors: number
  skipped: number
  items: ConvertItemResult[]
}

export interface ConvertProgress {
  phase: 'read' | 'build' | 'write' | 'verify' | 'done'
  index: number
  total: number
  name: string
}

/**
 * What the forge knows about the assimp command-line tool.
 *
 * `installed` means a file was found where assimp is expected. `ready` is the
 * stronger claim: it answered `assimp version`, and it lists `fbx` among the
 * formats it can export. The gap between the two is the interesting state — a
 * stale override, or a build whose `assimp-vc143-mt.dll` is not beside it.
 */
export interface AssimpStatus {
  installed: boolean
  ready: boolean
  /** Absolute path of the executable, when one was found. */
  exePath?: string
  dir?: string
  /**
   * How it was found: the user's own answer, a directory assimp installs into
   * (including one shipped beside this app), or `PATH`.
   */
  source?: 'override' | 'known' | 'path'
  /** Version string from `assimp version`, e.g. `6.0`. */
  version?: string
  /** Extensions it reads, minus the ambiguous ones the forge refuses to assume. */
  importExts: string[]
  /** Format ids from `assimp listexport`. */
  exportFormats: string[]
  /** Stable code the renderer localises: `unusable`, `noFbxExport`. */
  problem?: string
}

/** One file of the Project Zomboid syntax pack for Notepad++. */
export interface NppPackFile {
  /** File name inside `userDefineLangs`. */
  name: string
  /** Absolute destination path. */
  path: string
  /** Human label for the UI (the language name Notepad++ will show). */
  label: string
  installed: boolean
  /** False when an older revision of the pack is on disk. */
  current: boolean
  bytes: number
}

export interface NppStatus {
  installed: boolean
  /** Absolute `notepad++.exe`. */
  exePath?: string
  /** Version string from the executable's folder, when it could be read. */
  version?: string
  /** `%APPDATA%\Notepad++`, or the install dir for a portable copy. */
  configDir?: string
  /** `<configDir>\userDefineLangs`, where the pack is installed. */
  udlDir?: string
  /** True when the exe sits next to its own config (portable layout). */
  portable: boolean
  /** How the exe was found: registry, a known folder, or the user's override. */
  source?: 'registry' | 'known' | 'override'
  /** Revision of the pack this build ships. */
  packVersion: string
  /** Revision found on disk, when any part of the pack is installed. */
  installedVersion?: string
  files: NppPackFile[]
}

export interface NppInstallResult {
  udlDir: string
  written: string[]
  bytes: number
}

/** A pack file rendered for on-screen inspection before it is installed. */
export interface NppPackPreview {
  name: string
  label: string
  text: string
}

/* =========================================================================
   Workshop Overview types (Module 03)
   ========================================================================= */

export type WorkshopViewMode = 'workshop' | 'installed'
export type WorkshopSearchSort = 'trend' | 'popular' | 'recent' | 'updated'

export interface WorkshopSearchQuery {
  mode?: WorkshopViewMode
  search?: string
  sort?: WorkshopSearchSort
  days?: number
  page?: number
  numPerPage?: number
  tags?: string[]
  installedOnly?: boolean
  updatesOnly?: boolean
}

export interface WorkshopItemSummary {
  id: string
  title: string
  previewUrl: string
  posterPath?: string
  author: string
  authorId?: string
  subscriptions: number
  favorited: number
  views: number
  timeCreated: number
  timeUpdated: number
  fileSize: number
  tags: string[]
  isInstalled: boolean
  isSubscribed?: boolean
  localPath?: string
  needsUpdate?: boolean
}

export interface WorkshopItemDetails extends WorkshopItemSummary {
  description: string
  descriptionRu?: string
  screenshots: string[]
  childrenIds: string[]
}

export interface WorkshopSearchResult {
  items: WorkshopItemSummary[]
  total: number
  page: number
  hasMore: boolean
}

export interface WorkshopDownloadResult {
  ok: boolean
  message?: string
  itemId: string
  localPath?: string
}

export interface WorkshopSyncResult {
  installedCount: number
  updatedCount: number
  totalBytes: number
}
