/**
 * Workbench validator: static checks over a mod folder.
 *
 * Strictly read-only. Findings are emitted as stable rule ids plus parameters,
 * never as prose, so the renderer can render them in the active language.
 *
 * The Lua and script checks are hand-written scanners, not real parsers. They
 * are built to have no false *errors*: anything that could legitimately appear
 * in valid content is reported as a warning at most. A validator that cries
 * wolf gets switched off.
 */
import { promises as fs } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type {
  IssueCategory,
  IssueSnippetLine,
  ModHealthScore,
  ValidateOptions,
  ValidationCategoriesCount,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
  WorkbenchProgress
} from '../../shared/types'
import { checkVanillaOverwrites } from './explorer'
import { extOf, pLimit, readdirSafe, readTextSafe, stripBom } from './fsx'
import { first, parseModInfo } from './modinfo'

const MAX_FILES = 4000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_DEPTH = 24
/** Per-rule cap per file, so one broken file cannot flood the report. */
const MAX_PER_RULE = 4

/** Official whitelist of 262 engine events in LuaEventManager for Build 42 */
const B42_LUA_EVENTS = new Set<string>([
  'AcceptedFactionInvite', 'AcceptedMedicalCheck', 'AcceptedSafehouseInvite', 'AcceptedTrade', 'AddXP',
  'DoSpecialTooltip', 'EveryDays', 'EveryHours', 'EveryOneMinute', 'EveryTenMinutes', 'LevelPerk',
  'LoadChunk', 'LoadGridsquare', 'LogLevelPerk', 'MngInvReceiveItems', 'OnAcceptInvite', 'OnAddBuilding',
  'onAddForageDefs', 'OnAddMessage', 'OnAdminMessage', 'OnAIStateChange', 'OnAIStateEnter', 'OnAIStateExecute',
  'OnAIStateExit', 'OnAlertMessage', 'OnAmbientSound', 'OnAnimalTracks', 'OnBeingHitByZombie', 'OnCGlobalObjectSystemInit',
  'OnChallengeQuery', 'OnChangeWeather', 'OnCharacterCollide', 'OnCharacterCreateStats', 'OnCharacterDeath',
  'OnCharacterMeet', 'OnChatWindowInit', 'OnClickedAnimalForContext', 'OnClientCommand', 'OnClimateManagerInit',
  'OnClimateTick', 'OnClimateTickDebug', 'OnClothingUpdated', 'OnConnected', 'OnConnectFailed', 'OnConnectionStateChanged',
  'OnContainerUpdate', 'OnContextKey', 'OnCoopJoinFailed', 'OnCoopServerMessage', 'OnCreateLivingCharacter',
  'OnCreatePlayer', 'OnCreateSurvivor', 'OnCreateUI', 'OnCustomUIKey', 'OnCustomUIKeyPressed', 'OnCustomUIKeyReleased',
  'OnDawn', 'OnDeadBodySpawn', 'OnDestroyIsoThumpable', 'OnDeviceText', 'OnDisconnect', 'OnDistributionMerge',
  'OnDoTileBuilding', 'OnDoTileBuilding2', 'OnDoTileBuilding3', 'OnDusk', 'OnDynamicMovableRecipe', 'OnEnterVehicle',
  'OnEquipPrimary', 'OnEquipSecondary', 'OnFETick', 'OnFillContainer', 'OnFillInventoryObjectContextMenu',
  'onFillSearchIconContextMenu', 'OnFillWorldObjectContextMenu', 'OnFishingActionMPUpdate', 'OnGameBoot',
  'OnGamepadConnect', 'OnGamepadDisconnect', 'OnGameStart', 'OnGameStateEnter', 'OnGameTimeLoaded', 'OnGoogleAuthRequest',
  'OnGridBurnt', 'OnHitZombie', 'OnInitGlobalModData', 'OnInitModdedWeatherStage', 'OnInitRecordedMedia',
  'OnInitSeasons', 'OnInitWorld', 'OnIsoThumpableLoad', 'OnIsoThumpableSave', 'onItemFall', 'OnItemFound',
  'OnJoypadActivate', 'OnJoypadActivateUI', 'OnJoypadBeforeDeactivate', 'OnJoypadBeforeReactivate', 'OnJoypadDeactivate',
  'OnJoypadDebugRenderUIOptionSet', 'OnJoypadReactivate', 'OnJoypadRenderUI', 'OnKeyKeepPressed', 'OnKeyPressed',
  'OnKeyStartPressed', 'OnLoad', 'OnLoadedMapZones', 'OnLoadedTileDefinitions', 'OnLoadMapZones', 'onLoadModDataFromServer',
  'OnLoadRadioScripts', 'OnLoadSoundBanks', 'OnLoginState', 'OnLoginStateSuccess', 'OnMainMenuEnter', 'OnMakeItem',
  'OnMapLoadCreateIsoObject', 'OnMechanicActionDone', 'OnMiniScoreboardUpdate', 'OnModsModified', 'OnMouseDown',
  'OnMouseMove', 'OnMouseUp', 'OnMouseWheel', 'OnMovingObjectCrop', 'OnMultiTriggerNPCEvent', 'OnNetworkUsersReceived',
  'OnNewFire', 'OnNewGame', 'OnNewSurvivorGroup', 'OnNPCSurvivorUpdate', 'OnObjectAboutToBeRemoved', 'OnObjectAdded',
  'OnObjectCollide', 'OnObjectLeftMouseButtonDown', 'OnObjectLeftMouseButtonUp', 'OnObjectRightMouseButtonDown',
  'OnObjectRightMouseButtonUp', 'OnOverrideSearchManager', 'OnPlayerAttackFinished', 'OnPlayerDeath', 'OnPlayerGetDamage',
  'OnPlayerMove', 'OnPlayerSetSafehouse', 'OnPlayerUpdate', 'OnPostCharactersSquareDraw', 'OnPostDistributionMerge',
  'OnPostFloorLayerDraw', 'OnPostFloorSquareDraw', 'OnPostMapLoad', 'OnPostRender', 'OnPostSave', 'OnPostTileDraw',
  'OnPostTilesSquareDraw', 'OnPostUIDraw', 'OnPostWallSquareDraw', 'OnPreDistributionMerge', 'OnPreFillInventoryObjectContextMenu',
  'OnPreFillWorldObjectContextMenu', 'OnPreGameStart', 'OnPreMapLoad', 'OnPressRackButton', 'OnPressReloadButton',
  'OnPressWalkTo', 'OnPreUIDraw', 'OnProcessAction', 'OnProcessTransaction', 'OnQRReceived', 'OnRadioInteraction',
  'OnRainStart', 'OnRainStop', 'OnReceiveGlobalModData', 'OnReceiveItemListNet', 'OnReceiveUserlog',
  'OnRefreshInventoryWindowContainers', 'OnRenderTick', 'OnRenderUpdate', 'OnResetLua', 'OnResolutionChange',
  'OnRightMouseDown', 'OnRightMouseUp', 'OnRolesReceived', 'OnSafehousesChanged', 'OnSave', 'OnScoreboardUpdate',
  'OnSeeNewRoom', 'OnServerCommand', 'OnServerCustomizationDataReceived', 'OnServerFinishSaving', 'OnServerStarted',
  'OnServerStartSaving', 'OnServerStatisticReceived', 'OnServerWorkshopItems', 'OnSetDefaultTab', 'OnSGlobalObjectSystemInit',
  'OnSleepingTick', 'OnSourceWindowFileReload', 'OnSpawnRegionsLoaded', 'OnSpawnVehicleEnd', 'OnSpawnVehicleStart',
  'OnSteamGameJoin', 'OnSteamRefreshInternetServers', 'OnSteamRulesRefreshComplete', 'OnSteamServerFailedToRespond2',
  'OnSteamServerResponded', 'OnSteamServerResponded2', 'OnTabAdded', 'OnTabRemoved', 'OnTemplateTextInit',
  'OnThrowableExplode', 'OnThunderEvent', 'OnTick', 'OnTickEvenPaused', 'OnTileObjectAdded', 'OnTileRemoved',
  'OnTriggerNPCEvent', 'onUpdateIcon', 'OnUpdateModdedWeatherStage', 'OnVehicleDamageTexture', 'OnWarUpdate',
  'OnWaterAmountChange', 'OnWeaponHitCharacter', 'OnWeaponHitThumpable', 'OnWeaponHitTree', 'OnWeaponHitXp',
  'OnWeaponSwing', 'OnWeaponSwingHitPoint', 'OnWeatherPeriodComplete', 'OnWeatherPeriodStage', 'OnWeatherPeriodStart',
  'OnWeatherPeriodStop', 'OnWorldMessage', 'OnWorldSound', 'OnZombieCreate', 'OnZombieDead', 'OnZombieUpdate',
  'OptionControllerButtonStyleChanged', 'OptionGamepadBindingPresetChanged', 'preAddCatDefs', 'preAddForageDefs',
  'preAddItemDefs', 'preAddSkillDefs', 'preAddZoneDefs', 'ReceiveFactionInvite', 'ReceiveSafehouseInvite',
  'RefreshCheats', 'RenderOpaqueObjectsInWorld', 'RequestMedicalCheck', 'RequestTrade', 'ReuseGridsquare',
  'SendCustomModData', 'ServerPinged', 'SetDragItem', 'SwitchChatStream', 'SyncFaction', 'SyncFactionServer',
  'TradingUIAddItem', 'TradingUIRemoveItem', 'TradingUIUpdateState', 'ViewBannedIPs', 'ViewBannedSteamIDs', 'ViewTickets'
])

