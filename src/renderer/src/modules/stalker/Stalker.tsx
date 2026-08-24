import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FsNode,
  GroupMode,
  ModCategory,
  ModEntry,
  ModSource,
  ModSourceKind,
  SortMode
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Hint } from '@renderer/components/Hint'
import { MenuProvider } from '@renderer/components/Menu'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type I18n, type TKey } from '@renderer/i18n'
import { formatCount, formatDuration, shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { InfoPanel } from './InfoPanel'
import { ModList } from './ModList'
import { Skeleton } from './Skeleton'
import { StalkerToolbar } from './StalkerToolbar'
import { useModRows, type IssueFilter, type ModFilters } from './useModRows'

const LS_LEFT = 'pz.stalker.leftWidth'
const LS_RIGHT = 'pz.stalker.rightWidth'

const SOURCE_BUTTONS: Array<{
  kind: ModSourceKind
  labelKey: TKey
  icon: 'folder' | 'download' | 'target' | 'wrench'
}> = [
  { kind: 'local', labelKey: 'srcLabel.local', icon: 'folder' },
  { kind: 'workshop', labelKey: 'src.workshop', icon: 'download' },
  { kind: 'game', labelKey: 'src.game', icon: 'target' },
  { kind: 'project', labelKey: 'tb.srcProjects', icon: 'wrench' }
]

function readWidth(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 160 ? raw : fallback
}

export function Stalker({ onExit }: { onExit: () => void }) {
  const { scan, scanning, settings, refresh, saveSettings, byKey } = useAppStore()
  const { notify } = useToast()
  const { t, p } = useI18n()

  const [filters, setFiltersState] = useState<ModFilters>({
    query: '',
    sourceKinds: new Set<ModSourceKind>(),
    categories: new Set<ModCategory>(),
    builds: new Set<string>(),
    issue: 'all' as IssueFilter
  })
  const [group, setGroup] = useState<GroupMode>('type')
  const [sort, setSort] = useState<SortMode>('name')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string>()
  const [selectedNode, setSelectedNode] = useState<FsNode>()
  const [tab, setTab] = useState<'mod' | 'file'>('mod')
  const [showFilters, setShowFilters] = useState(false)
  const [leftW, setLeftW] = useState(() => readWidth(LS_LEFT, 328))
  const [rightW, setRightW] = useState(() => readWidth(LS_RIGHT, 396))
  const searchRef = useRef<HTMLInputElement>(null)
  const restored = useRef(false)

  const mods = scan?.mods ?? []
  const sources = scan?.sources ?? []
  const issues = scan?.issues

  // Restore the user's group/sort preference once settings arrive.
  useEffect(() => {
    if (!settings || restored.current) return
    restored.current = true
    setGroup(settings.groupMode)
    setSort(settings.sortMode)
  }, [settings])

  // Restore the previously inspected mod after the first scan.
  const restoredMod = useRef(false)
  useEffect(() => {
    if (restoredMod.current || !settings?.lastModKey || byKey.size === 0) return
    restoredMod.current = true
    if (byKey.has(settings.lastModKey)) setSelectedKey(settings.lastModKey)
  }, [settings, byKey])

  const setFilters = useCallback((patch: Partial<ModFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }))
  }, [])

  const { rows, matched, indexByKey, categoryCounts } = useModRows({
    mods,
    sources,
    issues,
    filters,
    group,
    sort,
    collapsed
  })

  const duplicateKeys = useMemo(() => {
    const set = new Set<string>()
    for (const keys of Object.values(issues?.duplicateIds ?? {})) for (const k of keys) set.add(k)
    return set
  }, [issues])

  const missingKeys = useMemo(
    () => new Set(Object.keys(issues?.missingRequires ?? {})),
    [issues]
  )

  const knownIds = useMemo(() => {
    const set = new Set<string>()
    for (const m of mods) if (m.modId) set.add(m.modId)
    return set
  }, [mods])

  const buildCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of mods) for (const b of m.builds) map.set(b, (map.get(b) ?? 0) + 1)
    return map
  }, [mods])

  const sourceButtons = useMemo(
    () =>
      SOURCE_BUTTONS.map((b) => {
        const owned = sources.filter((s) => s.kind === b.kind && s.exists)
        return {
          ...b,
          label: t(b.labelKey),
          sources: owned,
          count: mods.reduce((acc, m) => (m.sourceKind === b.kind ? acc + 1 : acc), 0)
        }
      }),
    [sources, mods, t]
  )

  const issueCounts = useMemo(
    () => ({
      /** Distinct ids that are installed more than once. */
      duplicates: Object.keys(issues?.duplicateIds ?? {}).length,
      /** Mod folders involved in an id clash. */
      duplicateMods: duplicateKeys.size,
      missing: missingKeys.size,
      noinfo: issues?.missingInfo.length ?? 0,
      warnings: mods.reduce((acc, m) => (m.warnings.length ? acc + 1 : acc), 0)
    }),
    [duplicateKeys, missingKeys, issues, mods]
  )

  const selectedMod = selectedKey ? byKey.get(selectedKey) : undefined

  const selectMod = useCallback(
    (mod: ModEntry) => {
      setSelectedKey(mod.key)
      setSelectedNode(undefined)
      setTab('mod')
      void saveSettings({ lastModKey: mod.key })
    },
    [saveSettings]
  )

  const selectNode = useCallback((node: FsNode) => {
    setSelectedNode(node)
    setTab('file')
  }, [])

  const jumpToMod = useCallback(
    (key: string) => {
      const target = byKey.get(key)
      if (!target) return
      // Clear anything that could hide the target row.
      setFiltersState({
        query: '',
        sourceKinds: new Set(),
        categories: new Set(),
        builds: new Set(),
        issue: 'all'
      })
      setCollapsed(new Set())
      selectMod(target)
      notify(t('toast.jumpedTo', { name: target.name }), 'ok')
    },
    [byKey, selectMod, notify, t]
  )

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onGroup = useCallback(
    (g: GroupMode) => {
      setGroup(g)
      void saveSettings({ groupMode: g })
    },
    [saveSettings]
  )

  const onSort = useCallback(
    (s: SortMode) => {
      setSort(s)
      void saveSettings({ sortMode: s })
    },
    [saveSettings]
  )

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        void refresh(true)
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'Escape' && typing) {
        setFilters({ query: '' })
        ;(e.target as HTMLElement).blur()
        return
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e' && selectedMod) {
        e.preventDefault()
        void window.pz.shell.reveal(selectedNode?.path ?? selectedMod.path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh, setFilters, selectedMod, selectedNode])

  const dragLeft = useCallback((dx: number) => {
    setLeftW((w) => {
      const next = Math.min(Math.max(w + dx, 220), 560)
      localStorage.setItem(LS_LEFT, String(next))
      return next
    })
  }, [])

  const dragRight = useCallback((dx: number) => {
    setRightW((w) => {
      const next = Math.min(Math.max(w - dx, 280), 640)
      localStorage.setItem(LS_RIGHT, String(next))
      return next
    })
  }, [])

  return (
    <MenuProvider>
      <div className="stalker">
        <StalkerToolbar
          ref={searchRef}
          onExit={onExit}
          onRescan={() => void refresh(true)}
          scanning={scanning}
          filters={filters}
          setFilters={setFilters}
          sourceButtons={sourceButtons}
          categoryCounts={categoryCounts}
          issueCounts={issueCounts}
          buildCounts={buildCounts}
          group={group}
          sort={sort}
          onGroup={onGroup}
          onSort={onSort}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((v) => !v)}
        />

        <div className="stalker__body">
          <section className="pane pane--left" style={{ width: leftW, flex: `0 0 ${leftW}px` }}>
            <div className="pane__head">
              <Icon name="list" size={13} color="var(--rust)" />
              <span className="pane__title stencil">{t('pane.mods')}</span>
              <span className="pane__count mono">
                {formatCount(matched.length)}
                {matched.length !== mods.length && (
                  <span className="pane__count-total"> / {formatCount(mods.length)}</span>
                )}
              </span>
              <div className="pane__head-spacer" />
              <Hint title={t('pane.mods')} body={t('help.pane.mods')} />
              <button
                className="btn btn-icon"
                title={t('pane.collapseGroups')}
                onClick={() =>
                  setCollapsed(
                    new Set(rows.filter((r) => r.kind === 'group').map((r) => r.id))
                  )
                }
              >
                <Icon name="minus" size={13} />
              </button>
              <button
                className="btn btn-icon"
                title={t('pane.expandGroups')}
                onClick={() => setCollapsed(new Set())}
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <ModList
              rows={rows}
              selectedKey={selectedKey}
              duplicateKeys={duplicateKeys}
              missingKeys={missingKeys}
              indexByKey={indexByKey}
              onSelect={selectMod}
              onToggleGroup={toggleGroup}
            />
          </section>

          <Splitter onDrag={dragLeft} onDoubleClick={() => setLeftW(328)} />

          <section className="pane pane--center">
            <Skeleton
              mod={selectedMod}
              selectedPath={selectedNode?.path}
              onSelectNode={selectNode}
            />
          </section>

          <Splitter onDrag={dragRight} onDoubleClick={() => setRightW(396)} />

          <section className="pane pane--right" style={{ width: rightW, flex: `0 0 ${rightW}px` }}>
            <InfoPanel
              mod={selectedMod}
              node={selectedNode}
              tab={tab}
              onTab={setTab}
              allMods={mods}
              sources={sources}
              issues={issues}
              knownIds={knownIds}
              onJumpToMod={jumpToMod}
            />
          </section>
        </div>

        <StatusBar
          matched={matched.length}
          total={mods.length}
          sources={sources}
          issueCounts={issueCounts}
          durationMs={scan?.durationMs}
          fromCache={scan?.fromCache}
          selectedPath={selectedNode?.path ?? selectedMod?.path}
          t={t}
          p={p}
        />
      </div>
    </MenuProvider>
  )
}

