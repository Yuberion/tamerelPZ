import { useMemo, useState } from 'react'
import type { MLOSCategory, ModEntry, ModOverwritesSummary, OrderIssue } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText } from '@renderer/lib/format'
import { CATEGORY_META } from './mlos'
import { bareId } from './useLoadout'

export interface OrderEntry {
  value: string
  index: number
  mod?: ModEntry
  missing: boolean
  duplicate: boolean
  category?: MLOSCategory
  issues?: OrderIssue[]
  hasRule?: boolean
}

export function isSeparator(value: string): boolean {
  return value.startsWith('__SEP__:')
}

export function parseSeparator(value: string): { title: string; color: string } {
  const raw = value.slice(8)
  const parts = raw.split(':')
  return {
    title: parts[0] || 'CATEGORY',
    color: parts[1] || 'var(--edge-hot)'
  }
}

interface OrderListProps {
  entries: OrderEntry[]
  selected: number | undefined
  onSelect(index: number | undefined): void
  onMove(from: number, to: number): void
  onRemove(index: number): void
  onEditRule?(modId: string): void
  resolve: boolean
  emptyLabel: string
  emptyHint: string
  disabled?: boolean
  overwritesSummary?: ModOverwritesSummary
  pinnedIds?: Set<string>
  onTogglePin?(modId: string): void
}