/** Canonical weapon swing animation keys supported by the Project Zomboid engine */
const VALID_SWING_ANIMS = new Set([
  'bat', 'heavyweapon', 'stab', 'spear', 'handgun', 'rifle', 'shotgun',
  'throw', 'chop', 'upper', 'under', 'punch', 'shove', 'attack_shove'
])

/** Standard types in Kahlua/Java runtime accessible without game engine package prefix */
const STANDARD_JAVA_AND_LUA_TYPES = new Set([
  'string', 'number', 'boolean', 'table', 'function', 'thread', 'userdata', 'nil',
  'Object', 'String', 'Double', 'Float', 'Integer', 'Long', 'Short', 'Byte', 'Character',
  'Boolean', 'Number', 'ArrayList', 'HashMap', 'List', 'Map', 'Set', 'Vector'
])

type Progress = (p: WorkbenchProgress) => void

interface Collected {
  /** Absolute paths of `.lua` files. */
  lua: string[]
  /** Absolute paths of `media/scripts/**` text files. */
  scripts: string[]
  /** Absolute paths of `Translate/<LANG>/*.txt` or `.json` files. */
  translate: string[]
  /** Absolute paths of `media/sandbox-options.txt` files. */
  sandbox: string[]
  /** Absolute paths of `.xml` files (e.g. clothing items, mannequins). */
  xml: string[]
  /** Lowercased file names found under any `media/textures`. */
  textures: Set<string>
  /** Lowercased 3D model names found under `media/models*`. */
  models: Set<string>
  /** Directories that exist but hold nothing, relative to the mod root. */
  emptyDirs: string[]
  /** `media` folders whose casing is wrong for a Linux server. */
  miscasedMedia: string[]
  /** Files whose names contain characters outside printable ASCII. */
  nonAscii: string[]
  hasMedia: boolean
  truncated: boolean
}

/** Directory names that are never part of a shipped mod. */
const SKIP_DIRS = new Set(['.git', '.svn', '.hg', '.vs', '.vscode', '.idea', 'node_modules'])

/* ---------------------------------------------------- Java API Engine Catalog -- */

interface JavaApiCatalog {
  fullClasses: Set<string>
  simpleClasses: Set<string>
  packages: Set<string>
  jarPath?: string
  mtime?: number
}

let cachedJavaApi: JavaApiCatalog | null = null

/**
 * Autonomous zero-dependency reader for projectzomboid.jar Central Directory.
 * Reads the ZIP central directory table at the end of the JAR in ~15ms,
 * extracting all 5,000+ official Java classes of the installed game engine.
 */
async function loadGameJarClasses(gameDir?: string): Promise<JavaApiCatalog> {
  const defaultJar = 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\projectzomboid.jar'
  const jarPath = gameDir ? join(gameDir, 'projectzomboid.jar') : defaultJar

  try {
    const st = await fs.stat(jarPath)
    if (cachedJavaApi && cachedJavaApi.jarPath === jarPath && cachedJavaApi.mtime === st.mtimeMs) {
      return cachedJavaApi
    }

    const fh = await fs.open(jarPath, 'r')
    const size = st.size
    const readLen = Math.min(size, 65536)
    const eocdBuf = Buffer.alloc(readLen)
    await fh.read(eocdBuf, 0, readLen, size - readLen)

    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
    const idx = eocdBuf.lastIndexOf(eocdSig)
    if (idx === -1) {
      await fh.close()
      return { fullClasses: new Set(), simpleClasses: new Set(), packages: new Set() }
    }

    const cdSize = eocdBuf.readUInt32LE(idx + 12)
    const cdOffset = eocdBuf.readUInt32LE(idx + 16)
    const cdBuf = Buffer.alloc(cdSize)
    await fh.read(cdBuf, 0, cdSize, cdOffset)
    await fh.close()

    const fullClasses = new Set<string>()
    const simpleClasses = new Set<string>()
    const packages = new Set<string>()

    let p = 0
    while (p < cdBuf.length) {
      if (cdBuf.readUInt32LE(p) !== 0x02014b50) break
      const fnLen = cdBuf.readUInt16LE(p + 28)
      const extraLen = cdBuf.readUInt16LE(p + 30)
      const commentLen = cdBuf.readUInt16LE(p + 32)
      const fn = cdBuf.toString('utf8', p + 46, p + 46 + fnLen)
      if (fn.endsWith('.class')) {
        const noExt = fn.slice(0, -6)
        const dotName = noExt.replace(/\//g, '.')
        fullClasses.add(dotName)

        const parts = dotName.split('.')
        const className = parts[parts.length - 1] ?? ''
        if (className.includes('$')) {
          for (const sub of className.split('$')) {
            if (sub) simpleClasses.add(sub)
          }
        }
        simpleClasses.add(className)

        let pkg = ''
        for (let k = 0; k < parts.length - 1; k++) {
          pkg = pkg ? `${pkg}.${parts[k]}` : parts[k]!
          packages.add(pkg)
        }
      }
      p += 46 + fnLen + extraLen + commentLen
    }

    cachedJavaApi = {
      fullClasses,
      simpleClasses,
      packages,
      jarPath,
      mtime: st.mtimeMs
    }
    return cachedJavaApi
  } catch {
    return { fullClasses: new Set(), simpleClasses: new Set(), packages: new Set() }
  }
}

let cachedVanillaModels: Set<string> | null = null
let cachedVanillaTextures: Set<string> | null = null

/**
 * Indexes official vanilla 3D models from game installation.
 */
async function getVanillaModels(gameDir?: string): Promise<Set<string>> {
  if (cachedVanillaModels) return cachedVanillaModels
  const out = new Set<string>()
  const roots = [
    gameDir ? join(gameDir, 'media', 'models_x') : 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\media\\models_x',
    gameDir ? join(gameDir, 'media', 'models') : 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\media\\models'
  ]
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
      for (const ent of entries) {
        if (ent.isFile()) {
          const lower = ent.name.toLowerCase()
          out.add(lower)
          const base = lower.replace(/\.[^/.]+$/, '')
          out.add(base)
        }
      }
    } catch {
      // Ignore if dir missing
    }
  }
  cachedVanillaModels = out
  return out
}

/**
 * Indexes official vanilla textures from game installation.
 */
async function getVanillaTextures(gameDir?: string): Promise<Set<string>> {
  if (cachedVanillaTextures) return cachedVanillaTextures
  const out = new Set<string>()
  const roots = [
    gameDir ? join(gameDir, 'media', 'textures') : 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\media\\textures',
    gameDir ? join(gameDir, 'media', 'ui') : 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\media\\ui'
  ]
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
      for (const ent of entries) {
        if (ent.isFile()) {
          const lower = ent.name.toLowerCase()
          out.add(lower)
          const base = lower.replace(/\.[^/.]+$/, '')
          out.add(base)
        }
      }
    } catch {
      // Ignore if dir missing
    }
  }
  cachedVanillaTextures = out
  return out
}

export interface ModAssetIndex {
  models: Set<string>
  textures: Set<string>
}

const modAssetCache = new Map<string, ModAssetIndex>()

