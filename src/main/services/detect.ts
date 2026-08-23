import type { ModCategory } from '../../shared/types'

/** Everything the classifier needs, gathered with cheap shallow reads. */
export interface ModEvidence {
  /** Lowercased directory names found directly under any `media/`. */
  mediaDirs: Set<string>
  /** Lowercased directory names found under any `media/lua/`. */
  luaDirs: Set<string>
  /** `media/lua/shared/Translate` exists. */
  hasTranslate: boolean
  /** Lowercased file names found under `media/scripts` (shallow). */
  scriptNames: string[]
  tags: string[]
  name: string
  modId?: string
  /** mod.info declares `tiledef=`. */
  hasTiledef: boolean
  /** mod.info declares `pack=`. */
  hasPack: boolean
}

const LIBRARY_RE = /\b(librar(?:y|ies)|framework|api|core|toolkit|utils?|sdk|common\s?lib)\b/i
const BALANCE_RE = /\b(balance|rebalance|tweak|nerf|buff|overhaul|realis)/i
const WEAPON_RE = /(weapon|gun|firearm|rifle|pistol|ammo|melee|magazine|attachment)/
const VEHICLE_RE = /(vehicle|car|truck|trailer|engine|tire|bicycle)/
const CLOTHING_RE = /(clothing|outfit|hat|bag|armor|armour|vest|uniform|shoes)/
const BUILD_RE = /(recipe|craft|build|entit|fixing|research|blueprint)/

/**
 * Classify a mod from its folder layout and metadata.
 * Returns up to three categories, most relevant first.
 */
export function detectCategories(e: ModEvidence): ModCategory[] {
  const scores = new Map<ModCategory, number>()
  const add = (c: ModCategory, n: number): void => {
    scores.set(c, (scores.get(c) ?? 0) + n)
  }

  const media = e.mediaDirs
  const scripts = e.scriptNames.join('|')
  const text = `${e.name} ${e.modId ?? ''} ${e.tags.join(' ')}`

  /**
   * Guiding rule: a shared container folder only identifies a mod when the mod
   * carries nothing heavier. Almost every mod ships `media/ui`, `media/sound`
   * and a `Translate` folder, so those score high only in isolation. Content
   * that defines a mod — maps, vehicle scripts, clothing, texture packs —
   * always outranks them.
   */
  const heavy =
    media.has('scripts') ||
    media.has('models') ||
    media.has('models_x') ||
    media.has('maps') ||
    media.has('clothing') ||
    media.has('texturepacks')

  if (media.has('maps')) add('map', 130)
  if (media.has('heightmaps') || media.has('binmap')) add('map', 25)

  if (media.has('texturepacks')) add('texture', 100)
  if (e.hasPack) add('texture', 60)
  if (e.hasTiledef) add('texture', 55)
  if (media.has('tiles') || media.has('tiledefinitions')) add('texture', 40)
  if (media.has('textures')) add('texture', heavy ? 10 : 30)

  // `media/scripts/vehicles/` is the canonical Build 41/42 vehicle layout.
  if (media.has('vehicles')) add('vehicle', 110)
  if (e.scriptNames.includes('vehicles')) add('vehicle', 95)
  if (VEHICLE_RE.test(scripts)) add('vehicle', 60)
  if (VEHICLE_RE.test(text)) add('vehicle', 35)

  if (media.has('clothing')) add('clothing', 90)
  if (CLOTHING_RE.test(scripts)) add('clothing', 50)
  if (CLOTHING_RE.test(text)) add('clothing', 25)

  if (WEAPON_RE.test(scripts)) add('weapon', 65)
  if (WEAPON_RE.test(text)) add('weapon', 30)

  if (media.has('scripts')) add('item', 35)
  if (scripts.includes('item')) add('item', 30)

  if (BUILD_RE.test(scripts)) add('build', 50)
  if (BUILD_RE.test(text)) add('build', 20)
  if (media.has('crafting')) add('build', 45)

  if (e.hasTranslate) add('translation', heavy || media.size > 2 ? 20 : 105)
  if (/translat|locali[sz]/i.test(text)) add('translation', 45)

  if (media.has('sound') || media.has('sounds') || media.has('music')) {
    add('sound', heavy ? 22 : 95)
  }
  if (/\b(sound|music|audio)\b/i.test(text)) add('sound', 35)

  const hasModels = media.has('models') || media.has('models_x')
  if (hasModels) add('model', media.has('scripts') ? 20 : 60)
  if (media.has('anims_x') || media.has('animsets') || media.has('animscript')) add('model', 50)

  if (media.has('ui')) add('ui', heavy ? 25 : 70)
  if (media.has('fonts') || media.has('font')) add('ui', 20)
  if (e.luaDirs.has('client') && !heavy) add('ui', 20)

  if (e.luaDirs.has('server') && !e.luaDirs.has('client')) add('server', 40)

  if (LIBRARY_RE.test(text)) add('library', 80)
  if (e.luaDirs.has('shared') && e.luaDirs.size === 1 && media.size <= 2) add('library', 35)

  if (BALANCE_RE.test(text)) add('balance', 45)

  const ranked = [...scores.entries()]
    .filter(([, n]) => n >= 30)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c)

  return ranked.length ? ranked.slice(0, 3) : ['misc']
}
