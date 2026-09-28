import { useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { categoryMeta } from '@renderer/lib/catmeta'
import { copyText } from '@renderer/lib/format'
import { pzFileUrl } from '@shared/ipc'
import type { ModCategory, ModEntry } from '@shared/types'
import type { LogIncident, ModAttribution } from './parseLog'

export interface ModIssuesModalProps {
  open: boolean
  onClose: () => void
  modAttributions: ModAttribution[]
  incidents: LogIncident[]
  scannedMods: ModEntry[]
  onSelectMod: (modName: string) => void
  coreCount?: number
}

export interface EnrichedModIssue {
  modName: string
  modId?: string
  modKey?: string
  modPath?: string
  errors: number
  warnings: number
  total: number
  categories: ModCategory[]
  workshopId?: string
  sourceKind?: string
  posterPath?: string
  iconPath?: string
  incidents: LogIncident[]
}

const CATEGORY_COLORS: Record<ModCategory, { bg: string; border: string; text: string; glow: string }> = {
  map: { bg: 'rgba(16, 185, 129, 0.16)', border: 'rgba(16, 185, 129, 0.5)', text: '#34d399', glow: 'rgba(16, 185, 129, 0.25)' },
  vehicle: { bg: 'rgba(14, 165, 233, 0.16)', border: 'rgba(14, 165, 233, 0.5)', text: '#38bdf8', glow: 'rgba(14, 165, 233, 0.25)' },
  weapon: { bg: 'rgba(239, 68, 68, 0.16)', border: 'rgba(239, 68, 68, 0.5)', text: '#f87171', glow: 'rgba(239, 68, 68, 0.25)' },
  clothing: { bg: 'rgba(168, 85, 247, 0.16)', border: 'rgba(168, 85, 247, 0.5)', text: '#c084fc', glow: 'rgba(168, 85, 247, 0.25)' },
  item: { bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.5)', text: '#fbbf24', glow: 'rgba(245, 158, 11, 0.25)' },
  build: { bg: 'rgba(249, 115, 22, 0.16)', border: 'rgba(249, 115, 22, 0.5)', text: '#fb923c', glow: 'rgba(249, 115, 22, 0.25)' },
  translation: { bg: 'rgba(59, 130, 246, 0.16)', border: 'rgba(59, 130, 246, 0.5)', text: '#60a5fa', glow: 'rgba(59, 130, 246, 0.25)' },
  library: { bg: 'rgba(20, 184, 166, 0.16)', border: 'rgba(20, 184, 166, 0.5)', text: '#2dd4bf', glow: 'rgba(20, 184, 166, 0.25)' },
  ui: { bg: 'rgba(217, 70, 239, 0.16)', border: 'rgba(217, 70, 239, 0.5)', text: '#e879f9', glow: 'rgba(217, 70, 239, 0.25)' },
  texture: { bg: 'rgba(217, 119, 6, 0.16)', border: 'rgba(217, 119, 6, 0.5)', text: '#f59e0b', glow: 'rgba(217, 119, 6, 0.25)' },
  sound: { bg: 'rgba(132, 204, 22, 0.16)', border: 'rgba(132, 204, 22, 0.5)', text: '#a3e635', glow: 'rgba(132, 204, 22, 0.25)' },
  model: { bg: 'rgba(99, 102, 241, 0.16)', border: 'rgba(99, 102, 241, 0.5)', text: '#818cf8', glow: 'rgba(99, 102, 241, 0.25)' },
  balance: { bg: 'rgba(234, 179, 8, 0.16)', border: 'rgba(234, 179, 8, 0.5)', text: '#facc15', glow: 'rgba(234, 179, 8, 0.25)' },
  server: { bg: 'rgba(100, 116, 139, 0.16)', border: 'rgba(100, 116, 139, 0.5)', text: '#94a3b8', glow: 'rgba(100, 116, 139, 0.25)' },
  misc: { bg: 'rgba(148, 163, 184, 0.16)', border: 'rgba(148, 163, 184, 0.5)', text: '#cbd5e1', glow: 'rgba(148, 163, 184, 0.25)' }
}

export function ModIssuesModal({
  open,
  onClose,
  modAttributions,
  incidents,
  scannedMods,
  onSelectMod,
  coreCount = 0
}: ModIssuesModalProps) {
  const { t } = useI18n()
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'errors' | 'warnings'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'errors' | 'warnings' | 'name'>('errors')
  const [expandedMods, setExpandedMods] = useState<Set<string>>(() => new Set())
  const [copiedMod, setCopiedMod] = useState<string | null>(null)

  // Map each ModAttribution to its rich ModEntry details
  const enrichedMods = useMemo<EnrichedModIssue[]>(() => {
    return modAttributions.map((attr) => {
      // Find matching mod in library
      const matched =
        (attr.modKey && scannedMods.find((m) => m.key === attr.modKey)) ||
        (attr.modId && scannedMods.find((m) => m.modId && m.modId.toLowerCase() === attr.modId!.toLowerCase())) ||
        scannedMods.find((m) => m.name.toLowerCase() === attr.modName.toLowerCase()) ||
        scannedMods.find((m) => m.folderName.toLowerCase() === attr.modName.toLowerCase())

      const modIncidents = incidents.filter((i) => i.modName === attr.modName)

      return {
        modName: attr.modName,
        modId: attr.modId ?? matched?.modId,
        modKey: attr.modKey ?? matched?.key,
        modPath: attr.modPath ?? matched?.path,
        errors: attr.errors,
        warnings: attr.warnings,
        total: attr.errors + attr.warnings,
        categories: matched?.categories && matched.categories.length > 0 ? matched.categories : ['misc'],
        workshopId: matched?.workshopId,
        sourceKind: matched?.sourceKind,
        posterPath: matched?.posterPath,
        iconPath: matched?.iconPath,
        incidents: modIncidents
      }
    })
  }, [modAttributions, scannedMods, incidents])

  // Aggregate stats
  const stats = useMemo(() => {
    let modsWithErrors = 0
    let modsWithWarnings = 0
    let totalErrors = 0
    let totalWarnings = 0

    for (const m of enrichedMods) {
      if (m.errors > 0) modsWithErrors++
      if (m.warnings > 0) modsWithWarnings++
      totalErrors += m.errors
      totalWarnings += m.warnings
    }

    return {
      modsWithErrors,
      modsWithWarnings,
      totalErrors,
      totalWarnings,
      totalModIncidents: totalErrors + totalWarnings,
      totalMods: enrichedMods.length
    }
  }, [enrichedMods])

  // Collect distinct categories present among the problematic mods
  const availableCategories = useMemo(() => {
    const counts = new Map<ModCategory, number>()
    for (const m of enrichedMods) {
      for (const cat of m.categories) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [enrichedMods])

  // Filter and sort mods
  const filteredMods = useMemo(() => {
    const q = search.trim().toLowerCase()

    return enrichedMods
      .filter((m) => {
        // Severity filter
        if (severityFilter === 'errors' && m.errors === 0) return false
        if (severityFilter === 'warnings' && m.warnings === 0) return false

        // Category filter
        if (categoryFilter !== 'all' && !m.categories.includes(categoryFilter as ModCategory)) {
          return false
        }

        // Search text
        if (!q) return true
        const matchName = m.modName.toLowerCase().includes(q)
        const matchId = m.modId ? m.modId.toLowerCase().includes(q) : false
        const matchCategory = m.categories.some((c) => c.toLowerCase().includes(q))
        return matchName || matchId || matchCategory
      })
      .sort((a, b) => {
        if (sortBy === 'errors') {
          if (b.errors !== a.errors) return b.errors - a.errors
          return b.warnings - a.warnings
        }
        if (sortBy === 'warnings') {
          if (b.warnings !== a.warnings) return b.warnings - a.warnings
          return b.errors - a.errors
        }
        return a.modName.localeCompare(b.modName)
      })
  }, [enrichedMods, search, severityFilter, categoryFilter, sortBy])

  const toggleExpand = (modName: string) => {
    setExpandedMods((prev) => {
      const next = new Set(prev)
      if (next.has(modName)) next.delete(modName)
      else next.add(modName)
      return next
    })
  }

  const copyModSummary = async (mod: EnrichedModIssue) => {
    const lines: string[] = [
      `### ⚠️ ${mod.modName} (ID: ${mod.modId || 'N/A'})`,
      `**Categories**: ${mod.categories.join(', ')}`,
      `**Errors**: ${mod.errors} | **Warnings**: ${mod.warnings}`,
      ''
    ]

    if (mod.incidents.length > 0) {
      lines.push('**Incidents:**')
      for (const inc of mod.incidents.slice(0, 15)) {
        lines.push(`- [Line ${inc.line}] [${inc.level.toUpperCase()}] ${inc.origin ? `\`${inc.origin}\`: ` : ''}${inc.head}`)
      }
      if (mod.incidents.length > 15) {
        lines.push(`- ... and ${mod.incidents.length - 15} more incidents`)
      }
    }

    await copyText(lines.join('\n'))
    setCopiedMod(mod.modName)
    setTimeout(() => setCopiedMod(null), 1500)
    notify(t('led.copiedModReport'), 'ok')
  }

  const copyAllSummary = async () => {
    const lines: string[] = [
      '# 🚨 Project Zomboid — Mod Issues Overview',
      `**Total Mods with Issues**: ${enrichedMods.length}`,
      `**Mods with Errors**: ${stats.modsWithErrors}`,
      `**Mods with Warnings**: ${stats.modsWithWarnings}`,
      `**Total Mod Incidents**: ${stats.totalModIncidents}`,
      `**Core Engine Incidents**: ${coreCount}`,
      '',
      '---',
      ''
    ]

    for (const m of enrichedMods) {
      lines.push(`### ${m.modName}`)
      lines.push(`- **ID**: \`${m.modId ?? 'N/A'}\``)
      lines.push(`- **Categories**: ${m.categories.join(', ')}`)
      lines.push(`- **Errors**: ${m.errors}`)
      lines.push(`- **Warnings**: ${m.warnings}`)
      if (m.workshopId) lines.push(`- **Workshop**: https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}`)
      if (m.incidents.length > 0) {
        lines.push('  **Sample Issues:**')
        for (const inc of m.incidents.slice(0, 3)) {
          lines.push(`  - L${inc.line} [${inc.level.toUpperCase()}]: ${inc.head}`)
        }
      }
      lines.push('')
    }

    await copyText(lines.join('\n'))
    notify(t('led.copiedModReport'), 'ok')
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modissues-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {/* Header */}
        <div className="modal__head modissues-header">
          <div className="modissues-header__title-row">
            <span className="modissues-header__icon-glow">
              <Icon name="alert-circle" size={18} color="#ef4444" />
            </span>
            <div className="modissues-header__text">
              <h2 className="modal__title stencil modissues-header__title">
                {t('led.modIssuesTitle')}
              </h2>
              <span className="modissues-header__subtitle">
                {t('led.modIssuesSubtitle')}
              </span>
            </div>
          </div>
          <div className="toolbar__spacer" />
          <button className="btn btn-icon" onClick={onClose} title={t('led.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal__body modissues-body">
          {/* Top KPI Metrics Row */}
          <div className="modissues-kpi-grid">
            <div className="modissues-kpi modissues-kpi--error">
              <div className="modissues-kpi__icon">
                <Icon name="x-circle" size={16} />
              </div>
              <div className="modissues-kpi__content">
                <span className="modissues-kpi__val mono">{stats.modsWithErrors}</span>
                <span className="modissues-kpi__lbl">{t('led.modsWithErrors')}</span>
              </div>
            </div>

            <div className="modissues-kpi modissues-kpi--warn">
              <div className="modissues-kpi__icon">
                <Icon name="alert" size={16} />
              </div>
              <div className="modissues-kpi__content">
                <span className="modissues-kpi__val mono">{stats.modsWithWarnings}</span>
                <span className="modissues-kpi__lbl">{t('led.modsWithWarnings')}</span>
              </div>
            </div>

            <div className="modissues-kpi modissues-kpi--incidents">
              <div className="modissues-kpi__icon">
                <Icon name="timeline" size={16} />
              </div>
              <div className="modissues-kpi__content">
                <span className="modissues-kpi__val mono">{stats.totalModIncidents}</span>
                <span className="modissues-kpi__lbl">{t('led.totalModIncidents')}</span>
              </div>
            </div>

            <div className="modissues-kpi modissues-kpi--core">
              <div className="modissues-kpi__icon">
                <Icon name="server" size={16} />
              </div>
              <div className="modissues-kpi__content">
                <span className="modissues-kpi__val mono">{coreCount}</span>
                <span className="modissues-kpi__lbl">{t('led.coreEngineIncidents')}</span>
              </div>
            </div>
          </div>

          {/* Controls Bar: Search, Severity, Category Pills, Sort */}
          <div className="modissues-toolbar">
            {/* Search */}
            <div className="modissues-search">
              <Icon name="search" size={13} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('led.searchModsPlaceholder')}
                autoFocus
              />
              {search && (
                <button
                  className="btn btn-icon btn--tiny"
                  onClick={() => setSearch('')}
                  title="Clear search"
                >
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>

            {/* Severity toggles */}
            <div className="modissues-seg">
              <button
                className={`modissues-seg__btn ${severityFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setSeverityFilter('all')}
              >
                {t('led.filterAll')} ({stats.totalMods})
              </button>
              <button
                className={`modissues-seg__btn modissues-seg__btn--err ${severityFilter === 'errors' ? 'is-active' : ''}`}
                onClick={() => setSeverityFilter('errors')}
              >
                <Icon name="x-circle" size={11} />
                {t('led.filterErrorsOnly')} ({stats.modsWithErrors})
              </button>
              <button
                className={`modissues-seg__btn modissues-seg__btn--warn ${severityFilter === 'warnings' ? 'is-active' : ''}`}
                onClick={() => setSeverityFilter('warnings')}
              >
                <Icon name="alert" size={11} />
                {t('led.filterWarningsOnly')} ({stats.modsWithWarnings})
              </button>
            </div>

            <div className="toolbar__spacer" />

            {/* Sorting */}
            <div className="modissues-sort">
              <Icon name="sort" size={12} />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="modissues-sort__select"
              >
                <option value="errors">{t('led.sortByErrors')}</option>
                <option value="warnings">{t('led.sortByWarnings')}</option>
                <option value="name">{t('led.sortByName')}</option>
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          {availableCategories.length > 0 && (
            <div className="modissues-cats-bar">
              <button
                className={`modissues-cat-pill ${categoryFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setCategoryFilter('all')}
              >
                <Icon name="grid" size={11} />
                {t('led.allCategories')}
                <span className="modissues-cat-pill__count mono">{stats.totalMods}</span>
              </button>

              {availableCategories.map(([cat, count]) => {
                const meta = categoryMeta(cat)
                const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.misc
                const isActive = categoryFilter === cat
                return (
                  <button
                    key={cat}
                    className={`modissues-cat-pill ${isActive ? 'is-active' : ''}`}
                    onClick={() => setCategoryFilter(isActive ? 'all' : cat)}
                    style={{
                      '--cat-bg': colors.bg,
                      '--cat-border': colors.border,
                      '--cat-text': colors.text,
                      '--cat-glow': colors.glow
                    } as any}
                  >
                    <Icon name={meta.icon} size={11} color={colors.text} />
                    <span>{t(meta.labelKey)}</span>
                    <span className="modissues-cat-pill__count mono">{count}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Mod Cards List */}
          <div className="modissues-list">
            {enrichedMods.length === 0 ? (
              <div className="modissues-empty modissues-empty--clean">
                <div className="modissues-empty__icon">
                  <Icon name="check-circle" size={32} color="#10b981" />
                </div>
                <h3>{t('led.noIssuesFound')}</h3>
                <p>{t('led.noIssuesFoundDesc')}</p>
              </div>
            ) : filteredMods.length === 0 ? (
              <div className="modissues-empty">
                <Icon name="search" size={28} />
                <h3>{t('led.noIssuesMatch')}</h3>
                <p>{t('led.noIssuesMatchDesc')}</p>
              </div>
            ) : (
              filteredMods.map((mod) => {
                const isExpanded = expandedMods.has(mod.modName)
                const artwork = mod.posterPath ?? mod.iconPath
                const hasErrors = mod.errors > 0
                const hasWarnings = mod.warnings > 0

                return (
                  <div
                    key={mod.modName}
                    className={`modissues-card ${hasErrors ? 'modissues-card--has-error' : 'modissues-card--has-warn'}`}
                  >
                    {/* Card Top Row */}
                    <div className="modissues-card__main">
                      {/* Thumbnail or Category placeholder */}
                      <div className="modissues-card__poster">
                        {artwork ? (
                          <img
                            src={pzFileUrl(artwork)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                          />
                        ) : (
                          <div
                            className="modissues-card__poster-fallback"
                            style={{
                              background: CATEGORY_COLORS[mod.categories[0] ?? 'misc'].bg,
                              borderColor: CATEGORY_COLORS[mod.categories[0] ?? 'misc'].border
                            }}
                          >
                            <Icon
                              name={categoryMeta(mod.categories[0] ?? 'misc').icon}
                              size={22}
                              color={CATEGORY_COLORS[mod.categories[0] ?? 'misc'].text}
                            />
                          </div>
                        )}
                      </div>

                      {/* Mod Metadata */}
                      <div className="modissues-card__info">
                        <div className="modissues-card__title-row">
                          <h4 className="modissues-card__name" title={mod.modName}>
                            {mod.modName}
                          </h4>

                          {/* Source Kind Badge */}
                          {mod.sourceKind && (
                            <span className="modissues-badge modissues-badge--source">
                              {mod.sourceKind === 'workshop' ? 'Steam' : mod.sourceKind}
                            </span>
                          )}

                          {/* Workshop Link if applicable */}
                          {mod.workshopId && (
                            <a
                              href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="modissues-badge modissues-badge--workshop"
                              title={`Workshop ID: ${mod.workshopId}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (window.pz?.shell?.external) {
                                  e.preventDefault()
                                  void window.pz.shell.external(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)
                                }
                              }}
                            >
                              <Icon name="external" size={10} />
                              <span>{mod.workshopId}</span>
                            </a>
                          )}
                        </div>

                        {/* Mod ID & Path subline */}
                        <div className="modissues-card__sub">
                          <span className="modissues-card__id mono" title={mod.modId || t('led.noId')}>
                            ID: {mod.modId || <span className="is-dim">{t('led.noId')}</span>}
                          </span>
                          {mod.modId && (
                            <button
                              className="btn btn-icon btn--tiny modissues-copy-id-btn"
                              onClick={() => {
                                void copyText(mod.modId!)
                                notify(`Mod ID "${mod.modId}" copied`, 'ok')
                              }}
                              title="Copy Mod ID"
                            >
                              <Icon name="copy" size={10} />
                            </button>
                          )}
                        </div>

                        {/* Categories Row (Vibrant & Color-coded) */}
                        <div className="modissues-card__cats">
                          {mod.categories.map((cat) => {
                            const meta = categoryMeta(cat)
                            const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.misc
                            return (
                              <span
                                key={cat}
                                className="modissues-cat-tag"
                                style={{
                                  backgroundColor: colors.bg,
                                  borderColor: colors.border,
                                  color: colors.text,
                                  boxShadow: `0 0 8px ${colors.glow}`
                                }}
                              >
                                <Icon name={meta.icon} size={11} color={colors.text} />
                                <span>{t(meta.labelKey)}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>

                      {/* Error & Warning Pills */}
                      <div className="modissues-card__stats">
                        {hasErrors && (
                          <div className="modissues-counter modissues-counter--error">
                            <Icon name="x-circle" size={13} />
                            <span className="mono">{mod.errors}</span>
                            <span className="modissues-counter__lbl">
                              {t('led.errorsCount', { count: '' }).trim()}
                            </span>
                          </div>
                        )}
                        {hasWarnings && (
                          <div className="modissues-counter modissues-counter--warn">
                            <Icon name="alert" size={13} />
                            <span className="mono">{mod.warnings}</span>
                            <span className="modissues-counter__lbl">
                              {t('led.warningsCount', { count: '' }).trim()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Card Action Buttons */}
                      <div className="modissues-card__actions">
                        {/* Show In Log Filter */}
                        <button
                          className="btn btn--primary btn--tiny modissues-action-btn"
                          onClick={() => onSelectMod(mod.modName)}
                          title={t('led.showInLogTitle')}
                        >
                          <Icon name="filter" size={11} />
                          {t('led.showInLog')}
                        </button>

                        {/* Reveal Folder */}
                        {mod.modPath && (
                          <button
                            className="btn btn--tiny modissues-action-btn"
                            onClick={() => void window.pz.shell.reveal(mod.modPath!)}
                            title={t('led.revealModFolderTitle')}
                          >
                            <Icon name="folder-open" size={11} />
                            {t('led.revealModFolder')}
                          </button>
                        )}

                        {/* Copy Mod Report */}
                        <button
                          className="btn btn-icon btn--tiny"
                          onClick={() => void copyModSummary(mod)}
                          title={t('led.copyModReportTitle')}
                        >
                          <Icon name={copiedMod === mod.modName ? 'check' : 'copy'} size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Incidents Toggle Drawer */}
                    {mod.incidents.length > 0 && (
                      <div className="modissues-card__accordion">
                        <button
                          className="modissues-card__accordion-toggle"
                          onClick={() => toggleExpand(mod.modName)}
                        >
                          <Icon
                            name={isExpanded ? 'chevron-down' : 'chevron-right'}
                            size={12}
                          />
                          <span>
                            {isExpanded
                              ? t('led.collapseIncidents')
                              : t('led.expandIncidents', { count: mod.incidents.length })}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="modissues-card__incidents-box mono">
                            {mod.incidents.map((inc) => (
                              <div
                                key={inc.id}
                                className={`modissues-incident-item modissues-incident-item--${inc.level}`}
                              >
                                <span className="modissues-incident-item__line">
                                  #{inc.line}
                                </span>
                                <span className={`modissues-incident-item__level is-${inc.level}`}>
                                  {inc.level.toUpperCase()}
                                </span>
                                {inc.origin && (
                                  <span className="modissues-incident-item__origin">
                                    [{inc.origin}]
                                  </span>
                                )}
                                <span className="modissues-incident-item__head" title={inc.head}>
                                  {inc.head}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal__foot modissues-footer">
          <div className="modissues-footer__summary is-dim">
            <span>
              {filteredMods.length} / {enrichedMods.length} {t('led.filterAll').toLowerCase()}
            </span>
          </div>

          <div className="toolbar__spacer" />

          <button className="btn" onClick={() => void copyAllSummary()}>
            <Icon name="copy" size={12} />
            {t('led.copyAllSummary')}
          </button>

          <button className="btn btn--primary" onClick={onClose}>
            {t('led.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