export async function indexModAssets(modPath: string): Promise<ModAssetIndex> {
  const hit = modAssetCache.get(modPath)
  if (hit) return hit

  const models = new Set<string>()
  const textures = new Set<string>()

  // Inspect 3D models and clothing item XMLs
  for (const sub of ['media/models_x', 'media/models', 'media/clothing/clothingItems']) {
    const dir = join(modPath, sub)
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
      for (const ent of entries) {
        if (ent.isFile()) {
          const lower = ent.name.toLowerCase()
          models.add(lower)
          const base = lower.replace(/\.[^/.]+$/, '')
          models.add(base)
        }
      }
    } catch {
      // Ignore missing dir
    }
  }

  // Inspect textures
  const texDir = join(modPath, 'media', 'textures')
  try {
    const entries = await fs.readdir(texDir, { recursive: true, withFileTypes: true })
    for (const ent of entries) {
      if (ent.isFile()) {
        const lower = ent.name.toLowerCase()
        textures.add(lower)
        const base = lower.replace(/\.[^/.]+$/, '')
        textures.add(base)
      }
    }
  } catch {
    // Ignore missing dir
  }

  const res: ModAssetIndex = { models, textures }
  modAssetCache.set(modPath, res)
  return res
}

function isKnownModelSync(
  raw: string,
  modModels: Set<string>,
  vanillaModels: Set<string>,
  depModels: Set<string>
): boolean {
  const clean = raw.trim().replace(/\\/g, '/').toLowerCase()
  const base = clean.split('/').pop() ?? clean
  const noExt = base.replace(/\.[^/.]+$/, '')

  return (
    modModels.has(clean) ||
    modModels.has(base) ||
    modModels.has(noExt) ||
    vanillaModels.has(clean) ||
    vanillaModels.has(base) ||
    vanillaModels.has(noExt) ||
    depModels.has(clean) ||
    depModels.has(base) ||
    depModels.has(noExt)
  )
}

function isKnownTextureSync(
  raw: string,
  modTextures: Set<string>,
  vanillaTextures: Set<string>,
  depTextures: Set<string>
): boolean {
  const clean = raw.trim().replace(/\\/g, '/').toLowerCase()
  const base = clean.split('/').pop() ?? clean
  const noExt = base.replace(/\.[^/.]+$/, '')

  return (
    modTextures.has(clean) ||
    modTextures.has(base) ||
    modTextures.has(noExt) ||
    modTextures.has(`${base}.png`) ||
    vanillaTextures.has(clean) ||
    vanillaTextures.has(base) ||
    vanillaTextures.has(noExt) ||
    vanillaTextures.has(`${base}.png`) ||
    depTextures.has(clean) ||
    depTextures.has(base) ||
    depTextures.has(noExt) ||
    depTextures.has(`${base}.png`)
  )
}

interface InstalledModMeta {
  modId?: string
  rawModId?: string
  name: string
  path: string
  folderName?: string
}

async function findProviderModForModel(
  rawModel: string,
  otherMods: InstalledModMeta[]
): Promise<{ name: string; requiredId: string } | null> {
  const clean = rawModel.trim().replace(/\\/g, '/').toLowerCase()
  const base = clean.split('/').pop() ?? clean
  const noExt = base.replace(/\.[^/.]+$/, '')

  for (const m of otherMods) {
    const idx = await indexModAssets(m.path)
    if (idx.models.has(clean) || idx.models.has(base) || idx.models.has(noExt)) {
      return {
        name: m.name,
        requiredId: m.modId ?? m.folderName ?? basename(m.path)
      }
    }
  }
  return null
}

async function findProviderModForTexture(
  rawTex: string,
  otherMods: InstalledModMeta[]
): Promise<{ name: string; requiredId: string } | null> {
  const clean = rawTex.trim().replace(/\\/g, '/').toLowerCase()
  const base = clean.split('/').pop() ?? clean
  const noExt = base.replace(/\.[^/.]+$/, '')

  for (const m of otherMods) {
    const idx = await indexModAssets(m.path)
    if (
      idx.textures.has(clean) ||
      idx.textures.has(base) ||
      idx.textures.has(noExt) ||
      idx.textures.has(`${base}.png`)
    ) {
      return {
        name: m.name,
        requiredId: m.modId ?? m.folderName ?? basename(m.path)
      }
    }
  }
  return null
}

function makeSnippet(
  text: string,
  targetLine?: number,
  context = 2,
  lang = 'text'
): { lines: IssueSnippetLine[]; lang: string } | undefined {
  if (!targetLine || targetLine <= 0) return undefined
  const allLines = text.split(/\r?\n/)
  const start = Math.max(0, targetLine - 1 - context)
  const end = Math.min(allLines.length, targetLine + context)
  const lines: IssueSnippetLine[] = []
  for (let idx = start; idx < end; idx++) {
    lines.push({
      num: idx + 1,
      text: allLines[idx] ?? '',
      isTarget: idx + 1 === targetLine
    })
  }
  return { lines, lang }
}

/* ---------------------------------------------------------------- collect -- */

async function collect(root: string): Promise<Collected> {
  const out: Collected = {
    lua: [],
    scripts: [],
    translate: [],
    sandbox: [],
    xml: [],
    textures: new Set(),
    models: new Set(),
    emptyDirs: [],
    miscasedMedia: [],
    nonAscii: [],
    hasMedia: false,
    truncated: false
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let seen = 0

  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    const entries = await readdirSafe(current.dir)
    const rel = relative(root, current.dir)
    const relPosix = rel ? rel.split(sep).join('/') : ''

    if (entries.length === 0 && rel) out.emptyDirs.push(relPosix)

    const leaf = relPosix ? (relPosix.split('/').pop() ?? '') : ''
    if (leaf.toLowerCase() === 'media' && leaf !== 'media') out.miscasedMedia.push(relPosix)

    const inTextures = /(^|\/)media\/textures(\/|$)/i.test(relPosix)
    const inModels = /(^|\/)media\/models(_x)?(\/|$)/i.test(relPosix)
    const inScripts = /(^|\/)media\/scripts(\/|$)/i.test(relPosix)
    const translateMatch = /(^|\/)Translate\/([^/]+)$/i.exec(relPosix)

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(current.dir, entry.name)

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.toLowerCase() === 'media') out.hasMedia = true
        if (current.depth < MAX_DEPTH) stack.push({ dir: abs, depth: current.depth + 1 })
        continue
      }

      seen++
      if (seen > MAX_FILES * 4) {
        out.truncated = true
        return out
      }

      if (/[^\x20-\x7e]/.test(entry.name)) out.nonAscii.push(relative(root, abs))

      const ext = extOf(entry.name)
      if (inTextures) out.textures.add(entry.name.toLowerCase())
      if (inModels) {
        if (ext === 'x' || ext === 'fbx' || ext === 'txt' || ext === 'obj') {
          out.models.add(entry.name.toLowerCase())
          out.models.add(entry.name.toLowerCase().replace(/\.[^/.]+$/, ''))
        }
      }
      if (entry.name.toLowerCase() === 'sandbox-options.txt') out.sandbox.push(abs)
      if (ext === 'lua') out.lua.push(abs)
      else if (ext === 'txt' && inScripts) out.scripts.push(abs)
      else if (ext === 'xml') out.xml.push(abs)
      if (translateMatch && (ext === 'txt' || ext === 'json')) out.translate.push(abs)
    }
  }

  out.lua.sort()
  out.scripts.sort()
  out.translate.sort()
  out.sandbox.sort()
  out.xml.sort()
  return out
}

/* --------------------------------------------------------------- mod.info -- */

const KNOWN_INFO_KEYS = new Set([
  'name', 'id', 'description', 'author', 'authors', 'modversion', 'version',
  'pzversion', 'versionmin', 'versionmax', 'url', 'poster', 'icon', 'require',
  'requires', 'tags', 'category', 'pack', 'tiledef', 'mappath', 'mapfolder',
  'excludetranslations'
])

const SINGLE_INFO_KEYS = ['name', 'id'] as const

