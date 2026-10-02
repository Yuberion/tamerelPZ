/** IPC channel names shared by main and preload. */
export const IPC = {
  appInfo: 'app:info',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowState: 'window:state',

  pathsDetect: 'paths:detect',
  pathsPickFolder: 'paths:pick-folder',

  modsScan: 'mods:scan',
  modsProgress: 'mods:progress',
  modsStats: 'mods:stats',

  fsList: 'fs:list',
  fsTree: 'fs:tree',
  fsPreview: 'fs:preview',
  fsMeshPreview: 'fs:mesh-preview',

  explorerGrep: 'explorer:grep',
  explorerVanillaOverwrites: 'explorer:vanilla-overwrites',
  stalkerGrep: 'explorer:grep',
  stalkerVanillaOverwrites: 'explorer:vanilla-overwrites',

  shellReveal: 'shell:reveal',
  shellOpen: 'shell:open',
  shellExternal: 'shell:external',
  shellTerminal: 'shell:terminal',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  /* Workbench — the only channels in the app that write to mod folders. */
  wbTargets: 'wb:targets',
  wbScaffold: 'wb:scaffold',
  wbReadInfo: 'wb:read-info',
  wbWriteInfo: 'wb:write-info',
  wbValidate: 'wb:validate',
  wbPack: 'wb:pack',
  wbShove: 'wb:shove',
  wbShoveCancel: 'wb:shove-cancel',
  wbProgress: 'wb:progress',

  /* Loadout — writes mod lists into the game's own config files. */
  loFiles: 'lo:files',
  loApply: 'lo:apply',
  loRulesGet: 'lo:rules-get',
  loRulesSave: 'lo:rules-save',
  loGamePresetsGet: 'lo:game-presets-get',
  loGamePresetsSave: 'lo:game-presets-save',
  loLuaDeps: 'lo:lua-deps',
  loFileOverwrites: 'lo:file-overwrites',
  loMapCells: 'lo:map-cells',
  loCreateMergePatch: 'lo:create-merge-patch',

  /* Ledger — read-only log reader; main resolves the paths itself. */
  logList: 'log:list',
  logRead: 'log:read',
  logProbe: 'log:probe',
  logClean: 'log:clean',
  logResolveSource: 'log:resolve-source',
  logSnippet: 'log:snippet',
  logDecompile: 'log:decompile',
  logDiff: 'log:diff',

  /* Tools — the FBX forge. Inputs are user-picked; the output dir lives in settings. */
  toolsPick: 'tools:pick',
  toolsPickFolder: 'tools:pick-folder',
  toolsPickOutput: 'tools:pick-output',
  toolsConvert: 'tools:convert',
  toolsCancel: 'tools:convert-cancel',
  toolsProgress: 'tools:progress',
  toolsReveal: 'tools:reveal',
  /* The assimp backend. Like `npp:*`, neither channel accepts an exe path. */
  toolsAssimpStatus: 'tools:assimp-status',
  toolsAssimpLocate: 'tools:assimp-locate',

  /* Tools — the Notepad++ bridge. No channel here accepts an exe path. */
  nppStatus: 'npp:status',
  nppLocate: 'npp:locate',
  nppAutoDetect: 'npp:autodetect',
  nppLaunch: 'npp:launch',
  nppInstall: 'npp:install',
  nppPreview: 'npp:preview',
  nppOpen: 'npp:open',
  nppReveal: 'npp:reveal',

  /* Tools — PZ Optimization */
  pzoptStatus: 'pzopt:status',
  pzoptCheckUpdate: 'pzopt:check-update',
  pzoptDownloadToProgram: 'pzopt:download-to-program',
  pzoptApplyToGame: 'pzopt:apply-to-game',
  pzoptRemoveFromGame: 'pzopt:remove-from-game',
  pzoptReadConfig: 'pzopt:read-config',
  pzoptWriteConfig: 'pzopt:write-config',

  /* Tools — Memory (RAM) Manager */
  memReport: 'mem:report',
  memApply: 'mem:apply',
  memSetEnv: 'mem:set-env',
  memSetReadOnly: 'mem:set-readonly',

  /* Workshop Overview (Module 03) */
  wsQuery: 'ws:query',
  wsDetails: 'ws:details',
  wsSubscribe: 'ws:subscribe',
  wsUnsubscribe: 'ws:unsubscribe',
  wsIsSteamActive: 'ws:is-steam-active',
  wsOpenSteam: 'ws:open-steam',
  wsOpenFolder: 'ws:open-folder',
  wsDownload: 'ws:download',
  wsSync: 'ws:sync',
  wsSyncChanged: 'ws:sync-changed',
  wsInstalledCount: 'ws:installed-count',
  wsTranslate: 'ws:translate',

  /* Cartographer */
  cartographerScan: 'cartographer:scan',
  cartographerGetImage: 'cartographer:get-image',
  cartographerScaffold: 'cartographer:scaffold-map',
  cartographerSaveSpawns: 'cartographer:save-spawns'
} as const

/** Custom protocol used to render local images inside the renderer. */
export const PZ_FILE_SCHEME = 'pzfile'
export const PZ_FILE_PREFIX = `${PZ_FILE_SCHEME}://f/`

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build a `pzfile://` url for an absolute path.
 * The path is base64url encoded so drive letters, spaces and backslashes
 * survive Chromium's url normalisation untouched.
 */
export function pzFileUrl(absolutePath: string): string {
  return PZ_FILE_PREFIX + toBase64Url(absolutePath)
}
