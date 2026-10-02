import { useState } from 'react'
import type { CartographerMapItem, CartographerSpawnPoint } from '@shared/types'
import { Icon } from '@renderer/components/Icon'

interface SpawnEditorModalProps {
  mapItem: CartographerMapItem
  isRu: boolean
  onClose: () => void
  onSaveSuccess: (updatedSpawns: CartographerSpawnPoint[]) => void
}

const PROFESSIONS = [
  { id: 'unemployed', nameEn: 'Unemployed', nameRu: 'Безработный' },
  { id: 'policeofficer', nameEn: 'Police Officer', nameRu: 'Полицейский' },
  { id: 'fireofficer', nameEn: 'Fire Officer', nameRu: 'Пожарный' },
  { id: 'doctor', nameEn: 'Doctor', nameRu: 'Врач' },
  { id: 'parkranger', nameEn: 'Park Ranger', nameRu: 'Егерь / Рейнджер' },
  { id: 'veteran', nameEn: 'Veteran', nameRu: 'Ветеран' },
  { id: 'carpenter', nameEn: 'Carpenter', nameRu: 'Плотник' },
  { id: 'burglar', nameEn: 'Burglar', nameRu: 'Взломщик' },
  { id: 'electrician', nameEn: 'Electrician', nameRu: 'Электрик' },
  { id: 'mechanics', nameEn: 'Mechanic', nameRu: 'Автомеханик' },
  { id: 'chef', nameEn: 'Chef', nameRu: 'Повар' }
]

export function SpawnEditorModal({
  mapItem,
  isRu,
  onClose,
  onSaveSuccess
}: SpawnEditorModalProps) {
  const [spawns, setSpawns] = useState<CartographerSpawnPoint[]>(
    mapItem.spawns && mapItem.spawns.length > 0
      ? [...mapItem.spawns]
      : [
          {
            worldX: mapItem.bounds.minX || 35,
            worldY: mapItem.bounds.minY || 32,
            posX: 150,
            posY: 150,
            posZ: 0,
            profession: 'unemployed'
          }
        ]
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAddSpawn = () => {
    const baseCellX = mapItem.bounds.minX || 35
    const baseCellY = mapItem.bounds.minY || 32
    setSpawns((prev) => [
      ...prev,
      {
        worldX: baseCellX,
        worldY: baseCellY,
        posX: 150,
        posY: 150,
        posZ: 0,
        profession: 'unemployed'
      }
    ])
  }

  const handleRemoveSpawn = (idx: number) => {
    setSpawns((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleUpdateSpawn = (idx: number, field: keyof CartographerSpawnPoint, val: any) => {
    setSpawns((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: val }
      return next
    })
  }

  const handleSave = async () => {
    if (spawns.length === 0) {
      setError(isRu ? 'Добавьте хотя бы одну точку спавна' : 'Add at least one spawn point')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const res = await window.pz.cartographer.saveSpawns({
        mapFolderPath: mapItem.folderPath,
        spawns
      })
      if (res.ok) {
        onSaveSuccess(spawns)
        onClose()
      } else {
        setError(res.error || 'Failed to save spawnpoints')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="carto-modal-overlay" onClick={onClose}>
      <div className="carto-modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="carto-modal-header">
          <div className="carto-modal-title">
            <Icon name="crosshair" size={18} />
            <h3>
              {isRu ? 'Редактор точек спавна:' : 'Spawn Points Editor:'} {mapItem.title}
            </h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="carto-modal-body">
          {error && <div className="carto-modal-alert alert-error">{error}</div>}

          <div className="spawns-toolbar">
            <span className="spawns-count">
              {isRu ? `Всего точек: ${spawns.length}` : `Total spawn points: ${spawns.length}`}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSpawn}>
              <Icon name="plus" size={14} />
              <span>{isRu ? 'Добавить точку спавна' : 'Add Spawn Point'}</span>
            </button>
          </div>

          <div className="spawns-table-container">
            <table className="spawns-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{isRu ? 'Профессия' : 'Profession'}</th>
                  <th>{isRu ? 'Клетка (X / Y)' : 'Cell (X / Y)'}</th>
                  <th>{isRu ? 'Локальный тайл (posX / posY)' : 'Local Tile (X / Y)'}</th>
                  <th>{isRu ? 'Этаж (Z)' : 'Floor (Z)'}</th>
                  <th>{isRu ? 'Мировой тайл' : 'World Tile'}</th>
                  <th style={{ width: 48 }}></th>
                </tr>
              </thead>
              <tbody>
                {spawns.map((sp, idx) => {
                  const worldTileX = sp.worldX * 300 + sp.posX
                  const worldTileY = sp.worldY * 300 + sp.posY

                  return (
                    <tr key={idx}>
                      <td className="text-muted">{idx + 1}</td>
                      <td>
                        <select
                          className="input-select"
                          value={sp.profession || 'unemployed'}
                          onChange={(e) => handleUpdateSpawn(idx, 'profession', e.target.value)}
                        >
                          {PROFESSIONS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {isRu ? p.nameRu : p.nameEn}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="coord-inputs">
                          <input
                            type="number"
                            className="input-num"
                            value={sp.worldX}
                            onChange={(e) =>
                              handleUpdateSpawn(idx, 'worldX', parseInt(e.target.value, 10) || 0)
                            }
                          />
                          <span>_</span>
                          <input
                            type="number"
                            className="input-num"
                            value={sp.worldY}
                            onChange={(e) =>
                              handleUpdateSpawn(idx, 'worldY', parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </div>
                      </td>
                      <td>
                        <div className="coord-inputs">
                          <input
                            type="number"
                            min={0}
                            max={299}
                            className="input-num"
                            value={sp.posX}
                            onChange={(e) =>
                              handleUpdateSpawn(idx, 'posX', parseInt(e.target.value, 10) || 0)
                            }
                          />
                          <span>,</span>
                          <input
                            type="number"
                            min={0}
                            max={299}
                            className="input-num"
                            value={sp.posY}
                            onChange={(e) =>
                              handleUpdateSpawn(idx, 'posY', parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={7}
                          className="input-num floor-input"
                          value={sp.posZ}
                          onChange={(e) =>
                            handleUpdateSpawn(idx, 'posZ', parseInt(e.target.value, 10) || 0)
                          }
                        />
                      </td>
                      <td className="font-mono text-cyan">
                        [{worldTileX}, {worldTileY}]
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon text-red"
                          onClick={() => handleRemoveSpawn(idx)}
                          title={isRu ? 'Удалить точку' : 'Delete'}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="carto-modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isSaving}>
              {isRu ? 'Отмена' : 'Cancel'}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
              <Icon name="save" size={15} />
              <span>
                {isSaving
                  ? isRu
                    ? 'Сохранение...'
                    : 'Saving...'
                  : isRu
                    ? '💾 Сохранить spawnpoints.lua'
                    : '💾 Save spawnpoints.lua'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
