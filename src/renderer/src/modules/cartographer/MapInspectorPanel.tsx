import { useEffect, useState } from 'react'
import type {
  CartographerCellConflict,
  CartographerMapItem,
  CartographerUrbanZone
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'

interface MapInspectorPanelProps {
  selectedCell: { x: number; y: number } | null
  selectedZone: CartographerUrbanZone | null
  selectedCellsGroup: Set<string>
  selectedMap: CartographerMapItem | null
  vanillaMaps: CartographerMapItem[]
  modMaps: CartographerMapItem[]
  conflicts: CartographerCellConflict[]
  mapColors: Map<string, string>
  isRu: boolean
  onSelectMap: (map: CartographerMapItem) => void
  onFocusBounds: (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => void
  onFocusCell: (x: number, y: number) => void
  onRequestScaffold?: () => void
  onOpenSpawnEditor?: (map: CartographerMapItem) => void
  onSelectZone?: (zone: CartographerUrbanZone | null) => void
}

export function MapInspectorPanel({
  selectedCell,
  selectedZone,
  selectedCellsGroup,
  selectedMap,
  vanillaMaps,
  modMaps,
  conflicts,
  mapColors,
  isRu,
  onSelectMap,
  onFocusBounds,
  onFocusCell,
  onRequestScaffold,
  onOpenSpawnEditor,
  onSelectZone
}: MapInspectorPanelProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  // Find conflict for selected cell
  const cellKey = selectedCell ? `${selectedCell.x}_${selectedCell.y}` : ''
  const cellConflict = conflicts.find((c) => c.cell === cellKey)

  // Find all maps occupying this cell
  const cellOccupants = selectedCell
    ? [...vanillaMaps, ...modMaps].filter((m) => m.cells.includes(cellKey))
    : []

  // Load thumbnail for selected map if present
  useEffect(() => {
    if (!selectedMap?.thumbnailPath) {
      setThumbUrl(null)
      return
    }
    let cancelled = false
    window.pz.cartographer
      .getImage(selectedMap.thumbnailPath)
      .then((url) => {
        if (!cancelled && url) setThumbUrl(url)
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedMap?.thumbnailPath])

  return (
    <div className="carto-inspector">
      <div className="carto-inspector__head">
        <span className="carto-inspector__title">
          <Icon name="info" size={14} />
          <span>{isRu ? 'Инспектор сектора' : 'Sector Inspector'}</span>
        </span>
      </div>

      <div className="carto-inspector__content">
        {/* 1. Multi-cell Claimed Territory Banner */}
        {selectedCellsGroup.size > 0 && (
          <div className="carto-card carto-card--accent">
            <div className="carto-card__head">
              <div className="carto-card__title">
                <Icon name="map-pin" size={14} color="#06b6d4" />
                <span>{isRu ? 'Выделенная территория' : 'Selected Territory'}</span>
              </div>
            </div>

            <div className="carto-card__body">
              <div className="territory-stat-row">
                <span className="text-muted">{isRu ? 'Площадь:' : 'Area:'}</span>
                <span className="font-mono text-cyan">
                  {selectedCellsGroup.size} {isRu ? 'клеток' : 'cells'} (~
                  {(selectedCellsGroup.size * 300 * 300 / 10000).toFixed(1)} {isRu ? 'га' : 'ha'})
                </span>
              </div>
              <div className="territory-stat-row">
                <span className="text-muted">{isRu ? 'Тайлы:' : 'Tiles:'}</span>
                <span className="font-mono">
                  {selectedCellsGroup.size * 300} x {selectedCellsGroup.size * 300}
                </span>
              </div>

              {onRequestScaffold && (
                <button
                  type="button"
                  className="btn btn-primary btn-block mt-3"
                  onClick={onRequestScaffold}
                >
                  <Icon name="wand" size={14} />
                  <span>{isRu ? '⚡ Создать мод карты здесь' : '⚡ Scaffold Map Mod Here'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 2. Urban Zone Dossier */}
        {selectedZone && (
          <div className="carto-card carto-card--zone">
            <div className="carto-card__head">
              <div className="carto-card__title">
                <Icon name="navigation" size={14} color="#f59e0b" />
                <span>{isRu ? selectedZone.nameRu : selectedZone.name}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() =>
                  onFocusBounds({
                    minX: selectedZone.cellBounds.minX,
                    maxX: selectedZone.cellBounds.maxX,
                    minY: selectedZone.cellBounds.minY,
                    maxY: selectedZone.cellBounds.maxY
                  })
                }
                title={isRu ? 'Фокус на городе' : 'Focus city'}
              >
                <Icon name="target" size={13} />
              </button>
            </div>

            <div className="carto-card__body">
              <div className="zone-meta-tags">
                <span className={`badge badge--${selectedZone.category}`}>
                  {selectedZone.category.toUpperCase()}
                </span>
                {selectedZone.lootTier && (
                  <span className="badge badge--loot">
                    {isRu ? `Лут: ${selectedZone.lootTier}` : `Loot: ${selectedZone.lootTier}`}
                  </span>
                )}
              </div>

              <p className="zone-desc">
                {isRu ? selectedZone.descriptionRu : selectedZone.description}
              </p>

              <div className="zone-bounds-info font-mono text-muted">
                {isRu ? 'Границы клеток:' : 'Cell Bounds:'} [
                {selectedZone.cellBounds.minX}_{selectedZone.cellBounds.minY} ..{' '}
                {selectedZone.cellBounds.maxX}_{selectedZone.cellBounds.maxY}]
              </div>

              {onSelectZone && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-block mt-2"
                  onClick={() => onSelectZone(null)}
                >
                  <Icon name="x" size={12} />
                  <span>{isRu ? 'Закрыть досье города' : 'Close City Dossier'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3. Selected Single Cell Card */}
        {selectedCell && (
          <div className={`carto-card ${cellConflict ? 'carto-card--conflict' : ''}`}>
            <div className="carto-card__head">
              <div className="carto-card__title">
                <Icon name="grid" size={14} color="#38bdf8" />
                <span className="font-mono">
                  {isRu ? 'Клетка' : 'Cell'} {selectedCell.x}_{selectedCell.y}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => onFocusCell(selectedCell.x, selectedCell.y)}
                title={isRu ? 'Центрировать ячейку' : 'Center Cell'}
              >
                <Icon name="target" size={13} />
              </button>
            </div>

            <div className="carto-card__body">
              <div className="cell-tile-range font-mono text-muted">
                <span>
                  {isRu ? 'Тайлы:' : 'Tiles:'} [{selectedCell.x * 300}..
                  {(selectedCell.x + 1) * 300 - 1}, {selectedCell.y * 300}..
                  {(selectedCell.y + 1) * 300 - 1}]
                </span>
              </div>

              {/* Conflict notice if cell has collision */}
              {cellConflict && (
                <div className="carto-conflict-box">
                  <div className="conflict-box-title">
                    <Icon name="alert-triangle" size={14} color="#f97316" />
                    <span>
                      {isRu
                        ? `Конфликт: ${cellConflict.maps.length} мода перекрывают клетку`
                        : `Conflict: ${cellConflict.maps.length} maps overwrite cell`}
                    </span>
                  </div>
                  <span className="conflict-box-sub text-muted">
                    {isRu ? 'Побеждает мод в верхней позиции списка' : 'Winner is top-priority mod'}
                  </span>
                </div>
              )}

              {/* Occupants list */}
              <div className="occupants-section">
                <span className="occupants-label text-muted">
                  {isRu ? 'Карты в этой клетке:' : 'Maps in this cell:'}
                </span>

                {cellOccupants.length === 0 ? (
                  <div className="empty-cell-note">
                    <Icon name="navigation" size={14} />
                    <span>
                      {isRu
                        ? '🟢 Свободная нетронутая глушь округа Нокс. Идеально для новой карты!'
                        : '🟢 Free untouched Knox wilderness. Perfect for a new map!'}
                    </span>
                  </div>
                ) : (
                  <div className="occupants-list">
                    {cellOccupants.map((occ) => {
                      const isWinner = cellConflict
                        ? cellConflict.winningMapId === occ.id
                        : true
                      const color = mapColors.get(occ.id) || '#38bdf8'

                      return (
                        <div
                          key={occ.id}
                          className={`occupant-item ${selectedMap?.id === occ.id ? 'active' : ''}`}
                          onClick={() => onSelectMap(occ)}
                        >
                          <div
                            className="color-dot"
                            style={{ backgroundColor: occ.isVanilla ? '#2563eb' : color }}
                          />
                          <div className="occupant-details">
                            <span className="occupant-name">{occ.title}</span>
                            <span className="occupant-mod text-muted font-mono">
                              {occ.isVanilla ? 'Vanilla' : occ.modId}
                            </span>
                          </div>
                          {cellConflict && (
                            <span
                              className={`priority-badge ${isWinner ? 'winner' : 'overwritten'}`}
                            >
                              {isWinner
                                ? isRu
                                  ? '🏆 Побеждает'
                                  : '🏆 Winner'
                                : isRu
                                  ? 'Перекрыт'
                                  : 'Overwritten'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. Selected Map Detail Card */}
        {selectedMap && (
          <div className="carto-card">
            <div className="carto-card__head">
              <div className="carto-card__title">
                <Icon name="map" size={14} color="#38bdf8" />
                <span>{selectedMap.title}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => onFocusBounds(selectedMap.bounds)}
                title={isRu ? 'Показать всю карту' : 'Fit map bounds'}
              >
                <Icon name="maximize" size={13} />
              </button>
            </div>

            <div className="carto-card__body">
              {/* Thumbnail preview with object-fit: contain (STRICT ZERO-CROPPING RULE) */}
              {thumbUrl && (
                <div className="carto-map-thumbnail-container">
                  <img
                    src={thumbUrl}
                    alt={selectedMap.title}
                    className="carto-map-thumbnail"
                  />
                </div>
              )}

              <div className="map-detail-grid font-mono">
                <div className="detail-row">
                  <span className="text-muted">{isRu ? 'Папка:' : 'Folder:'}</span>
                  <span>{selectedMap.folderName}</span>
                </div>
                <div className="detail-row">
                  <span className="text-muted">Mod ID:</span>
                  <span>{selectedMap.isVanilla ? 'vanilla' : selectedMap.modId}</span>
                </div>
                {selectedMap.lots && (
                  <div className="detail-row">
                    <span className="text-muted">lots=:</span>
                    <span>{selectedMap.lots}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="text-muted">{isRu ? 'Клеток:' : 'Cells:'}</span>
                  <span className="text-cyan font-bold">{selectedMap.cells.length}</span>
                </div>
                {selectedMap.spawns && selectedMap.spawns.length > 0 && (
                  <div className="detail-row">
                    <span className="text-muted">{isRu ? 'Спавнов:' : 'Spawns:'}</span>
                    <span className="text-yellow">{selectedMap.spawns.length}</span>
                  </div>
                )}
              </div>

              {selectedMap.description && (
                <p className="map-detail-desc text-muted">{selectedMap.description}</p>
              )}

              {/* Action: Open Spawnpoint Editor */}
              {onOpenSpawnEditor && !selectedMap.isVanilla && (
                <button
                  type="button"
                  className="btn btn-secondary btn-block mt-3"
                  onClick={() => onOpenSpawnEditor(selectedMap)}
                >
                  <Icon name="crosshair" size={14} />
                  <span>{isRu ? '🎯 Редактор точек спавна' : '🎯 Edit Spawnpoints'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Fallback empty guide */}
        {!selectedCell && !selectedZone && !selectedMap && selectedCellsGroup.size === 0 && (
          <div className="carto-empty-guide">
            <Icon name="mouse-pointer" size={24} color="#64748b" />
            <p className="text-muted">
              {isRu
                ? 'Кликните по любой клетке, городу или перетащите рамку с зажатой ЛКМ в режиме "Выбор зоны", чтобы исследовать или создать карту.'
                : 'Click any cell or town, or drag a selection box in "Select" mode to inspect or scaffold a map.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
