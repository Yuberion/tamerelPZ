import { useMemo, useState } from 'react'
import type { LoadoutFile, ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import { bareId } from './useLoadout'
import { isSeparator } from './OrderList'

interface ServerSyncModalProps {
  activeMods: string[]
  activeMaps: string[]
  byModId: Map<string, ModEntry>
  serverFiles: LoadoutFile[]
  onSyncComplete(): void
  onClose(): void
}

export function ServerSyncModal({
  activeMods,
  activeMaps,
  byModId,
  serverFiles,
  onSyncComplete,
  onClose
}: ServerSyncModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()

  const [selectedServerId, setSelectedServerId] = useState<string>(
    () => serverFiles[0]?.id ?? ''
  )
  const [saving, setSaving] = useState(false)

  // Clean active mods (filter out visual separators)
  const cleanMods = useMemo(() => {
    return activeMods.filter((m) => !isSeparator(m))
  }, [activeMods])

  // Extract Workshop item IDs from active mods
  const workshopItems = useMemo(() => {
    const set = new Set<string>()
    for (const rawId of cleanMods) {
      const bare = bareId(rawId)
      const mod = byModId.get(bare)
      if (mod?.workshopId) {
        set.add(mod.workshopId.trim())
      }
    }
    return Array.from(set)
  }, [cleanMods, byModId])

  const selectedServer = serverFiles.find((f) => f.id === selectedServerId)

  // Formatted INI text block
  const iniText = useMemo(() => {
    const lines: string[] = []
    lines.push(`Mods=${cleanMods.join(';')}${cleanMods.length > 0 ? ';' : ''}`)
    lines.push(`WorkshopItems=${workshopItems.join(';')}${workshopItems.length > 0 ? ';' : ''}`)
    if (activeMaps.length > 0) {
      lines.push(`Map=${activeMaps.join(';')};`)
    }
    return lines.join('\n')
  }, [cleanMods, workshopItems, activeMaps])

  const handleCopy = async (): Promise<void> => {
    await copyText(iniText)
    notify(isRu ? 'Конфигурация сервера скопирована!' : 'Server INI block copied!', 'ok')
  }

  const handleApplyToServer = async (): Promise<void> => {
    if (!selectedServer) return
    setSaving(true)
    try {
      await window.pz.loadout.apply({
        targetId: selectedServer.id,
        mods: cleanMods,
        maps: activeMaps,
        workshopItems,
        backup: true
      })
      notify(
        isRu
          ? `Сервер "${selectedServer.serverName}" успешно обновлён!`
          : `Server "${selectedServer.serverName}" synced successfully!`,
        'ok'
      )
      onSyncComplete()
      onClose()
    } catch (err) {
      notify(String(err), 'warn')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--server-sync" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon name="server" size={16} color="var(--ember)" />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Экспорт & Синхронизация с сервером (server.ini)' : 'Export & Server Sync (server.ini)'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__body" style={{ padding: '16px 20px' }}>
          {/* Target server selection */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--ash)', marginBottom: 6 }}>
              {isRu ? 'Целевой конфиг сервера (Zomboid/Server/*.ini):' : 'Target Server Config (Zomboid/Server/*.ini):'}
            </label>
            {serverFiles.length > 0 ? (
              <select
                className="select"
                style={{ width: '100%', padding: '6px 10px', background: '#14181e', color: 'var(--bone)', border: '1px solid #28313e', borderRadius: '4px' }}
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value)}
              >
                {serverFiles.map((sf) => (
                  <option key={sf.id} value={sf.id}>
                    {sf.serverName}.ini ({sf.mods.length} {isRu ? 'модов' : 'mods'})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--ash-faint)' }}>
                {isRu
                  ? 'Конфиги серверов не найдены в Zomboid/Server. Вы можете скопировать сгенерированный блок ниже вручную.'
                  : 'No server configs found in Zomboid/Server. You can copy the generated block below.'}
              </div>
            )}
          </div>

          {/* Stats pills */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <span className="lopill lopill--sep-count">
              <strong>{cleanMods.length}</strong> {isRu ? 'модов' : 'mods'}
            </span>
            <span className="lopill lopill--overwrite">
              <strong>{workshopItems.length}</strong> Workshop IDs
            </span>
            <span className="lopill lopill--dupe">
              <strong>{activeMaps.length}</strong> {isRu ? 'карт' : 'maps'}
            </span>
          </div>

          {/* Formatted Code Block */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '11px', color: 'var(--ash-faint)' }}>
                {isRu ? 'Готовый фрагмент для вставки в server.ini:' : 'Ready-to-paste server.ini block:'}
              </span>
              <button className="btn btn-sm" onClick={handleCopy}>
                <Icon name="copy" size={11} />
                {isRu ? 'Копировать' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={iniText}
              rows={8}
              style={{
                width: '100%',
                background: '#0e1216',
                color: '#86efac',
                border: '1px solid #232c37',
                borderRadius: '6px',
                padding: '10px 12px',
                fontFamily: 'monospace',
                fontSize: '11.5px',
                lineHeight: '1.4',
                resize: 'none'
              }}
            />
          </div>
        </div>

        <div className="lomodal__foot">
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
          <div className="toolbar__spacer" />
          <button className="btn" onClick={handleCopy}>
            <Icon name="copy" size={12} />
            {isRu ? 'Копировать в буфер' : 'Copy to Clipboard'}
          </button>
          {selectedServer && (
            <button className="btn is-primary" disabled={saving} onClick={handleApplyToServer}>
              <Icon name="refresh" size={12} />
              {saving
                ? isRu ? 'Сохранение...' : 'Saving...'
                : isRu ? `Записать в ${selectedServer.serverName}.ini` : `Save to ${selectedServer.serverName}.ini`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
