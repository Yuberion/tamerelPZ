import type { ModCategory, ModEntry, ModSource, ModSourceKind } from '@shared/types'
import type { IconName } from '@renderer/components/Icon'
import type { TKey } from '@renderer/i18n'

export interface CategoryMeta {
  /** Dictionary key — resolve with `t()` at the render site. */
  labelKey: TKey
  color: string
  icon: IconName
}

export const CATEGORY_META: Record<ModCategory, CategoryMeta> = {
  map: { labelKey: 'cat.map', color: 'var(--cat-map)', icon: 'map' },
  vehicle: { labelKey: 'cat.vehicle', color: 'var(--cat-vehicle)', icon: 'car' },
  weapon: { labelKey: 'cat.weapon', color: 'var(--cat-weapon)', icon: 'gun' },
  clothing: { labelKey: 'cat.clothing', color: 'var(--cat-clothing)', icon: 'shirt' },
  item: { labelKey: 'cat.item', color: 'var(--cat-item)', icon: 'cube' },
  build: { labelKey: 'cat.build', color: 'var(--cat-build)', icon: 'hammer' },
  translation: { labelKey: 'cat.translation', color: 'var(--cat-translation)', icon: 'globe' },
  library: { labelKey: 'cat.library', color: 'var(--cat-library)', icon: 'book' },
  ui: { labelKey: 'cat.ui', color: 'var(--cat-ui)', icon: 'monitor' },
  texture: { labelKey: 'cat.texture', color: 'var(--cat-texture)', icon: 'palette' },
  sound: { labelKey: 'cat.sound', color: 'var(--cat-sound)', icon: 'volume' },
  model: { labelKey: 'cat.model', color: 'var(--cat-model)', icon: 'layers' },
  balance: { labelKey: 'cat.balance', color: 'var(--cat-balance)', icon: 'scales' },
  server: { labelKey: 'cat.server', color: 'var(--cat-server)', icon: 'server' },
  misc: { labelKey: 'cat.misc', color: 'var(--cat-misc)', icon: 'dots' }
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

export const SOURCE_META: Record<
  ModSourceKind,
  { labelKey: TKey; glyph: string; color: string }
> = {
  local: { labelKey: 'src.local', glyph: 'L', color: 'var(--moss)' },
  workshop: { labelKey: 'src.workshop', glyph: 'W', color: 'var(--steel)' },
  game: { labelKey: 'src.game', glyph: 'G', color: 'var(--ember)' },
  project: { labelKey: 'src.project', glyph: 'P', color: 'var(--rust-hot)' },
  custom: { labelKey: 'src.custom', glyph: 'C', color: 'var(--ash)' }
}

/**
 * Display label for a concrete source directory.
 *
 * Built-in sources carry a `labelKey` from main and are translated; user-defined
 * sources keep their own `label` verbatim, since it is not ours to translate.
 */
export function sourceLabel(source: ModSource, t: (key: TKey) => string): string {
  return source.labelKey ? t(`srcLabel.${source.labelKey}` as TKey) : source.label
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