async function checkModInfo(
  root: string,
  infoFile: string | undefined,
  knownIds: Set<string>,
  add: (issue: ValidationIssue) => void,
  gameVersion?: string
): Promise<Set<string>> {
  const declaredRequires = new Set<string>()
  if (!infoFile) {
    add({ rule: 'modinfo.missing', severity: 'error', category: 'critical' })
    return declaredRequires
  }

  const raw = (await readTextSafe(infoFile, 64 * 1024)) ?? ''
  const fields = parseModInfo(raw)
  const lines = raw.split(/\r?\n/)

  const keyLines = new Map<string, Array<{ line: number; rawVal: string }>>()
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('--')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim().toLowerCase()
      const rawVal = trimmed.slice(eq + 1).trim()
      const list = keyLines.get(key) ?? []
      list.push({ line: idx + 1, rawVal })
      keyLines.set(key, list)
    }
  }

  const emit = (
    rule: string,
    severity: ValidationSeverity,
    line: number,
    params?: Record<string, string | number>,
    category: IssueCategory = 'hygiene'
  ): void => {
    const snippet = makeSnippet(raw, line, 2, 'ini')
    add(params ? { rule, severity, category, file: infoFile, line, params, snippet } : { rule, severity, category, file: infoFile, line, snippet })
  }

  if (raw.charCodeAt(0) === 0xfeff) {
    emit('modinfo.bom', 'warn', 1, undefined, 'hygiene')
  }

  const name = first(fields, 'name')
  const id = first(fields, 'id')
  if (!name) emit('modinfo.no-name', 'error', 1, undefined, 'critical')
  if (!id) emit('modinfo.no-id', 'error', 1, undefined, 'critical')

  const idLine = keyLines.get('id')?.[0]?.line ?? 1

  if (id) {
    const bare = /^\d+\/(.+)$/.exec(id.trim())?.[1]?.trim() ?? id.trim()
    const folder = root.split(sep).filter(Boolean).pop() ?? ''
    if (folder && bare.toLowerCase() !== folder.toLowerCase()) {
      emit('modinfo.id-folder-mismatch', 'info', idLine, { id: bare, folder }, 'hygiene')
    }
    const reqEntries = [...(keyLines.get('require') ?? []), ...(keyLines.get('requires') ?? [])]
    for (const reqEntry of reqEntries) {
      if (reqEntry.rawVal.split(/[,;]/).some((r) => r.trim() === bare)) {
        emit('modinfo.self-require', 'warn', reqEntry.line, { id: bare }, 'overwrites')
      }
    }
  }

  for (const key of SINGLE_INFO_KEYS) {
    const occurrences = keyLines.get(key) ?? []
    if (occurrences.length > 1) {
      emit('modinfo.duplicate-key', 'warn', occurrences[1]!.line, { key, n: occurrences.length }, 'hygiene')
    }
  }

  for (const [key, entries] of keyLines) {
    if (!KNOWN_INFO_KEYS.has(key)) {
      emit('modinfo.unknown-key', 'info', entries[0]!.line, { key }, 'hygiene')
    }
  }

  if (!first(fields, 'description')) {
    emit('modinfo.no-description', 'info', 1, undefined, 'hygiene')
  }
  if (!first(fields, 'pzversion', 'versionmin')) {
    emit('modinfo.no-pzversion', 'info', 1, undefined, 'hygiene')
  }

  const versionMaxEntry = keyLines.get('versionmax')?.[0]
  if (versionMaxEntry) {
    const isB42Game = gameVersion ? gameVersion.startsWith('42') : true
    if (isB42Game) {
      emit('modinfo.b42-versionmax', 'error', versionMaxEntry.line, { max: versionMaxEntry.rawVal }, 'critical')
    }
  }

  // Compatibility comparison against the installed game engine version
  if (gameVersion) {
    const minEntry = keyLines.get('versionmin')?.[0] ?? keyLines.get('pzversion')?.[0]
    if (minEntry) {
      const minVal = parseFloat(minEntry.rawVal)
      const gameVal = parseFloat(gameVersion)
      if (!isNaN(minVal) && !isNaN(gameVal) && minVal > gameVal) {
        emit('modinfo.game-version-mismatch', 'error', minEntry.line, { required: minEntry.rawVal, installed: gameVersion }, 'critical')
      }
    }
    if (versionMaxEntry) {
      const maxVal = parseFloat(versionMaxEntry.rawVal)
      const gameVal = parseFloat(gameVersion)
      if (!isNaN(maxVal) && !isNaN(gameVal) && maxVal < gameVal) {
        emit('modinfo.game-version-outdated', 'warn', versionMaxEntry.line, { max: versionMaxEntry.rawVal, installed: gameVersion }, 'critical')
      }
    }
  }

  // Tiledef check: ensure mod tiledefs use custom id >= 100
  const tiledefEntries = keyLines.get('tiledef') ?? []
  for (const tdEntry of tiledefEntries) {
    const parts = tdEntry.rawVal.split(/\s+/)
    if (parts.length >= 2) {
      const tileId = parseInt(parts[1] ?? '', 10)
      if (!isNaN(tileId) && tileId < 100) {
        emit('conflict.tiledef-reserved', 'warn', tdEntry.line, { id: tileId, name: parts[0] ?? '' }, 'overwrites')
      }
    }
  }

  const infoDir = join(infoFile, '..')
  const posterEntries = keyLines.get('poster') ?? []
  if (posterEntries.length === 0) {
    emit('modinfo.no-poster', 'info', 1, undefined, 'hygiene')
  } else {
    for (const pEntry of posterEntries) {
      const poster = pEntry.rawVal.trim()
      if (!poster) continue
      if (await fileExists(join(infoDir, poster))) continue
      if (await fileExists(join(root, poster))) continue
      emit('modinfo.poster-missing', 'error', pEntry.line, { file: poster }, 'assets')
    }
  }

  const iconEntry = keyLines.get('icon')?.[0]
  if (iconEntry) {
    const icon = iconEntry.rawVal.trim()
    if (icon && !(await fileExists(join(infoDir, icon))) && !(await fileExists(join(root, icon)))) {
      emit('modinfo.icon-missing', 'warn', iconEntry.line, { file: icon }, 'assets')
    }
  }

  const reqEntries = [...(keyLines.get('require') ?? []), ...(keyLines.get('requires') ?? [])]
  for (const rEntry of reqEntries) {
    for (const req of rEntry.rawVal.split(/[,;]/)) {
      const trimmed = req.trim()
      if (!trimmed) continue
      const bare = /^\d+\/(.+)$/.exec(trimmed)?.[1]?.trim() ?? trimmed
      const lowerBare = bare.toLowerCase()
      declaredRequires.add(lowerBare)
      if (!knownIds.has(lowerBare)) {
        emit('modinfo.require-missing', 'warn', rEntry.line, { id: bare }, 'overwrites')
      }
    }
  }

  return declaredRequires
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function buildScope(file: string, modPath: string): string {
  const rel = relative(modPath, file).split(sep)
  const head = rel[0] ?? ''
  return /^(?:common|4[0-9](?:\.\d+)*)$/i.test(head) ? head.toLowerCase() : ''
}

/* -------------------------------------------------------------------- lua -- */

type LuaBlock = 'function' | 'if' | 'do' | 'repeat'

function isKnownZombieRef(ref: string, javaApi: JavaApiCatalog): boolean {
  if (javaApi.fullClasses.has(ref) || javaApi.packages.has(ref)) return true
  const parts = ref.split('.')
  while (parts.length > 1) {
    parts.pop()
    const candidate = parts.join('.')
    if (javaApi.fullClasses.has(candidate)) return true
  }
  return false
}

