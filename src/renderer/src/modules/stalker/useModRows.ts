import { useMemo } from 'react'
import type {
  GroupMode,
  ModCategory,
  ModEntry,
  ModSource,
  ModSourceKind,
  ScanIssues,
  SortMode
} from '@shared/types'
import type { IconName } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import {
  CATEGORY_ORDER,
  categoryMeta,
  primaryCategory,
  sourceLabel,
  SOURCE_META
} from '@renderer/lib/catmeta'
import { fuzzyMatch } from '@renderer/lib/format'

export type IssueFilter = 'all' | 'duplicates' | 'missing' | 'noinfo' | 'warnings'

export interface ModFilters {
  query: string
  sourceKinds: Set<ModSourceKind>
  categories: Set<ModCategory>
  builds: Set<string>
  issue: IssueFilter
}

export type ModRow =
  | {
      kind: 'group'
      id: string
      label: string
      color: string
      icon: IconName
      count: number
      collapsed: boolean
    }
  | { kind: 'mod'; id: string; mod: ModEntry; indices: number[] }

interface Params {
  mods: ModEntry[]
  sources: ModSource[]
  issues: ScanIssues | undefined
  filters: ModFilters
  group: GroupMode
  sort: SortMode
  collapsed: Set<string>
}

export interface ModRowsResult {
  rows: ModRow[]
  /** Mods left after filtering (group headers excluded). */
  matched: ModEntry[]
  /** Row index for a mod key, for keyboard navigation and scroll-into-view. */
  indexByKey: Map<string, number>
  /** Counts per category across the source-filtered set, for the filter bar. */
  categoryCounts: Map<ModCategory, number>
}

function sortMods(
  mods: ModEntry[],
  sort: SortMode,
  sources: ModSource[],
  labelOf: (s: ModSource) => string
): ModEntry[] {
  const byName = (a: ModEntry, b: ModEntry): number =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const sourceLabelFor = (m: ModEntry): string => {
    const s = sources.find((x) => x.id === m.sourceId)
    return s ? labelOf(s) : m.sourceKind
  }
  const copy = [...mods]
  switch (sort) {
    case 'name-desc':
      return copy.sort((a, b) => byName(b, a))
    case 'recent':
      return copy.sort((a, b) => b.mtime - a.mtime || byName(a, b))
    case 'id':
      return copy.sort((a, b) => (a.modId ?? '~').localeCompare(b.modId ?? '~') || byName(a, b))
    case 'type':
      return copy.sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(primaryCategory(a)) - CATEGORY_ORDER.indexOf(primaryCategory(b)) ||
          byName(a, b)
      )
    case 'source':
      return copy.sort((a, b) => sourceLabelFor(a).localeCompare(sourceLabelFor(b)) || byName(a, b))
    default:
      return copy.sort(byName)
  }
}

