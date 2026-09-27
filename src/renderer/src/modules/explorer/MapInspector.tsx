import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'

export interface MapData {
  name: string
  title?: string
  lots?: string
  description?: string
  cells: string[]
}

interface MapInspectorProps {
  mapData?: MapData
  filePath?: string
}

export function MapInspector({ mapData: initialMapData, filePath }: MapInspectorProps) {
  const [loadedData, setLoadedData] = useState<MapData | null>(null)

  useEffect(() => {
    if (!filePath || initialMapData) return
    let cancelled = false
    void window.pz.fs.preview(filePath).then((preview) => {
      if (cancelled) return
      if (preview.kind === 'text' && preview.text) {
        const text = preview.text
        const titleMatch = text.match(/^\s*title\s*=\s*(.+)$/im)
        const descMatch = text.match(/^\s*description\s*=\s*(.+)$/im)
        const lotsMatch = text.match(/^\s*lots\s*=\s*(.+)$/im)
        const name = filePath.split(/[/\\]/).slice(-2)[0] || 'Map'
        
        // Find cell patterns like 30_40 or 10500_10200
        const cellMatches = Array.from(text.matchAll(/\b(\d{1,3})_(\d{1,3})\b/g)).map(
          (m) => `${m[1]}_${m[2]}`
        )
        const uniqueCells = Array.from(new Set(cellMatches))

        setLoadedData({
          name,
          title: titleMatch ? titleMatch[1].trim() : undefined,
          description: descMatch ? descMatch[1].trim() : undefined,
          lots: lotsMatch ? lotsMatch[1].trim() : undefined,
          cells: uniqueCells
        })
      }
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [filePath, initialMapData])

  const mapData = initialMapData || loadedData || {
    name: filePath ? filePath.split(/[/\\]/).pop() || 'Map' : 'Map',
    cells: []
  }

  const { parsedCells, minX, maxX, minY, maxY } = useMemo(() => {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    const parsedCells: Array<{ x: number; y: number }> = []

    for (const c of mapData.cells) {
      const parts = c.split('_')
      if (parts.length >= 2) {
        const x = parseInt(parts[0], 10)
        const y = parseInt(parts[1], 10)
        if (!isNaN(x) && !isNaN(y)) {
          parsedCells.push({ x, y })
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    return { parsedCells, minX, maxX, minY, maxY }
  }, [mapData.cells])

  const hasCoords = isFinite(minX) && isFinite(maxX)

  return (
    <div className="map-inspector">
      <div className="map-card">
        <div className="map-card__head">
          <span className="map-card__title">
            <Icon name="map" size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {mapData.title || mapData.name}
          </span>
          <span className="map-card__cells-badge mono">
            {mapData.cells.length} {mapData.cells.length === 1 ? 'ячейка' : 'ячеек'}
          </span>
        </div>

        {mapData.description && (
          <div className="label is-dim" style={{ marginBottom: 8, fontSize: '11px' }}>
            {mapData.description}
          </div>
        )}

        <div className="wbgrid" style={{ marginBottom: 8 }}>
          <div>
            <span className="label is-dim">Папка карты:</span>
            <div className="mono" style={{ fontSize: '11px', color: '#67e8f9' }}>
              {mapData.name}
            </div>
          </div>
          {mapData.lots && (
            <div>
              <span className="label is-dim">Lots (уровни):</span>
              <div className="mono" style={{ fontSize: '11px' }}>{mapData.lots}</div>
            </div>
          )}
          {hasCoords && (
            <div>
              <span className="label is-dim">Координаты X:</span>
              <div className="mono" style={{ fontSize: '11px', color: 'var(--rust-hot)' }}>
                {minX} ... {maxX}
              </div>
            </div>
          )}
          {hasCoords && (
            <div>
              <span className="label is-dim">Координаты Y:</span>
              <div className="mono" style={{ fontSize: '11px', color: 'var(--rust-hot)' }}>
                {minY} ... {maxY}
              </div>
            </div>
          )}
        </div>

        {/* Knox County Schematic Grid Viewport */}
        {hasCoords && (
          <div style={{ marginTop: 10 }}>
            <span className="label is-dim" style={{ display: 'block', marginBottom: 4 }}>
              Схематичное расположение ячеек (Knox Grid):
            </span>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 180,
                background: '#090d14',
                border: '1px solid var(--border, #202630)',
                borderRadius: 4,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/* Mini Knox Coordinate Grid */}
              <svg width="100%" height="100%" viewBox="0 0 60 50" style={{ background: '#070a0f' }}>
                {/* Background grid lines */}
                {Array.from({ length: 11 }).map((_, i) => (
                  <line
                    key={`gx_${i}`}
                    x1={i * 6}
                    y1={0}
                    x2={i * 6}
                    y2={50}
                    stroke="#151c28"
                    strokeWidth="0.3"
                  />
                ))}
                {Array.from({ length: 9 }).map((_, i) => (
                  <line
                    key={`gy_${i}`}
                    x1={0}
                    y1={i * 6}
                    x2={60}
                    y2={i * 6}
                    stroke="#151c28"
                    strokeWidth="0.3"
                  />
                ))}

                {/* Render cell rectangles */}
                {parsedCells.map((c) => (
                  <rect
                    key={`${c.x}_${c.y}`}
                    x={c.x}
                    y={c.y}
                    width={1}
                    height={1}
                    fill="var(--rust-hot, #f97316)"
                    stroke="#fdba74"
                    strokeWidth="0.1"
                  >
                    <title>{`Cell ${c.x}_${c.y}`}</title>
                  </rect>
                ))}
              </svg>
            </div>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <span className="label is-dim">Список ячеек ({mapData.cells.length}):</span>
          <div className="map-card__cells-list">
            {mapData.cells.map((c) => (
              <span key={c} className="map-card__cell-tag mono">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