function checkLua(
  text: string,
  file: string,
  add: (issue: ValidationIssue) => void,
  javaApi: JavaApiCatalog
): void {
  if (!text.trim()) {
    add({ rule: 'lua.empty', severity: 'info', category: 'hygiene', file })
    return
  }

  const brackets: Record<string, { open: number; line: number }> = {
    '()': { open: 0, line: 0 },
    '[]': { open: 0, line: 0 },
    '{}': { open: 0, line: 0 }
  }
  const pairOf: Record<string, string> = {
    '(': '()', ')': '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}'
  }
  const stack: Array<{ kind: LuaBlock; line: number }> = []
  const reported = new Map<string, number>()

  const emit = (
    rule: string,
    severity: ValidationSeverity,
    line: number,
    params?: Record<string, string | number>,
    category: IssueCategory = 'critical'
  ): void => {
    const seen = reported.get(rule) ?? 0
    if (seen >= MAX_PER_RULE) return
    reported.set(rule, seen + 1)
    const snippet = makeSnippet(text, line, 2, 'lua')
    add(params ? { rule, severity, category, file, line, params, snippet } : { rule, severity, category, file, line, snippet })
  }

  if (text.charCodeAt(0) === 0xfeff) {
    emit('hygiene.bom', 'error', 1, undefined, 'hygiene')
  }

  if (!/(?:^|[\\/])Translate[\\/]/i.test(file) && /[^\x00-\x7F]/.test(text)) {
    const lines = text.split(/\r?\n/)
    for (let l = 0; l < lines.length; l++) {
      if (/[^\x00-\x7F]/.test(lines[l]!)) {
        emit('hygiene.non-ascii-code', 'warn', l + 1, undefined, 'hygiene')
        break
      }
    }
  }

  // 1. LuaEventManager 262 Canonical Events Whitelist
  const eventRegex = /Events\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*['"]([A-Za-z0-9_]+)['"]\s*\])\s*(?:\.Add|:Add|:addListener)\b/g
  let match: RegExpExecArray | null
  while ((match = eventRegex.exec(text)) !== null) {
    const eventName = match[1] || match[2]
    if (eventName && !B42_LUA_EVENTS.has(eventName)) {
      const lineNum = text.slice(0, match.index).split('\n').length
      emit('lua.unknown-event', 'warn', lineNum, { event: eventName }, 'engine-api')
    }
  }

  // 2. Installed Java Engine API Checks (projectzomboid.jar)
  if (javaApi.fullClasses.size > 0) {
    // Check instanceof(obj, "ClassName")
    const ioRegex = /\binstanceof\s*\(\s*[^,)]+,\s*["']([^"']+)["']\s*\)/g
    let ioMatch: RegExpExecArray | null
    while ((ioMatch = ioRegex.exec(text)) !== null) {
      const cls = ioMatch[1]
      if (cls && !STANDARD_JAVA_AND_LUA_TYPES.has(cls)) {
        if (!javaApi.simpleClasses.has(cls) && !javaApi.fullClasses.has(cls)) {
          const lineNum = text.slice(0, ioMatch.index).split('\n').length
          emit('lua.unknown-engine-class', 'warn', lineNum, { className: cls }, 'engine-api')
        }
      }
    }

    // Check direct zombie package access
    const zombieRegex = /\b(zombie(?:\.[A-Za-z0-9_$]+)+)\b/g
    let zMatch: RegExpExecArray | null
    while ((zMatch = zombieRegex.exec(text)) !== null) {
      const fullRef = zMatch[1]!
      if (!isKnownZombieRef(fullRef, javaApi)) {
        const lineNum = text.slice(0, zMatch.index).split('\n').length
        emit('lua.unknown-engine-class', 'warn', lineNum, { className: fullRef }, 'engine-api')
      }
    }
  }

  // 3. Lua Global Function Leak Check (polluting _G)
  const luaLines = text.split(/\r?\n/)
  for (let l = 0; l < luaLines.length; l++) {
    const lineStr = luaLines[l]!
    const fnMatch = /^[ \t]*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lineStr)
    if (fnMatch) {
      const fnName = fnMatch[1]!
      if (fnName && fnName !== 'main' && fnName !== 'init' && fnName.length > 2) {
        emit('lua.global-function-leak', 'warn', l + 1, { name: fnName }, 'engine-api')
      }
    }
  }

  let i = 0
  let line = 1
  let word = ''

  const flushWord = (): void => {
    if (!word) return
    const w = word
    word = ''
    if (w === 'function' || w === 'if' || w === 'do' || w === 'repeat') {
      stack.push({ kind: w, line })
      return
    }
    if (w === 'end') {
      const top = stack.pop()
      if (!top) emit('lua.block-extra-end', 'error', line, undefined, 'critical')
      return
    }
    if (w === 'until') {
      if (stack.length && stack[stack.length - 1]!.kind === 'repeat') stack.pop()
    }
  }

  const longBracketLevel = (): number => {
    if (text[i] !== '[') return -1
    let j = i + 1
    let level = 0
    while (text[j] === '=') {
      level++
      j++
    }
    return text[j] === '[' ? level : -1
  }

  const skipLongBracket = (level: number, startLine: number, rule: string): void => {
    const closer = `]${'='.repeat(level)}]`
    const end = text.indexOf(closer, i)
    if (end < 0) {
      emit(rule, 'error', startLine, undefined, 'critical')
      i = text.length
      return
    }
    for (let k = i; k < end; k++) if (text[k] === '\n') line++
    i = end + closer.length
  }

  while (i < text.length) {
    const ch = text[i] as string

    if (ch === '-' && text[i + 1] === '-') {
      flushWord()
      i += 2
      const level = longBracketLevel()
      if (level >= 0) {
        const startLine = line
        i += level + 2
        skipLongBracket(level, startLine, 'lua.unterminated-comment')
        continue
      }
      while (i < text.length && text[i] !== '\n') i++
      continue
    }

    if (ch === '"' || ch === "'") {
      flushWord()
      const quote = ch
      const startLine = line
      i++
      let closed = false
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') {
          if (text[i + 1] === '\n') line++
          i += 2
          continue
        }
        if (c === '\n') break
        if (c === quote) {
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) emit('lua.unterminated-string', 'error', startLine, undefined, 'critical')
      continue
    }

    if (ch === '[') {
      const level = longBracketLevel()
      if (level >= 0) {
        flushWord()
        const startLine = line
        i += level + 2
        skipLongBracket(level, startLine, 'lua.unterminated-string')
        continue
      }
    }

    if (ch === '\n') {
      flushWord()
      line++
      i++
      continue
    }

    if (/[A-Za-z0-9_]/.test(ch)) {
      word += ch
      i++
      continue
    }

    flushWord()

    const key = pairOf[ch]
    if (key) {
      const slot = brackets[key]!
      if (ch === '(' || ch === '[' || ch === '{') {
        slot.open++
        slot.line = line
      } else if (slot.open === 0) {
        emit('lua.bracket-unbalanced', 'error', line, { bracket: key, delta: -1 }, 'critical')
      } else {
        slot.open--
      }
    }
    i++
  }
  flushWord()

  for (const [key, slot] of Object.entries(brackets)) {
    if (slot.open > 0) {
      emit('lua.bracket-unbalanced', 'error', slot.line, { bracket: key, delta: slot.open }, 'critical')
    }
  }
  if (stack.length > 0) {
    emit('lua.block-unclosed', 'warn', stack[0]!.line, { n: stack.length }, 'critical')
  }
}

/* ---------------------------------------------------------------- scripts -- */

const KNOWN_BLOCKS = new Set([
  'imports', 'item', 'recipe', 'craftrecipe', 'craftitem', 'evolvedrecipe', 'uniquerecipe',
  'researchrecipe', 'fixing', 'vehicle', 'template', 'model', 'animation',
  'animationsmesh', 'sound', 'soundtimeline', 'ragdoll', 'entity', 'component',
  'multistagebuild', 'physicshape', 'mannequin', 'vehicleengine', 'vehicletemplate',
  'clothingitem', 'body', 'skill', 'trait', 'profession', 'timedaction', 'material',
  'grainlot', 'farming', 'mapdefine', 'energy', 'fluid', 'xpscale', 'equipmenttype',
  'itemvisual', 'modelattachment', 'emitter'
])

interface ScriptProperty {
  val: string
  line: number
}

interface ScriptBlock {
  type: string
  name: string
  line: number
  props: Map<string, ScriptProperty>
  hasInputs?: boolean
  hasOutputs?: boolean
}

function stripScriptComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const chunk = end < 0 ? text.slice(i) : text.slice(i, end + 2)
      out += chunk.replace(/[^\n]/g, '')
      if (end < 0) break
      i = end + 2
      continue
    }
    out += text[i]
    i++
  }
  return out
}

/* -------------------------------------------------------------------- xml -- */

