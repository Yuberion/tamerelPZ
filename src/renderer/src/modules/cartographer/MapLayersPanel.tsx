import { useMemo, useState } from 'react'
import type {
  CartographerCellConflict,
  CartographerMapItem,
  CartographerUrbanZone
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'

interface MapLayersPanelProps {
  vanillaMaps: CartographerMapItem[]
  modMaps: CartographerMapItem[]
  conflicts: CartographerCellConflict[]
  urbanZones: CartographerUrbanZone[]
  activeMapNames: string[]
  mapColors: Map<string, string>
  visibleMapIds: Set<string>
  selectedMapId: string | null
  showVanilla: boolean
  showTowns: boolean
  showWaterways: boolean
  showSpawns: boolean
  isRu: boolean
  onToggleVanilla: () => void
  onToggleTowns: () => void
  onToggleWaterways: () => void
  onToggleSpawns: () => void
  onToggleMapVisibility: (mapId: string) => void
  onToggleAllMaps: (visible: boolean) => void
  onSelectMap: (map: CartographerMapItem) => void
  onSelectZone: (zone: CartographerUrbanZone) => void
  onFocusBounds: (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => void
  onFocusCell: (x: number, y: number) => void
}

type TabKind = 'maps' | 'towns' | 'conflicts'

export function MapLayersPanel({
  vanillaMaps,
  modMaps,
  conflicts,
  urbanZones,
  activeMapNames,
  mapColors,
  visibleMapIds,
  selectedMapId,
  showVanilla,
  showTowns,
  showWaterways,
  showSpawns,
  isRu,
  onToggleVanilla,
  onToggleTowns,
  onToggleWaterways,
  onToggleSpawns,
  onToggleMapVisibility,
  onToggleAllMaps,
  onSelectMap,
  onSelectZone,
  onFocusBounds,
  onFocusCell
}: MapLayersPanelProps) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TabKind>('maps')

  // Filtered Mod Maps
  const filteredModMaps = useMemo(() => {
    const q = search.trim().toLowerCase()
    return modMaps.filter((m) => {
      if (!q) return true
      return (
        m.title.toLowerCase().includes(q) ||
        m.folderName.toLowerCase().includes(q) ||
        (m.modName && m.modName.toLowerCase().includes(q)) ||
        m.modId.toLowerCase().includes(q) ||
        m.cells.some((c) => c.includes(q))
      )
    })
  }, [modMaps, search])

  // Filtered Towns
  const filteredTowns = useMemo(() => {
    const q = search.trim().toLowerCase()
    return urbanZones.filter((z) => {
      if (!q) return true
      return (
        z.name.toLowerCase().includes(q) ||
        z.nameRu.toLowerCase().includes(q) ||
        z.category.toLowerCase().includes(q)
      )
    })
  }, [urbanZones, search])

  return (
    <div className="carto-sidebar">
      {/* Top Search bar */}
      <div className="carto-sidebar__head">
        <div className="carto-search">
          <Icon name="search" size={13} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isRu
                ? 'Поиск карты, города (West Point) или клетки (35_32)…'
                : 'Search map, town (West Point), or cell (35_32)...'
            }
            spellCheck={false}
          />
          {search && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setSearch('')}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        {/* Global Layer Quick Toggles */}
        <div className="carto-global-toggles">
          <button
            type="button"
            className={`toggle-chip ${showVanilla ? 'active' : ''}`}
            onClick={onToggleVanilla}
            title={isRu ? 'Отображение базовых клеток ванили' : 'Toggle vanilla cells'}
          >
            <span className="dot dot--vanilla" />
            <span>{isRu ? 'Ваниль' : 'Vanilla'}</span>
          </button>

          <button
            type="button"
            className={`toggle-chip ${showTowns ? 'active' : ''}`}
            onClick={onToggleTowns}
            title={isRu ? 'Отображение городов и ориентиров' : 'Toggle towns and landmarks'}
          >
            <span className="dot dot--towns" />
            <span>{isRu ? 'Города' : 'Towns'}</span>
          </button>

          <button
            type="button"
            className={`toggle-chip ${showWaterways ? 'active' : ''}`}
            onClick={onToggleWaterways}
            title={isRu ? 'Отображение реки Огайо и озер' : 'Toggle rivers and lakes'}
          >
            <span className="dot dot--water" />
            <span>{isRu ? 'Реки' : 'Rivers'}</span>
          </button>

          <button
            type="button"
            className={`toggle-chip ${showSpawns ? 'active' : ''}`}
            onClick={onToggleSpawns}
            title={isRu ? 'Отображение точек спавна' : 'Toggle spawn points'}
          >
            <span className="dot dot--spawns" />
            <span>{isRu ? 'Спавны' : 'Spawns'}</span>
          </button>
        </div>

        {/* Tab switchers */}
        <div className="carto-tabs">
          <button
            type="button"
            className={`carto-tab-btn ${tab === 'maps' ? 'active' : ''}`}
            onClick={() => setTab('maps')}
          >
            <Icon name="layers" size={13} />
            <span>{isRu ? 'Моды карт' : 'Map Mods'}</span>
            <span className="tab-badge">{modMaps.length}</span>
          </button>

          <button
            type="button"
            className={`carto-tab-btn ${tab === 'towns' ? 'active' : ''}`}
            onClick={() => setTab('towns')}
          >
            <Icon name="navigation" size={13} />
            <span>{isRu ? 'Города' : 'Towns'}</span>
            <span className="tab-badge">{urbanZones.length}</span>
          </button>

          <button
            type="button"
            className={`carto-tab-btn ${tab === 'conflicts' ? 'active' : ''}`}
            onClick={() => setTab('conflicts')}
          >
            <Icon name="alert-triangle" size={13} />
            <span>{isRu ? 'Конфликты' : 'Conflicts'}</span>
            {conflicts.length > 0 && <span className="tab-badge alert">{conflicts.length}</span>}
          </button>
        </div>
      </div>

      {/* Main List Body */}
      <div className="carto-sidebar__body">
        {/* TAB 1: MOD MAPS */}
        {tab === 'maps' && (
          <div className="carto-list-section">
            <div className="list-section-header">
              <span className="section-label">
                {isRu ? 'Установленные моды карт' : 'Installed Map Mods'} ({filteredModMaps.length})
              </span>
              <div className="header-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => onToggleAllMaps(true)}
                  title={isRu ? 'Показать все' : 'Show all'}
                >
                  {isRu ? 'Все' : 'All'}
                </button>
                <span>/</span>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => onToggleAllMaps(false)}
                  title={isRu ? 'Скрыть все' : 'Hide all'}
                >
                  {isRu ? 'Скрыть' : 'Hide'}
                </button>
              </div>
            </div>

            {filteredModMaps.length === 0 ? (
              <div className="carto-empty-list">
                <Icon name="map" size={18} color="#64748b" />
                <span>{isRu ? 'Моды карт не найдены' : 'No map mods found'}</span>
              </div>
            ) : (
              <div className="carto-items-container">
                {filteredModMaps.map((m) => {
                  const isVisible = visibleMapIds.has(m.id)
                  const isSelected = selectedMapId === m.id
                  const color = mapColors.get(m.id) || '#38bdf8'
                  const isActive = activeMapNames.includes(m.folderName)

                  return (
                    <div
                      key={m.id}
                      className={`carto-map-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => onSelectMap(m)}
                    >
                      <button
                        type="button"
                        className={`visibility-toggle ${isVisible ? 'visible' : 'hidden'}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleMapVisibility(m.id)
                        }}
                        title={
                          isVisible
                            ? isRu
                              ? 'Скрыть слой карты'
                              : 'Hide map layer'
                            : isRu
                              ? 'Показать слой карты'
                              : 'Show map layer'
                        }
                      >
                        <Icon name={isVisible ? 'eye' : 'eye-off'} size={14} />
                      </button>

                      <div className="map-color-bar" style={{ backgroundColor: color }} />

                      <div className="map-info-col">
                        <span className="map-item-title">{m.title}</span>
                        <div className="map-item-sub font-mono">
                          <span>{m.folderName}</span>
                          <span className="cell-pill">{m.cells.length} cl</span>
                          {isActive && (
                            <span className="active-pill">{isRu ? 'Активен' : 'Active'}</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          onFocusBounds(m.bounds)
                        }}
                        title={isRu ? 'Фокус на карте' : 'Focus map'}
                      >
                        <Icon name="target" size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Vanilla Maps Section */}
            {vanillaMaps.length > 0 && (
              <div className="vanilla-section mt-4">
                <div className="list-section-header">
                  <span className="section-label">
                    {isRu ? 'Карты ванили (PZ Media)' : 'Vanilla Game Maps'} ({vanillaMaps.length})
                  </span>
                </div>
                <div className="carto-items-container">
                  {vanillaMaps.map((vm) => (
                    <div
                      key={vm.id}
                      className={`carto-map-row ${selectedMapId === vm.id ? 'selected' : ''}`}
                      onClick={() => onSelectMap(vm)}
                    >
                      <div className="map-color-bar" style={{ backgroundColor: '#2563eb' }} />
                      <div className="map-info-col">
                        <span className="map-item-title">{vm.title}</span>
                        <span className="map-item-sub font-mono text-muted">{vm.folderName}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          onFocusBounds(vm.bounds)
                        }}
                        title={isRu ? 'Фокус' : 'Focus'}
                      >
                        <Icon name="target" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TOWNS & LANDMARKS */}
        {tab === 'towns' && (
          <div className="carto-list-section">
            <div className="list-section-header">
              <span className="section-label">
                {isRu ? 'Канонические города округа Нокс' : 'Knox County Towns'} ({filteredTowns.length})
              </span>
            </div>

            <div className="carto-items-container">
              {filteredTowns.map((z) => (
                <div
                  key={z.id}
                  className="carto-town-row"
                  onClick={() => {
                    onSelectZone(z)
                    onFocusBounds({
                      minX: z.cellBounds.minX,
                      maxX: z.cellBounds.maxX,
                      minY: z.cellBounds.minY,
                      maxY: z.cellBounds.maxY
                    })
                  }}
                >
                  <div className={`town-category-icon cat--${z.category}`}>
                    <Icon
                      name={
                        z.category === 'metropolis'
                          ? 'building'
                          : z.category === 'military'
                            ? 'shield'
                            : z.category === 'commercial'
                              ? 'shopping-bag'
                              : 'home'
                      }
                      size={15}
                    />
                  </div>

                  <div className="town-info-col">
                    <span className="town-name">{isRu ? z.nameRu : z.name}</span>
                    <span className="town-sub font-mono text-muted">
                      [{z.cellBounds.minX}_{z.cellBounds.minY}..{z.cellBounds.maxX}_
                      {z.cellBounds.maxY}]
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFocusBounds({
                        minX: z.cellBounds.minX,
                        maxX: z.cellBounds.maxX,
                        minY: z.cellBounds.minY,
                        maxY: z.cellBounds.maxY
                      })
                    }}
                    title={isRu ? 'Перейти к городу' : 'Jump to Town'}
                  >
                    <Icon name="navigation" size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: CONFLICTS */}
        {tab === 'conflicts' && (
          <div className="carto-list-section">
            <div className="list-section-header">
              <span className="section-label text-red">
                {isRu ? 'Коллизии оверлея клеток' : 'Cell Overlap Conflicts'} ({conflicts.length})
              </span>
            </div>

            {conflicts.length === 0 ? (
              <div className="carto-empty-list">
                <Icon name="check-circle" size={18} color="#10b981" />
                <span className="text-emerald">
                  {isRu
                    ? 'Конфликтов не обнаружено. Все моды карт изолированы!'
                    : 'No conflicts detected. All maps have unique territory!'}
                </span>
              </div>
            ) : (
              <div className="carto-items-container">
                {conflicts.map((c) => (
                  <div
                    key={c.cell}
                    className="carto-conflict-row"
                    onClick={() => onFocusCell(c.x, c.y)}
                  >
                    <div className="conflict-badge">
                      <Icon name="alert-triangle" size={14} color="#f97316" />
                      <span className="font-mono">{c.cell}</span>
                    </div>

                    <div className="conflict-occupants-mini">
                      {c.maps.map((m) => (
                        <span key={m.mapId} className="mini-tag">
                          {m.mapName}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFocusCell(c.x, c.y)
                      }}
                      title={isRu ? 'Фокус на конфликте' : 'Focus conflict'}
                    >
                      <Icon name="target" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
