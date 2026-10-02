import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type {
  AppSettings,
  CartographerCellConflict,
  CartographerMapItem,
  CartographerRoad,
  CartographerSaveSpawnsRequest,
  CartographerSaveSpawnsResult,
  CartographerScaffoldRequest,
  CartographerScaffoldResult,
  CartographerSpawnPoint,
  CartographerUrbanZone,
  CartographerWaterway,
  CartographerWorldData
} from '../../shared/types'
import { isDir, readTextSafe, readdirSafe } from './fsx'
import { detectGameDir, detectPaths, detectZomboidDir } from './paths'
import { scanMods } from './scanner'

const LOTPACK_RE = /(?:world_|chunkdata_)?(\d{1,3})_(\d{1,3})\.(?:lotpack|bin)/i
const SPAWN_WORLD_RE = /worldX\s*=\s*(\d+)\s*,\s*worldY\s*=\s*(\d+)(?:\s*,\s*posX\s*=\s*(\d+))?(?:\s*,\s*posY\s*=\s*(\d+))?(?:\s*,\s*posZ\s*=\s*(\d+))?/gi
const SPAWN_POS_RE = /posX\s*=\s*(\d+)\s*,\s*posY\s*=\s*(\d+)(?:\s*,\s*posZ\s*=\s*(\d+))?/gi

/**
 * Official Canonical Urban Zones of Knox County, Kentucky
 * Coordinates derived from PZ Java world engine and regions.lua definitions.
 */