async function checkXml(
  raw: string,
  file: string,
  modModels: Set<string>,
  vanillaModels: Set<string>,
  depModels: Set<string>,
  modTextures: Set<string>,
  vanillaTextures: Set<string>,
  depTextures: Set<string>,
  otherMods: InstalledModMeta[],
  add: (issue: ValidationIssue) => void
): Promise<void> {
  const emit = (
    rule: string,
    severity: ValidationSeverity,
    at: number,
    params?: Record<string, string | number>,
    category: IssueCategory = 'b42-syntax'
  ): void => {
    const snippet = makeSnippet(raw, at, 2, 'xml')
    add(params ? { rule, severity, category, file, line: at, params, snippet } : { rule, severity, category, file, line: at, snippet })
  }

  if (raw.charCodeAt(0) === 0xfeff) {
    emit('hygiene.bom', 'error', 1, undefined, 'hygiene')
  }

  const clean = stripBom(raw)
  if (!clean.trim()) {
    emit('xml.malformed', 'warn', 1, { error: 'Empty XML file' }, 'hygiene')
    return
  }

  const stack: Array<{ tag: string; line: number }> = []
  const lines = clean.split(/\r?\n/)

  const MODEL_TAGS = new Set(['m_malemodel', 'm_femalemodel', 'm_staticmodel', 'm_basemesh'])
  const TEXTURE_TAGS = new Set(['texturechoices', 'm_texture', 'texture'])

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1
    const lineText = lines[idx]!
    const trimmed = lineText.trim()
    if (!trimmed || trimmed.startsWith('<?') || trimmed.startsWith('<!--')) continue

    // Tag scanner
    const tagRegex = /<([/]?)([A-Za-z0-9_:-]+)([^>]*)>/g
    let match: RegExpExecArray | null

    while ((match = tagRegex.exec(lineText)) !== null) {
      const isClosing = match[1] === '/'
      const tagName = match[2]!
      const attrs = match[3] ?? ''
      const isSelfClosing = attrs.trim().endsWith('/')

      if (isSelfClosing) continue

      if (isClosing) {
        if (stack.length === 0) {
          emit('xml.mismatched-tag', 'error', lineNum, { expected: 'none', found: tagName }, 'critical')
        } else {
          const top = stack.pop()!
          if (top.tag.toLowerCase() !== tagName.toLowerCase()) {
            emit('xml.mismatched-tag', 'error', lineNum, { expected: top.tag, found: tagName }, 'critical')
          }
        }
      } else {
        stack.push({ tag: tagName, line: lineNum })
      }
    }

    // Inspect values inside tags e.g. <m_MaleModel>path</m_MaleModel>
    const valTagRegex = /<([A-Za-z0-9_:-]+)>([^<]+)<\/\1>/g
    let valMatch: RegExpExecArray | null
    while ((valMatch = valTagRegex.exec(lineText)) !== null) {
      const tagLower = valMatch[1]!.toLowerCase()
      const val = valMatch[2]!.trim()
      if (!val) continue

      if (MODEL_TAGS.has(tagLower)) {
        if (!isKnownModelSync(val, modModels, vanillaModels, depModels)) {
          const other = await findProviderModForModel(val, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', lineNum, {
              asset: val,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.model-missing', 'warn', lineNum, { model: val, item: basename(file) }, 'assets')
          }
        }
      } else if (TEXTURE_TAGS.has(tagLower)) {
        if (!isKnownTextureSync(val, modTextures, vanillaTextures, depTextures)) {
          const other = await findProviderModForTexture(val, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', lineNum, {
              asset: val,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.texture-missing', 'warn', lineNum, { texture: val, model: basename(file) }, 'assets')
          }
        }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!
    emit('xml.unclosed-tag', 'error', unclosed.line, { tag: unclosed.tag }, 'critical')
  }
}

/* ----------------------------------------------------------------- scripts -- */

async function checkScript(
  raw: string,
  file: string,
  scope: string,
  modTextures: Set<string>,
  vanillaTextures: Set<string>,
  depTextures: Set<string>,
  modModels: Set<string>,
  vanillaModels: Set<string>,
  depModels: Set<string>,
  seenItems: Map<string, string>,
  otherMods: InstalledModMeta[],
  add: (issue: ValidationIssue) => void
): Promise<void> {
  const text = stripScriptComments(raw)
  const stack: ScriptBlock[] = []
  const reported = new Map<string, number>()
  let pending = ''
  let line = 1
  let depth = 0
  let sawModule = false
  let extraClose = false

  const emit = (
    rule: string,
    severity: ValidationSeverity,
    at: number,
    params?: Record<string, string | number>,
    category: IssueCategory = 'b42-syntax'
  ): void => {
    const seen = reported.get(rule) ?? 0
    if (seen >= MAX_PER_RULE) return
    reported.set(rule, seen + 1)
    const snippet = makeSnippet(raw, at, 2, 'txt')
    add(params ? { rule, severity, category, file, line: at, params, snippet } : { rule, severity, category, file, line: at, snippet })
  }

  if (raw.charCodeAt(0) === 0xfeff) {
    emit('hygiene.bom', 'error', 1, undefined, 'hygiene')
  }

  const flushStatement = (): void => {
    const stmt = pending.trim()
    pending = ''
    if (!stmt) return

    const block = stack[stack.length - 1]
    if (!block) return

    // Track B42 inputs/outputs in craftRecipe
    if (block.type === 'craftrecipe') {
      const lower = stmt.toLowerCase()
      if (lower.startsWith('item:') || lower.startsWith('fluid:') || lower.startsWith('tag:') || lower.startsWith('tool:')) {
        block.hasInputs = true
      }
      if (lower.startsWith('item:') || lower.startsWith('fluid:')) {
        block.hasOutputs = true
      }
    }

    const eq = stmt.indexOf('=')
    if (eq <= 0) return
    const key = stmt.slice(0, eq).trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      block.props.set(key.toLowerCase(), { val: stmt.slice(eq + 1).trim(), line })
    }
  }

  const closeBlock = async (block: ScriptBlock): Promise<void> => {
    const name = block.name
    if (!name) return

    if (block.type === 'item') {
      if (!block.props.has('displayname')) {
        emit('script.item-no-display-name', 'warn', block.line, { name }, 'b42-syntax')
      }
      if (!block.props.has('type')) {
        emit('script.item-no-type', 'warn', block.line, { name }, 'b42-syntax')
      }

      const itemType = (block.props.get('type')?.val ?? '').toLowerCase()
      if (itemType === 'weapon') {
        const swingAnimProp = block.props.get('swinganim')
        if (swingAnimProp && !VALID_SWING_ANIMS.has(swingAnimProp.val.toLowerCase())) {
          emit('script.invalid-swing-anim', 'warn', swingAnimProp.line, { name, anim: swingAnimProp.val }, 'b42-syntax')
        }
        const minDmgProp = block.props.get('mindamage')
        const maxDmgProp = block.props.get('maxdamage')
        if (minDmgProp && maxDmgProp) {
          const minDmg = Number(minDmgProp.val)
          const maxDmg = Number(maxDmgProp.val)
          if (!isNaN(minDmg) && !isNaN(maxDmg) && minDmg > maxDmg) {
            emit('script.weapon-damage-inverted', 'warn', minDmgProp.line, { name, min: minDmg, max: maxDmg }, 'b42-syntax')
          }
        }
      } else if (itemType === 'food') {
        const hungerProp = block.props.get('hungerchange')
        if (hungerProp) {
          const hunger = Number(hungerProp.val)
          if (!isNaN(hunger) && hunger > 0) {
            emit('script.food-positive-hunger', 'warn', hungerProp.line, { name, hunger }, 'b42-syntax')
          }
        }
      }

      // Check 3D models existence with cross-mod resolution
      const staticModelProp = block.props.get('staticmodel')
      if (staticModelProp) {
        const mVal = staticModelProp.val
        if (!isKnownModelSync(mVal, modModels, vanillaModels, depModels)) {
          const other = await findProviderModForModel(mVal, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', staticModelProp.line, {
              asset: mVal,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.model-missing', 'warn', staticModelProp.line, { model: mVal, item: name }, 'assets')
          }
        }
      }

      const worldModelProp = block.props.get('worldstaticmodel')
      if (worldModelProp) {
        const mVal = worldModelProp.val
        if (!isKnownModelSync(mVal, modModels, vanillaModels, depModels)) {
          const other = await findProviderModForModel(mVal, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', worldModelProp.line, {
              asset: mVal,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.model-missing', 'warn', worldModelProp.line, { model: mVal, item: name }, 'assets')
          }
        }
      }

      // Check Icon with cross-mod resolution
      const iconProp = block.props.get('icon')
      if (iconProp) {
        const icon = iconProp.val
        const bare = icon.includes('.') ? (icon.split('.').pop() as string) : icon
        const wanted = `item_${bare.trim().toLowerCase()}.png`
        if (!isKnownTextureSync(wanted, modTextures, vanillaTextures, depTextures)) {
          const other = await findProviderModForTexture(wanted, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', iconProp.line, {
              asset: wanted,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('script.icon-missing', 'warn', iconProp.line, { name, texture: `Item_${bare.trim()}.png` }, 'assets')
          }
        }
      }
    } else if (block.type === 'craftrecipe') {
      const timeProp = block.props.get('time')
      if (!timeProp) {
        emit('script.craftrecipe-no-time', 'warn', block.line, { name }, 'b42-syntax')
      } else {
        const tNum = Number(timeProp.val.replace(/[^0-9.]/g, ''))
        if (isNaN(tNum) || tNum <= 0) {
          emit('script.craftrecipe-invalid-time', 'warn', timeProp.line, { name, time: timeProp.val }, 'b42-syntax')
        }
      }
      if (!block.hasInputs && !block.hasOutputs) {
        emit('script.craftrecipe-missing-inputs', 'warn', block.line, { name }, 'b42-syntax')
      }
    } else if (block.type === 'model') {
      const meshProp = block.props.get('mesh')
      if (meshProp) {
        const mVal = meshProp.val
        if (!isKnownModelSync(mVal, modModels, vanillaModels, depModels)) {
          const other = await findProviderModForModel(mVal, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', meshProp.line, {
              asset: mVal,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.model-missing', 'warn', meshProp.line, { model: mVal, item: name }, 'assets')
          }
        }
      }
      const texProp = block.props.get('texture')
      if (texProp) {
        const tVal = texProp.val
        if (!isKnownTextureSync(tVal, modTextures, vanillaTextures, depTextures)) {
          const other = await findProviderModForTexture(tVal, otherMods)
          if (other) {
            emit('asset.dependency-undeclared', 'warn', texProp.line, {
              asset: tVal,
              provider: other.name,
              requiredId: other.requiredId
            }, 'assets')
          } else {
            emit('asset.texture-missing', 'warn', texProp.line, { texture: tVal, model: name }, 'assets')
          }
        }
      }
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string

    if (ch === '\n') {
      line++
      pending += ' '
      continue
    }

    if (ch === '{') {
      const header = pending.trim().replace(/\s+/g, ' ')
      pending = ''
      const parts = header.split(' ')
      const type = (parts[0] ?? '').toLowerCase()
      const name = parts.slice(1).join(' ')

      if (depth === 0) {
        if (type === 'module') sawModule = true
        else if (header) emit('script.unknown-block', 'info', line, { block: header }, 'b42-syntax')
      } else if (depth === 1 && type && !KNOWN_BLOCKS.has(type)) {
        emit('script.unknown-block', 'info', line, { block: parts[0] ?? header }, 'b42-syntax')
      }

      if (depth === 1 && type === 'item' && name) {
        const moduleName = stack[0]?.name ?? 'Base'
        const fullName = `${scope}\u0000${moduleName}.${name}`.toLowerCase()
        const previous = seenItems.get(fullName)
        if (previous) {
          emit('script.duplicate-item', 'error', line, { name: `${moduleName}.${name}` }, 'critical')
        } else {
          seenItems.set(fullName, file)
        }
      }

      stack.push({ type, name, line, props: new Map() })
      depth++
      continue
    }

    if (ch === '}') {
      flushStatement()
      const block = stack.pop()
      if (block) await closeBlock(block)
      depth--
      if (depth < 0) {
        if (!extraClose) {
          extraClose = true
          emit('script.brace-unbalanced', 'error', line, { delta: -1 }, 'critical')
        }
        depth = 0
      }
      continue
    }

    if (ch === ',') {
      flushStatement()
      continue
    }

    pending += ch
  }

  if (depth > 0) emit('script.brace-unbalanced', 'error', line, { delta: depth }, 'critical')
  if (!sawModule && text.trim()) emit('script.no-module', 'warn', 1, undefined, 'b42-syntax')
}

/* -------------------------------------------------------------- translate -- */

const KNOWN_LANGS = new Set([
  'AR', 'CA', 'CH', 'CN', 'CS', 'CZ', 'DA', 'DE', 'DK', 'EN', 'ES', 'ES_CL',
  'ES_MX', 'FI', 'FR', 'HU', 'ID', 'IT', 'JP', 'KO', 'NL', 'NO', 'PH', 'PL',
  'PT', 'PTBR', 'RO', 'RU', 'STREW', 'TH', 'TR', 'TW', 'UA'
])

function langOf(file: string): string {
  const parts = file.split(sep)
  return parts[parts.length - 2] ?? ''
}

function lineAt(text: string, position: number): number {
  let line = 1
  const stop = Math.min(position, text.length)
  for (let i = 0; i < stop; i++) if (text[i] === '\n') line++
  return line
}

function checkTranslateJson(
  text: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const at = /position (\d+)/.exec(err instanceof Error ? err.message : '')?.[1]
    const line = at ? lineAt(text, Number(at)) : undefined
    add({
      rule: 'translate.json-invalid',
      severity: 'error',
      category: 'critical',
      file,
      line,
      snippet: line ? makeSnippet(text, line, 2, 'json') : undefined
    })
    return
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    add({ rule: 'translate.json-not-object', severity: 'error', category: 'critical', file })
    return
  }

  const bad = Object.entries(parsed as Record<string, unknown>)
    .filter(([, value]) => typeof value !== 'string')
    .map(([key]) => key)
  if (bad.length > 0) {
    add({
      rule: 'translate.json-non-string',
      severity: 'warn',
      category: 'b42-syntax',
      file,
      params: { key: bad[0] ?? '', n: bad.length }
    })
  }
}