export function OrderList({
  entries,
  selected,
  onSelect,
  onMove,
  onRemove,
  onEditRule,
  resolve,
  emptyLabel,
  emptyHint,
  disabled,
  overwritesSummary,
  pinnedIds,
  onTogglePin
}: OrderListProps) {
  const { t, lang } = useI18n()
  const { openMenu } = useMenu()
  const { notify } = useToast()
  const isRu = lang === 'ru'
  const [dragIndex, setDragIndex] = useState<number>()
  const [overIndex, setOverIndex] = useState<number>()
  const [collapsedSeps, setCollapsedSeps] = useState<Set<number>>(() => new Set())

  // Calculate group ranges and membership for separators
  const { sepCounts, itemToSep } = useMemo(() => {
    const counts = new Map<number, number>()
    const itemMap = new Map<number, number>()
    let currentSepIdx: number | undefined

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (isSeparator(e.value)) {
        currentSepIdx = i
        counts.set(i, 0)
      } else if (currentSepIdx !== undefined) {
        counts.set(currentSepIdx, (counts.get(currentSepIdx) ?? 0) + 1)
        itemMap.set(i, currentSepIdx)
      }
    }
    return { sepCounts: counts, itemToSep: itemMap }
  }, [entries])

  // Safe-Drop dependency bounds calculation for the dragged mod
  const safeDropInfo = useMemo(() => {
    if (dragIndex === undefined || dragIndex < 0 || dragIndex >= entries.length) return null
    const dragged = entries[dragIndex]
    if (!dragged?.mod || isSeparator(dragged.value)) return null

    const mod = dragged.mod
    const reqs = new Set(mod.requires.map((r) => bareId(r)))
    if (mod.loadAfter) {
      for (const a of mod.loadAfter) reqs.add(bareId(a))
    }

    let minSafeIndex = 0
    let minSafeReason = ''
    let maxSafeIndex = entries.length - 1
    let maxSafeReason = ''

    for (let i = 0; i < entries.length; i++) {
      if (i === dragIndex) continue
      const e = entries[i]
      if (!e.mod) continue
      const eBare = bareId(e.value)

      // If dragged mod requires e -> e must come BEFORE dragged mod (i < target)
      if (reqs.has(eBare)) {
        if (i >= minSafeIndex) {
          minSafeIndex = i + 1
          minSafeReason = e.mod.name || e.value
        }
      }

      // If e requires dragged mod -> e must come AFTER dragged mod (i > target)
      const eReqs = new Set(e.mod.requires.map((r) => bareId(r)))
      if (e.mod.loadAfter) {
        for (const a of e.mod.loadAfter) eReqs.add(bareId(a))
      }
      if (eReqs.has(bareId(dragged.value))) {
        if (i <= maxSafeIndex) {
          maxSafeIndex = i - 1
          maxSafeReason = e.mod.name || e.value
        }
      }
    }

    return { minSafeIndex, minSafeReason, maxSafeIndex, maxSafeReason }
  }, [dragIndex, entries])

  if (entries.length === 0) {
    return (
      <div className="pane__scroll">
        <div className="pane__empty">
          <Icon name="list" size={22} />
          <span className="label">{emptyLabel}</span>
          <span className="label wbmuted">{emptyHint}</span>
        </div>
      </div>
    )
  }

  const endDrag = (): void => {
    setDragIndex(undefined)
    setOverIndex(undefined)
  }

  const toggleSepCollapse = (sepIdx: number): void => {
    setCollapsedSeps((prev) => {
      const next = new Set(prev)
      if (next.has(sepIdx)) next.delete(sepIdx)
      else next.add(sepIdx)
      return next
    })
  }

  const rowMenu = (e: React.MouseEvent, entry: OrderEntry): void => {
    const items: Parameters<typeof openMenu>[1] = []

    if (!isSeparator(entry.value)) {
      const isPinned = pinnedIds?.has(bareId(entry.value)) ?? false
      items.push({
        label: isPinned
          ? (isRu ? 'Открепить позицию' : 'Unlock position')
          : (isRu ? 'Зафиксировать позицию (🔒 Lock)' : 'Lock position (🔒 Lock)'),
        icon: 'lock',
        onClick: () => onTogglePin?.(entry.value)
      })
      items.push({ separator: true })
    }

    if (!isSeparator(entry.value) && onEditRule) {
      items.push({
        label: isRu ? 'Правила сортировки (MLOS)...' : 'Edit Sorting Rules...',
        icon: 'wrench',
        onClick: () => onEditRule(entry.value)
      })
      items.push({ separator: true })
    }

    items.push(
      {
        label: t('lo.moveTop'),
        icon: 'arrow-up',
        disabled: disabled || entry.index === 0,
        onClick: () => onMove(entry.index, 0)
      },
      {
        label: t('lo.moveBottom'),
        icon: 'arrow-down',
        disabled: disabled || entry.index === entries.length - 1,
        onClick: () => onMove(entry.index, entries.length - 1)
      },
      { separator: true },
      {
        label: t('menu.reveal'),
        icon: 'external',
        disabled: !entry.mod,
        onClick: () => {
          if (entry.mod) void window.pz.shell.reveal(entry.mod.path)
        }
      },
      {
        label: t('menu.copyModId'),
        icon: 'hash',
        onClick: () => {
          void copyText(entry.value)
          notify(t('toast.modIdCopied'), 'ok')
        }
      },
      { separator: true },
      {
        label: t('lo.remove'),
        icon: 'trash',
        disabled,
        onClick: () => onRemove(entry.index)
      }
    )

    openMenu(e, items)
  }

  return (
    <div className="pane__scroll" onDragEnd={endDrag}>
      <div className="loorder">
        {entries.map((entry) => {
          const isSep = isSeparator(entry.value)
          const parentSep = itemToSep.get(entry.index)
          const isHiddenByCollapse = parentSep !== undefined && collapsedSeps.has(parentSep)

          if (isHiddenByCollapse) {
            return null
          }

          // Safe drop validation
          let dropStatus: 'none' | 'safe' | 'unsafe' = 'none'
          let dropReason = ''
          if (overIndex === entry.index && dragIndex !== undefined && dragIndex !== entry.index) {
            if (safeDropInfo) {
              if (overIndex < safeDropInfo.minSafeIndex) {
                dropStatus = 'unsafe'
                dropReason = isRu
                  ? `Требует загрузки ПОСЛЕ: ${safeDropInfo.minSafeReason}`
                  : `Must load AFTER: ${safeDropInfo.minSafeReason}`
              } else if (overIndex > safeDropInfo.maxSafeIndex) {
                dropStatus = 'unsafe'
                dropReason = isRu
                  ? `Требует загрузки ДО: ${safeDropInfo.maxSafeReason}`
                  : `Must load BEFORE: ${safeDropInfo.maxSafeReason}`
              } else {
                dropStatus = 'safe'
                dropReason = isRu ? 'Безопасная позиция' : 'Safe position'
              }
            } else {
              dropStatus = 'safe'
            }
          }

          // If entry is a separator row
          if (isSep) {
            const sep = parseSeparator(entry.value)
            const count = sepCounts.get(entry.index) ?? 0
            const isCollapsed = collapsedSeps.has(entry.index)

            return (
              <div
                key={`sep:${entry.index}:${entry.value}`}
                className={[
                  'lorow lorow--sep',
                  selected === entry.index ? 'is-selected' : '',
                  dragIndex === entry.index ? 'is-dragging' : '',
                  dropStatus === 'safe' ? 'is-safe-drop' : '',
                  dropStatus === 'unsafe' ? 'is-unsafe-drop' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={!disabled}
                onClick={() => onSelect(entry.index)}
                onContextMenu={(e) => rowMenu(e, entry)}
                onDragStart={(e) => {
                  setDragIndex(entry.index)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', entry.value)
                }}
                onDragOver={(e) => {
                  if (dragIndex === undefined) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverIndex(entry.index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== undefined && dragIndex !== entry.index) {
                    onMove(dragIndex, entry.index)
                  }
                  endDrag()
                }}
              >
                <button
                  className="lorow__collapse-btn"
                  title={isCollapsed ? (isRu ? 'Развернуть' : 'Expand') : (isRu ? 'Свернуть' : 'Collapse')}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSepCollapse(entry.index)
                  }}
                >
                  <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                </button>

                <div className="lorow__sep-bar" style={{ background: sep.color }} />

                <span className="lorow__sep-title stencil">{sep.title}</span>

                <span className="lopill lopill--sep-count" title={`${count} mods in group`}>
                  {count} {isRu ? 'мод.' : 'mods'}
                </span>

                <div className="toolbar__spacer" />

                {dropStatus !== 'none' && (
                  <span className={`lorow__drop-badge ${dropStatus === 'safe' ? 'is-safe' : 'is-unsafe'}`}>
                    <Icon name={dropStatus === 'safe' ? 'check' : 'alert'} size={10} />
                    {dropReason}
                  </span>
                )}

                <span className="lorow__actions">
                  <button
                    className="btn btn-icon"
                    title={t('lo.moveUp')}
                    disabled={disabled || entry.index === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      onMove(entry.index, entry.index - 1)
                    }}
                  >
                    <Icon name="arrow-up" size={11} />
                  </button>
                  <button
                    className="btn btn-icon"
                    title={t('lo.moveDown')}
                    disabled={disabled || entry.index === entries.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      onMove(entry.index, entry.index + 1)
                    }}
                  >
                    <Icon name="arrow-down" size={11} />
                  </button>
                  <button
                    className="btn btn-icon"
                    title={t('lo.remove')}
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(entry.index)
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </span>
              </div>
            )
          }

          // Standard Mod Entry
          const src = entry.mod ? SOURCE_META[entry.mod.sourceKind] : undefined
          const bad = resolve && entry.missing
          const catMeta = entry.category ? CATEGORY_META[entry.category] : undefined
          const issueCount = entry.issues?.length ?? 0

          // Overwrite stats (Point 7)
          const overwrites = overwritesSummary?.overwritesOthers[entry.value] ?? 0
          const overwritten = overwritesSummary?.overwrittenByOthers[entry.value] ?? 0
          const isPinned = !isSep && (pinnedIds?.has(bareId(entry.value)) ?? false)

          return (
            <div
              key={`${entry.index}:${entry.value}`}
              className={[
                'lorow',
                selected === entry.index ? 'is-selected' : '',
                bad ? 'is-missing' : '',
                entry.duplicate ? 'is-duplicate' : '',
                issueCount > 0 ? 'is-warn-issue' : '',
                isPinned ? 'is-pinned' : '',
                dragIndex === entry.index ? 'is-dragging' : '',
                dropStatus === 'safe' ? 'is-safe-drop' : '',
                dropStatus === 'unsafe' ? 'is-unsafe-drop' : '',
                overIndex === entry.index && dragIndex !== entry.index && dropStatus === 'none' ? 'is-over' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              draggable={!disabled}
              onClick={() => onSelect(entry.index)}
              onContextMenu={(e) => rowMenu(e, entry)}
              onDragStart={(e) => {
                setDragIndex(entry.index)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', entry.value)
              }}
              onDragOver={(e) => {
                if (dragIndex === undefined) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverIndex(entry.index)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== undefined && dragIndex !== entry.index) {
                  onMove(dragIndex, entry.index)
                }
                endDrag()
              }}
              title={
                entry.issues?.length
                  ? entry.issues.map((i) => `⚠ ${i.message}`).join('\n')
                  : entry.mod?.path ?? entry.value
              }
            >
              <span className="lorow__grip">
                <Icon name="dots" size={12} />
              </span>
              <span className="lorow__index mono">{entry.index + 1}</span>
              <button
                type="button"
                className={`lorow__pin-btn ${isPinned ? 'is-pinned' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin?.(entry.value)
                }}
                title={
                  isPinned
                    ? (isRu ? 'Позиция зафиксирована (кликните, чтобы снять замок)' : 'Position locked (click to unlock)')
                    : (isRu ? 'Зафиксировать позицию мода при сортировке MLOS' : 'Lock position during MLOS sort')
                }
              >
                <Icon name="lock" size={10} color={isPinned ? '#f59e0b' : undefined} />
              </button>
              {resolve && (
                <span
                  className="lorow__src mono"
                  style={src ? { color: src.color } : undefined}
                  title={src ? t(src.labelKey) : t('lo.statusMissing')}
                >
                  {src?.glyph ?? '·'}
                </span>
              )}
              <span className="lorow__body">
                <span className="lorow__name truncate">{entry.mod?.name ?? entry.value}</span>
                <span className="lorow__id mono truncate">{entry.value}</span>
              </span>

              {catMeta && (
                <span
                  className="lomlos-badge"
                  style={{ color: catMeta.color, background: catMeta.bg }}
                  title={`MLOS Category: ${isRu ? catMeta.labelRu : catMeta.labelEn}`}
                >
                  {isRu ? catMeta.labelRu : catMeta.labelEn}
                </span>
              )}

              {entry.hasRule && (
                <button
                  className="lorow__rule-btn"
                  title={isRu ? 'Правило MLOS активно (нажмите для редактирования)' : 'MLOS rule active'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditRule?.(entry.value)
                  }}
                >
                  <Icon name="wrench" size={11} color="var(--rust-hot)" />
                </button>
              )}

              {/* Overwrite badges (Point 7) */}
              {overwrites > 0 && (
                <span
                  className="lopill lopill--overwrite"
                  title={isRu ? `Переопределяет ${overwrites} файл(ов) из более ранних модов` : `Overwrites ${overwrites} file(s) from earlier mods`}
                >
                  +{overwrites}
                </span>
              )}
              {overwritten > 0 && (
                <span
                  className="lopill lopill--overwritten"
                  title={isRu ? `Перекрыто ${overwritten} файл(ов) более поздними модами` : `Overwritten in ${overwritten} file(s) by later mods`}
                >
                  -{overwritten}
                </span>
              )}

              {dropStatus !== 'none' && (
                <span className={`lorow__drop-badge ${dropStatus === 'safe' ? 'is-safe' : 'is-unsafe'}`}>
                  <Icon name={dropStatus === 'safe' ? 'check' : 'alert'} size={10} />
                  {dropReason}
                </span>
              )}

              {issueCount > 0 && (
                <span
                  className="lopill lopill--issue"
                  title={entry.issues?.map((i) => i.message).join('\n')}
                >
                  <Icon name="alert" size={9} />
                  {issueCount}
                </span>
              )}

              {entry.duplicate && (
                <span className="lopill lopill--dupe" title={t('lo.statusDuplicate')}>
                  {t('lo.badgeDuplicate')}
                </span>
              )}
              {bad && (
                <span className="lopill lopill--missing" title={t('lo.statusMissing')}>
                  {t('lo.badgeMissing')}
                </span>
              )}

              <span className="lorow__actions">
                {onEditRule && (
                  <button
                    className="btn btn-icon"
                    title={isRu ? 'Редактировать правила сортировки' : 'Edit sorting rules'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditRule(entry.value)
                    }}
                  >
                    <Icon name="wrench" size={11} />
                  </button>
                )}
                <button
                  className="btn btn-icon"
                  title={t('lo.moveUp')}
                  disabled={disabled || entry.index === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(entry.index, entry.index - 1)
                  }}
                >
                  <Icon name="arrow-up" size={11} />
                </button>
                <button
                  className="btn btn-icon"
                  title={t('lo.moveDown')}
                  disabled={disabled || entry.index === entries.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(entry.index, entry.index + 1)
                  }}
                >
                  <Icon name="arrow-down" size={11} />
                </button>
                <button
                  className="btn btn-icon"
                  title={t('lo.remove')}
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(entry.index)
                  }}
                >
                  <Icon name="trash" size={11} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
