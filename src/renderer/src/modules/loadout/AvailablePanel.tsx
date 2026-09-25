import { useMemo, useState } from 'react'
import type { MLOSCategory, ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { fuzzyMatch, segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'
import { CATEGORY_META, detectMlosCategory, RAW_CATEGORY_ORDER } from './mlos'

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
  onRemove?(value: string): void
  onAddAll(values: string[]): void
  onInspect?(value: string): void
  inspectedValue?: string
  emptyLabel: string
  emptyHint: string
  disabled?: boolean
  showCategoryFilters?: boolean
}

interface Row {
  candidate: Candidate
  category?: MLOSCategory
  indices: number[]
}

export function AvailablePanel({
  candidates,
  used,
  keyOf,
  query,
  onQuery,
  onAdd,
  onRemove,
  onAddAll,
  onInspect,
  inspectedValue,
  emptyLabel,
  emptyHint,
  disabled,
  showCategoryFilters
}: AvailablePanelProps) {
  const { t, lang } = useI18n()
  const isRu = lang === 'ru'
  const [selectedCat, setSelectedCat] = useState<MLOSCategory | 'all'>('all')

  const candidatesWithCat = useMemo(() => {
    return candidates.map((c) => ({
      candidate: c,
      category: c.mod ? detectMlosCategory(c.mod) : undefined
    }))
  }, [candidates])

  const filteredCandidates = useMemo(() => {
    if (selectedCat === 'all') return candidatesWithCat
    return candidatesWithCat.filter((c) => c.category === selectedCat)
  }, [candidatesWithCat, selectedCat])

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim()
    if (!needle) {
      return filteredCandidates.map(({ candidate, category }) => ({
        candidate,
        category,
        indices: []
      }))
    }
    const hits: Array<Row & { score: number }> = []
    for (const { candidate, category } of filteredCandidates) {
      const onLabel = fuzzyMatch(needle, candidate.label)
      const hit = onLabel ?? fuzzyMatch(needle, candidate.value)
      if (!hit) continue
      hits.push({ candidate, category, indices: onLabel?.indices ?? [], score: hit.score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits
  }, [filteredCandidates, query])

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

      {showCategoryFilters && (
        <div className="locat-filter-bar">
          <button
            className={`locat-chip ${selectedCat === 'all' ? 'is-active' : ''}`}
            onClick={() => setSelectedCat('all')}
          >
            {isRu ? 'Все' : 'All'}
          </button>
          {RAW_CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat]
            return (
              <button
                key={cat}
                className={`locat-chip ${selectedCat === cat ? 'is-active' : ''}`}
                style={
                  selectedCat === cat
                    ? { borderColor: meta.color, color: meta.color, background: meta.bg }
                    : undefined
                }
                onClick={() => setSelectedCat(cat)}
              >
                {isRu ? meta.labelRu : meta.labelEn}
              </button>
            )
          })}
        </div>
      )}

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
              {rows.slice(v.start, v.end).map(({ candidate, category, indices }) => {
                const isUsed = used.has(keyOf(candidate.value))
                const src = candidate.mod ? SOURCE_META[candidate.mod.sourceKind] : undefined
                const catMeta = category ? CATEGORY_META[category] : undefined
                const segments = indices.length
                  ? segmentByIndices(candidate.label, indices)
                  : null
                return (
                  <div
                    key={`${candidate.value}:${candidate.mod?.key ?? ''}`}
                    className={`locand ${isUsed ? 'is-used' : ''} ${inspectedValue === candidate.value ? 'is-active' : ''}`}
                    style={{ height: ROW_H }}
                    onClick={() => onInspect?.(candidate.value)}
                    onDoubleClick={() => {
                      if (disabled) return
                      if (isUsed) onRemove?.(candidate.value)
                      else onAdd(candidate.value)
                    }}
                    onMouseEnter={() => onInspect?.(candidate.value)}
                    title={candidate.mod?.path ?? candidate.value}
                  >
                    <button
                      type="button"
                      className={`locand__checkbox ${isUsed ? 'is-checked' : ''}`}
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isUsed) {
                          onRemove?.(candidate.value)
                        } else {
                          onInspect?.(candidate.value)
                          onAdd(candidate.value)
                        }
                      }}
                      title={
                        isUsed
                          ? (isRu ? 'Отключить мод (убрать из порядка)' : 'Disable mod')
                          : (isRu ? 'Включить мод (добавить в порядок)' : 'Enable mod')
                      }
                    >
                      {isUsed && <Icon name="check" size={11} />}
                    </button>

                    <span
                      className="locand__src mono"
                      style={src ? { color: src.color } : undefined}
                      title={src ? t(src.labelKey) : undefined}
                    >
                      {src?.glyph ?? '·'}
                    </span>
                    <span className="locand__body">
                      <span className="locand__name truncate">
                        {segments ? (
                          segments.map((s, i) =>
                            s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
                          )
                        ) : (
                          candidate.label
                        )}
                      </span>
                      {candidate.mod && (
                        <span className="locand__id mono truncate">{candidate.value}</span>
                      )}
                    </span>
                    {catMeta && (
                      <span
                        className="lomlos-badge"
                        style={{ color: catMeta.color, background: catMeta.bg }}
                        title={`MLOS: ${isRu ? catMeta.labelRu : catMeta.labelEn}`}
                      >
                        {isRu ? catMeta.labelRu : catMeta.labelEn}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`locand__go ${isUsed ? 'is-used' : ''}`}
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isUsed) onRemove?.(candidate.value)
                        else {
                          onInspect?.(candidate.value)
                          onAdd(candidate.value)
                        }
                      }}
                      title={isUsed ? (isRu ? 'Отключить' : 'Remove') : (isRu ? 'Добавить' : 'Add')}
                    >
                      <Icon name={isUsed ? 'close' : 'plus'} size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