function checkTranslateTxt(
  text: string,
  raw: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  let depth = 0
  for (const ch of text) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  if (depth !== 0) {
    add({
      rule: 'translate.brace-unbalanced',
      severity: 'error',
      category: 'critical',
      file,
      line: 1,
      params: { delta: depth },
      snippet: makeSnippet(raw, 1, 2, 'txt')
    })
  }

  const header = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(text)
  const table = header?.[1]
  if (table) {
    const suffix = table.slice(table.lastIndexOf('_') + 1).toUpperCase()
    const upper = langOf(file).toUpperCase()
    if (table.includes('_') && suffix !== upper) {
      const lines = raw.split(/\r?\n/)
      let hLine = 1
      for (let idx = 0; idx < lines.length; idx++) {
        if (lines[idx]!.includes(table)) {
          hLine = idx + 1
          break
        }
      }
      add({
        rule: 'translate.header-mismatch',
        severity: 'warn',
        category: 'hygiene',
        file,
        line: hLine,
        params: { expected: upper, found: suffix },
        snippet: makeSnippet(raw, hLine, 2, 'txt')
      })
    }
  }
}

function checkTranslate(
  raw: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  if (raw.charCodeAt(0) === 0xfeff) {
    add({ rule: 'hygiene.bom', severity: 'error', category: 'hygiene', file, line: 1, snippet: makeSnippet(raw, 1, 2, 'txt') })
  }

  const langDir = langOf(file)
  if (!KNOWN_LANGS.has(langDir.toUpperCase())) {
    add({
      rule: 'translate.unknown-language',
      severity: 'info',
      category: 'hygiene',
      file,
      line: 1,
      params: { dir: langDir },
      snippet: makeSnippet(raw, 1, 2, 'txt')
    })
  }

  const text = stripBom(raw)
  if (!text.trim()) {
    add({ rule: 'translate.empty', severity: 'info', category: 'hygiene', file, line: 1 })
    return
  }

  if (extOf(file) === 'json') checkTranslateJson(text, file, add)
  else checkTranslateTxt(text, raw, file, add)
}

/* -------------------------------------------------------- sandbox-options -- */

function checkSandboxOptions(
  raw: string,
  file: string,
  add: (issue: ValidationIssue) => void
): void {
  if (raw.charCodeAt(0) === 0xfeff) {
    add({ rule: 'hygiene.bom', severity: 'error', category: 'hygiene', file, line: 1, snippet: makeSnippet(raw, 1, 2) })
  }

  const clean = stripBom(raw)
  const lines = clean.split(/\r?\n/)
  let sawVersion = false

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('--')) continue

    if (!sawVersion) {
      sawVersion = true
      if (/^VERSION\s*=\s*1\s*,/i.test(trimmed)) {
        // Valid B42 format
      } else if (/^VERSION\s*=\s*1/i.test(trimmed)) {
        add({
          rule: 'sandbox.missing-trailing-comma',
          severity: 'error',
          category: 'b42-syntax',
          file,
          line: idx + 1,
          snippet: makeSnippet(raw, idx + 1, 2)
        })
      } else {
        add({
          rule: 'sandbox.missing-version',
          severity: 'error',
          category: 'b42-syntax',
          file,
          line: idx + 1,
          snippet: makeSnippet(raw, idx + 1, 2)
        })
      }
      continue
    }

    if (trimmed.includes('=')) {
      const eq = trimmed.indexOf('=')
      const val = trimmed.slice(eq + 1).trim()
      if (!val) {
        add({
          rule: 'sandbox.empty-option',
          severity: 'warn',
          category: 'b42-syntax',
          file,
          line: idx + 1,
          snippet: makeSnippet(raw, idx + 1, 2)
        })
      }
    }
  }

  if (!sawVersion) {
    add({ rule: 'sandbox.missing-version', severity: 'error', category: 'b42-syntax', file, line: 1, snippet: makeSnippet(raw, 1, 2) })
  }
}

/* ------------------------------------------------------------ health score -- */

