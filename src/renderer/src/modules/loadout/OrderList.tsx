import { useState } from 'react'
import type { ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText } from '@renderer/lib/format'

/**
 * One line of a load order, already resolved against the scan.
 *
 * The raw token is the authority — it is what the game reads, and it is written
 * back verbatim. Everything else here is decoration used to explain the token:
 * whether a mod with that id is actually installed, and whether an earlier line
 * already claimed it.
 */
export interface OrderEntry {
  /** Token exactly as it appears in the config. */
  value: string
  index: number
  /** Installed mod this token resolves to, when there is one. */
  mod?: ModEntry
  /** Nothing on this machine answers to this token. */
  missing: boolean
  /** An earlier line in the same list holds the same token. */
  duplicate: boolean
}

interface OrderListProps {
  entries: OrderEntry[]
  selected: number | undefined
  onSelect(index: number | undefined): void
  /** Move the entry at `from` so it lands at `to`. */
  onMove(from: number, to: number): void
  onRemove(index: number): void
  /** Resolution is only meaningful for lists that can be matched to a scan. */
  resolve: boolean
  emptyLabel: string
  emptyHint: string
  disabled?: boolean
}

/**
 * Reorderable list of config entries.
 *
 * Deliberately not virtualised, unlike the mod panes: HTML5 drag and drop needs
 * the source and target rows to exist in the DOM at the same time, and a load
 * order is bounded by what one person actually plays with — a few hundred lines
 * at the very worst, not the 10k file rows the skeleton tree has to survive.
 */
export function OrderList({
  entries,
  selected,
  onSelect,
  onMove,
  onRemove,
  resolve,
  emptyLabel,
  emptyHint,
  disabled
}: OrderListProps) {
  const { t } = useI18n()
  const { openMenu } = useMenu()
  const { notify } = useToast()
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
    openMenu(e, [
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
    ])
  }

  return (
    <div className="pane__scroll" onDragEnd={endDrag}>
      <div className="loorder">
        {entries.map((entry) => {
          const src = entry.mod ? SOURCE_META[entry.mod.sourceKind] : undefined
          const bad = resolve && entry.missing
          return (
            <div
              key={`${entry.index}:${entry.value}`}
              className={[
                'lorow',
                selected === entry.index ? 'is-selected' : '',
                bad ? 'is-missing' : '',
                entry.duplicate ? 'is-duplicate' : '',
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
                // Chromium refuses to start a drag without payload.
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
              title={entry.mod?.path ?? entry.value}
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
                {entry.mod && <span className="lorow__id mono truncate">{entry.value}</span>}
              </span>
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