export const CANONICAL_URBAN_ZONES: CartographerUrbanZone[] = [
  {
    id: 'zone_louisville',
    name: 'Louisville Metropolis',
    nameRu: 'Мегаполис Луисвилль',
    category: 'metropolis',
    cellBounds: { minX: 38, maxX: 46, minY: 3, maxY: 14 },
    centerTile: { x: 13000, y: 2500 },
    centerCell: { x: 43, y: 8 },
    lootTier: 'high',
    isVanilla: true,
    description: 'The vast quarantine metropolis. High-rise skyscrapers, hospitals, military checkpoints, and the Grand Ohio Mall.',
    descriptionRu: 'Крупнейший мегаполис зоны отчуждения. Небоскребы, больницы, блокпосты военных и торговый центр Grand Ohio Mall.'
  },
  {
    id: 'zone_west_point',
    name: 'West Point',
    nameRu: 'Вест Пойнт',
    category: 'town',
    cellBounds: { minX: 36, maxX: 41, minY: 22, maxY: 26 },
    centerTile: { x: 11650, y: 7000 },
    centerCell: { x: 38, y: 23 },
    lootTier: 'civilian',
    isVanilla: true,
    description: 'Historic Ohio river town with high zombie density, gun store, police station, and hardware stores.',
    descriptionRu: 'Исторический речной город на берегу реки Огайо с оружейным магазином, полицией и плотной застройкой.'
  },
  {
    id: 'zone_muldraugh',
    name: 'Muldraugh',
    nameRu: 'Малдро',
    category: 'town',
    cellBounds: { minX: 35, maxX: 38, minY: 30, maxY: 36 },
    centerTile: { x: 10750, y: 9700 },
    centerCell: { x: 37, y: 32 },
    lootTier: 'civilian',
    isVanilla: true,
    description: 'Iconic starter town along Dixie Highway. Industrial warehouses, railyard, Sunstar Motel, and Mass-Genfac.',
    descriptionRu: 'Культовый стартовый город вдоль шоссе Дикси. Склады, железнодорожные пути, мотель Sunstar и промзона.'
  },
  {
    id: 'zone_rosewood',
    name: 'Rosewood',
    nameRu: 'Роузвуд',
    category: 'town',
    cellBounds: { minX: 26, maxX: 29, minY: 36, maxY: 41 },
    centerTile: { x: 8150, y: 11500 },
    centerCell: { x: 27, y: 38 },
    lootTier: 'civilian',
    isVanilla: true,
    description: 'Affluent suburban town featuring the Rosewood Fire Station, Police Dept, Court House, and Kentucky State Prison.',
    descriptionRu: 'Зажиточный пригород с пожарной частью, полицейским участком, судом и тюрьмой строгого режима.'
  },
  {
    id: 'zone_riverside',
    name: 'Riverside',
    nameRu: 'Риверсайд',
    category: 'town',
    cellBounds: { minX: 18, maxX: 24, minY: 17, maxY: 21 },
    centerTile: { x: 6450, y: 5600 },
    centerCell: { x: 21, y: 19 },
    lootTier: 'civilian',
    isVanilla: true,
    description: 'Riverfront resort town with a country club, yacht marina, gated community, police station, and post office.',
    descriptionRu: 'Курортный городок на реке Огайо с яхт-клубом, элитным поселком, полицейским участком и аптекой.'
  },
  {
    id: 'zone_march_ridge',
    name: 'March Ridge',
    nameRu: 'Марч Ридж',
    category: 'military',
    cellBounds: { minX: 31, maxX: 34, minY: 40, maxY: 43 },
    centerTile: { x: 10000, y: 12600 },
    centerCell: { x: 33, y: 42 },
    lootTier: 'military',
    isVanilla: true,
    description: 'Garrisoned military community built with dense multi-story apartment dormitories and a central cinema complex.',
    descriptionRu: 'Закрытый военный городок с плотными многоэтажными общежитиями, штабными зданиями и кинотеатром.'
  },
  {
    id: 'zone_fallas_lake',
    name: 'Fallas Lake',
    nameRu: 'Фаллас Лейк',
    category: 'settlement',
    cellBounds: { minX: 23, maxX: 26, minY: 27, maxY: 30 },
    centerTile: { x: 7300, y: 8400 },
    centerCell: { x: 24, y: 28 },
    lootTier: 'rural',
    isVanilla: true,
    description: 'Scenic lakeside rural community with a church, grocery store, hunting supplies, and farming outpost.',
    descriptionRu: 'Живописный поселок у озера с церковью, фермерским универсамом, охотничьей лавкой и автозаправкой.'
  },
  {
    id: 'zone_valley_station',
    name: 'Valley Station',
    nameRu: 'Велли Стейшн',
    category: 'commercial',
    cellBounds: { minX: 42, maxX: 45, minY: 18, maxY: 22 },
    centerTile: { x: 13200, y: 5800 },
    centerCell: { x: 44, y: 19 },
    lootTier: 'civilian',
    isVanilla: true,
    description: 'Transit and commercial corridor preceding Louisville, home to the massive multi-level Crossroads Mall.',
    descriptionRu: 'Транзитный торговый узел на пути в Луисвилль с колоссальным молом Crossroads Mall.'
  },
  {
    id: 'zone_brandenburg',
    name: 'Brandenburg',
    nameRu: 'Бранденбург',
    category: 'settlement',
    cellBounds: { minX: 6, maxX: 9, minY: 19, maxY: 22 },
    centerTile: { x: 2300, y: 6200 },
    centerCell: { x: 8, y: 21 },
    lootTier: 'rural',
    isVanilla: true,
    description: 'North-western river hamlet and port with rustic timber homes and fishing facilities.',
    descriptionRu: 'Северо-западный речной порт и поселок с лесопилками и рыбацкими пристанями.'
  },
  {
    id: 'zone_ekron',
    name: 'Ekron Crossroads',
    nameRu: 'Экрона Перекресток',
    category: 'settlement',
    cellBounds: { minX: 2, maxX: 5, minY: 31, maxY: 34 },
    centerTile: { x: 1000, y: 9800 },
    centerCell: { x: 3, y: 33 },
    lootTier: 'rural',
    isVanilla: true,
    description: 'Far western farming crossroads surrounded by extensive Kentucky agricultural land.',
    descriptionRu: 'Сельскохозяйственный перекресток на крайнем западе округа Нокс.'
  },
  {
    id: 'zone_echo_creek',
    name: 'Echo Creek',
    nameRu: 'Эхо Крик',
    category: 'settlement',
    cellBounds: { minX: 12, maxX: 16, minY: 35, maxY: 38 },
    centerTile: { x: 4200, y: 11000 },
    centerCell: { x: 14, y: 37 },
    lootTier: 'rural',
    isVanilla: true,
    description: 'Forested settlement with a gas station, diner, and remote log cabins.',
    descriptionRu: 'Лесное поселение на юго-западе с автозаправкой, мотелем и бревенчатыми хижинами.'
  },
  {
    id: 'zone_irvington',
    name: 'Irvington',
    nameRu: 'Ирвингтон',
    category: 'settlement',
    cellBounds: { minX: 8, maxX: 11, minY: 44, maxY: 48 },
    centerTile: { x: 2700, y: 13800 },
    centerCell: { x: 9, y: 46 },
    lootTier: 'rural',
    isVanilla: true,
    description: 'Southern outpost featuring the Irvington Speedway race track and ranch estates.',
    descriptionRu: 'Южный форпост с автодромом Irvington Speedway и фермерскими усадьбами.'
  },
  {
    id: 'zone_secret_military_base',
    name: 'Secret Military Research Complex',
    nameRu: 'Секретная Военная База',
    category: 'military',
    cellBounds: { minX: 17, maxX: 19, minY: 40, maxY: 42 },
    centerTile: { x: 5500, y: 12400 },
    centerCell: { x: 18, y: 41 },
    lootTier: 'military',
    isVanilla: true,
    description: 'Heavily guarded research installation hidden deep in the wilderness. High-grade military armories.',
    descriptionRu: 'Засекреченный исследовательский комплекс посреди леса. Первоклассные арсеналы и охрана.'
  },
  {
    id: 'zone_prison',
    name: 'Kentucky State Penitentiary',
    nameRu: 'Государственная Тюрьма Кентукки',
    category: 'military',
    cellBounds: { minX: 25, maxX: 26, minY: 39, maxY: 40 },
    centerTile: { x: 7600, y: 11800 },
    centerCell: { x: 25, y: 39 },
    lootTier: 'military',
    isVanilla: true,
    description: 'Maximum security prison with high fences, guard towers, and an extensive armory.',
    descriptionRu: 'Тюрьма строгого режима с вышками охраны, защитными периметрами и оружейной комнатой.'
  },
  {
    id: 'zone_crossroads_mall',
    name: 'Crossroads Shopping Mall',
    nameRu: 'Торговый Центр Crossroads Mall',
    category: 'commercial',
    cellBounds: { minX: 46, maxX: 47, minY: 19, maxY: 20 },
    centerTile: { x: 13866, y: 5743 },
    centerCell: { x: 46, y: 19 },
    lootTier: 'high',
    isVanilla: true,
    description: 'Multi-story shopping mall with dozens of retail stores, grocery hypermarket, and theater.',
    descriptionRu: 'Многоэтажный торговый центр с десятками магазинов, кинотеатром и супермаркетом.'
  }
]

