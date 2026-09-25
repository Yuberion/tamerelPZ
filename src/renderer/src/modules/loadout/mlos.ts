import type { MLOSCategory, ModEntry, OrderIssue, OrderValidationResult, SortingRule } from '@shared/types'
import { bareId } from './useLoadout'

/**
 * MLOS (Mod Load Order Sorter) Engine & Mod Manager compatibility algorithms.
 *
 * Implements:
 *  - 11-tier MLOS category order: coreRequirement -> tweaks -> resource -> map ->
 *    vehicle -> code -> clothes -> ui -> other -> translation -> undefined
 *  - Preorder priority: ModManager (1), ModManagerServer (2), modoptions (3)
 *  - Dynamic category detection from mod filesystem evidence & keywords
 *  - Rules integration: loadAfter, loadBefore, incompatibleMods, loadFirst, loadLast
 *  - Mirrored loadBefore -> loadAfter
 *  - Soft Lua dependency edges from require "..."
 *  - Topological sort with user manual index preservation and cycle breaking
 *  - Comprehensive order validation
 *  - Text format sharing compatible with in-game [B42] Mod Manager
 */

export const PREORDER: Record<string, number> = {
  modmanager: 1,
  modmanagerserver: 2,
  modoptions: 3
}

export const RAW_CATEGORY_ORDER: readonly MLOSCategory[] = [
  'coreRequirement',
  'tweaks',
  'resource',
  'map',
  'vehicle',
  'code',
  'clothes',
  'ui',
  'other',
  'translation',
  'undefined'
] as const

export const CATEGORY_ORDER: Record<MLOSCategory, number> = RAW_CATEGORY_ORDER.reduce(
  (acc, cat, idx) => {
    acc[cat] = idx
    return acc
  },
  {} as Record<MLOSCategory, number>
)

export const TWEAK_KEYWORDS = [
  'framework',
  ' api',
  '_api',
  'tweak',
  'interface',
  'utilit',
  'bugfix',
  'fix',
  'patch'
]

export const CATEGORY_META: Record<
  MLOSCategory,
  { labelEn: string; labelRu: string; color: string; bg: string }
> = {
  coreRequirement: { labelEn: 'Core', labelRu: 'Ядро', color: '#ff79c6', bg: 'rgba(255, 121, 198, 0.15)' },
  tweaks: { labelEn: 'Tweaks', labelRu: 'Твики', color: '#50fa7b', bg: 'rgba(80, 250, 123, 0.15)' },
  resource: { labelEn: 'Resource', labelRu: 'Ресурсы', color: '#8be9fd', bg: 'rgba(139, 233, 253, 0.15)' },
  map: { labelEn: 'Map', labelRu: 'Карты', color: '#f1fa8c', bg: 'rgba(241, 250, 140, 0.15)' },
  vehicle: { labelEn: 'Vehicle', labelRu: 'Транспорт', color: '#ffb86c', bg: 'rgba(255, 184, 108, 0.15)' },
  code: { labelEn: 'Code', labelRu: 'Скрипты', color: '#bd93f9', bg: 'rgba(189, 147, 249, 0.15)' },
  clothes: { labelEn: 'Clothes', labelRu: 'Одежда', color: '#ff5555', bg: 'rgba(255, 85, 85, 0.15)' },
  ui: { labelEn: 'UI', labelRu: 'Интерфейс', color: '#00d2ff', bg: 'rgba(0, 210, 255, 0.15)' },
  other: { labelEn: 'Other', labelRu: 'Прочее', color: '#a0a0a0', bg: 'rgba(160, 160, 160, 0.15)' },
  translation: { labelEn: 'Translation', labelRu: 'Перевод', color: '#5af78e', bg: 'rgba(90, 247, 142, 0.15)' },
  undefined: { labelEn: 'Unknown', labelRu: 'Неизвестно', color: '#6272a4', bg: 'rgba(98, 114, 164, 0.15)' }
}