function computeHealthScore(issues: ValidationIssue[]): {
  score: ModHealthScore
  categories: ValidationCategoriesCount
} {
  const catCount: ValidationCategoriesCount = {
    critical: 0,
    engineApi: 0,
    b42Syntax: 0,
    assets: 0,
    overwrites: 0,
    hygiene: 0
  }

  let errorCount = 0
  let warnCount = 0
  let infoCount = 0

  for (const i of issues) {
    const cat = i.category ?? 'hygiene'
    if (cat === 'critical') catCount.critical++
    else if (cat === 'engine-api') catCount.engineApi++
    else if (cat === 'b42-syntax') catCount.b42Syntax++
    else if (cat === 'assets') catCount.assets++
    else if (cat === 'overwrites') catCount.overwrites++
    else catCount.hygiene++

    if (i.severity === 'error') {
      errorCount++
      if (cat !== 'critical') catCount.critical++
    } else if (i.severity === 'warn') {
      warnCount++
    } else {
      infoCount++
    }
  }

  const penalty = errorCount * 14 + warnCount * 3 + infoCount * 0.5
  const overall = Math.max(0, Math.min(100, Math.round(100 - penalty)))

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'A+'
  if (overall >= 95 && errorCount === 0) grade = 'A+'
  else if (overall >= 85 && errorCount === 0) grade = 'A'
  else if (overall >= 70) grade = 'B'
  else if (overall >= 50) grade = 'C'
  else if (overall >= 30) grade = 'D'
  else grade = 'F'

  const calcSub = (issuesInCat: ValidationIssue[]): number => {
    let errs = 0
    let warns = 0
    for (const i of issuesInCat) {
      if (i.severity === 'error') errs++
      else if (i.severity === 'warn') warns++
    }
    return Math.max(0, Math.min(100, Math.round(100 - (errs * 25 + warns * 8))))
  }

  return {
    score: {
      overall,
      grade,
      engineApi: calcSub(issues.filter((i) => i.category === 'engine-api')),
      b42Syntax: calcSub(issues.filter((i) => i.category === 'b42-syntax')),
      assets: calcSub(issues.filter((i) => i.category === 'assets')),
      overwrites: calcSub(issues.filter((i) => i.category === 'overwrites')),
      hygiene: calcSub(issues.filter((i) => i.category === 'hygiene' || !i.category))
    },
    categories: catCount
  }
}

/* ------------------------------------------------------------------ entry -- */

export async function validateMod(
  modPath: string,
  opts: ValidateOptions,
  onProgress: Progress
): Promise<ValidationReport> {
  const started = Date.now()
  const issues: ValidationIssue[] = []
  const add = (issue: ValidationIssue): void => {
    issues.push(issue)
  }

  onProgress({ task: 'validate', phase: 'collect', done: 0, total: 0, label: '' })

  const [found, javaApi, vanillaModels, vanillaTextures] = await Promise.all([
    collect(modPath),
    loadGameJarClasses(opts.gameDir),
    getVanillaModels(opts.gameDir),
    getVanillaTextures(opts.gameDir)
  ])

  if (!found.hasMedia) add({ rule: 'layout.no-media', severity: 'error', category: 'hygiene' })
  for (const dir of found.miscasedMedia.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.media-case', severity: 'warn', category: 'hygiene', params: { dir } })
  }
  for (const file of found.nonAscii.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.non-ascii-name', severity: 'warn', category: 'hygiene', params: { file } })
  }
  for (const dir of found.emptyDirs.slice(0, MAX_PER_RULE)) {
    add({ rule: 'layout.empty-dir', severity: 'info', category: 'hygiene', params: { dir } })
  }

  const infoFile = opts.infoFile ?? (await resolveInfo(modPath))
  const knownIds = new Set((opts.knownIds ?? []).map((id) => id.toLowerCase()))
  const declaredRequires = await checkModInfo(modPath, infoFile, knownIds, add, opts.gameVersion)

  // Resolve declared dependencies and other installed mods for cross-mod asset resolution
  const installedMods = opts.installedMods ?? []
  const declaredDepMods = installedMods.filter((m) => {
    const modId = (m.modId ?? '').toLowerCase()
    const rawId = (m.rawModId ?? '').toLowerCase()
    const folder = (m.folderName ?? '').toLowerCase()
    return declaredRequires.has(modId) || declaredRequires.has(rawId) || declaredRequires.has(folder)
  })

  const otherInstalledMods = installedMods.filter((m) => {
    if (m.path.toLowerCase() === modPath.toLowerCase()) return false
    const modId = (m.modId ?? '').toLowerCase()
    const rawId = (m.rawModId ?? '').toLowerCase()
    const folder = (m.folderName ?? '').toLowerCase()
    return !declaredRequires.has(modId) && !declaredRequires.has(rawId) && !declaredRequires.has(folder)
  })

  const depIndexes = await Promise.all(declaredDepMods.map((m) => indexModAssets(m.path)))
  const depModels = new Set<string>()
  const depTextures = new Set<string>()
  for (const idx of depIndexes) {
    for (const m of idx.models) depModels.add(m)
    for (const t of idx.textures) depTextures.add(t)
  }

  // Vanilla Overwrites check
  if (opts.checkVanillaOverwrites !== false) {
    try {
      const overwrites = await checkVanillaOverwrites(
        opts.gameDir ? ({ gameDirOverride: opts.gameDir } as any) : ({} as any),
        modPath
      )
      for (const ov of overwrites.slice(0, 10)) {
        add({
          rule: 'conflict.vanilla-overwrite',
          severity: 'info',
          category: 'overwrites',
          file: ov,
          params: { file: basename(ov) }
        })
      }
    } catch {
      // Non-fatal
    }
  }

  const queue = [
    ...found.lua,
    ...found.scripts,
    ...found.translate,
    ...found.sandbox,
    ...found.xml
  ].slice(0, MAX_FILES)
  const total = queue.length
  if (
    queue.length <
    found.lua.length + found.scripts.length + found.translate.length + found.sandbox.length + found.xml.length
  ) {
    found.truncated = true
  }

  const scriptSet = new Set(found.scripts)
  const translateSet = new Set(found.translate)
  const sandboxSet = new Set(found.sandbox)
  const xmlSet = new Set(found.xml)
  const seenItems = new Map<string, string>()

  const limit = pLimit(16)
  let done = 0
  let bytesChecked = 0
  let budgetSpent = false

  await Promise.all(
    queue.map((file) =>
      limit(async () => {
        if (!budgetSpent) {
          const text = await readTextSafe(file, MAX_FILE_BYTES)
          if (text !== undefined) {
            bytesChecked += Buffer.byteLength(text, 'utf8')
            if (bytesChecked > MAX_TOTAL_BYTES) {
              budgetSpent = true
              found.truncated = true
            }
            if (xmlSet.has(file)) {
              await checkXml(
                text,
                file,
                found.models,
                vanillaModels,
                depModels,
                found.textures,
                vanillaTextures,
                depTextures,
                otherInstalledMods,
                add
              )
            } else if (translateSet.has(file)) {
              checkTranslate(text, file, add)
            } else if (scriptSet.has(file)) {
              await checkScript(
                text,
                file,
                buildScope(file, modPath),
                found.textures,
                vanillaTextures,
                depTextures,
                found.models,
                vanillaModels,
                depModels,
                seenItems,
                otherInstalledMods,
                add
              )
            } else if (sandboxSet.has(file)) {
              checkSandboxOptions(text, file, add)
            } else {
              checkLua(text, file, add, javaApi)
            }
          }
        }
        done++
        if (done % 20 === 0 || done === total) {
          onProgress({
            task: 'validate',
            phase: 'read',
            done,
            total,
            label: file.split(sep).pop() ?? ''
          })
        }
      })
    )
  )

  onProgress({ task: 'validate', phase: 'done', done: total, total, label: '' })

  const rank: Record<ValidationSeverity, number> = { error: 0, warn: 1, info: 2 }
  issues.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule)
  )

  const { score: healthScore, categories } = computeHealthScore(issues)

  return {
    modPath,
    durationMs: Date.now() - started,
    filesChecked: total,
    bytesChecked,
    issues,
    healthScore,
    categories,
    truncated: found.truncated
  }
}

/** Fallback when the caller has no scanner result to hand. */
async function resolveInfo(modPath: string): Promise<string | undefined> {
  const root = join(modPath, 'mod.info')
  if (await fileExists(root)) return root
  for (const entry of await readdirSafe(modPath)) {
    if (!entry.isDirectory()) continue
    if (!/^(?:common|4[0-9](?:\.\d+)*)$/i.test(entry.name)) continue
    const candidate = join(modPath, entry.name, 'mod.info')
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}
