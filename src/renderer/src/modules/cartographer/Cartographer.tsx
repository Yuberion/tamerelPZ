import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CartographerMapItem,
  CartographerSpawnPoint,
  CartographerUrbanZone,
  CartographerWorldData
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { CartographerTool, KnoxMapCanvas } from './KnoxMapCanvas'
import { MapLayersPanel } from './MapLayersPanel'
import { MapInspectorPanel } from './MapInspectorPanel'
import { CartographerStudioModal } from './CartographerStudioModal'
import { SpawnEditorModal } from './SpawnEditorModal'
import { SavegameDoctor } from './SavegameDoctor'

interface CartographerProps {
  onExit: () => void
}

export function Cartographer({ onExit }: CartographerProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()

  const [mainTab, setMainTab] = useState<'map' | 'doctor'>('map')
  const [worldData, setWorldData] = useState<CartographerWorldData | null>(null)
  const [loading, setLoading] = useState(true)
  const [visibleMapIds, setVisibleMapIds] = useState<Set<string>>(new Set())

  // Layer toggles
  const [showVanilla, setShowVanilla] = useState(true)
  const [showTowns, setShowTowns] = useState(true)
  const [showWaterways, setShowWaterways] = useState(true)
  const [showSpawns, setShowSpawns] = useState(true)

  // Active Tool Mode
  const [activeTool, setActiveTool] = useState<CartographerTool>('inspect')

  // Selection states
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null)
  const [selectedZone, setSelectedZone] = useState<CartographerUrbanZone | null>(null)
  const [selectedCellsGroup, setSelectedCellsGroup] = useState<Set<string>>(new Set())
  const [selectedMap, setSelectedMap] = useState<CartographerMapItem | null>(null)

  // Modals state
  const [isStudioModalOpen, setIsStudioModalOpen] = useState(false)
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false)
  const [spawnTargetMap, setSpawnTargetMap] = useState<CartographerMapItem | null>(null)

  // Camera function refs
  const focusCellRef = useRef<((x: number, y: number) => void) | null>(null)
  const focusBoundsRef = useRef<((b: { minX: number; maxX: number; minY: number; maxY: number }) => void) | null>(null)
  const resetViewRef = useRef<(() => void) | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.pz.cartographer.scan()
      setWorldData(data)

      const allIds = new Set<string>()
      data.vanillaMaps.forEach((m) => allIds.add(m.id))
      data.modMaps.forEach((m) => allIds.add(m.id))
      setVisibleMapIds(allIds)

      notify(
        isRu
          ? `Картограф: загружено ${data.vanillaMaps.length} ванильных городов и ${data.modMaps.length} модовых карт`
          : `Cartographer: loaded ${data.vanillaMaps.length} vanilla towns & ${data.modMaps.length} mod maps`,
        'ok'
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    } finally {
      setLoading(false)
    }
  }, [notify, isRu])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Generate distinct HSL colors for each mod map
  const mapColors = useMemo(() => {
    const map = new Map<string, string>()
    if (!worldData) return map

    worldData.vanillaMaps.forEach((m) => {
      map.set(m.id, '#2563eb')
    })

    worldData.modMaps.forEach((m, idx) => {
      const hue = Math.round((idx * 137.508 + 35) % 360)
      map.set(m.id, `hsl(${hue}, 75%, 58%)`)
    })

    return map
  }, [worldData])

  const handleToggleMapVisibility = useCallback((mapId: string) => {
    setVisibleMapIds((prev) => {
      const next = new Set(prev)
      if (next.has(mapId)) next.delete(mapId)
      else next.add(mapId)
      return next
    })
  }, [])

  const handleToggleAllMaps = useCallback(
    (visible: boolean) => {
      if (!worldData) return
      if (visible) {
        const all = new Set<string>()
        worldData.vanillaMaps.forEach((m) => all.add(m.id))
        worldData.modMaps.forEach((m) => all.add(m.id))
        setVisibleMapIds(all)
      } else {
        setVisibleMapIds(new Set())
      }
    },
    [worldData]
  )

  const handleSelectMap = useCallback(
    (map: CartographerMapItem) => {
      setSelectedMap(map)
      setSelectedZone(null)
      if (map.cells.length > 0) {
        focusBoundsRef.current?.(map.bounds)
      }
    },
    []
  )

  const handleSelectZone = useCallback((zone: CartographerUrbanZone | null) => {
    setSelectedZone(zone)
    if (zone) {
      focusBoundsRef.current?.(zone.cellBounds)
    }
  }, [])

  const handleQuickJumpCity = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const zoneId = e.target.value
    if (!zoneId || !worldData) {
      setSelectedZone(null)
      return
    }
    const zone = worldData.urbanZones.find((z) => z.id === zoneId)
    if (zone) {
      setSelectedZone(zone)
      focusBoundsRef.current?.(zone.cellBounds)
    }
  }

  const handleScaffoldSuccess = (modId: string) => {
    notify(
      isRu
        ? `Мод карты ${modId} успешно создан в директории модов!`
        : `Map mod ${modId} successfully scaffolded!`,
      'ok'
    )
    setSelectedCellsGroup(new Set())
    void loadData()
  }

  const handleSaveSpawnsSuccess = (updatedSpawns: CartographerSpawnPoint[]) => {
    notify(
      isRu
        ? `Точки спавна (${updatedSpawns.length}) успешно сохранены!`
        : `Spawn points (${updatedSpawns.length}) successfully saved!`,
      'ok'
    )
    if (spawnTargetMap) {
      spawnTargetMap.spawns = updatedSpawns
    }
  }

  // Claimed cells array for modal
  const claimedCellsArray = useMemo(() => {
    if (selectedCellsGroup.size > 0) {
      return Array.from(selectedCellsGroup)
    }
    if (selectedCell) {
      return [`${selectedCell.x}_${selectedCell.y}`]
    }
    return ['35_32']
  }, [selectedCellsGroup, selectedCell])

  return (
    <div className="carto-module">
      {/* Top Main Navigation & Tools Bar */}
      <div className="carto-topbar">
        <div className="carto-topbar__left">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onExit}
            title={isRu ? 'Назад в меню' : 'Back to menu'}
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <div className="carto-title-block">
            <h2 className="carto-title">05 / TRIAGE</h2>
            <span className="carto-subtitle">
              {isRu ? 'Доктор сохранений & Карта Knox' : 'Savegame Doctor & Knox Atlas'}
              {worldData && (
                <span className="badge badge-subtle font-mono" style={{ marginLeft: 6, fontSize: 10 }}>
                  {worldData.gameVersion ? `${worldData.gameVersion} (${worldData.detectedBuild})` : worldData.detectedBuild}
                </span>
              )}
            </span>
          </div>

          {/* Module Tab Switcher */}
          <div className="btn-group" style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button
              type="button"
              className={`btn btn-sm ${mainTab === 'map' ? 'btn-active' : ''}`}
              onClick={() => setMainTab('map')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
            >
              <Icon name="map" size={13} color={mainTab === 'map' ? '#38bdf8' : undefined} />
              {isRu ? 'Карта Нокса' : 'Knox Map'}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mainTab === 'doctor' ? 'btn-active' : ''}`}
              onClick={() => setMainTab('doctor')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
            >
              <Icon name="pulse" size={13} color={mainTab === 'doctor' ? 'var(--rust-hot)' : undefined} />
              {isRu ? 'Доктор сохранений (Soft Reset)' : 'Savegame Doctor'}
            </button>
          </div>

          {/* Quick Jump City Dropdown */}
          {worldData && worldData.urbanZones.length > 0 && (
            <div className="carto-city-select-box">
              <Icon name="navigation" size={14} color="#f59e0b" />
              <select
                className="carto-city-select"
                onChange={handleQuickJumpCity}
                value={selectedZone?.id || ''}
              >
                <option value="">{isRu ? '— Перейти к городу —' : '— Jump to Town —'}</option>
                {worldData.urbanZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {isRu ? z.nameRu : z.name} ({z.category})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Center: Tactical Tool Modes Switcher */}
        <div className="carto-tool-modes">
          <button
            type="button"
            className={`tool-btn ${activeTool === 'inspect' ? 'active' : ''}`}
            onClick={() => setActiveTool('inspect')}
            title={isRu ? 'Инспектор и перемещение' : 'Inspect & Pan'}
          >
            <Icon name="mouse-pointer" size={14} />
            <span>{isRu ? 'Инспектор' : 'Inspect'}</span>
          </button>

          <button
            type="button"
            className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title={isRu ? 'Выделение области клеток для создания карты' : 'Claim cells area'}
          >
            <Icon name="crop" size={14} />
            <span>{isRu ? 'Выбор зоны' : 'Claim Zone'}</span>
          </button>

          <button
            type="button"
            className={`tool-btn ${activeTool === 'ruler' ? 'active' : ''}`}
            onClick={() => setActiveTool('ruler')}
            title={isRu ? 'Измерение расстояний и времени ходьбы' : 'Measure distances'}
          >
            <Icon name="maximize" size={14} />
            <span>{isRu ? 'Линейка' : 'Ruler'}</span>
          </button>

          <button
            type="button"
            className={`tool-btn ${activeTool === 'spawn' ? 'active' : ''}`}
            onClick={() => setActiveTool('spawn')}
            title={isRu ? 'Размещение точки спавна кликом' : 'Place spawn point'}
          >
            <Icon name="crosshair" size={14} />
            <span>{isRu ? 'Точка спавна' : 'Spawn'}</span>
          </button>
        </div>

        {/* Right action buttons */}
        <div className="carto-topbar__right">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setIsStudioModalOpen(true)}
            title={isRu ? 'Мастер создания карты в выбранной области' : 'Scaffold new map mod'}
          >
            <Icon name="wand" size={14} />
            <span>{isRu ? '⚡ Создать карту' : '⚡ Scaffold Map'}</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => resetViewRef.current?.()}
            title={isRu ? 'Сбросить вид на весь округ Нокс' : 'Reset view to Knox County'}
          >
            <Icon name="home" size={15} />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => void loadData()}
            disabled={loading}
            title={isRu ? 'Пересканировать карты' : 'Rescan maps'}
          >
            <Icon name="refresh" size={15} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* 3-Pane Workspace: Left (Layers), Center (Canvas), Right (Inspector) or Savegame Doctor */}
      {mainTab === 'doctor' ? (
        <SavegameDoctor />
      ) : (
        <div className="carto-workspace">
        {/* Left: Layers & Towns Panel */}
        <MapLayersPanel
          vanillaMaps={worldData?.vanillaMaps || []}
          modMaps={worldData?.modMaps || []}
          conflicts={worldData?.conflicts || []}
          urbanZones={worldData?.urbanZones || []}
          activeMapNames={worldData?.activeMapNames || []}
          mapColors={mapColors}
          visibleMapIds={visibleMapIds}
          selectedMapId={selectedMap?.id || null}
          showVanilla={showVanilla}
          showTowns={showTowns}
          showWaterways={showWaterways}
          showSpawns={showSpawns}
          isRu={isRu}
          onToggleVanilla={() => setShowVanilla((v) => !v)}
          onToggleTowns={() => setShowTowns((v) => !v)}
          onToggleWaterways={() => setShowWaterways((v) => !v)}
          onToggleSpawns={() => setShowSpawns((v) => !v)}
          onToggleMapVisibility={handleToggleMapVisibility}
          onToggleAllMaps={handleToggleAllMaps}
          onSelectMap={handleSelectMap}
          onSelectZone={handleSelectZone}
          onFocusBounds={(b) => focusBoundsRef.current?.(b)}
          onFocusCell={(x, y) => focusCellRef.current?.(x, y)}
        />

        {/* Center: Interactive Knox Map Canvas */}
        <div className="carto-canvas-wrapper">
          {worldData ? (
            <KnoxMapCanvas
              bounds={worldData.bounds}
              vanillaMaps={worldData.vanillaMaps}
              modMaps={worldData.modMaps}
              conflicts={worldData.conflicts}
              urbanZones={worldData.urbanZones}
              waterways={worldData.waterways}
              roads={worldData.roads || []}
              activeMapNames={worldData.activeMapNames}
              mapColors={mapColors}
              visibleMapIds={visibleMapIds}
              selectedCell={selectedCell}
              selectedZone={selectedZone}
              selectedCellsGroup={selectedCellsGroup}
              activeTool={activeTool}
              showSpawns={showSpawns}
              showVanilla={showVanilla}
              showTowns={showTowns}
              showWaterways={showWaterways}
              isRu={isRu}
              onSelectCell={setSelectedCell}
              onSelectZone={setSelectedZone}
              onSelectCellsGroup={setSelectedCellsGroup}
              onAddSpawnPoint={(wx, wy, px, py) => {
                if (selectedMap && !selectedMap.isVanilla) {
                  setSpawnTargetMap(selectedMap)
                  setIsSpawnModalOpen(true)
                } else {
                  notify(
                    isRu
                      ? `Координаты спавна: Клетка [${wx}, ${wy}], Тайл [${px}, ${py}]`
                      : `Spawn coordinates: Cell [${wx}, ${wy}], Tile [${px}, ${py}]`,
                    'info'
                  )
                }
              }}
              onRequestScaffold={() => setIsStudioModalOpen(true)}
              onFocusCellRef={(fn) => {
                focusCellRef.current = fn
              }}
              onFocusBoundsRef={(fn) => {
                focusBoundsRef.current = fn
              }}
              onResetViewRef={(fn) => {
                resetViewRef.current = fn
              }}
            />
          ) : (
            <div className="carto-loading-view">
              <Icon name="refresh" size={28} className="spinning" color="#38bdf8" />
              <span>{isRu ? 'Сканирование географии округа Нокс…' : 'Scanning Knox County geography...'}</span>
            </div>
          )}
        </div>

        {/* Right: Sector & Map Inspector Panel */}
        <MapInspectorPanel
          selectedCell={selectedCell}
          selectedZone={selectedZone}
          selectedCellsGroup={selectedCellsGroup}
          selectedMap={selectedMap}
          vanillaMaps={worldData?.vanillaMaps || []}
          modMaps={worldData?.modMaps || []}
          conflicts={worldData?.conflicts || []}
          mapColors={mapColors}
          isRu={isRu}
          onSelectMap={setSelectedMap}
          onFocusBounds={(b) => focusBoundsRef.current?.(b)}
          onFocusCell={(x, y) => focusCellRef.current?.(x, y)}
          onRequestScaffold={() => setIsStudioModalOpen(true)}
          onOpenSpawnEditor={(m) => {
            setSpawnTargetMap(m)
            setIsSpawnModalOpen(true)
          }}
          onSelectZone={setSelectedZone}
        />
      </div>
      )}

      {/* Map Modder Studio Scaffolding Modal */}
      {isStudioModalOpen && (
        <CartographerStudioModal
          selectedCells={claimedCellsArray}
          isRu={isRu}
          onClose={() => setIsStudioModalOpen(false)}
          onSuccess={handleScaffoldSuccess}
        />
      )}

      {/* Spawnpoints Editor Modal */}
      {isSpawnModalOpen && spawnTargetMap && (
        <SpawnEditorModal
          mapItem={spawnTargetMap}
          isRu={isRu}
          onClose={() => setIsSpawnModalOpen(false)}
          onSaveSuccess={handleSaveSpawnsSuccess}
        />
      )}
    </div>
  )
}

export const Triage = SavegameDoctor