export function detectMlosCategory(mod?: ModEntry, ruleCategory?: string): MLOSCategory {
  if (ruleCategory) {
    const rc = ruleCategory.trim().toLowerCase()
    if (RAW_CATEGORY_ORDER.includes(rc as MLOSCategory)) {
      return rc as MLOSCategory
    }
  }
  if (!mod) return 'undefined'

  // 1. Explicit declared category
  if (mod.declaredCategory) {
    const dec = mod.declaredCategory.trim().toLowerCase()
    if (RAW_CATEGORY_ORDER.includes(dec as MLOSCategory)) {
      return dec as MLOSCategory
    }
  }

  // 2. Directory structure evidence
  const dirs = new Set(mod.mediaDirs.map((d) => d.toLowerCase()))
  const isModels = dirs.has('models') || dirs.has('models_x')
  const isTextures = dirs.has('textures') || dirs.has('texturepacks')
  const isVehicleModels =
    dirs.has('models_x/vehicles') ||
    dirs.has('models/vehicles') ||
    mod.categories.includes('vehicle')
  const isCodeExist = dirs.has('lua') || dirs.has('scripts') || dirs.has('shared')
  const isSkinned = dirs.has('models_x/skinned') || mod.categories.includes('clothing')
  const isUI = dirs.has('ui') || dirs.has('textures/ui') || mod.categories.includes('ui')
  const isTranslation = dirs.has('translate') || mod.categories.includes('translation')
  const isResource = dirs.has('resource')
  const isMap = dirs.has('maps') || mod.categories.includes('map')

  const nameLower = (mod.name || '').toLowerCase()
  const isTweak = TWEAK_KEYWORDS.some((kw) => nameLower.includes(kw))

  let cat: MLOSCategory = 'undefined'

  const tryApply = (candidate: MLOSCategory, condition: boolean): void => {
    if (condition && CATEGORY_ORDER[candidate] < CATEGORY_ORDER[cat]) {
      cat = candidate
    }
  }

  tryApply('translation', isTranslation && !isCodeExist && !isModels && !isTextures)
  tryApply('ui', isUI)
  tryApply('clothes', isSkinned)
  tryApply('code', isCodeExist && !isModels && !isTextures && !isUI && !isResource)
  tryApply('tweaks', isTweak)
  tryApply('vehicle', isVehicleModels && (isTextures || isModels))
  tryApply('map', isMap)
  tryApply('resource', (isTextures || isResource) && !isCodeExist && !isModels && !isMap && !isUI)
  tryApply('other', cat === 'undefined')

  return cat
}

export interface SortContext {
  modId: string
  entry?: ModEntry
  rule: SortingRule
  category: MLOSCategory
  effectiveLoadAfter: string[]
  effectiveLoadBefore: string[]
  softAfter: string[]
  manualIndex: number
}

export function buildSortContexts(
  modIds: string[],
  byModId: Map<string, ModEntry>,
  rules: Record<string, SortingRule>,
  luaDeps: Record<string, string[]>
): Map<string, SortContext> {
  const contexts = new Map<string, SortContext>()

  for (let index = 0; index < modIds.length; index++) {
    const rawId = modIds[index]
    const idKey = bareId(rawId)
    const entry = byModId.get(idKey)
    const rule = rules[idKey] ??
      rules[rawId] ?? {
        loadAfter: [],
        loadBefore: [],
        incompatibleMods: [],
        loadFirst: 'off',
        loadLast: 'off'
      }

    const explicitCategory = rule.category && RAW_CATEGORY_ORDER.includes(rule.category as MLOSCategory)
      ? (rule.category as MLOSCategory)
      : undefined
    const category = explicitCategory ?? detectMlosCategory(entry)

    const effectiveLoadAfter = [
      ...(entry?.loadAfter ?? []),
      ...rule.loadAfter
    ].map(bareId)

    const effectiveLoadBefore = [
      ...(entry?.loadBefore ?? []),
      ...rule.loadBefore
    ].map(bareId)

    const softAfter = (luaDeps[idKey] ?? luaDeps[rawId] ?? []).map(bareId)

    contexts.set(idKey, {
      modId: rawId,
      entry,
      rule,
      category,
      effectiveLoadAfter: Array.from(new Set(effectiveLoadAfter)),
      effectiveLoadBefore: Array.from(new Set(effectiveLoadBefore)),
      softAfter: Array.from(new Set(softAfter)),
      manualIndex: index
    })
  }

  // Mirror loadBefore -> loadAfter
  for (const [id, ctx] of contexts.entries()) {
    for (const beforeTarget of ctx.effectiveLoadBefore) {
      const targetCtx = contexts.get(beforeTarget)
      if (targetCtx && !targetCtx.effectiveLoadAfter.includes(id)) {
        targetCtx.effectiveLoadAfter.push(id)
      }
    }
  }

  return contexts
}

function preorderRank(id: string): number {
  return PREORDER[bareId(id)] ?? 10000
}

function initialSortCompare(a: SortContext, b: SortContext): number {
  const pA = preorderRank(a.modId)
  const pB = preorderRank(b.modId)
  if (pA !== pB) return pA - pB

  const lfA = a.rule.loadFirst === 'on' ? 0 : 1
  const lfB = b.rule.loadFirst === 'on' ? 0 : 1
  if (lfA !== lfB) return lfA - lfB

  const llA = a.rule.loadLast === 'on' ? 1 : 0
  const llB = b.rule.loadLast === 'on' ? 1 : 0
  if (llA !== llB) return llA - llB

  const catA = CATEGORY_ORDER[a.category] ?? 99
  const catB = CATEGORY_ORDER[b.category] ?? 99
  if (catA !== catB) return catA - catB

  const lfcA = a.rule.loadFirst === 'category' ? 0 : 1
  const lfcB = b.rule.loadFirst === 'category' ? 0 : 1
  if (lfcA !== lfcB) return lfcA - lfcB

  const llcA = a.rule.loadLast === 'category' ? 1 : 0
  const llcB = b.rule.loadLast === 'category' ? 1 : 0
  if (llcA !== llcB) return llcA - llcB

  // Preserve player's manual position if all priority criteria match!
  if (a.manualIndex !== b.manualIndex) {
    return a.manualIndex - b.manualIndex
  }

  return a.modId.localeCompare(b.modId)
}

