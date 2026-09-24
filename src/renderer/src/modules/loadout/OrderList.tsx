import { useState } from 'react'
import type { MLOSCategory, ModEntry, OrderIssue } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText } from '@renderer/lib/format'
import { CATEGORY_META } from './mlos'

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
  disabled
}: OrderListProps) {
  const { t, lang } = useI18n()
  const { openMenu } = useMenu()
  const { notify } = useToast()
  const isRu = lang === 'ru'
  const [dragIndex, setDragIndex] = useState<number>()
  const [overIndex, setOverIndex] = useState<number>()

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

  const rowMenu = (e: React.MouseEvent, entry: OrderEntry): void => {
    const items: Parameters<typeof openMenu>[1] = []

    if (onEditRule) {
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
          const src = entry.mod ? SOURCE_META[entry.mod.sourceKind] : undefined
          const bad = resolve && entry.missing
          const catMeta = entry.category ? CATEGORY_META[entry.category] : undefined
          const issueCount = entry.issues?.length ?? 0

          return (
            <div
              key={`${entry.index}:${entry.value}`}
              className={[
                'lorow',
                selected === entry.index ? 'is-selected' : '',
                bad ? 'is-missing' : '',
                entry.duplicate ? 'is-duplicate' : '',
                issueCount > 0 ? 'is-warn-issue' : '',
                dragIndex === entry.index ? 'is-dragging' : '',
                overIndex === entry.index && dragIndex !== entry.index ? 'is-over' : ''
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