function StatusBar({
  matched,
  total,
  sources,
  issueCounts,
  durationMs,
  fromCache,
  selectedPath,
  t,
  p
}: {
  matched: number
  total: number
  sources: ModSource[]
  issueCounts: {
    duplicates: number
    duplicateMods: number
    missing: number
    noinfo: number
    warnings: number
  }
  durationMs: number | undefined
  fromCache: number | undefined
  selectedPath: string | undefined
  t: I18n['t']
  p: I18n['p']
}) {
  const sourceCount = sources.filter((s) => s.exists).length
  return (
    <footer className="statusbar mono">
      <span>
        {formatCount(matched)} / {formatCount(total)} {p('mods', total)}
      </span>
      <span className="statusbar__sep">·</span>
      <span>
        {sourceCount} {p('sources', sourceCount)}
      </span>
      {issueCounts.duplicates > 0 && (
        <>
          <span className="statusbar__sep">·</span>
          <span className="is-bad">
            {issueCounts.duplicates} {p('duplicateIds', issueCounts.duplicates)} (
            {issueCounts.duplicateMods} {p('folders', issueCounts.duplicateMods)})
          </span>
        </>
      )}
      {issueCounts.missing > 0 && (
        <>
          <span className="statusbar__sep">·</span>
          <span className="is-warn">
            {issueCounts.missing} {p('brokenRequires', issueCounts.missing)}
          </span>
        </>
      )}
      {issueCounts.noinfo > 0 && (
        <>
          <span className="statusbar__sep">·</span>
          <span className="is-dim">{t('sb.withoutInfo', { n: issueCounts.noinfo })}</span>
        </>
      )}
      {durationMs !== undefined && (
        <>
          <span className="statusbar__sep">·</span>
          <span className="is-dim">
            {t('sb.scan', { d: formatDuration(durationMs) })}
            {fromCache ? ` ${t('sb.cached', { n: fromCache })}` : ''}
          </span>
        </>
      )}
      <div className="statusbar__spacer" />
      {selectedPath && <span className="statusbar__path">{shortenPath(selectedPath, 4)}</span>}
    </footer>
  )
}