/**
 * Full Enhanced MLOS Sort.
 * Reorders active mods following:
 *  1. Initial sort (Preorder, loadFirst, MLOS categories, manual order)
 *  2. Topological sort (Hard requirements -> Rules loadAfter -> Soft Lua requires)
 *  3. Non-destructive cycle breaking (soft edges broken first, never drops mods).
 */
export function sortModsMLOS(
  modIds: string[],
  byModId: Map<string, ModEntry>,
  rules: Record<string, SortingRule> = {},
  luaDeps: Record<string, string[]> = {},
  pinnedIds?: Set<string> | string[]
): { sorted: string[]; cycles: string[][] } {
  if (modIds.length <= 1) return { sorted: [...modIds], cycles: [] }

  const pinnedSet = new Set(
    Array.isArray(pinnedIds)
      ? pinnedIds.map(bareId)
      : Array.from(pinnedIds ?? []).map(bareId)
  )

  // Extract visual separators AND pinned mods to preserve their exact slot
  const seps: Array<{ index: number; value: string }> = []
  const pinnedEntries: Array<{ index: number; value: string }> = []
  const cleanMods: string[] = []

  for (let i = 0; i < modIds.length; i++) {
    const item = modIds[i]
    if (item.startsWith('__SEP__:')) {
      seps.push({ index: i, value: item })
    } else if (pinnedSet.has(bareId(item))) {
      pinnedEntries.push({ index: i, value: item })
    } else {
      cleanMods.push(item)
    }
  }

  // If all mods are pinned or no unpinned mods exist
  if (cleanMods.length === 0) {
    return { sorted: [...modIds], cycles: [] }
  }

  const contexts = buildSortContexts(cleanMods, byModId, rules, luaDeps)
  const ordered = Array.from(contexts.values()).sort(initialSortCompare)

  const sortedResult: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const cycles: string[][] = []

  function visit(ctx: SortContext, soft = false): void {
    const key = bareId(ctx.modId)

    if (visiting.has(key)) {
      if (soft) return // Soft cycle: ignore edge
      // Hard cycle
      const cyclePath = Array.from(visiting).concat(key)
      cycles.push(cyclePath)
      return
    }

    if (visited.has(key)) return

    visiting.add(key)

    // 1. Hard requirements from mod.info
    for (const req of ctx.entry?.requires ?? []) {
      const depKey = bareId(req)
      const depCtx = contexts.get(depKey)
      if (depCtx) visit(depCtx, false)
    }

    // 2. Rules loadAfter (and mod.info loadAfter)
    for (const after of ctx.effectiveLoadAfter) {
      const depKey = bareId(after)
      const depCtx = contexts.get(depKey)
      if (depCtx) visit(depCtx, false)
    }

    // 3. Soft Lua dependencies
    for (const softDep of ctx.softAfter) {
      const depKey = bareId(softDep)
      const depCtx = contexts.get(depKey)
      if (depCtx) visit(depCtx, true)
    }

    visiting.delete(key)
    visited.add(key)
    sortedResult.push(ctx.modId)
  }

  for (const ctx of ordered) {
    visit(ctx, false)
  }

  // Re-insert pinned mods strictly at their original positions!
  const finalSorted = [...sortedResult]
  for (const pinned of pinnedEntries.sort((a, b) => a.index - b.index)) {
    const targetIdx = Math.min(pinned.index, finalSorted.length)
    finalSorted.splice(targetIdx, 0, pinned.value)
  }

  // Re-insert separators proportionally
  for (const sep of seps.sort((a, b) => a.index - b.index)) {
    const targetIdx = Math.min(sep.index, finalSorted.length)
    finalSorted.splice(targetIdx, 0, sep.value)
  }

  return { sorted: finalSorted, cycles }
}

/**
 * Validates load order for active mods.
 */