/**
 * Natural Waterways of Knox County (Ohio River, Salt River, Lakes)
 */
export const CANONICAL_WATERWAYS: CartographerWaterway[] = [
  {
    id: 'river_ohio',
    name: 'Ohio River',
    nameRu: 'Река Огайо',
    kind: 'river',
    width: 2.2,
    points: [
      { x: 5, y: 18 },
      { x: 9, y: 18 },
      { x: 14, y: 17 },
      { x: 18, y: 17 },
      { x: 23, y: 17 },
      { x: 28, y: 18 },
      { x: 33, y: 19 },
      { x: 37, y: 21 },
      { x: 40, y: 19 },
      { x: 42, y: 16 },
      { x: 43, y: 11 },
      { x: 44, y: 6 },
      { x: 45, y: 2 },
      { x: 46, y: 0 }
    ]
  },
  {
    id: 'river_salt',
    name: 'Salt River',
    nameRu: 'Река Солт',
    kind: 'river',
    width: 1.2,
    points: [
      { x: 37, y: 21 },
      { x: 39, y: 22 },
      { x: 41, y: 23 },
      { x: 43, y: 24 },
      { x: 45, y: 26 }
    ]
  },
  {
    id: 'lake_doe_valley',
    name: 'Doe Valley Lake',
    nameRu: 'Озеро Доу Вэлли',
    kind: 'lake',
    width: 2.5,
    points: [
      { x: 12, y: 26 },
      { x: 14, y: 26 },
      { x: 14, y: 28 },
      { x: 12, y: 28 },
      { x: 12, y: 26 }
    ]
  },
  {
    id: 'lake_deerhead',
    name: 'Deerhead Lake',
    nameRu: 'Озеро Дирхэд',
    kind: 'lake',
    width: 1.8,
    points: [
      { x: 15, y: 30 },
      { x: 17, y: 30 },
      { x: 17, y: 32 },
      { x: 15, y: 32 },
      { x: 15, y: 30 }
    ]
  }
]

/**
 * Major Roadways & Highway Corridors of Knox County
 * Modeled after canonical Kentucky highways (US-31W Dixie Hwy, I-65, US-60)
 */
