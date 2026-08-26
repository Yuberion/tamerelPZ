import { useMemo } from 'react'
import type { ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { fuzzyMatch, segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'

const ROW_H = 30

/** Something that can be appended to the active list. */
export interface Candidate {
  /** Token written into the config. */
  value: string
  /** Human label; falls back to the token when nothing resolves it. */
  label: string
  mod?: ModEntry
}

interface AvailablePanelProps {
  candidates: Candidate[]
  /** Keys of the entries already listed, as produced by the caller's `keyOf`. */
  used: Set<string>
  keyOf(value: string): string
  query: string
  onQuery(query: string): void
  onAdd(value: string): void
  onAddAll(values: string[]): void
  emptyLabel: string
  emptyHint: string
  disabled?: boolean
}

interface Row {
  candidate: Candidate
  /** Match positions inside the label, for `<mark>` highlighting. */
  indices: number[]
}

/**
 * Left pane: everything that could be added to the active list.
 *
 * Entries already present stay visible but greyed, rather than disappearing —
 * a list you are building is easier to reason about when the source pane does
 * not reshuffle under the cursor on every click.
 */
export function AvailablePanel({
  candidates,
  used,
  keyOf,
  query,
  onQuery,
  onAdd,
  onAddAll,
  emptyLabel,
  emptyHint,
  disabled
}: AvailablePanelProps) {
  const { t } = useI18n()

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim()
    if (!needle) return candidates.map((candidate) => ({ candidate, indices: [] }))
    const hits: Array<Row & { score: number }> = []
    for (const candidate of candidates) {
      // The label is what gets highlighted, so only its own match contributes
      // indices; a hit on the raw token still keeps the row, unhighlighted.
      const onLabel = fuzzyMatch(needle, candidate.label)
      const hit = onLabel ?? fuzzyMatch(needle, candidate.value)
      if (!hit) continue
      hits.push({ candidate, indices: onLabel?.indices ?? [], score: hit.score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits
  }, [candidates, query])

  const addable = useMemo(
    () => rows.map((r) => r.candidate.value).filter((v) => !used.has(keyOf(v))),
    [rows, used, keyOf]
  )

  const v = useVirtual(rows.length, ROW_H)

  return (
    <>
      <div className="wbsearch">
        <div className="minisearch">
          <Icon name="search" size={12} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('lo.searchPlaceholder')}
            spellCheck={false}
          />
          {query && (
            <button className="minisearch__clear" onClick={() => onQuery('')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <button
          className="btn btn--tiny"
          onClick={() => onAddAll(addable)}
          disabled={disabled || addable.length === 0}
          title={t('lo.addAllTitle')}
        >
          <Icon name="plus" size={11} />
          {t('lo.addAll', { n: addable.length })}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="pane__scroll">
          <div className="pane__empty">
            <Icon name="package" size={22} />
            <span className="label">{emptyLabel}</span>
            <span className="label wbmuted">{emptyHint}</span>
          </div>
        </div>
      ) : (
        <div className="pane__scroll" ref={v.ref}>
          <div style={{ height: v.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${v.offset}px)` }}>
              {rows.slice(v.start, v.end).map(({ candidate, indices }) => {
                const isUsed = used.has(keyOf(candidate.value))
                const src = candidate.mod ? SOURCE_META[candidate.mod.sourceKind] : undefined
                const segments = indices.length
                  ? segmentByIndices(candidate.label, indices)
                  : null
                return (
                  <button
                    key={`${candidate.value}:${candidate.mod?.key ?? ''}`}
                    className={`locand ${isUsed ? 'is-used' : ''}`}
                    style={{ height: ROW_H }}
                    disabled={disabled || isUsed}
                    onClick={() => onAdd(candidate.value)}
                    title={candidate.mod?.path ?? candidate.value}
                  >
                    <span
                      className="locand__src mono"
                      style={src ? { color: src.color } : undefined}
                      title={src ? t(src.labelKey) : undefined}
                    >
                      {src?.glyph ?? '·'}
                    </span>
                    <span className="locand__body">
                      <span className="locand__name truncate">
                        {segments
                          ? segments.map((s, i) =>
                              s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
                            )
                          : candidate.label}
                      </span>
                      <span className="locand__id mono truncate">{candidate.value}</span>
                    </span>
                    <Icon name={isUsed ? 'check' : 'plus'} size={12} className="locand__go" />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