export function validateOrder(
  modIds: string[],
  byModId: Map<string, ModEntry>,
  rules: Record<string, SortingRule> = {}
): OrderValidationResult {
  const issues: OrderIssue[] = []
  const cleanMods = modIds.filter((m) => !m.startsWith('__SEP__:'))
  const enabledSet = new Set(cleanMods.map(bareId))
  const checkedSet = new Set<string>()

  for (const rawId of cleanMods) {
    const key = bareId(rawId)
    const entry = byModId.get(key)
    const rule = rules[key] ?? rules[rawId]

    // Check 1: Missing requirements
    if (entry?.requires) {
      for (const req of entry.requires) {
        const reqKey = bareId(req)
        if (!checkedSet.has(reqKey)) {
          const reqMod = byModId.get(reqKey)
          const isEnabledLater = enabledSet.has(reqKey)
          issues.push({
            type: 'missing',
            modId: rawId,
            targetId: req,
            targetName: reqMod?.name ?? req,
            message: isEnabledLater
              ? `Requires "${reqMod?.name ?? req}" to load before this mod`
              : `Requires "${reqMod?.name ?? req}" which is not enabled or not installed`
          })
        }
      }
    }

    // Check 2: LoadAfter rule violations
    const allLoadAfter = [...(entry?.loadAfter ?? []), ...(rule?.loadAfter ?? [])]
    for (const after of allLoadAfter) {
      const afterKey = bareId(after)
      if (enabledSet.has(afterKey) && !checkedSet.has(afterKey)) {
        const afterMod = byModId.get(afterKey)
        issues.push({
          type: 'rule',
          modId: rawId,
          targetId: after,
          targetName: afterMod?.name ?? after,
          message: `Should load after "${afterMod?.name ?? after}" according to sorting rules`
        })
      }
    }

    // Check 3: Incompatible mods
    const allIncompat = [...(entry?.incompatible ?? []), ...(rule?.incompatibleMods ?? [])]
    for (const bad of allIncompat) {
      const badKey = bareId(bad)
      if (enabledSet.has(badKey)) {
        const badMod = byModId.get(badKey)
        issues.push({
          type: 'incompatible',
          modId: rawId,
          targetId: bad,
          targetName: badMod?.name ?? bad,
          message: `Incompatible with active mod "${badMod?.name ?? bad}"`
        })
      }
    }

    checkedSet.add(key)
  }

  // Check 4: Cycles
  const { cycles } = sortModsMLOS(modIds, byModId, rules)
  for (const c of cycles) {
    issues.push({
      type: 'cycle',
      modId: c[0] ?? 'cycle',
      message: `Circular dependency detected: ${c.join(' ➔ ')}`
    })
  }

  const issuesByMod = new Map<string, OrderIssue[]>()
  for (const issue of issues) {
    const list = issuesByMod.get(issue.modId) ?? []
    list.push(issue)
    issuesByMod.set(issue.modId, list)
  }

  return {
    valid: issues.length === 0,
    issues,
    cycles,
    issuesByMod
  }
}

/* =========================================================================
   Shareable Text Format ([B42] Mod Manager compatible)
   ========================================================================= */

export function exportShareText(
  name: string,
  modIds: string[],
  byModId: Map<string, ModEntry>
): string {
  const workshopIds: string[] = []
  for (const id of modIds) {
    const entry = byModId.get(bareId(id))
    if (entry?.workshopId && !workshopIds.includes(entry.workshopId)) {
      workshopIds.push(entry.workshopId)
    }
  }

  return [
    `${name}:${modIds.join('; ')};`,
    `${modIds.join(';')};`,
    workshopIds.join(';')
  ].join('\n')
}

export function importShareText(
  text: string
): { name: string; modIds: string[]; workshopIds: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) throw new Error('Text is empty')

  let name = 'Imported Preset'
  let rawModString = ''

  const firstLine = lines[0]
  const sep = firstLine.indexOf(':')
  if (sep > 0) {
    name = firstLine.slice(0, sep).trim()
    rawModString = firstLine.slice(sep + 1).trim()
  } else {
    rawModString = firstLine
  }

  const modIds: string[] = []
  for (const part of rawModString.replace(/,/g, ';').split(';')) {
    const p = part.trim().replace(/^\\/, '')
    if (p && !modIds.includes(p)) modIds.push(p)
  }

  const workshopIds: string[] = []
  if (lines.length >= 3) {
    for (const part of lines[2].replace(/,/g, ';').split(';')) {
      const p = part.trim()
      if (p && !workshopIds.includes(p)) workshopIds.push(p)
    }
  }

  return { name, modIds, workshopIds }
}

export function copyOrderText(
  modIds: string[],
  byModId: Map<string, ModEntry>,
  withWorkshop = true
): string {
  const workshopIds: string[] = []
  for (const id of modIds) {
    const entry = byModId.get(bareId(id))
    if (entry?.workshopId && !workshopIds.includes(entry.workshopId)) {
      workshopIds.push(entry.workshopId)
    }
  }

  let result = `${modIds.join(';')};`
  if (withWorkshop && workshopIds.length > 0) {
    result += `\n${workshopIds.join(';')}`
  }
  return result
}
