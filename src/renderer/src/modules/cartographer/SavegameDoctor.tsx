import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SavegameInfo } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { formatBytes, formatCount } from '@renderer/lib/format'

interface SavegameDoctorProps {
  onExit?: () => void
}

export function SavegameDoctor({ onExit }: SavegameDoctorProps) {
  const { notify } = useToast()

  const [saves, setSaves] = useState<SavegameInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [wiping, setWiping] = useState(false)
  const [createBackup, setCreateBackup] = useState(true)

  // Protected cells set: Set of "cellX,cellY"
  const [protectedCells, setProtectedCells] = useState<Set<string>>(new Set())

  // Player rescue coordinates
  const [playerX, setPlayerX] = useState(10800)
  const [playerY, setPlayerY] = useState(10100)
  const [playerZ, setPlayerZ] = useState(0)
  const [resettingPlayer, setResettingPlayer] = useState(false)

  const loadSaves = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.pz.triage.scanSaves()
      setSaves(list)
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0]!.id)
      }
    } catch (err) {
      notify(`Ошибка сканирования сохранений: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setLoading(false)
    }
  }, [notify, selectedId])

  useEffect(() => {
    void loadSaves()
  }, [loadSaves])

  const currentSave = useMemo(() => {
    return saves.find((s) => s.id === selectedId)
  }, [saves, selectedId])

  // Automatically protect the top cell (likely player base) when selecting a save
  useEffect(() => {
    if (currentSave && currentSave.exploredCells.length > 0) {
      const topCell = currentSave.exploredCells[0]!
      setProtectedCells(new Set([`${topCell.cellX},${topCell.cellY}`]))
    } else {
      setProtectedCells(new Set())
    }
  }, [currentSave])

  const toggleProtectCell = (cellX: number, cellY: number) => {
    const key = `${cellX},${cellY}`
    setProtectedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleProtectTop3 = () => {
    if (!currentSave) return
    const top3 = currentSave.exploredCells.slice(0, 3)
    const next = new Set<string>()
    for (const c of top3) {
      next.add(`${c.cellX},${c.cellY}`)
    }
    setProtectedCells(next)
  }

  const handleWipeChunks = async () => {
    if (!currentSave) return
    if (protectedCells.size === 0) {
      notify('Отметьте ячейку вашей базы, чтобы она не была стёрта при сбросе мира!', 'warn')
      return
    }

    const protectedList = Array.from(protectedCells).map((k) => {
      const [cx, cy] = k.split(',').map(Number)
      return { cellX: cx!, cellY: cy! }
    })

    const confirmed = window.confirm(
      `Внимание! Будут удалены все внешние чанки кроме защищенных ячеек (${protectedCells.size} шт.).\n\nЭто позволит игре заново сгенерировать свежий лут и подвалы B42, сохранив вашу базу.\n\nПродолжить?`
    )
    if (!confirmed) return

    setWiping(true)
    try {
      const res = await window.pz.triage.wipeChunks({
        savePath: currentSave.folderPath,
        protectedCells: protectedList,
        createBackup
      })

      if (res.ok) {
        notify(
          `Soft Reset успешно выполнен! Очищено чанков: ${formatCount(res.wipedChunks)}, освобождено ${formatBytes(res.bytesFreed)}.${
            res.backupPath ? ` Резервная копия создана.` : ''
          }`,
          'ok'
        )
        await loadSaves()
      } else {
        throw new Error(res.error || 'Failed wiping chunks')
      }
    } catch (err) {
      notify(`Ошибка при очистке чанков: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setWiping(false)
    }
  }

  const handleResetPlayer = async () => {
    if (!currentSave) return
    setResettingPlayer(true)
    try {
      const res = await window.pz.triage.resetPlayer({
        savePath: currentSave.folderPath,
        targetX: playerX,
        targetY: playerY,
        targetZ: playerZ
      })

      if (res.ok) {
        notify(res.message, 'ok')
      } else {
        throw new Error(res.error || res.message)
      }
    } catch (err) {
      notify(`Ошибка реанимации персонажа: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setResettingPlayer(false)
    }
  }

  return (
    <div className="savegame-doctor" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: 16 }}>
      {/* Top selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 16px',
          background: 'var(--slate)',
          border: '1px solid var(--rim)',
          borderRadius: 6,
          marginBottom: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onExit && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onExit}
              title="Назад в меню"
              style={{ marginRight: 4 }}
            >
              <Icon name="arrow-left" size={16} />
            </button>
          )}
          <Icon name="pulse" size={20} color="var(--rust-hot)" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="stencil" style={{ fontSize: 13, color: 'var(--bone)' }}>
                05 / TRIAGE • Доктор сохранений (Savegame Doctor)
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(52, 211, 153, 0.12)',
                  color: '#34d399'
                }}
              >
                Build 41 / 42
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
              Лечение сломанных сохранений, сброс застрявшего персонажа и обновление лута карты без потери базы
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--ash)' }}>Сохранение:</span>
          <select
            className="select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loading || saves.length === 0}
            style={{
              minWidth: 240,
              background: 'var(--charcoal)',
              color: 'var(--bone)',
              border: '1px solid var(--rim)',
              borderRadius: 4,
              padding: '5px 10px',
              fontSize: 12
            }}
          >
            {saves.length === 0 ? (
              <option value="">Сохранения не найдены</option>
            ) : (
              saves.map((s) => (
                <option key={s.id} value={s.id}>
                  [{s.gameMode}] {s.name} ({new Date(s.lastModified).toLocaleDateString()})
                </option>
              ))
            )}
          </select>

          <button
            className="btn btn-icon btn-sm"
            onClick={() => void loadSaves()}
            disabled={loading}
            title="Обновить список сохранений"
          >
            <Icon name="refresh" size={13} className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--ash)' }}>
          <Icon name="refresh" size={16} className="spin" />
          <span>Сканирование сохранений в папке Zomboid/Saves...</span>
        </div>
      ) : !currentSave ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--ash)', gap: 6 }}>
          <Icon name="info" size={24} color="var(--dim)" />
          <span>В папке игры Zomboid/Saves пока нет созданных сохранений.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Save Info Card */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: 16,
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--rim)',
              borderRadius: 6,
              padding: 14
            }}
          >
            {/* Thumbnail */}
            <div
              style={{
                width: 140,
                height: 100,
                background: 'rgba(0, 0, 0, 0.4)',
                borderRadius: 4,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--rim)'
              }}
            >
              {currentSave.thumbUrl ? (
                <img
                  src={currentSave.thumbUrl}
                  alt={currentSave.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Icon name="map" size={32} color="var(--dim)" />
              )}
            </div>

            {/* Details */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--bone)' }}>
                    {currentSave.name}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--ash)'
                    }}
                  >
                    Режим: {currentSave.gameMode}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 4 }}>
                  Путь: <span className="mono">{currentSave.folderPath}</span>
                </div>
              </div>

              {/* Quick stats pills */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--bone)', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 8px', borderRadius: 4 }}>
                  Исследовано ячеек: <b style={{ color: '#38bdf8' }}>{currentSave.exploredCells.length}</b>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--bone)', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 8px', borderRadius: 4 }}>
                  Чанков мира: <b style={{ color: '#a78bfa' }}>{formatCount(currentSave.totalChunks)}</b>
                </div>
                {currentSave.playerCount !== undefined && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--bone)', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 8px', borderRadius: 4 }}>
                    Персонажей в базе: <b style={{ color: '#34d399' }}>{currentSave.playerCount}</b>
                  </div>
                )}
                {currentSave.vehicleCount !== undefined && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--bone)', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 8px', borderRadius: 4 }}>
                    Машин в мире: <b style={{ color: '#fbbf24' }}>{currentSave.vehicleCount}</b>
                  </div>
                )}
                <div className="mono" style={{ fontSize: 11, color: 'var(--ash)', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 8px', borderRadius: 4 }}>
                  Активных модов: {currentSave.activeMods.length}
                </div>
              </div>
            </div>
          </div>

          {/* Section 1: Soft Reset & Chunk Cleaner */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--rim)',
              borderRadius: 6,
              padding: 16
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="layers" size={16} color="#34d399" />
                <span className="stencil" style={{ fontSize: 13, color: 'var(--bone)' }}>
                  Очистка внешних чанков (Soft Reset)
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={handleProtectTop3} style={{ fontSize: 11 }}>
                  Защитить топ-3 ячейки
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setProtectedCells(new Set())}
                  style={{ fontSize: 11 }}
                >
                  Снять выбор со всех
                </button>
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.5, marginBottom: 12 }}>
              Отметьте ячейки, где расположена ваша база, убежища и тайники (они помечены зеленым бейджем{' '}
              <b style={{ color: '#34d399' }}>ЗАЩИЩЕНО</b>). Все остальные неотмеченные чанки будут безопасно очищены. При
              следующем исследовании игра заново сгенерирует свежий лут, контейнеры, подвалы и животных Build 42!
            </p>

            {/* Explored cells grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8,
                maxHeight: 220,
                overflowY: 'auto',
                padding: 4,
                marginBottom: 14
              }}
            >
              {currentSave.exploredCells.map((c) => {
                const key = `${c.cellX},${c.cellY}`
                const isProtected = protectedCells.has(key)

                return (
                  <div
                    key={key}
                    onClick={() => toggleProtectCell(c.cellX, c.cellY)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 4,
                      background: isProtected ? 'rgba(52, 211, 153, 0.12)' : 'rgba(0, 0, 0, 0.25)',
                      border: isProtected ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid var(--rim)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bone)' }}>
                        Ячейка ({c.cellX}, {c.cellY})
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ash)' }}>
                        {c.chunkCount} чанков исследовано
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: isProtected ? '#10b981' : 'rgba(255, 255, 255, 0.08)',
                        color: isProtected ? '#fff' : 'var(--ash)'
                      }}
                    >
                      {isProtected ? 'ЗАЩИЩЕНО' : 'ПОД СБРОС'}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Action footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--rim)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--bone)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={createBackup}
                  onChange={(e) => setCreateBackup(e.target.checked)}
                />
                Создать резервную копию сохранения перед очисткой (Рекомендуется)
              </label>

              <button
                className="btn btn-primary"
                onClick={handleWipeChunks}
                disabled={wiping || protectedCells.size === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--rust-hot)',
                  borderColor: 'var(--rust-hot)'
                }}
              >
                <Icon name="trash" size={13} />
                {wiping ? 'Очистка чанков...' : `Выполнить Soft Reset (${protectedCells.size} защ.)`}
              </button>
            </div>
          </div>

          {/* Section 2: Player & Database Rescue */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--rim)',
              borderRadius: 6,
              padding: 16
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Icon name="alert" size={16} color="#38bdf8" />
              <span className="stencil" style={{ fontSize: 13, color: 'var(--bone)' }}>
                Реанимация персонажа (Сброс координат при «черном экране»)
              </span>
            </div>

            <p style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.5, marginBottom: 12 }}>
              Если персонаж погиб, застрял в багованном интерьере или игра зависает на этапе «Загрузка мира» с черным экраном
              из-за поврежденных координат — телепортируйте персонажа в безопасную точку (по умолчанию окрестности Малдро).
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ash)' }}>Координата X:</span>
                <input
                  type="number"
                  className="input"
                  value={playerX}
                  onChange={(e) => setPlayerX(Number(e.target.value))}
                  style={{ width: 90, fontSize: 12, padding: '4px 8px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ash)' }}>Координата Y:</span>
                <input
                  type="number"
                  className="input"
                  value={playerY}
                  onChange={(e) => setPlayerY(Number(e.target.value))}
                  style={{ width: 90, fontSize: 12, padding: '4px 8px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ash)' }}>Высота Z:</span>
                <input
                  type="number"
                  className="input"
                  value={playerZ}
                  onChange={(e) => setPlayerZ(Number(e.target.value))}
                  style={{ width: 60, fontSize: 12, padding: '4px 8px' }}
                />
              </div>

              <button
                className="btn btn-sm"
                onClick={() => {
                  setPlayerX(10800)
                  setPlayerY(10100)
                  setPlayerZ(0)
                }}
                style={{ fontSize: 11 }}
              >
                Спавн: Малдро
              </button>

              <button
                className="btn btn-sm"
                onClick={() => {
                  setPlayerX(8100)
                  setPlayerY(11600)
                  setPlayerZ(0)
                }}
                style={{ fontSize: 11 }}
              >
                Спавн: Роузвуд
              </button>

              <div style={{ flex: 1 }} />

              <button
                className="btn btn-primary"
                onClick={handleResetPlayer}
                disabled={resettingPlayer}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}
              >
                <Icon name="check" size={13} />
                {resettingPlayer ? 'Реанимация...' : 'Сбросить координаты персонажа'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
