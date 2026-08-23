import type { ModCategory, ModEntry, ModSourceKind } from '@shared/types'
import type { IconName } from '@renderer/components/Icon'

export interface CategoryMeta {
  label: string
  color: string
  icon: IconName
}

export const CATEGORY_META: Record<ModCategory, CategoryMeta> = {
  map: { label: 'Maps', color: 'var(--cat-map)', icon: 'map' },
  vehicle: { label: 'Vehicles', color: 'var(--cat-vehicle)', icon: 'car' },
  weapon: { label: 'Weapons', color: 'var(--cat-weapon)', icon: 'gun' },
  clothing: { label: 'Clothing', color: 'var(--cat-clothing)', icon: 'shirt' },
  item: { label: 'Items', color: 'var(--cat-item)', icon: 'cube' },
  build: { label: 'Crafting', color: 'var(--cat-build)', icon: 'hammer' },
  translation: { label: 'Translations', color: 'var(--cat-translation)', icon: 'globe' },
  library: { label: 'Libraries', color: 'var(--cat-library)', icon: 'book' },
  ui: { label: 'Interface', color: 'var(--cat-ui)', icon: 'monitor' },
  texture: { label: 'Textures & Tiles', color: 'var(--cat-texture)', icon: 'palette' },
  sound: { label: 'Audio', color: 'var(--cat-sound)', icon: 'volume' },
  model: { label: 'Models & Anims', color: 'var(--cat-model)', icon: 'layers' },
  balance: { label: 'Balance', color: 'var(--cat-balance)', icon: 'scales' },
  server: { label: 'Server', color: 'var(--cat-server)', icon: 'server' },
  misc: { label: 'Unclassified', color: 'var(--cat-misc)', icon: 'dots' }
}

/** Display order for groups in the mod tree. */
export const CATEGORY_ORDER: ModCategory[] = [
  'map',
  'vehicle',
  'weapon',
  'clothing',
  'item',
  'build',
  'texture',
  'model',
  'sound',
  'ui',
  'library',
  'translation',
  'balance',
  'server',
  'misc'
]

export function primaryCategory(mod: ModEntry): ModCategory {
  return mod.categories[0] ?? 'misc'
}

export function categoryMeta(c: ModCategory): CategoryMeta {
  return CATEGORY_META[c] ?? CATEGORY_META.misc
}

export const SOURCE_META: Record<ModSourceKind, { label: string; glyph: string; color: string }> = {
  local: { label: 'Local', glyph: 'L', color: 'var(--moss)' },
  workshop: { label: 'Workshop', glyph: 'W', color: 'var(--steel)' },
  game: { label: 'Game', glyph: 'G', color: 'var(--ember)' },
  project: { label: 'Project', glyph: 'P', color: 'var(--rust-hot)' },
  custom: { label: 'Custom', glyph: 'C', color: 'var(--ash)' }
}

const EXT_ICONS: Record<string, IconName> = {
  lua: 'code',
  txt: 'file',
  info: 'info',
  xml: 'code',
  json: 'code',
  ini: 'file',
  md: 'file',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  ico: 'image',
  tga: 'image',
  ogg: 'volume',
  wav: 'volume',
  mp3: 'volume',
  bank: 'volume',
  fsb: 'volume',
  x: 'layers',
  fbx: 'layers',
  pack: 'archive',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tiles: 'palette',
  lotheader: 'map',
  lotpack: 'map',
  bin: 'hard-drive'
}

/** Colour used for file rows in the skeleton tree, grouped by file family. */
const EXT_COLORS: Record<string, string> = {
  lua: '#8fa9b8',
  txt: '#9a958a',
  info: '#c87a48',
  xml: '#8a9a7a',
  json: '#8a9a7a',
  png: '#a08a63',
  jpg: '#a08a63',
  jpeg: '#a08a63',
  gif: '#a08a63',
  bmp: '#a08a63',
  webp: '#a08a63',
  ico: '#a08a63',
  tga: '#a08a63',
  ogg: '#7a8a7a',
  wav: '#7a8a7a',
  mp3: '#7a8a7a',
  bank: '#7a8a7a',
  x: '#87757f',
  fbx: '#87757f',
  pack: '#9a7d5e',
  tiles: '#9a7d5e',
  lotheader: '#7d8f5a',
  lotpack: '#7d8f5a'
}

export function fileIcon(ext: string): IconName {
  return EXT_ICONS[ext] ?? 'file'
}

export function fileColor(ext: string): string {
  return EXT_COLORS[ext] ?? 'var(--ash-dim)'
}
