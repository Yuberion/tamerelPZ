import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CartographerCellConflict,
  CartographerMapItem,
  CartographerRoad,
  CartographerUrbanZone,
  CartographerWaterway
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'

export type CartographerTool = 'inspect' | 'select' | 'ruler' | 'spawn'

interface KnoxMapCanvasProps {
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  vanillaMaps: CartographerMapItem[]
  modMaps: CartographerMapItem[]
  conflicts: CartographerCellConflict[]
  urbanZones: CartographerUrbanZone[]
  waterways: CartographerWaterway[]
  roads?: CartographerRoad[]
  activeMapNames: string[]
  mapColors: Map<string, string>
  visibleMapIds: Set<string>
  selectedCell: { x: number; y: number } | null
  selectedZone: CartographerUrbanZone | null
  selectedCellsGroup: Set<string>
  activeTool: CartographerTool
  showSpawns: boolean
  showVanilla: boolean
  showTowns: boolean
  showWaterways: boolean
  isRu: boolean
  onSelectCell: (cell: { x: number; y: number } | null) => void
  onSelectZone: (zone: CartographerUrbanZone | null) => void
  onSelectCellsGroup: (cells: Set<string>) => void
  onAddSpawnPoint?: (worldX: number, worldY: number, posX: number, posY: number) => void
  onRequestScaffold?: () => void
  onFocusCellRef?: (fn: (x: number, y: number) => void) => void
  onFocusBoundsRef?: (fn: (b: { minX: number; maxX: number; minY: number; maxY: number }) => void) => void
  onResetViewRef?: (fn: () => void) => void
}