export const CANONICAL_ROADS: CartographerRoad[] = [
  {
    id: 'road_dixie_hwy',
    name: 'Dixie Highway (US 31W)',
    kind: 'highway',
    width: 0.6,
    points: [
      { x: 44, y: 14 },
      { x: 42, y: 17 },
      { x: 39, y: 21 },
      { x: 38, y: 23 },
      { x: 38, y: 28 },
      { x: 37, y: 32 },
      { x: 37, y: 35 },
      { x: 35, y: 38 },
      { x: 34, y: 44 },
      { x: 33, y: 50 }
    ]
  },
  {
    id: 'road_i65',
    name: 'Interstate 65 (I-65 Corridor)',
    kind: 'highway',
    width: 0.8,
    points: [
      { x: 46, y: 2 },
      { x: 46, y: 8 },
      { x: 47, y: 14 },
      { x: 47, y: 22 },
      { x: 46, y: 30 },
      { x: 45, y: 40 },
      { x: 45, y: 50 }
    ]
  },
  {
    id: 'road_route_60',
    name: 'US Route 60 (Westbound)',
    kind: 'primary',
    width: 0.5,
    points: [
      { x: 41, y: 21 },
      { x: 38, y: 23 },
      { x: 34, y: 23 },
      { x: 28, y: 21 },
      { x: 24, y: 20 },
      { x: 21, y: 19 },
      { x: 16, y: 22 },
      { x: 10, y: 24 }
    ]
  },
  {
    id: 'road_rosewood_connector',
    name: 'Rosewood - Muldraugh Connector',
    kind: 'primary',
    width: 0.45,
    points: [
      { x: 37, y: 34 },
      { x: 34, y: 35 },
      { x: 30, y: 36 },
      { x: 27, y: 38 }
    ]
  },
  {
    id: 'road_riverside_rosewood',
    name: 'Rural Route 11 (Riverside - Ekron - Rosewood)',
    kind: 'secondary',
    width: 0.4,
    points: [
      { x: 21, y: 20 },
      { x: 22, y: 25 },
      { x: 24, y: 30 },
      { x: 25, y: 34 },
      { x: 27, y: 37 }
    ]
  },
  {
    id: 'road_march_ridge',
    name: 'March Ridge Access Road',
    kind: 'secondary',
    width: 0.4,
    points: [
      { x: 27, y: 39 },
      { x: 30, y: 40 },
      { x: 32, y: 41 },
      { x: 35, y: 41 }
    ]
  },
  {
    id: 'road_louisville_ring',
    name: 'Louisville Perimeter Loop',
    kind: 'highway',
    width: 0.7,
    points: [
      { x: 40, y: 14 },
      { x: 42, y: 14 },
      { x: 45, y: 14 },
      { x: 46, y: 11 },
      { x: 46, y: 6 },
      { x: 43, y: 4 },
      { x: 39, y: 5 }
    ]
  }
]

function parseSpawnpoints(text: string): CartographerSpawnPoint[] {
  const spawns: CartographerSpawnPoint[] = []
  if (!text) return spawns

  // 1. Try worldX/worldY format (common in mods)
  let match: RegExpExecArray | null
  SPAWN_WORLD_RE.lastIndex = 0
  while ((match = SPAWN_WORLD_RE.exec(text)) !== null) {
    const wx = parseInt(match[1], 10)
    const wy = parseInt(match[2], 10)
    const px = match[3] ? parseInt(match[3], 10) : 0
    const py = match[4] ? parseInt(match[4], 10) : 0
    const pz = match[5] ? parseInt(match[5], 10) : 0
    if (!isNaN(wx) && !isNaN(wy)) {
      spawns.push({ worldX: wx, worldY: wy, posX: px, posY: py, posZ: pz })
    }
  }

  // 2. Try world-tile posX/posY format (used in vanilla PZ spawnpoints.lua)
  if (spawns.length === 0) {
    SPAWN_POS_RE.lastIndex = 0
    while ((match = SPAWN_POS_RE.exec(text)) !== null) {
      const tileX = parseInt(match[1], 10)
      const tileY = parseInt(match[2], 10)
      const pz = match[3] ? parseInt(match[3], 10) : 0
      if (!isNaN(tileX) && !isNaN(tileY)) {
        const wx = Math.floor(tileX / 300)
        const wy = Math.floor(tileY / 300)
        const px = tileX % 300
        const py = tileY % 300
        spawns.push({ worldX: wx, worldY: wy, posX: px, posY: py, posZ: pz })
      }
    }
  }

  return spawns
}

