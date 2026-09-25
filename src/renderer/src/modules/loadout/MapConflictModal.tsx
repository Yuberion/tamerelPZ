import { useEffect, useState } from 'react'
import type { MapScanResult } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'

interface MapConflictModalProps {
  activeModIds: string[]
  currentMaps: string[]
  onApplyMapOrder(newMaps: string[]): void
  onClose(): void
}

export function MapConflictModal({
  activeModIds,
  currentMaps,
  onApplyMapOrder,
  onClose
}: MapConflictModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<MapScanResult>({ maps: [], conflicts: [] })
  const [orderedMapNames, setOrderedMapNames] = useState<string[]>(() => [...currentMaps])
  const [activeTab, setActiveTab] = useState<'conflicts' | 'maps'>('conflicts')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.pz.loadout
      .getMapCells(activeModIds)
      .then((res) => {
        if (cancelled) return
        setData(res)

        // Initialize orderedMapNames if empty or missing scanned maps
        const scannedNames = res.maps.map((m) => m.mapName)
        const combined = [...currentMaps]
        for (const name of scannedNames) {
          if (!combined.includes(name)) combined.push(name)
        }
        setOrderedMapNames(combined)
      })
      .catch((err) => {
        console.error('Failed to scan map cells:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeModIds, currentMaps])

  const moveMap = (from: number, to: number): void => {
    if (to < 0 || to >= orderedMapNames.length) return
    const next = [...orderedMapNames]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrderedMapNames(next)
  }

  const handleApply = (): void => {
    onApplyMapOrder(orderedMapNames)
    onClose()
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--map-conflict" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840 }}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon name="map" size={16} color="var(--blue-light, #38bdf8)" />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Инспектор коллизий карт (Cell Overlaps)' : 'Map Conflict & Cell Overlap Inspector'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__body" style={{ padding: '16px 20px', minHeight: '380px' }}>
          {loading ? (
            <div className="pane__empty">
              <Icon name="refresh" size={24} className="spin" />
              <span className="label">{isRu ? 'Сканирование чанков карт...' : 'Scanning map cell coordinates...'}</span>
            </div>
          ) : (
            <>
              {/* Summary Banner */}
              <div className="loval-summary" style={{ marginBottom: 14 }}>
                <div className={`loval-status ${data.conflicts.length > 0 ? 'is-warn' : 'is-ok'}`}>
                  <Icon name={data.conflicts.length > 0 ? 'alert' : 'check'} size={20} />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {data.conflicts.length > 0
                        ? isRu
                          ? `Обнаружено пересечений чанков: ${data.conflicts.length}`
                          : `Found ${data.conflicts.length} overlapping map cell(s)`
                        : isRu
                        ? 'Пересечений чанков между картами не обнаружено!'
                        : 'No overlapping map cells detected!'}
                    </div>
                    <div style={{ fontSize: '11px', opacity: 0.85, marginTop: 2 }}>
                      {isRu
                        ? `Обнаружено карт: ${data.maps.length}. При конфликте побеждает карта, стоящая ниже в порядке загрузки.`
                        : `Total maps: ${data.maps.length}. When overlapping, map loaded later in order overrides earlier ones.`}
                    </div>
                  </div>
                </div>

                <div className="loval-badges" style={{ marginTop: 8 }}>
                  <button
                    className={`btn btn-sm ${activeTab === 'conflicts' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('conflicts')}
                  >
                    {isRu ? `Конфликты чанков (${data.conflicts.length})` : `Cell Overlaps (${data.conflicts.length})`}
                  </button>
                  <button
                    className={`btn btn-sm ${activeTab === 'maps' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('maps')}
                  >
                    {isRu ? `Порядок загрузки карт (${orderedMapNames.length})` : `Map Order Priority (${orderedMapNames.length})`}
                  </button>
                </div>
              </div>

              {/* Tab 1: Conflicts table */}
              {activeTab === 'conflicts' && (
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {data.conflicts.length === 0 ? (
                    <div className="pane__empty" style={{ padding: '30px 0' }}>
                      <Icon name="check" size={28} color="var(--moss)" />
                      <span className="label" style={{ marginTop: 8 }}>
                        {isRu ? 'Все карты располагаются в разных координатах' : 'All map cells are completely separate'}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.conflicts.map((conf, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: '#161b22',
                            border: '1px solid #28313e',
                            borderRadius: '6px',
                            padding: '10px 12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span
                              className="mono"
                              style={{
                                background: '#3b2420',
                                color: '#fca5a5',
                                border: '1px solid #7f1d1d',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700
                              }}
                            >
                              Cell [{conf.cell.replace('_', ', ')}]
                            </span>
                            <span style={{ fontSize: '12px', color: 'var(--ash)' }}>
                              {isRu ? 'Конфликтуют моды:' : 'Conflicting maps:'}
                            </span>
                            <div className="toolbar__spacer" />
                            <span
                              style={{
                                fontSize: '11px',
                                color: '#86efac',
                                background: '#143823',
                                border: '1px solid #166534',
                                padding: '2px 8px',
                                borderRadius: '4px'
                              }}
                            >
                              {isRu ? `Побеждает: ${conf.winningMap}` : `Winner: ${conf.winningMap}`}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {conf.maps.map((m, mIdx) => {
                              const isWinner = m.mapName === conf.winningMap
                              return (
                                <div
                                  key={mIdx}
                                  style={{
                                    fontSize: '11.5px',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    background: isWinner ? '#164e2a' : '#1e2530',
                                    border: isWinner ? '1px solid #22c55e' : '1px solid #333f50',
                                    color: isWinner ? '#dcfce7' : 'var(--bone)'
                                  }}
                                >
                                  <strong>{m.title || m.mapName}</strong>
                                  <span className="mono" style={{ opacity: 0.65, marginLeft: 6, fontSize: '10px' }}>
                                    ({m.modId})
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Map Priority Reordering */}
              {activeTab === 'maps' && (
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  <div style={{ fontSize: '11px', color: 'var(--ash-faint)', marginBottom: 8 }}>
                    {isRu
                      ? 'В Project Zomboid карта в конце списка имеет наивысший приоритет и перекрывает совпадающие чанки.'
                      : 'In Project Zomboid, maps lower in the list have higher priority and override conflicting cells.'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {orderedMapNames.map((name, idx) => {
                      const info = data.maps.find((m) => m.mapName === name)
                      return (
                        <div
                          key={name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            background: '#161b22',
                            border: '1px solid #212936',
                            borderRadius: '4px'
                          }}
                        >
                          <span className="mono" style={{ fontSize: '11px', color: 'var(--ash-faint)', width: '22px' }}>
                            {idx + 1}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--bone)' }}>
                            {info?.title || name}
                          </span>
                          <span className="mono" style={{ fontSize: '10px', color: 'var(--ash-faint)' }}>
                            [{name}]
                          </span>
                          {info && (
                            <span className="lopill lopill--sep-count" style={{ marginLeft: 6 }}>
                              {info.cells.length} {isRu ? 'чанков' : 'cells'}
                            </span>
                          )}
                          <div className="toolbar__spacer" />
                          <button
                            className="btn btn-icon"
                            disabled={idx === 0}
                            onClick={() => moveMap(idx, idx - 1)}
                            title={isRu ? 'Выше' : 'Move Up'}
                          >
                            <Icon name="arrow-up" size={11} />
                          </button>
                          <button
                            className="btn btn-icon"
                            disabled={idx === orderedMapNames.length - 1}
                            onClick={() => moveMap(idx, idx + 1)}
                            title={isRu ? 'Ниже' : 'Move Down'}
                          >
                            <Icon name="arrow-down" size={11} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="lomodal__foot">
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
          <div className="toolbar__spacer" />
          <button className="btn is-primary" onClick={handleApply}>
            <Icon name="check" size={12} />
            {isRu ? 'Применить порядок карт' : 'Apply Map Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
