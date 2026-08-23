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
  kind: 'text' | 'image' | 'binary'
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
