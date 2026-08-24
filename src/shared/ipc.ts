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
  wbProgress: 'wb:progress'
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