export function KnoxMapCanvas({
  bounds,
  vanillaMaps,
  modMaps,
  conflicts,
  urbanZones,
  waterways,
  roads = [],
  activeMapNames: _activeMapNames,
  mapColors,
  visibleMapIds,
  selectedCell,
  selectedZone,
  selectedCellsGroup,
  activeTool,
  showSpawns,
  showVanilla,
  showTowns,
  showWaterways,
  isRu,
  onSelectCell,
  onSelectZone,
  onSelectCellsGroup,
  onAddSpawnPoint,
  onRequestScaffold,
  onFocusCellRef,
  onFocusBoundsRef,
  onResetViewRef
}: KnoxMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Canvas pixel buffer dimensions (driven by ResizeObserver)
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const hasAutoCentered = useRef(false)

  // Camera state
  const [zoom, setZoom] = useState(26) // Pixels per cell
  const [pan, setPan] = useState({ x: 120, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Box selection drag state
  const [isBoxSelecting, setIsBoxSelecting] = useState(false)
  const boxSelectStart = useRef<{ x: number; y: number } | null>(null)
  const [boxSelectCurrent, setBoxSelectCurrent] = useState<{ x: number; y: number } | null>(null)

  // Ruler measurement tool state
  const [rulerStart, setRulerStart] = useState<{ x: number; y: number } | null>(null)
  const [rulerCurrent, setRulerCurrent] = useState<{ x: number; y: number } | null>(null)

  // Hover state
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null)
  const [hoveredZone, setHoveredZone] = useState<CartographerUrbanZone | null>(null)

  // Quick conflict lookup map: "x_y" -> conflict
  const conflictMap = useRef<Map<string, CartographerCellConflict>>(new Map())
  useEffect(() => {
    const map = new Map<string, CartographerCellConflict>()
    for (const c of conflicts) {
      map.set(c.cell, c)
    }
    conflictMap.current = map
  }, [conflicts])

  // Cell -> Maps lookup for rendering & hover
  const cellToMaps = useRef<Map<string, CartographerMapItem[]>>(new Map())
  useEffect(() => {
    const map = new Map<string, CartographerMapItem[]>()
    const all = [...(showVanilla ? vanillaMaps : []), ...modMaps]
    for (const m of all) {
      if (!visibleMapIds.has(m.id)) continue
      for (const cell of m.cells) {
        const list = map.get(cell) ?? []
        list.push(m)
        map.set(cell, list)
      }
    }
    cellToMaps.current = map
  }, [vanillaMaps, modMaps, showVanilla, visibleMapIds])

  // Center on bounds
  const centerOnBounds = useCallback(
    (b: { minX: number; maxX: number; minY: number; maxY: number }) => {
      const container = containerRef.current
      const width = container?.clientWidth || canvasSize.width || 800
      const height = container?.clientHeight || canvasSize.height || 600
      if (width <= 0 || height <= 0) return

      const spanX = Math.max(1, b.maxX - b.minX + 1)
      const spanY = Math.max(1, b.maxY - b.minY + 1)

      const targetZoom = Math.min(
        Math.max(10, Math.floor(Math.min((width - 120) / spanX, (height - 120) / spanY))),
        45
      )
      const centerX = (b.minX + b.maxX + 1) / 2
      const centerY = (b.minY + b.maxY + 1) / 2

      setZoom(targetZoom)
      setPan({
        x: width / 2 - (centerX - bounds.minX) * targetZoom,
        y: height / 2 - (centerY - bounds.minY) * targetZoom
      })
    },
    [bounds.minX, bounds.minY, canvasSize.width, canvasSize.height]
  )

  // Auto-center when container first acquires non-zero dimensions
  useEffect(() => {
    if (canvasSize.width > 0 && canvasSize.height > 0 && !hasAutoCentered.current) {
      hasAutoCentered.current = true
      centerOnBounds(bounds)
    }
  }, [canvasSize, bounds, centerOnBounds])

  // Expose camera methods to parent
  useEffect(() => {
    if (onResetViewRef) onResetViewRef(() => centerOnBounds(bounds))
    if (onFocusBoundsRef) onFocusBoundsRef((b) => centerOnBounds(b))
    if (onFocusCellRef) {
      onFocusCellRef((cx, cy) => {
        const container = containerRef.current
        if (!container) return
        const width = container.clientWidth
        const height = container.clientHeight
        const targetZoom = Math.max(zoom, 34)
        setZoom(targetZoom)
        setPan({
          x: width / 2 - (cx - bounds.minX + 0.5) * targetZoom,
          y: height / 2 - (cy - bounds.minY + 0.5) * targetZoom
        })
      })
    }
  }, [bounds, centerOnBounds, onResetViewRef, onFocusBoundsRef, onFocusCellRef, zoom])

  // Screen to Cell conversion
  const screenToCell = useCallback(
    (sx: number, sy: number) => {
      const cx = Math.floor((sx - pan.x) / zoom) + bounds.minX
      const cy = Math.floor((sy - pan.y) / zoom) + bounds.minY
      return { x: cx, y: cy }
    },
    [pan, zoom, bounds.minX, bounds.minY]
  )

  // Cell to Screen conversion
  const cellToScreen = useCallback(
    (cx: number, cy: number) => {
      const sx = (cx - bounds.minX) * zoom + pan.x
      const sy = (cy - bounds.minY) * zoom + pan.y
      return { x: sx, y: sy }
    },
    [pan, zoom, bounds.minX, bounds.minY]
  )

  // Find urban zone covering cell
  const findZoneForCell = useCallback(
    (cx: number, cy: number) => {
      return urbanZones.find(
        (z) =>
          cx >= z.cellBounds.minX &&
          cx <= z.cellBounds.maxX &&
          cy >= z.cellBounds.minY &&
          cy <= z.cellBounds.maxY
      )
    },
    [urbanZones]
  )

  // Minimap bounding parameters
  const MINIMAP_WIDTH = 180
  const MINIMAP_HEIGHT = 150
  const MINIMAP_PAD = 16

  // Canvas main rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // 1. Tactical Cartographic Background
    ctx.fillStyle = '#080d16'
    ctx.fillRect(0, 0, width, height)

    // Calculate visible cell window
    const startX = Math.max(bounds.minX, Math.floor(-pan.x / zoom) + bounds.minX - 1)
    const endX = Math.min(bounds.maxX, Math.ceil((width - pan.x) / zoom) + bounds.minX + 1)
    const startY = Math.max(bounds.minY, Math.floor(-pan.y / zoom) + bounds.minY - 1)
    const endY = Math.min(bounds.maxY, Math.ceil((height - pan.y) / zoom) + bounds.minY + 1)

    // 2. Base Wilderness Terrain Fill (Knox County Forest green tint)
    for (let cx = startX; cx <= endX; cx++) {
      for (let cy = startY; cy <= endY; cy++) {
        const { x: sx, y: sy } = cellToScreen(cx, cy)
        ctx.fillStyle = '#0c1622'
        ctx.fillRect(sx, sy, zoom, zoom)
      }
    }

    // 3. Minor Chunk Grid lines (if zoomed in sufficiently)
    if (zoom >= 24) {
      ctx.strokeStyle = '#111d2e'
      ctx.lineWidth = 0.5
      const chunkZoom = zoom / 10
      for (let cx = startX; cx <= endX; cx++) {
        for (let cy = startY; cy <= endY; cy++) {
          const { x: sx, y: sy } = cellToScreen(cx, cy)
          for (let i = 1; i < 10; i++) {
            ctx.beginPath()
            ctx.moveTo(sx + i * chunkZoom, sy)
            ctx.lineTo(sx + i * chunkZoom, sy + zoom)
            ctx.stroke()

            ctx.beginPath()
            ctx.moveTo(sx, sy + i * chunkZoom)
            ctx.lineTo(sx + zoom, sy + i * chunkZoom)
            ctx.stroke()
          }
        }
      }
    }

    // 4. Knox County Cell Grid Lines
    ctx.strokeStyle = '#1b2a3f'
    ctx.lineWidth = 1
    for (let cx = startX; cx <= endX + 1; cx++) {
      const { x: sx } = cellToScreen(cx, startY)
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
      ctx.stroke()
    }
    for (let cy = startY; cy <= endY + 1; cy++) {
      const { y: sy } = cellToScreen(startX, cy)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
      ctx.stroke()
    }

    // 5. Waterways (Ohio River, Salt River, Lakes) with Shorelines
    if (showWaterways) {
      ctx.save()
      for (const w of waterways) {
        if (w.points.length < 2) continue

        const baseWidth = (w.width || 1.8) * zoom

        // 5a. Shoreline glow / edge
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'
        ctx.lineWidth = baseWidth + 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        ctx.beginPath()
        const first = cellToScreen(w.points[0].x, w.points[0].y)
        ctx.moveTo(first.x + zoom / 2, first.y + zoom / 2)
        for (let i = 1; i < w.points.length; i++) {
          const pt = cellToScreen(w.points[i].x, w.points[i].y)
          ctx.lineTo(pt.x + zoom / 2, pt.y + zoom / 2)
        }
        if (w.kind === 'lake') {
          ctx.closePath()
        }
        ctx.stroke()

        // 5b. River / Lake deep blue water body
        ctx.strokeStyle = '#0284c7'
        ctx.fillStyle = 'rgba(2, 132, 199, 0.65)'
        ctx.lineWidth = baseWidth

        ctx.beginPath()
        ctx.moveTo(first.x + zoom / 2, first.y + zoom / 2)
        for (let i = 1; i < w.points.length; i++) {
          const pt = cellToScreen(w.points[i].x, w.points[i].y)
          ctx.lineTo(pt.x + zoom / 2, pt.y + zoom / 2)
        }

        if (w.kind === 'lake') {
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        } else {
          ctx.stroke()
        }

        // River name text along watercourse
        if (zoom >= 14 && w.points.length >= 4) {
          const midIdx = Math.floor(w.points.length / 2)
          const midPt = cellToScreen(w.points[midIdx].x, w.points[midIdx].y)
          ctx.font = 'bold italic 11px Inter, system-ui, sans-serif'
          const label = isRu ? w.nameRu : w.name
          const tw = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(8, 13, 22, 0.85)'
          ctx.fillRect(midPt.x + zoom / 2 - tw / 2 - 4, midPt.y + zoom / 2 - 8, tw + 8, 16)
          ctx.fillStyle = '#7dd3fc'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, midPt.x + zoom / 2, midPt.y + zoom / 2)
        }
      }
      ctx.restore()
    }

    // 6. Canonical Highways & Roads Network
    if (roads && roads.length > 0) {
      ctx.save()
      for (const road of roads) {
        if (road.points.length < 2) continue

        // Outer road shoulders
        ctx.strokeStyle = '#0a0f1d'
        ctx.lineWidth = Math.max(3, (road.width || 0.5) * zoom + 3)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        const first = cellToScreen(road.points[0].x, road.points[0].y)
        ctx.moveTo(first.x + zoom / 2, first.y + zoom / 2)
        for (let i = 1; i < road.points.length; i++) {
          const pt = cellToScreen(road.points[i].x, road.points[i].y)
          ctx.lineTo(pt.x + zoom / 2, pt.y + zoom / 2)
        }
        ctx.stroke()

        // Asphalt roadway surface
        ctx.strokeStyle = road.kind === 'highway' ? '#334155' : road.kind === 'primary' ? '#243042' : '#1e293b'
        ctx.lineWidth = Math.max(2, (road.width || 0.5) * zoom)
        ctx.stroke()

        // Center line markings for major highways
        if (road.kind === 'highway' && zoom >= 16) {
          ctx.strokeStyle = '#facc15'
          ctx.lineWidth = 1
          ctx.setLineDash([5, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }

        // Road Name Badge
        if (zoom >= 18 && road.points.length >= 2) {
          const midIdx = Math.floor(road.points.length / 2)
          const midPt = cellToScreen(road.points[midIdx].x, road.points[midIdx].y)
          ctx.font = 'bold 9.5px Inter, system-ui, sans-serif'
          const rw = ctx.measureText(road.name).width
          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
          ctx.strokeStyle = '#475569'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.roundRect(midPt.x + zoom / 2 - rw / 2 - 5, midPt.y + zoom / 2 - 8, rw + 10, 16, 4)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = '#f1f5f9'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(road.name, midPt.x + zoom / 2, midPt.y + zoom / 2)
        }
      }
      ctx.restore()
    }

    // 7. Vanilla Cells (Muldraugh base)
    if (showVanilla) {
      for (const vm of vanillaMaps) {
        if (!visibleMapIds.has(vm.id)) continue
        const isMuldraughBase = vm.folderName.toLowerCase().startsWith('muldraugh')
        ctx.fillStyle = isMuldraughBase ? 'rgba(30, 48, 71, 0.25)' : 'rgba(56, 189, 248, 0.25)'
        ctx.strokeStyle = isMuldraughBase ? '#1e3047' : '#38bdf8'
        ctx.lineWidth = 1

        for (const cellStr of vm.cells) {
          const [cx, cy] = cellStr.split('_').map(Number)
          if (cx < startX || cx > endX || cy < startY || cy > endY) continue

          const { x: sx, y: sy } = cellToScreen(cx, cy)
          ctx.fillRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1)
          if (!isMuldraughBase) {
            ctx.strokeRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1)
          }
        }
      }
    }

    // 8. Canonical Urban Zones & Cities (With street grids & building footprints)
    if (showTowns) {
      for (const zone of urbanZones) {
        const { minX: zx1, maxX: zx2, minY: zy1, maxY: zy2 } = zone.cellBounds
        if (zx2 < startX || zx1 > endX || zy2 < startY || zy1 > endY) continue

        const p1 = cellToScreen(zx1, zy1)
        const p2 = cellToScreen(zx2 + 1, zy2 + 1)
        const zoneW = p2.x - p1.x
        const zoneH = p2.y - p1.y

        // Distinct category coloring
        let zoneFill = 'rgba(245, 158, 11, 0.12)'
        let zoneBorder = '#f59e0b'

        if (zone.category === 'metropolis') {
          zoneFill = 'rgba(234, 88, 12, 0.16)'
          zoneBorder = '#ea580c'
        } else if (zone.category === 'military') {
          zoneFill = 'rgba(239, 68, 68, 0.16)'
          zoneBorder = '#ef4444'
        } else if (zone.category === 'commercial') {
          zoneFill = 'rgba(16, 185, 129, 0.14)'
          zoneBorder = '#10b981'
        } else if (zone.category === 'settlement') {
          zoneFill = 'rgba(217, 119, 6, 0.10)'
          zoneBorder = '#d97706'
        }

        const isHovered = hoveredZone?.id === zone.id
        const isSelected = selectedZone?.id === zone.id

        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.35)' : isHovered ? 'rgba(245, 158, 11, 0.28)' : zoneFill
        ctx.fillRect(p1.x, p1.y, zoneW, zoneH)

        // Procedural Urban Street Grids & Building Blocks (GIS Editor view)
        if (zoom >= 14) {
          ctx.save()
          for (let cx = Math.max(startX, zx1); cx <= Math.min(endX, zx2); cx++) {
            for (let cy = Math.max(startY, zy1); cy <= Math.min(endY, zy2); cy++) {
              const { x: csx, y: csy } = cellToScreen(cx, cy)
              const subStep = zoom / 3

              // Local streets
              ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)'
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(csx + subStep, csy)
              ctx.lineTo(csx + subStep, csy + zoom)
              ctx.moveTo(csx + subStep * 2, csy)
              ctx.lineTo(csx + subStep * 2, csy + zoom)
              ctx.moveTo(csx, csy + subStep)
              ctx.lineTo(csx + zoom, csy + subStep)
              ctx.moveTo(csx, csy + subStep * 2)
              ctx.lineTo(csx + zoom, csy + subStep * 2)
              ctx.stroke()

              // Building block footprints
              const seed = (cx * 73856093) ^ (cy * 19349663)
              ctx.fillStyle = 'rgba(100, 116, 139, 0.35)'
              ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)'
              ctx.lineWidth = 0.8

              for (let bx = 0; bx < 3; bx++) {
                for (let by = 0; by < 3; by++) {
                  const bSeed = (seed + bx * 31 + by * 17) & 0xff
                  if (bSeed % 10 < 7) {
                    const bw = subStep * 0.62
                    const bh = subStep * 0.62
                    const bpx = csx + bx * subStep + subStep * 0.19
                    const bpy = csy + by * subStep + subStep * 0.19
                    ctx.fillRect(bpx, bpy, bw, bh)
                    ctx.strokeRect(bpx, bpy, bw, bh)
                  }
                }
              }
            }
          }
          ctx.restore()
        }

        ctx.strokeStyle = isSelected ? '#38bdf8' : isHovered ? '#ffffff' : zoneBorder
        ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5
        ctx.setLineDash(isSelected ? [] : [6, 4])
        ctx.strokeRect(p1.x + 0.5, p1.y + 0.5, zoneW - 1, zoneH - 1)
        ctx.setLineDash([])

        // Draw Town Badge & Name
        if (zoom >= 11) {
          const center = cellToScreen(zone.centerCell.x, zone.centerCell.y)
          const badgeX = center.x + zoom / 2
          const badgeY = center.y + zoom / 2

          ctx.font = 'bold 12px Inter, system-ui, sans-serif'
          const labelText = isRu ? zone.nameRu : zone.name
          const textW = ctx.measureText(labelText).width

          ctx.fillStyle = 'rgba(15, 23, 42, 0.90)'
          ctx.strokeStyle = isSelected ? '#38bdf8' : zoneBorder
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.roundRect(badgeX - textW / 2 - 8, badgeY - 14, textW + 16, 24, 6)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(labelText, badgeX, badgeY - 2)
        }
      }
    }

    // 8. Modded Map Cells
    for (const mm of modMaps) {
      if (!visibleMapIds.has(mm.id)) continue
      const color = mapColors.get(mm.id) || '#38bdf8'

      ctx.fillStyle = color
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2

      for (const cellStr of mm.cells) {
        const [cx, cy] = cellStr.split('_').map(Number)
        if (cx < startX || cx > endX || cy < startY || cy > endY) continue

        const { x: sx, y: sy } = cellToScreen(cx, cy)
        ctx.fillRect(sx + 1, sy + 1, zoom - 2, zoom - 2)
      }
      ctx.globalAlpha = 1.0

      for (const cellStr of mm.cells) {
        const [cx, cy] = cellStr.split('_').map(Number)
        if (cx < startX || cx > endX || cy < startY || cy > endY) continue
        const { x: sx, y: sy } = cellToScreen(cx, cy)
        ctx.strokeRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1)
      }
    }

    // 9. Conflict Hatched Stripes
    for (const conf of conflicts) {
      if (conf.x < startX || conf.x > endX || conf.y < startY || conf.y > endY) continue
      const { x: sx, y: sy } = cellToScreen(conf.x, conf.y)

      ctx.save()
      ctx.beginPath()
      ctx.rect(sx + 1, sy + 1, zoom - 2, zoom - 2)
      ctx.clip()

      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      const step = 6
      for (let i = -zoom; i <= zoom * 2; i += step) {
        ctx.beginPath()
        ctx.moveTo(sx + i, sy)
        ctx.lineTo(sx + i + zoom, sy + zoom)
        ctx.stroke()
      }
      ctx.restore()

      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = 2
      ctx.strokeRect(sx + 1, sy + 1, zoom - 2, zoom - 2)
    }

    // 10. Selected Cells Group (Multi-cell claim selection)
    if (selectedCellsGroup.size > 0) {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.28)'
      ctx.strokeStyle = '#06b6d4'
      ctx.lineWidth = 2

      for (const cellStr of selectedCellsGroup) {
        const [cx, cy] = cellStr.split('_').map(Number)
        if (cx < startX || cx > endX || cy < startY || cy > endY) continue
        const { x: sx, y: sy } = cellToScreen(cx, cy)
        ctx.fillRect(sx + 1, sy + 1, zoom - 2, zoom - 2)
        ctx.strokeRect(sx + 1, sy + 1, zoom - 2, zoom - 2)
      }
    }

    // 11. Box Selection in progress
    if (isBoxSelecting && boxSelectStart.current && boxSelectCurrent) {
      const minX = Math.min(boxSelectStart.current.x, boxSelectCurrent.x)
      const maxX = Math.max(boxSelectStart.current.x, boxSelectCurrent.x)
      const minY = Math.min(boxSelectStart.current.y, boxSelectCurrent.y)
      const maxY = Math.max(boxSelectStart.current.y, boxSelectCurrent.y)

      const p1 = cellToScreen(minX, minY)
      const p2 = cellToScreen(maxX + 1, maxY + 1)
      const bw = p2.x - p1.x
      const bh = p2.y - p1.y

      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)'
      ctx.fillRect(p1.x, p1.y, bw, bh)

      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(p1.x, p1.y, bw, bh)
      ctx.setLineDash([])
    }

    // 12. Tactical Ruler overlay
    if (activeTool === 'ruler' && rulerStart && rulerCurrent) {
      const p1 = cellToScreen(rulerStart.x, rulerStart.y)
      const p2 = cellToScreen(rulerCurrent.x, rulerCurrent.y)
      const p1Center = { x: p1.x + zoom / 2, y: p1.y + zoom / 2 }
      const p2Center = { x: p2.x + zoom / 2, y: p2.y + zoom / 2 }

      ctx.strokeStyle = '#eab308'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(p1Center.x, p1Center.y)
      ctx.lineTo(p2Center.x, p2Center.y)
      ctx.stroke()

      // Target markers
      ctx.fillStyle = '#eab308'
      ctx.beginPath()
      ctx.arc(p1Center.x, p1Center.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p2Center.x, p2Center.y, 5, 0, Math.PI * 2)
      ctx.fill()

      // Distance calculations
      const dxCells = Math.abs(rulerCurrent.x - rulerStart.x)
      const dyCells = Math.abs(rulerCurrent.y - rulerStart.y)
      const distCells = Math.hypot(dxCells, dyCells)
      const distTiles = Math.round(distCells * 300)
      const distKm = (distTiles / 1000).toFixed(2)
      const walkMinutesPz = Math.round((distTiles / 4.5) / 60)

      const midX = (p1Center.x + p2Center.x) / 2
      const midY = (p1Center.y + p2Center.y) / 2

      ctx.font = 'bold 11px monospace'
      const label = `${distTiles} tiles (~${distKm} km) | 🚶 ~${walkMinutesPz}m PZ`
      const tw = ctx.measureText(label).width

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
      ctx.strokeStyle = '#eab308'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(midX - tw / 2 - 8, midY - 14, tw + 16, 22, 4)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#fef08a'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, midX, midY - 3)
    }

    // 13. Spawn Points (Rendered if toggled and zoom is detailed)
    if (showSpawns && zoom >= 14) {
      const all = [...(showVanilla ? vanillaMaps : []), ...modMaps]
      for (const m of all) {
        if (!visibleMapIds.has(m.id) || !m.spawns) continue
        for (const sp of m.spawns) {
          if (sp.worldX < startX || sp.worldX > endX || sp.worldY < startY || sp.worldY > endY)
            continue
          const { x: sx, y: sy } = cellToScreen(sp.worldX, sp.worldY)
          const px = sx + (sp.posX / 300) * zoom
          const py = sy + (sp.posY / 300) * zoom

          ctx.fillStyle = '#eab308'
          ctx.beginPath()
          ctx.arc(px, py, Math.max(3, zoom / 7), 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#000000'
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
      }
    }

    // 14. Hovered Cell
    if (hoveredCell) {
      const { x: sx, y: sy } = cellToScreen(hoveredCell.x, hoveredCell.y)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.lineWidth = 1.8
      ctx.strokeRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1)
    }

    // 15. Selected Cell (Single focus)
    if (selectedCell) {
      const { x: sx, y: sy } = cellToScreen(selectedCell.x, selectedCell.y)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2.5
      ctx.shadowColor = '#0284c7'
      ctx.shadowBlur = 10
      ctx.strokeRect(sx, sy, zoom, zoom)
      ctx.shadowBlur = 0
    }

    // 15b. Cell coordinate tags (e.g. 38, 23)
    if (zoom >= 26) {
      ctx.fillStyle = '#475569'
      ctx.font = '9px monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      for (let cx = startX; cx <= endX; cx++) {
        for (let cy = startY; cy <= endY; cy++) {
          const { x: sx, y: sy } = cellToScreen(cx, cy)
          ctx.fillText(`${cx},${cy}`, sx + 3, sy + 3)
        }
      }
    }

    // 16. Minimap Radar (Knox County Overview in bottom-right)
    const mmX = width - MINIMAP_WIDTH - MINIMAP_PAD
    const mmY = height - MINIMAP_HEIGHT - MINIMAP_PAD

    ctx.save()
    ctx.fillStyle = 'rgba(11, 19, 31, 0.85)'
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(mmX, mmY, MINIMAP_WIDTH, MINIMAP_HEIGHT, 8)
    ctx.fill()
    ctx.stroke()

    // Minimap scale
    const worldSpanX = Math.max(1, bounds.maxX - bounds.minX + 1)
    const worldSpanY = Math.max(1, bounds.maxY - bounds.minY + 1)
    const mmScaleX = (MINIMAP_WIDTH - 16) / worldSpanX
    const mmScaleY = (MINIMAP_HEIGHT - 16) / worldSpanY
    const mmScale = Math.min(mmScaleX, mmScaleY)

    const mmOffsetX = mmX + (MINIMAP_WIDTH - worldSpanX * mmScale) / 2
    const mmOffsetY = mmY + (MINIMAP_HEIGHT - worldSpanY * mmScale) / 2

    // Draw minimap base cells
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(mmOffsetX, mmOffsetY, worldSpanX * mmScale, worldSpanY * mmScale)

    // Draw minimap waterways
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = 1.5
    for (const w of waterways) {
      if (w.points.length < 2) continue
      ctx.beginPath()
      const p0 = {
        x: mmOffsetX + (w.points[0].x - bounds.minX) * mmScale,
        y: mmOffsetY + (w.points[0].y - bounds.minY) * mmScale
      }
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < w.points.length; i++) {
        ctx.lineTo(
          mmOffsetX + (w.points[i].x - bounds.minX) * mmScale,
          mmOffsetY + (w.points[i].y - bounds.minY) * mmScale
        )
      }
      ctx.stroke()
    }

    // Draw minimap urban centers
    for (const z of urbanZones) {
      const zx = mmOffsetX + (z.centerCell.x - bounds.minX) * mmScale
      const zy = mmOffsetY + (z.centerCell.y - bounds.minY) * mmScale
      ctx.fillStyle = z.category === 'metropolis' ? '#ea580c' : '#f59e0b'
      ctx.beginPath()
      ctx.arc(zx, zy, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw minimap viewport camera rectangle
    const camX1 = mmOffsetX + (startX - bounds.minX) * mmScale
    const camY1 = mmOffsetY + (startY - bounds.minY) * mmScale
    const camW = (endX - startX + 1) * mmScale
    const camH = (endY - startY + 1) * mmScale

    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.strokeRect(camX1, camY1, camW, camH)
    ctx.restore()
  }, [
    zoom,
    pan,
    canvasSize,
    bounds,
    vanillaMaps,
    modMaps,
    conflicts,
    urbanZones,
    waterways,
    roads,
    mapColors,
    visibleMapIds,
    selectedCell,
    selectedZone,
    selectedCellsGroup,
    hoveredCell,
    hoveredZone,
    isBoxSelecting,
    boxSelectCurrent,
    activeTool,
    rulerStart,
    rulerCurrent,
    showSpawns,
    showVanilla,
    showTowns,
    showWaterways,
    isRu,
    cellToScreen
  ])

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    // Check if clicked inside Minimap radar to fast-travel camera
    const canvasW = canvasRef.current?.width || 800
    const canvasH = canvasRef.current?.height || 600
    const mmX = canvasW - MINIMAP_WIDTH - MINIMAP_PAD
    const mmY = canvasH - MINIMAP_HEIGHT - MINIMAP_PAD

    if (sx >= mmX && sx <= mmX + MINIMAP_WIDTH && sy >= mmY && sy <= mmY + MINIMAP_HEIGHT) {
      const worldSpanX = Math.max(1, bounds.maxX - bounds.minX + 1)
      const worldSpanY = Math.max(1, bounds.maxY - bounds.minY + 1)
      const mmScale = Math.min((MINIMAP_WIDTH - 16) / worldSpanX, (MINIMAP_HEIGHT - 16) / worldSpanY)
      const mmOffsetX = mmX + (MINIMAP_WIDTH - worldSpanX * mmScale) / 2
      const mmOffsetY = mmY + (MINIMAP_HEIGHT - worldSpanY * mmScale) / 2

      const targetCellX = Math.round((sx - mmOffsetX) / mmScale) + bounds.minX
      const targetCellY = Math.round((sy - mmOffsetY) / mmScale) + bounds.minY
      setPan({
        x: canvasW / 2 - (targetCellX - bounds.minX + 0.5) * zoom,
        y: canvasH / 2 - (targetCellY - bounds.minY + 0.5) * zoom
      })
      return
    }

    const cell = screenToCell(sx, sy)

    // Pan camera on Middle click or Right click or Shift+Left click
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      return
    }

    if (e.button === 0) {
      if (activeTool === 'select') {
        setIsBoxSelecting(true)
        boxSelectStart.current = cell
        setBoxSelectCurrent(cell)
      } else if (activeTool === 'ruler') {
        setRulerStart(cell)
        setRulerCurrent(cell)
      } else if (activeTool === 'spawn') {
        // Place spawn point at exact tile offset
        const { x: cellSx, y: cellSy } = cellToScreen(cell.x, cell.y)
        const localPx = Math.min(299, Math.max(0, Math.round(((sx - cellSx) / zoom) * 300)))
        const localPy = Math.min(299, Math.max(0, Math.round(((sy - cellSy) / zoom) * 300)))
        if (onAddSpawnPoint) {
          onAddSpawnPoint(cell.x, cell.y, localPx, localPy)
        }
      } else {
        // Pan tool or default inspect
        setIsDragging(true)
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    const cell = screenToCell(sx, sy)
    setHoveredCell(cell)
    setHoveredZone(findZoneForCell(cell.x, cell.y) || null)

    if (isDragging) {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPan({
        x: dragStart.current.panX + dx,
        y: dragStart.current.panY + dy
      })
    } else if (isBoxSelecting && boxSelectStart.current) {
      setBoxSelectCurrent(cell)
    } else if (activeTool === 'ruler' && rulerStart) {
      setRulerCurrent(cell)
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setIsDragging(false)
      const dx = Math.abs(e.clientX - dragStart.current.x)
      const dy = Math.abs(e.clientY - dragStart.current.y)
      // If minimal movement, register as cell click
      if (dx < 4 && dy < 4 && activeTool === 'inspect') {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const sx = e.clientX - rect.left
          const sy = e.clientY - rect.top
          const cell = screenToCell(sx, sy)
          onSelectCell(cell)
          const zone = findZoneForCell(cell.x, cell.y)
          onSelectZone(zone || null)
        }
      }
    }

    if (isBoxSelecting && boxSelectStart.current && boxSelectCurrent) {
      setIsBoxSelecting(false)
      const minX = Math.min(boxSelectStart.current.x, boxSelectCurrent.x)
      const maxX = Math.max(boxSelectStart.current.x, boxSelectCurrent.x)
      const minY = Math.min(boxSelectStart.current.y, boxSelectCurrent.y)
      const maxY = Math.max(boxSelectStart.current.y, boxSelectCurrent.y)

      const group = new Set<string>()
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          group.add(`${x}_${y}`)
        }
      }
      onSelectCellsGroup(group)
      boxSelectStart.current = null
      setBoxSelectCurrent(null)
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const delta = e.deltaY < 0 ? 1.15 : 0.87
    const newZoom = Math.min(Math.max(8, Math.round(zoom * delta)), 70)
    if (newZoom === zoom) return

    setPan({
      x: mx - (mx - pan.x) * (newZoom / zoom),
      y: my - (my - pan.y) * (newZoom / zoom)
    })
    setZoom(newZoom)
  }

  // ResizeObserver ensures canvas pixel buffer matches container exactly
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleSize = (w: number, h: number) => {
      const floorW = Math.max(1, Math.floor(w))
      const floorH = Math.max(1, Math.floor(h))
      if (canvasRef.current) {
        if (canvasRef.current.width !== floorW) canvasRef.current.width = floorW
        if (canvasRef.current.height !== floorH) canvasRef.current.height = floorH
      }
      setCanvasSize((prev) => {
        if (prev.width === floorW && prev.height === floorH) return prev
        return { width: floorW, height: floorH }
      })
    }

    if (container.clientWidth > 0 && container.clientHeight > 0) {
      handleSize(container.clientWidth, container.clientHeight)
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          handleSize(width, height)
        }
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="knox-map-canvas-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`knox-map-canvas tool-${activeTool}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Floating Selection Banner when cells are claimed */}
      {selectedCellsGroup.size > 0 && (
        <div className="knox-selection-banner">
          <div className="knox-selection-info">
            <Icon name="map-pin" size={16} />
            <span>
              {isRu
                ? `Выбрано клеток: ${selectedCellsGroup.size} (~${selectedCellsGroup.size * 300 * 300} м²)`
                : `Selected cells: ${selectedCellsGroup.size} (~${selectedCellsGroup.size * 300 * 300} m²)`}
            </span>
          </div>
          <div className="knox-selection-actions">
            {onRequestScaffold && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onRequestScaffold}
              >
                <Icon name="wand" size={14} />
                <span>{isRu ? '⚡ Создать мод карты' : '⚡ Scaffold Map Mod'}</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSelectCellsGroup(new Set())}
            >
              <Icon name="x" size={14} />
              <span>{isRu ? 'Сбросить' : 'Clear'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Tactical GIS Telemetry HUD (Bottom Bar) */}
      <div className="knox-telemetry-hud">
        <div className="hud-segment">
          <span className="hud-label">{isRu ? 'КЛЕТКА' : 'CELL'}</span>
          <span className="hud-val">
            {hoveredCell ? `[${hoveredCell.x}, ${hoveredCell.y}]` : '—'}
          </span>
        </div>
        <div className="hud-segment">
          <span className="hud-label">{isRu ? 'ТАЙЛЫ МИРА' : 'WORLD TILES'}</span>
          <span className="hud-val">
            {hoveredCell
              ? `[${hoveredCell.x * 300}..${(hoveredCell.x + 1) * 300 - 1}, ${hoveredCell.y * 300}..${(hoveredCell.y + 1) * 300 - 1}]`
              : '—'}
          </span>
        </div>
        <div className="hud-segment">
          <span className="hud-label">{isRu ? 'ЛОКАЦИЯ' : 'ZONE'}</span>
          <span className="hud-val hud-zone">
            {hoveredZone
              ? (isRu ? hoveredZone.nameRu : hoveredZone.name)
              : isRu
                ? '🌲 Глушь округа Нокс'
                : '🌲 Knox Wilderness'}
          </span>
        </div>
        <div className="hud-segment">
          <span className="hud-label">{isRu ? 'МАСШТАБ' : 'SCALE'}</span>
          <span className="hud-val">
            {zoom}px / {isRu ? 'кл' : 'cell'} (1:{Math.round(300 / Math.max(1, zoom))})
          </span>
        </div>
      </div>
    </div>
  )
}
