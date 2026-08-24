import { forwardRef } from 'react'
import type { GroupMode, ModCategory, ModSource, ModSourceKind, SortMode } from '@shared/types'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { CATEGORY_ORDER, categoryMeta } from '@renderer/lib/catmeta'
import { useI18n } from '@renderer/i18n'
import { formatCount } from '@renderer/lib/format'
import type { IssueFilter, ModFilters } from './useModRows'

interface SourceButton {
  kind: ModSourceKind
  label: string
  icon: 'folder' | 'download' | 'target' | 'wrench'
  count: number
  sources: ModSource[]
}

interface ToolbarProps {
  onExit: () => void
  onRescan: () => void
  scanning: boolean
  filters: ModFilters
  setFilters: (patch: Partial<ModFilters>) => void
  sourceButtons: SourceButton[]
  categoryCounts: Map<ModCategory, number>
  issueCounts: {
    duplicates: number
    duplicateMods: number
    missing: number
    noinfo: number
    warnings: number
  }
  buildCounts: Map<string, number>
  group: GroupMode
  sort: SortMode
  onGroup: (g: GroupMode) => void
  onSort: (s: SortMode) => void
  showFilters: boolean
  onToggleFilters: () => void
}

export const StalkerToolbar = forwardRef<HTMLInputElement, ToolbarProps>(function StalkerToolbar(
  {
    onExit,
    onRescan,
    scanning,
    filters,
    setFilters,
    sourceButtons,
    categoryCounts,
    issueCounts,
    buildCounts,
    group,
    sort,
    onGroup,
    onSort,
    showFilters,
    onToggleFilters
  },
  searchRef
) {
  const { openMenu } = useMenu()
  const { t } = useI18n()

  const toggleSource = (kind: ModSourceKind): void => {
    const next = new Set(filters.sourceKinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setFilters({ sourceKinds: next })
  }

  const toggleCategory = (cat: ModCategory): void => {
    const next = new Set(filters.categories)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setFilters({ categories: next })
  }

  const toggleBuild = (build: string): void => {
    const next = new Set(filters.builds)
    if (next.has(build)) next.delete(build)
    else next.add(build)
    setFilters({ builds: next })
  }

  const setIssue = (issue: IssueFilter): void => {
    setFilters({ issue: filters.issue === issue ? 'all' : issue })
  }

  const activeFilters =
    filters.categories.size + filters.builds.size + (filters.issue !== 'all' ? 1 : 0)

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
          <Icon name="arrow-left" size={13} />
          {t('tb.hub')}
        </button>

        <div className="divider-v" />

        <Hint title={t('ip.source')} body={t('help.tb.sources')} />

        <div className="srcgroup">
          {sourceButtons.map((b) => {
            const on = filters.sourceKinds.has(b.kind)
            const disabled = b.sources.length === 0
            return (
              <div key={b.kind} className={`srcbtn ${on ? 'is-active' : ''}`}>
                <button
                  className="srcbtn__main"
                  disabled={disabled}
                  onClick={() => toggleSource(b.kind)}
                  title={
                    disabled
                      ? t('tb.sourceMissing', { label: b.label })
                      : t(on ? 'tb.hideSource' : 'tb.showOnlySource', { label: b.label })
                  }
                >
                  <Icon name={b.icon} size={13} />
                  <span className="srcbtn__label stencil">{b.label}</span>
                  <span className="srcbtn__count mono">{formatCount(b.count)}</span>
                </button>
                <button
                  className="srcbtn__aux"
                  disabled={disabled}
                  title={t('tb.openContainer')}
                  onClick={(e) => {
                    if (b.sources.length === 1) {
                      void window.pz.shell.open(b.sources[0]!.path)
                      return
                    }
                    openMenu(
                      e,
                      b.sources.map((s) => ({
                        label: s.path,
                        icon: 'folder-open' as const,
                        onClick: () => void window.pz.shell.open(s.path)
                      }))
                    )
                  }}
                >
                  <Icon name="folder-open" size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="divider-v" />

        <button className="btn" onClick={onRescan} disabled={scanning} title={t('tb.rescanTitle')}>
          <Icon name="refresh" size={13} className={scanning ? 'spin' : undefined} />
          {scanning ? t('tb.scanning') : t('tb.rescan')}
        </button>
        <Hint title={t('tb.rescan')} body={t('help.tb.rescan')} />

        <div className="toolbar__spacer" />

        <div className="search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder={t('tb.searchPlaceholder')}
            spellCheck={false}
          />
          {filters.query && (
            <button className="search__clear" onClick={() => setFilters({ query: '' })}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <Hint title={t('tb.searchPlaceholder')} body={t('help.tb.search')} />

        <label className="pick">
          <span className="label">{t('tb.group')}</span>
          <select value={group} onChange={(e) => onGroup(e.target.value as GroupMode)}>
            <option value="type">{t('tb.groupType')}</option>
            <option value="source">{t('tb.groupSource')}</option>
            <option value="build">{t('tb.groupBuild')}</option>
            <option value="none">{t('tb.groupFlat')}</option>
          </select>
        </label>
        <Hint title={t('tb.group')} body={t('help.tb.group')} />

        <label className="pick">
          <span className="label">{t('tb.sort')}</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as SortMode)}>
            <option value="name">{t('tb.sortNameAsc')}</option>
            <option value="name-desc">{t('tb.sortNameDesc')}</option>
            <option value="type">{t('tb.sortType')}</option>
            <option value="recent">{t('tb.sortRecent')}</option>
            <option value="id">{t('tb.sortId')}</option>
            <option value="source">{t('tb.sortSource')}</option>
          </select>
        </label>
        <Hint title={t('tb.sort')} body={t('help.tb.sort')} />

        <button
          className={`btn btn-icon ${showFilters || activeFilters ? 'is-active' : ''}`}
          onClick={onToggleFilters}
          title={t('tb.filters')}
        >
          <Icon name="filter" size={13} />
        </button>
        <Hint title={t('tb.filters')} body={t('help.tb.filters')} />
      </div>

      {showFilters && (
        <div className="toolbar__row toolbar__row--filters">
          <span className="label toolbar__legend">{t('tb.legendType')}</span>
          {CATEGORY_ORDER.filter((c) => (categoryCounts.get(c) ?? 0) > 0).map((c) => {
            const meta = categoryMeta(c)
            const on = filters.categories.has(c)
            return (
              <button
                key={c}
                className={`chip ${on ? 'is-on' : ''}`}
                style={on ? { borderColor: meta.color, color: '#e0d9cc' } : undefined}
                onClick={() => toggleCategory(c)}
              >
                <Icon name={meta.icon} size={11} color={meta.color} />
                {t(meta.labelKey)}
                <span className="chip__n mono">{categoryCounts.get(c)}</span>
              </button>
            )
          })}

          <div className="divider-v" />
          <span className="label toolbar__legend">{t('tb.legendBuild')}</span>
          {[...buildCounts.entries()]
            .sort()
            .map(([b, n]) => (
              <button
                key={b}
                className={`chip ${filters.builds.has(b) ? 'is-on' : ''}`}
                onClick={() => toggleBuild(b)}
              >
                {b}
                <span className="chip__n mono">{n}</span>
              </button>
            ))}

          <div className="divider-v" />
          <span className="label toolbar__legend">{t('tb.legendIssues')}</span>
          <button
            className={`chip ${filters.issue === 'duplicates' ? 'is-on' : ''}`}
            onClick={() => setIssue('duplicates')}
            disabled={!issueCounts.duplicates}
          >
            <Icon name="alert" size={11} color="var(--blood)" />
            {t('tb.duplicateIds')}
            <span className="chip__n mono">{issueCounts.duplicates}</span>
          </button>
          <button
            className={`chip ${filters.issue === 'missing' ? 'is-on' : ''}`}
            onClick={() => setIssue('missing')}
            disabled={!issueCounts.missing}
          >
            <Icon name="link" size={11} color="var(--ember)" />
            {t('tb.brokenRequires')}
            <span className="chip__n mono">{issueCounts.missing}</span>
          </button>
          <button
            className={`chip ${filters.issue === 'noinfo' ? 'is-on' : ''}`}
            onClick={() => setIssue('noinfo')}
            disabled={!issueCounts.noinfo}
          >
            <Icon name="info" size={11} />
            {t('tb.noModInfo')}
            <span className="chip__n mono">{issueCounts.noinfo}</span>
          </button>

          {activeFilters > 0 && (
            <>
              <div className="toolbar__spacer" />
              <button
                className="btn"
                onClick={() =>
                  setFilters({ categories: new Set(), builds: new Set(), issue: 'all' })
                }
              >
                <Icon name="close" size={12} />
                {t('tb.clear', { n: activeFilters })}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})