/** Turns the raw scan into the flat, virtualisable row list rendered on the left. */
export function useModRows({
  mods,
  sources,
  issues,
  filters,
  group,
  sort,
  collapsed
}: Params): ModRowsResult {
  const { t } = useI18n()
  return useMemo(() => {
    const labelOf = (s: ModSource): string => sourceLabel(s, t)
    const dupKeys = new Set<string>()
    for (const keys of Object.values(issues?.duplicateIds ?? {})) for (const k of keys) dupKeys.add(k)
    const missingKeys = new Set(Object.keys(issues?.missingRequires ?? {}))
    const noInfoKeys = new Set(issues?.missingInfo ?? [])

    const bySource = mods.filter(
      (m) => filters.sourceKinds.size === 0 || filters.sourceKinds.has(m.sourceKind)
    )

    const categoryCounts = new Map<ModCategory, number>()
    for (const m of bySource) {
      const c = primaryCategory(m)
      categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1)
    }

    const scored: Array<{ mod: ModEntry; indices: number[]; score: number }> = []
    for (const m of bySource) {
      if (filters.categories.size && !m.categories.some((c) => filters.categories.has(c))) continue
      if (filters.builds.size && !m.builds.some((b) => filters.builds.has(b))) continue
      if (filters.issue === 'duplicates' && !dupKeys.has(m.key)) continue
      if (filters.issue === 'missing' && !missingKeys.has(m.key)) continue
      if (filters.issue === 'noinfo' && !noInfoKeys.has(m.key)) continue
      if (filters.issue === 'warnings' && m.warnings.length === 0) continue

      if (!filters.query) {
        scored.push({ mod: m, indices: [], score: 0 })
        continue
      }
      const nameHit = fuzzyMatch(filters.query, m.name)
      const altHit =
        nameHit ??
        fuzzyMatch(filters.query, m.modId ?? '') ??
        fuzzyMatch(filters.query, m.folderName) ??
        fuzzyMatch(filters.query, m.authors ?? '') ??
        (m.workshopId ? fuzzyMatch(filters.query, m.workshopId) : null)
      if (!altHit) continue
      scored.push({ mod: m, indices: nameHit ? nameHit.indices : [], score: altHit.score })
    }

    const matched = filters.query
      ? scored.sort((a, b) => b.score - a.score).map((s) => s.mod)
      : sortMods(
          scored.map((s) => s.mod),
          sort,
          sources,
          labelOf
        )

    const indicesByKey = new Map(scored.map((s) => [s.mod.key, s.indices]))
    const rows: ModRow[] = []

    const emitMod = (m: ModEntry): void => {
      rows.push({ kind: 'mod', id: m.key, mod: m, indices: indicesByKey.get(m.key) ?? [] })
    }

    // Searching flattens the tree: relevance beats taxonomy.
    if (group === 'none' || filters.query) {
      for (const m of matched) emitMod(m)
    } else if (group === 'type') {
      const buckets = new Map<ModCategory, ModEntry[]>()
      for (const m of matched) {
        const c = primaryCategory(m)
        const list = buckets.get(c)
        if (list) list.push(m)
        else buckets.set(c, [m])
      }
      for (const cat of CATEGORY_ORDER) {
        const list = buckets.get(cat)
        if (!list?.length) continue
        const meta = categoryMeta(cat)
        const isCollapsed = collapsed.has(`type:${cat}`)
        rows.push({
          kind: 'group',
          id: `type:${cat}`,
          label: t(meta.labelKey),
          color: meta.color,
          icon: meta.icon,
          count: list.length,
          collapsed: isCollapsed
        })
        if (!isCollapsed) for (const m of list) emitMod(m)
      }
    } else if (group === 'source') {
      const buckets = new Map<string, ModEntry[]>()
      for (const m of matched) {
        const list = buckets.get(m.sourceId)
        if (list) list.push(m)
        else buckets.set(m.sourceId, [m])
      }
      const order = sources.filter((s) => buckets.has(s.id))
      for (const s of order) {
        const list = buckets.get(s.id) ?? []
        const isCollapsed = collapsed.has(`source:${s.id}`)
        rows.push({
          kind: 'group',
          id: `source:${s.id}`,
          label: labelOf(s),
          color: SOURCE_META[s.kind].color,
          icon: s.kind === 'workshop' ? 'download' : s.kind === 'game' ? 'target' : 'folder',
          count: list.length,
          collapsed: isCollapsed
        })
        if (!isCollapsed) for (const m of list) emitMod(m)
      }
    } else {
      // Bucket by the raw build string so group ids stay stable across a language
      // switch; only the rendered label is translated.
      const buckets = new Map<string, ModEntry[]>()
      for (const m of matched) {
        const key = m.builds.join(' + ')
        const list = buckets.get(key)
        if (list) list.push(m)
        else buckets.set(key, [m])
      }
      for (const key of [...buckets.keys()].sort()) {
        const list = buckets.get(key) ?? []
        const isCollapsed = collapsed.has(`build:${key}`)
        rows.push({
          kind: 'group',
          id: `build:${key}`,
          label: key || t('group.unknownBuild'),
          color: key.includes('B42') ? 'var(--moss)' : 'var(--ember)',
          icon: 'hash',
          count: list.length,
          collapsed: isCollapsed
        })
        if (!isCollapsed) for (const m of list) emitMod(m)
      }
    }

    const indexByKey = new Map<string, number>()
    rows.forEach((r, i) => {
      if (r.kind === 'mod') indexByKey.set(r.mod.key, i)
    })

    return { rows, matched, indexByKey, categoryCounts }
  }, [mods, sources, issues, filters, group, sort, collapsed, t])
}