function calculateBounds(cells: string[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const c of cells) {
    const parts = c.split('_')
    if (parts.length >= 2) {
      const x = parseInt(parts[0], 10)
      const y = parseInt(parts[1], 10)
      if (!isNaN(x) && !isNaN(y)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (!isFinite(minX) || !isFinite(maxX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }
  return { minX, maxX, minY, maxY }
}

async function inspectMapFolder(
  mapFolder: string,
  folderName: string,
  modId: string,
  modName?: string,
  isVanilla = false
): Promise<CartographerMapItem | undefined> {
  if (!(await isDir(mapFolder))) return undefined

  const files = await readdirSafe(mapFolder)
  if (files.length === 0) return undefined

  const mapInfoText = await readTextSafe(join(mapFolder, 'map.info'), 32 * 1024)
  let title: string | undefined
  let description: string | undefined
  let lots: string | undefined
  let fixed2x: boolean | undefined
  let zoomX: number | undefined
  let zoomY: number | undefined

  if (mapInfoText) {
    for (const line of mapInfoText.split(/\r?\n/)) {
      const tm = /^\s*title\s*=\s*(.*?)\s*$/i.exec(line)
      if (tm) title = tm[1].trim()
      const dm = /^\s*description\s*=\s*(.*?)\s*$/i.exec(line)
      if (dm) description = dm[1].trim()
      const lm = /^\s*lots\s*=\s*(.*?)\s*$/i.exec(line)
      if (lm) lots = lm[1].trim()
      if (/^\s*fixed2x\s*=\s*true/i.test(line)) fixed2x = true
      const zx = /^\s*zoomX\s*=\s*(\d+)/i.exec(line)
      if (zx) zoomX = parseInt(zx[1], 10)
      const zy = /^\s*zoomY\s*=\s*(\d+)/i.exec(line)
      if (zy) zoomY = parseInt(zy[1], 10)
    }
  }

  // Scan cell coordinate files (world_X_Y.lotpack)
  const cellSet = new Set<string>()
  let hasThumbnail = false
  let thumbnailPath: string | undefined

  for (const f of files) {
    const m = LOTPACK_RE.exec(f.name)
    if (m) {
      cellSet.add(`${m[1]}_${m[2]}`)
    }
    if (/^(map|preview|thumb)\.png$/i.test(f.name)) {
      hasThumbnail = true
      thumbnailPath = join(mapFolder, f.name)
    }
  }

  // Parse spawn points if available
  let spawns: CartographerSpawnPoint[] | undefined
  const spawnText = await readTextSafe(join(mapFolder, 'spawnpoints.lua'), 64 * 1024)
  if (spawnText) {
    const parsed = parseSpawnpoints(spawnText)
    if (parsed.length > 0) spawns = parsed
  }

  // If no lotpacks exist in this folder (e.g. Vanilla town folders like Rosewood, KY, West Point, KY that extend Muldraugh):
  if (cellSet.size === 0) {
    // 1. First check if spawns define coordinates
    if (spawns && spawns.length > 0) {
      for (const sp of spawns) {
        cellSet.add(`${sp.worldX}_${sp.worldY}`)
      }
    }

    // 2. Check if zoomX & zoomY give center tile
    if (zoomX !== undefined && zoomY !== undefined) {
      const cx = Math.floor(zoomX / 300)
      const cy = Math.floor(zoomY / 300)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          cellSet.add(`${cx + dx}_${cy + dy}`)
        }
      }
    }

    // 3. Check canonical urban zone match by folder name
    const cleanName = folderName.replace(/,\s*KY/i, '').toLowerCase().replace(/\s+/g, '')
    const matchedZone = CANONICAL_URBAN_ZONES.find((z) => {
      const zClean = z.name.toLowerCase().replace(/\s+/g, '')
      return cleanName.includes(zClean) || zClean.includes(cleanName)
    })
    if (matchedZone) {
      const { minX, maxX, minY, maxY } = matchedZone.cellBounds
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          cellSet.add(`${x}_${y}`)
        }
      }
    }
  }

  const cells = Array.from(cellSet).sort((a, b) => {
    const [ax, ay] = a.split('_').map(Number)
    const [bx, by] = b.split('_').map(Number)
    if (ax !== bx) return ax - bx
    return ay - by
  })

  const bounds = calculateBounds(cells)
  const displayTitle = title && !title.startsWith('See ') ? title : folderName

  return {
    id: isVanilla ? `vanilla:${folderName}` : `${modId}:${folderName}`,
    mapName: displayTitle,
    folderName,
    modId,
    modName,
    isVanilla,
    folderPath: mapFolder,
    title: displayTitle,
    description: description && !description.startsWith('See ') ? description : undefined,
    lots,
    fixed2x,
    cells,
    bounds,
    spawns,
    hasThumbnail,
    thumbnailPath
  }
}

