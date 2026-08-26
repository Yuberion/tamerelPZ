import { useEffect } from 'react'
import { Icon, type IconName } from '@renderer/components/Icon'
import type { TKey } from '@renderer/i18n'
import { segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'
import type { LogIncident, LogLevel } from './parseLog'

/** Fixed row height, so the virtualiser stays exact. */
const ROW_H = 26

export const LEVEL_ICON: Record<LogLevel, IconName> = {
  error: 'x-circle',
  warn: 'alert',
  info: 'info',
  debug: 'dots'
}

/** Level names live in the dictionary; a record keeps `t()` type-checked. */
export const LEVEL_KEY: Record<LogLevel, TKey> = {
  error: 'led.lvl.error',
  warn: 'led.lvl.warn',
  info: 'led.lvl.info',
  debug: 'led.lvl.debug'
}

/** One visible entry plus the search hit that let it through. */
export interface LogRow {
  incident: LogIncident
  /** Character positions to mark in the head, empty when the hit was in the body. */
  indices: number[]
}

export interface LogListProps {
  rows: LogRow[]
  selectedId: number | undefined
  onSelect: (id: number) => void
  emptyIcon: IconName
  emptyLabel: string
  emptyHint: string
}

/**
 * Virtualised list of log entries.
 *
 * A one-megabyte tail is tens of thousands of lines, so rows are windowed and the
 * height is fixed — a stack trace lives in the detail pane rather than expanding
 * inline, which would break the fixed-height assumption the virtualiser relies on.
 */
export function LogList({
  rows,
  selectedId,
  onSelect,
  emptyIcon,
  emptyLabel,
  emptyHint
}: LogListProps) {
  const v = useVirtual(rows.length, ROW_H)

  // Follow the selection when it is moved from outside the list (first-error
  // jump, keyboard stepping) rather than by a click on a visible row.
  useEffect(() => {
    if (selectedId === undefined) return
    const at = rows.findIndex((r) => r.incident.id === selectedId)
    if (at >= 0) v.scrollToIndex(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  if (rows.length === 0) {
    return (
      <div className="pane__scroll">
        <div className="pane__empty">
          <Icon name={emptyIcon} size={22} />
          <span className="label">{emptyLabel}</span>
          <span className="label wbmuted">{emptyHint}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pane__scroll" ref={v.ref}>
      <div style={{ height: v.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${v.offset}px)` }}>
          {rows.slice(v.start, v.end).map(({ incident, indices }) => (
            <LogRowView
              key={incident.id}
              incident={incident}
              indices={indices}
              selected={incident.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LogRowView({
  incident,
  indices,
  selected,
  onSelect
}: {
  incident: LogIncident
  indices: number[]
  selected: boolean
  onSelect: (id: number) => void
}) {
  const segments = indices.length ? segmentByIndices(incident.head, indices) : null
  return (
    <button
      className={`ledrow ledrow--${incident.level} ${selected ? 'is-selected' : ''}`}
      style={{ height: ROW_H }}
      onClick={() => onSelect(incident.id)}
      title={incident.origin ? `${incident.origin} > ${incident.head}` : incident.head}
    >
      <Icon name={LEVEL_ICON[incident.level]} size={11} className="ledrow__lvl" />
      <span className="ledrow__line mono">{incident.line}</span>
      <span className="ledrow__cat mono truncate">{incident.category ?? '·'}</span>
      <span className="ledrow__head truncate">
        {segments
          ? segments.map((s, i) =>
              s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
            )
          : incident.head}
      </span>
      {incident.body.length > 0 && (
        <span className="ledpill ledpill--stack mono">+{incident.body.length}</span>
      )}
      {incident.modName && (
        <span className="ledpill ledpill--mod truncate">{incident.modName}</span>
      )}
    </button>
  )
}
