import { useState } from 'react'
import type { CartographerScaffoldRequest } from '@shared/types'
import { Icon } from '@renderer/components/Icon'

interface CartographerStudioModalProps {
  selectedCells: string[]
  isRu: boolean
  onClose: () => void
  onSuccess: (modId: string, mapFolder: string) => void
}

export function CartographerStudioModal({
  selectedCells,
  isRu,
  onClose,
  onSuccess
}: CartographerStudioModalProps) {
  const [modName, setModName] = useState('')
  const [modId, setModId] = useState('')
  const [mapFolder, setMapFolder] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('PZ Modder')
  const [targetLocation, setTargetLocation] = useState<'localMods' | 'workspace'>('localMods')
  const [baseLots, setBaseLots] = useState('Muldraugh, KY')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (val: string) => {
    setModName(val)
    if (!modId) {
      const slug = val.replace(/[^a-zA-Z0-9_]/g, '')
      setModId(slug)
      setMapFolder(slug ? `${slug}_Map` : '')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modId.trim()) {
      setError(isRu ? 'Укажите идентификатор мода (Mod ID)' : 'Specify Mod ID')
      return
    }
    if (!mapFolder.trim()) {
      setError(isRu ? 'Укажите имя папки карты' : 'Specify map folder name')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const req: CartographerScaffoldRequest = {
        modId: modId.trim(),
        modName: modName.trim() || modId.trim(),
        mapFolderName: mapFolder.trim(),
        description: description.trim(),
        author: author.trim(),
        cells: selectedCells,
        targetLocation,
        lots: baseLots.trim() || 'Muldraugh, KY',
        includeSpawnpoint: true
      }

      const res = await window.pz.cartographer.scaffoldMap(req)
      if (res.ok) {
        onSuccess(req.modId, req.mapFolderName)
        onClose()
      } else {
        setError(res.error || 'Failed to scaffold map mod')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="carto-modal-overlay" onClick={onClose}>
      <div className="carto-modal" onClick={(e) => e.stopPropagation()}>
        <div className="carto-modal-header">
          <div className="carto-modal-title">
            <Icon name="wand" size={18} />
            <h3>{isRu ? 'Мастер создания карты (Map Studio)' : 'Map Modder Studio'}</h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="carto-modal-body">
          {error && <div className="carto-modal-alert alert-error">{error}</div>}

          <div className="carto-form-group">
            <label>{isRu ? 'Название карты / мода:' : 'Map / Mod Title:'}</label>
            <input
              type="text"
              className="input-field"
              placeholder={isRu ? 'Например: Blackwood Outpost' : 'e.g. Blackwood Outpost'}
              value={modName}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>

          <div className="carto-form-row">
            <div className="carto-form-group">
              <label>{isRu ? 'Mod ID (идентификатор):' : 'Mod ID:'}</label>
              <input
                type="text"
                className="input-field font-mono"
                placeholder="BlackwoodOutpost"
                value={modId}
                onChange={(e) => setModId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                required
              />
            </div>

            <div className="carto-form-group">
              <label>{isRu ? 'Папка карты (media/maps/...):' : 'Map Folder Name:'}</label>
              <input
                type="text"
                className="input-field font-mono"
                placeholder="BlackwoodOutpost_Map"
                value={mapFolder}
                onChange={(e) => setMapFolder(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="carto-form-group">
            <label>{isRu ? 'Описание мода:' : 'Description:'}</label>
            <textarea
              className="input-field"
              rows={2}
              placeholder={isRu ? 'Краткое описание вашей локации' : 'Short description of your map'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="carto-form-row">
            <div className="carto-form-group">
              <label>{isRu ? 'Автор:' : 'Author:'}</label>
              <input
                type="text"
                className="input-field"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>

            <div className="carto-form-group">
              <label>{isRu ? 'Базовые лоты (lots=):' : 'Base Lots (lots=):'}</label>
              <input
                type="text"
                className="input-field"
                value={baseLots}
                onChange={(e) => setBaseLots(e.target.value)}
              />
            </div>
          </div>

          <div className="carto-form-group">
            <label>{isRu ? 'Целевая директория:' : 'Target Directory:'}</label>
            <div className="carto-radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="targetLoc"
                  value="localMods"
                  checked={targetLocation === 'localMods'}
                  onChange={() => setTargetLocation('localMods')}
                />
                <span>
                  {isRu
                    ? '📁 Папка модов пользователя (Zomboid/mods/)'
                    : '📁 User Mods Folder (Zomboid/mods/)'}
                </span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="targetLoc"
                  value="workspace"
                  checked={targetLocation === 'workspace'}
                  onChange={() => setTargetLocation('workspace')}
                />
                <span>
                  {isRu
                    ? '🛠️ Рабочая среда PZ Management (projects/)'
                    : '🛠️ PZ Management Workspace (projects/)'}
                </span>
              </label>
            </div>
          </div>

          <div className="carto-cells-summary">
            <div className="summary-title">
              <Icon name="map-pin" size={14} />
              <span>
                {isRu
                  ? `Территория карты (${selectedCells.length} клеток):`
                  : `Claimed Territory (${selectedCells.length} cells):`}
              </span>
            </div>
            <div className="summary-chips">
              {selectedCells.slice(0, 16).map((c) => (
                <span key={c} className="cell-chip">
                  {c}
                </span>
              ))}
              {selectedCells.length > 16 && (
                <span className="cell-chip-more">+{selectedCells.length - 16}...</span>
              )}
            </div>
          </div>

          <div className="carto-modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isSubmitting}>
              {isRu ? 'Отмена' : 'Cancel'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              <Icon name="rocket" size={15} />
              <span>
                {isSubmitting
                  ? isRu
                    ? 'Создание...'
                    : 'Scaffolding...'
                  : isRu
                    ? '🚀 Сгенерировать каркас мода'
                    : '🚀 Create Map Mod'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