/**
 * Reads active maps from client config (Zomboid/mods/default.txt)
 */
async function getActiveMapNames(settings: AppSettings): Promise<string[]> {
  const zomboidDir = await detectZomboidDir(settings)
  if (!zomboidDir) return []

  const clientPath = join(zomboidDir, 'mods', 'default.txt')
  const text = await readTextSafe(clientPath, 64 * 1024)
  if (!text) return []

  const active: string[] = []
  let inMaps = false
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (/^maps\s*\{?$/i.test(t)) {
      inMaps = true
      continue
    }
    if (inMaps) {
      if (t === '}') {
        inMaps = false
        break
      }
      const m = /^map\s*=\s*(.+?),?$/i.exec(t)
      if (m && m[1]) {
        active.push(m[1].trim())
      }
    }
  }
  return active
}

/**
 * Scans all maps from:
 * 1. Vanilla game directory (media/maps/*) — automatically adapting to B41, B42 or future builds
 * 2. Installed mods across Steam Workshop, user mods and local directories
 */
export async function scanCartographerWorld(settings: AppSettings): Promise<CartographerWorldData> {
  const paths = await detectPaths(settings)
  const gameDir = paths.gameDir || (await detectGameDir(settings))
  const vanillaMaps: CartographerMapItem[] = []
  const modMaps: CartographerMapItem[] = []

  // 1. Scan Vanilla Game Maps dynamically
  if (gameDir) {
    const vanillaMapsDir = join(gameDir, 'media', 'maps')
    if (await isDir(vanillaMapsDir)) {
      const entries = await readdirSafe(vanillaMapsDir)
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name.toLowerCase() === 'challengemaps')
          continue
        const item = await inspectMapFolder(
          join(vanillaMapsDir, e.name),
          e.name,
          'vanilla',
          'Vanilla Project Zomboid',
          true
        )
        if (item && item.cells.length > 0) {
          vanillaMaps.push(item)
        }
      }
    }
  }

  // 2. Scan Mods Maps
  const scanResult = await scanMods(settings, {}, () => {})
  for (const mod of scanResult.mods) {
    if (!mod.path) continue
    const effectiveModId = mod.modId || mod.rawModId || mod.folderName

    const mapCandidates = [
      join(mod.path, 'media', 'maps'),
      join(mod.path, 'common', 'media', 'maps'),
      join(mod.path, '42', 'media', 'maps'),
      join(mod.path, '41', 'media', 'maps')
    ]

    for (const candidate of mapCandidates) {
      if (!(await isDir(candidate))) continue
      const entries = await readdirSafe(candidate)
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const item = await inspectMapFolder(
          join(candidate, e.name),
          e.name,
          effectiveModId,
          mod.name,
          false
        )
        if (item && item.cells.length > 0) {
          // Avoid duplicate folders across builds if already added
          const already = modMaps.find(
            (m) =>
              m.folderName.toLowerCase() === item.folderName.toLowerCase() &&
              m.modId === effectiveModId
          )
          if (!already) {
            modMaps.push(item)
          }
        }
      }
    }
  }

  // 3. Active Maps in Loadout
  const activeMapNames = await getActiveMapNames(settings)

  // 4. Calculate Priority and Conflicts
  const activeOrderMap = new Map<string, number>()
  activeMapNames.forEach((name, idx) => {
    activeOrderMap.set(name.toLowerCase(), idx + 1)
  })

  // Cell usage map: cell -> maps occupying this cell
  const cellOccupants = new Map<
    string,
    Array<{
      mapId: string
      mapName: string
      modId: string
      modName?: string
      isVanilla: boolean
      priority: number
    }>
  >()

  const allMaps = [...vanillaMaps, ...modMaps]
  for (const m of allMaps) {
    let priority = 0
    if (!m.isVanilla) {
      const orderIdx = activeOrderMap.get(m.folderName.toLowerCase())
      priority = orderIdx ?? 1
    }

    for (const cell of m.cells) {
      const list = cellOccupants.get(cell) ?? []
      list.push({
        mapId: m.id,
        mapName: m.title,
        modId: m.modId,
        modName: m.modName,
        isVanilla: m.isVanilla,
        priority
      })
      cellOccupants.set(cell, list)
    }
  }

  const conflicts: CartographerCellConflict[] = []
  for (const [cell, occupants] of cellOccupants.entries()) {
    const nonVanilla = occupants.filter((o) => !o.isVanilla)
    if (nonVanilla.length > 1) {
      const [cx, cy] = cell.split('_').map(Number)
      const sorted = [...occupants].sort((a, b) => b.priority - a.priority)
      conflicts.push({
        cell,
        x: cx,
        y: cy,
        maps: occupants,
        winningMapId: sorted[0].mapId
      })
    }
  }

  // 5. Global Bounds calculation
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const m of allMaps) {
    if (m.bounds.minX < minX) minX = m.bounds.minX
    if (m.bounds.maxX > maxX) maxX = m.bounds.maxX
    if (m.bounds.minY < minY) minY = m.bounds.minY
    if (m.bounds.maxY > maxY) maxY = m.bounds.maxY
  }

  // Ensure canonical landmarks fit comfortably into view
  if (minX > 0) minX = 0
  if (maxX < 52) maxX = 52
  if (minY > 0) minY = 0
  if (maxY < 50) maxY = 50

  let detectedBuild: 'B42' | 'B41' = 'B42'
  if (paths.gameVersion) {
    if (paths.gameVersion.startsWith('41') || paths.gameVersion.toLowerCase().includes('b41')) {
      detectedBuild = 'B41'
    } else {
      detectedBuild = 'B42'
    }
  } else if (gameDir) {
    const hasCraftRecipes = await isDir(join(gameDir, 'media', 'scripts', 'craftRecipes'))
    const hasEntities = await isDir(join(gameDir, 'media', 'scripts', 'entities'))
    if (!hasCraftRecipes && !hasEntities) {
      detectedBuild = 'B41'
    }
  }

  return {
    gameVersion: paths.gameVersion || 'Auto-Detected',
    detectedBuild,
    bounds: { minX, maxX, minY, maxY },
    vanillaMaps,
    modMaps,
    conflicts,
    activeMapNames,
    urbanZones: CANONICAL_URBAN_ZONES,
    waterways: CANONICAL_WATERWAYS,
    roads: CANONICAL_ROADS
  }
}

