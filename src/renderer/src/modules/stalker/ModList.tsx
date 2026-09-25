import { useCallback, useEffect } from 'react'
import type { ModEntry, UserModAnnotation } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { categoryMeta, primaryCategory, SOURCE_META } from '@renderer/lib/catmeta'
import { copyText, formatCount, segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'
import type { ModRow } from './useModRows'

const ROW_H = 27

interface ModListProps {
  rows: ModRow[]
  selectedKey: string | undefined
  duplicateKeys: Set<string>
  missingKeys: Set<string>
  indexByKey: Map<string, number>
  annotations?: Record<string, UserModAnnotation>
  onSelect: (mod: ModEntry) => void
  onToggleGroup: (id: string) => void
  onToggleFavorite?: (modKey: string) => void
}

export function ModList({
  rows,
  selectedKey,
  duplicateKeys,
  missingKeys,
  indexByKey,
  annotations,
  onSelect,
  onToggleGroup,
  onToggleFavorite
}: ModListProps) {
  const v = useVirtual(rows.length, ROW_H)
  const { openMenu } = useMenu()
  const { notify } = useToast()
  const { t } = useI18n()

  // Keep the selected mod on screen when the selection changes elsewhere.
  useEffect(() => {
    if (!selectedKey) return
    const idx = indexByKey.get(selectedKey)
    if (idx !== undefined) v.scrollToIndex(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const move = useCallback(
    (dir: 1 | -1) => {
      const modRows = rows
        .map((r, i) => ({ r, i }))
        .filter((x): x is { r: Extract<ModRow, { kind: 'mod' }>; i: number } => x.r.kind === 'mod')
      if (!modRows.length) return
      const current = modRows.findIndex((x) => x.r.mod.key === selectedKey)
      const nextIdx = current < 0 ? 0 : Math.min(Math.max(current + dir, 0), modRows.length - 1)
      const next = modRows[nextIdx]
      if (next) {
        onSelect(next.r.mod)
        v.scrollToIndex(next.i)
      }
    },
    [rows, selectedKey, onSelect, v]
  )

  return (
    <div
      className="pane__scroll"
      ref={v.ref}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      <div style={{ height: v.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${v.offset}px)` }}>
          {rows.slice(v.start, v.end).map((row) => {
            if (row.kind === 'group') {
              return (
                <button
                  key={row.id}
                  className="grouprow"
                  style={{ height: ROW_H }}
                  onClick={() => onToggleGroup(row.id)}
                >
                  <Icon name={row.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                  <Icon name={row.icon} size={13} color={row.color} />
                  <span className="grouprow__label stencil truncate">{row.label}</span>
                  <span className="grouprow__line" style={{ background: row.color }} />
                  <span className="grouprow__count mono">{formatCount(row.count)}</span>
                </button>
              )
            }

            const mod = row.mod
            const cat = categoryMeta(primaryCategory(mod))
            const src = SOURCE_META[mod.sourceKind]
            const isDup = duplicateKeys.has(mod.key)
            const isMissing = missingKeys.has(mod.key)
            const isFav = Boolean(annotations?.[mod.key]?.favorite)

            return (
              <div
                key={row.id}
                className={`modrow ${selectedKey === mod.key ? 'is-selected' : ''}`}
                style={{ height: ROW_H }}
                onClick={() => onSelect(mod)}
                onDoubleClick={() => void window.pz.shell.open(mod.path)}
                onContextMenu={(e) => {
                  onSelect(mod)
                  openMenu(e, [
                    {
                      label: isFav ? 'Убрать из избранного' : 'Добавить в избранное',
                      icon: 'star',
                      onClick: () => {
                        onToggleFavorite?.(mod.key)
                        notify(isFav ? 'Удалено из избранного' : 'Добавлено в избранное', 'ok')
                      }
                    },
                    { separator: true },
                    {
                      label: t('menu.openFolder'),
                      icon: 'folder-open',
                      onClick: () => void window.pz.shell.open(mod.path)
                    },
                    {
                      label: t('menu.reveal'),
                      icon: 'external',
                      onClick: () => void window.pz.shell.reveal(mod.path)
                    },
                    {
                      label: t('menu.openTerminal'),
                      icon: 'terminal',
                      onClick: () => void window.pz.shell.terminal(mod.path)
                    },
                    { separator: true },
                    {
                      label: t('menu.copyModId'),
                      icon: 'hash',
                      disabled: !mod.modId,
                      onClick: () => {
                        if (mod.modId) {
                          void copyText(mod.modId)
                          notify(t('toast.copiedValue', { value: mod.modId }), 'ok')
                        }
                      }
                    },
                    {
                      label: t('menu.copyPath'),
                      icon: 'copy',
                      onClick: () => {
                        void copyText(mod.path)
                        notify(t('toast.pathCopied'), 'ok')
                      }
                    },
                    { separator: true },
                    {
                      label: t('menu.openWorkshop'),
                      icon: 'link',
                      disabled: !mod.workshopId,
                      onClick: () =>
                        void window.pz.shell.external(
                          `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`
                        )
                    }
                  ])
                }}
                title={mod.path}
              >
                <span className="modrow__bar" style={{ background: cat.color }} />
                <Icon name={cat.icon} size={13} color={cat.color} className="modrow__icon" />
                <span className="modrow__name truncate">
                  {segmentByIndices(mod.name, row.indices).map((seg, i) =>
                    seg.hit ? (
                      <mark key={i}>{seg.text}</mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </span>
                {isFav && (
                  <span className="modrow__fav" title="В избранном">
                    ★
                  </span>
                )}
                {mod.builds.map((b) => (
                  <span key={b} className={`bbadge bbadge--${b.toLowerCase()}`}>
                    {b.replace('B', '')}
                  </span>
                ))}
                {/* Distinct glyphs so a drive full of duplicates does not drown
                    out the mods that are genuinely broken. */}
                {mod.warnings.length > 0 && (
                  <Icon name="alert" size={12} color="var(--blood)" title={t('glyph.warnings')} />
                )}
                {isMissing && (
                  <Icon name="link" size={12} color="var(--ember)" title={t('glyph.unresolved')} />
                )}
                {isDup && (
                  <Icon name="copy" size={11} color="var(--steel)" title={t('glyph.duplicate')} />
                )}
                <span
                  className="modrow__src"
                  style={{ color: src.color }}
                  title={t(src.labelKey)}
                >
                  {src.glyph}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {rows.length === 0 && (
        <div className="pane__empty">
          <Icon name="search" size={22} />
          <span className="label">{t('list.nothingMatches')}</span>
        </div>
      )}
    </div>
  )
}