/**
 * Returns base64 Data URL for map.png / preview.png / thumb.png
 */
export async function getCartographerMapImage(filePath: string): Promise<string | undefined> {
  try {
    const buffer = await fs.readFile(filePath)
    const base64 = buffer.toString('base64')
    return `data:image/png;base64,${base64}`
  } catch {
    return undefined
  }
}

/**
 * Scaffolds a brand new Map Mod for the map modder inside Zomboid/mods or active workspace
 */
export async function scaffoldMapMod(
  settings: AppSettings,
  req: CartographerScaffoldRequest
): Promise<CartographerScaffoldResult> {
  try {
    if (!req.modId || !req.mapFolderName) {
      return { ok: false, modPath: '', mapFolderPath: '', createdFiles: [], error: 'Missing modId or mapFolderName' }
    }

    const zomboidDir = await detectZomboidDir(settings)
    let targetBaseDir: string

    if (req.targetLocation === 'workspace') {
      targetBaseDir = join(process.cwd(), 'projects')
    } else {
      if (!zomboidDir) {
        return { ok: false, modPath: '', mapFolderPath: '', createdFiles: [], error: 'Zomboid user directory not found' }
      }
      targetBaseDir = join(zomboidDir, 'mods')
    }

    const modDir = join(targetBaseDir, req.modId)
    const mapDir = join(modDir, 'media', 'maps', req.mapFolderName)
    await fs.mkdir(mapDir, { recursive: true })

    const createdFiles: string[] = []

    // 1. Write mod.info
    const modInfoContent = [
      `name=${req.modName || req.modId}`,
      `id=${req.modId}`,
      `description=${req.description || 'Custom map mod created with PZ Management Cartographer Studio.'}`,
      `author=${req.author || 'PZ Modder'}`,
      `versionMin=41.0`,
      `versionMax=`,
      `modversion=${req.version || '1.0.0'}`,
      `poster=poster.png`
    ].join('\r\n')

    const modInfoPath = join(modDir, 'mod.info')
    await fs.writeFile(modInfoPath, modInfoContent, 'utf8')
    createdFiles.push(modInfoPath)

    // 2. Calculate center coordinates from selected cells
    let centerTileX = 10000
    let centerTileY = 10000
    if (req.cells.length > 0) {
      let sumX = 0
      let sumY = 0
      for (const c of req.cells) {
        const [cx, cy] = c.split('_').map(Number)
        sumX += cx * 300 + 150
        sumY += cy * 300 + 150
      }
      centerTileX = Math.round(sumX / req.cells.length)
      centerTileY = Math.round(sumY / req.cells.length)
    }

    // 3. Write media/maps/<MapFolder>/map.info
    const mapInfoContent = [
      `title=${req.modName || req.mapFolderName}`,
      `lots=${req.lots || 'Muldraugh, KY'}`,
      `description=${req.description || 'Custom Map'}`,
      `fixed2x=true`,
      `zoomX=${centerTileX}`,
      `zoomY=${centerTileY}`,
      `zoomS=14.0`
    ].join('\r\n')

    const mapInfoPath = join(mapDir, 'map.info')
    await fs.writeFile(mapInfoPath, mapInfoContent, 'utf8')
    createdFiles.push(mapInfoPath)

    // 4. Write description.txt
    const descPath = join(mapDir, 'description.txt')
    await fs.writeFile(descPath, req.description || `${req.modName} Map`, 'utf8')
    createdFiles.push(descPath)

    // 5. Write spawnpoints.lua
    const firstCell = req.cells.length > 0 ? req.cells[0].split('_').map(Number) : [35, 32]
    const defaultWx = firstCell[0]
    const defaultWy = firstCell[1]

    const spawnContent = [
      `-- Generated by PZ Management Cartographer Studio`,
      `function SpawnPoints()`,
      `    local default_spawns = {`,
      `        { worldX = ${defaultWx}, worldY = ${defaultWy}, posX = 150, posY = 150, posZ = 0 },`,
      `        { worldX = ${defaultWx}, worldY = ${defaultWy}, posX = 160, posY = 150, posZ = 0 },`,
      `    }`,
      `    return {`,
      `        unemployed = default_spawns,`,
      `        policeofficer = default_spawns,`,
      `        fireofficer = default_spawns,`,
      `        doctor = default_spawns,`,
      `        parkranger = default_spawns,`,
      `        veteran = default_spawns,`,
      `        carpenter = default_spawns,`,
      `        burglar = default_spawns,`,
      `    }`,
      `end`
    ].join('\r\n')

    const spawnPath = join(mapDir, 'spawnpoints.lua')
    await fs.writeFile(spawnPath, spawnContent, 'utf8')
    createdFiles.push(spawnPath)

    // 6. Create placeholder world_X_Y.lotpack empty descriptor files for WorldEd recognition
    for (const cell of req.cells) {
      const lotpackPath = join(mapDir, `world_${cell}.lotpack`)
      try {
        await fs.writeFile(lotpackPath, Buffer.alloc(0))
        createdFiles.push(lotpackPath)
      } catch {
        // non-fatal
      }
    }

    return {
      ok: true,
      modPath: modDir,
      mapFolderPath: mapDir,
      createdFiles
    }
  } catch (e) {
    return {
      ok: false,
      modPath: '',
      mapFolderPath: '',
      createdFiles: [],
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * Saves customized spawnpoints cleanly back into a mod's spawnpoints.lua
 */
export async function saveSpawnpoints(
  req: CartographerSaveSpawnsRequest
): Promise<CartographerSaveSpawnsResult> {
  try {
    if (!req.mapFolderPath || !req.spawns) {
      return { ok: false, savedCount: 0, error: 'Invalid spawn request' }
    }

    const spawnFilePath = join(req.mapFolderPath, 'spawnpoints.lua')
    const lines: string[] = [
      `-- Spawnpoints generated by PZ Management Cartographer Studio`,
      `function SpawnPoints()`,
      `    local all_spawns = {`
    ]

    for (const sp of req.spawns) {
      lines.push(
        `        { worldX = ${sp.worldX}, worldY = ${sp.worldY}, posX = ${sp.posX}, posY = ${sp.posY}, posZ = ${sp.posZ} },`
      )
    }

    lines.push(
      `    }`,
      `    return {`,
      `        unemployed = all_spawns,`,
      `        policeofficer = all_spawns,`,
      `        fireofficer = all_spawns,`,
      `        doctor = all_spawns,`,
      `        parkranger = all_spawns,`,
      `        veteran = all_spawns,`,
      `        carpenter = all_spawns,`,
      `        burglar = all_spawns,`,
      `    }`,
      `end`,
      ``
    )

    await fs.writeFile(spawnFilePath, lines.join('\r\n'), 'utf8')
    return { ok: true, savedCount: req.spawns.length }
  } catch (e) {
    return { ok: false, savedCount: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
