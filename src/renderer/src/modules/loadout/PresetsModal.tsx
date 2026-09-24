import { useState } from 'react'
import type { LoadoutProfile, ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import { exportShareText, importShareText } from './mlos'

interface PresetsModalProps {
  currentMods: string[]
  currentKind: 'client' | 'server' | 'save'
  byModId: Map<string, ModEntry>
  profiles: LoadoutProfile[]
  gamePresets: Record<string, string[]>
  onSaveProfile(name: string): Promise<void>
  onDeleteProfile(id: string): Promise<void>
  onApplyProfile(profile: LoadoutProfile): void
  onApplyGamePreset(name: string, modIds: string[]): void
  onImportGamePresets(gamePresets: Record<string, string[]>): Promise<void>
  onDeleteGamePreset(name: string): Promise<void>
  onImportCustomList(name: string, modIds: string[]): void
  onClose(): void
}

type PresetTab = 'profiles' | 'game' | 'share'

export function PresetsModal({
  currentMods,
  currentKind: _currentKind,
  byModId,
  profiles,
  gamePresets,
  onSaveProfile,
  onDeleteProfile,
  onApplyProfile,
  onApplyGamePreset,
  onImportGamePresets,
  onDeleteGamePreset,
  onImportCustomList,
  onClose
}: PresetsModalProps) {
  const { lang } = useI18n()
  const { notify } = useToast()
  const isRu = lang === 'ru'

  const [activeTab, setActiveTab] = useState<PresetTab>('profiles')
  const [newProfileName, setNewProfileName] = useState('')
  const [shareText, setShareText] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSaveCurrent = async (): Promise<void> => {
    const name = newProfileName.trim()
    if (!name) {
      notify(isRu ? 'Введите название пресета' : 'Please enter a preset name', 'warn')
      return
    }
    setBusy(true)
    try {
      await onSaveProfile(name)
      setNewProfileName('')
    } finally {
      setBusy(false)
    }
  }

  const handleExportToText = (name: string, mods: string[]): void => {
    const text = exportShareText(name, mods, byModId)
    setShareText(text)
    setActiveTab('share')
    notify(isRu ? 'Пресет экспортирован в форму обмена' : 'Preset exported to share format', 'ok')
  }

  const handleCopyClipboard = async (): Promise<void> => {
    if (!shareText.trim()) return
    await copyText(shareText)
    notify(isRu ? 'Скопировано в буфер обмена' : 'Copied to clipboard', 'ok')
  }

  const handlePasteClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setShareText(text)
    } catch {
      notify(isRu ? 'Не удалось прочитать буфер обмена' : 'Failed to read clipboard', 'warn')
    }
  }

  const handleImportText = (): void => {
    try {
      const parsed = importShareText(shareText)
      if (parsed.modIds.length === 0) {
        notify(isRu ? 'В тексте не найдено ID модов' : 'No mod IDs found in text', 'warn')
        return
      }
      onImportCustomList(parsed.name, parsed.modIds)
      notify(
        isRu
          ? `Импортирован пресет «${parsed.name}» (${parsed.modIds.length} модов)`
          : `Imported "${parsed.name}" (${parsed.modIds.length} mods)`,
        'ok'
      )
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    }
  }

  const handleImportAllGamePresets = async (): Promise<void> => {
    setBusy(true)
    try {
      await onImportGamePresets(gamePresets)
      notify(
        isRu
          ? `Импортировано пресетов: ${Object.keys(gamePresets).length}`
          : `Imported ${Object.keys(gamePresets).length} game presets`,
        'ok'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--presets" onClick={(e) => e.stopPropagation()}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon name="book" size={15} color="var(--rust-hot)" />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Управление пресетами модов' : 'Mod Presets & Share'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__tabs">
          <button
            className={`ptab ${activeTab === 'profiles' ? 'is-on' : ''}`}
            onClick={() => setActiveTab('profiles')}
          >
            <Icon name="list" size={12} />
            {isRu ? 'Мои пресеты' : 'My Presets'} ({profiles.length})
          </button>
          <button
            className={`ptab ${activeTab === 'game' ? 'is-on' : ''}`}
            onClick={() => setActiveTab('game')}
          >
            <Icon name="package" size={12} />
            {isRu ? 'Пресеты из игры (Mod Manager)' : 'In-game Presets'} (
            {Object.keys(gamePresets).length})
          </button>
          <button
            className={`ptab ${activeTab === 'share' ? 'is-on' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            <Icon name="copy" size={12} />
            {isRu ? 'Обмен текстом' : 'Text Share'}
          </button>
        </div>

        <div className="lomodal__body lomodal__body--presets">
          {activeTab === 'profiles' && (
            <div className="lopresets-view">
              <div className="lopresets-save-row">
                <input
                  className="lofield__input"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder={
                    isRu ? 'Название нового пресета…' : 'New preset name…'
                  }
                  spellCheck={false}
                />
                <button
                  className="btn is-primary"
                  onClick={() => void handleSaveCurrent()}
                  disabled={busy || !newProfileName.trim()}
                >
                  <Icon name="save" size={12} />
                  {isRu ? 'Сохранить текущий порядок' : 'Save Active Order'}
                </button>
              </div>

              <div className="lopresets-list">
                {profiles.length === 0 ? (
                  <div className="pane__empty">
                    <Icon name="list" size={20} />
                    <span className="label wbmuted">
                      {isRu ? 'Нет сохранённых пресетов' : 'No saved presets yet'}
                    </span>
                  </div>
                ) : (
                  profiles.map((p) => (
                    <div key={p.id} className="lopreset-item">
                      <div className="lopreset-item__info">
                        <span className="lopreset-item__name">{p.name}</span>
                        <span className="label wbmuted">
                          {p.mods.length} {isRu ? 'модов' : 'mods'} · {p.kind}
                        </span>
                      </div>
                      <div className="lopreset-item__actions">
                        <button
                          className="btn btn--tiny is-primary"
                          onClick={() => {
                            onApplyProfile(p)
                            onClose()
                          }}
                          title={isRu ? 'Загрузить в редактор' : 'Load into editor'}
                        >
                          <Icon name="play" size={11} />
                          {isRu ? 'Применить' : 'Apply'}
                        </button>
                        <button
                          className="btn btn--tiny"
                          onClick={() => handleExportToText(p.name, p.mods)}
                          title={isRu ? 'Экспорт в текст' : 'Export to text'}
                        >
                          <Icon name="external" size={11} />
                          {isRu ? 'Экспорт' : 'Share'}
                        </button>
                        <button
                          className="btn btn-icon btn--danger"
                          onClick={() => void onDeleteProfile(p.id)}
                          title={isRu ? 'Удалить пресет' : 'Delete preset'}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'game' && (
            <div className="lopresets-view">
              <div className="lopresets-notice">
                <span className="label wbmuted">
                  {isRu
                    ? 'Пресеты, созданные модом [B42] Mod Manager в файле Zomboid/Lua/pz_modlist_settings.cfg'
                    : 'Presets created by [B42] Mod Manager in Zomboid/Lua/pz_modlist_settings.cfg'}
                </span>
                {Object.keys(gamePresets).length > 0 && (
                  <button
                    className="btn btn--tiny"
                    onClick={() => void handleImportAllGamePresets()}
                    disabled={busy}
                  >
                    <Icon name="download" size={11} />
                    {isRu ? 'Импортировать все в мои' : 'Import All to My Presets'}
                  </button>
                )}
              </div>

              <div className="lopresets-list">
                {Object.keys(gamePresets).length === 0 ? (
                  <div className="pane__empty">
                    <Icon name="package" size={20} />
                    <span className="label wbmuted">
                      {isRu
                        ? 'Файл pz_modlist_settings.cfg не найден или в нём нет пресетов'
                        : 'No in-game presets found'}
                    </span>
                  </div>
                ) : (
                  Object.entries(gamePresets).map(([name, ids]) => (
                    <div key={name} className="lopreset-item">
                      <div className="lopreset-item__info">
                        <span className="lopreset-item__name">{name}</span>
                        <span className="label wbmuted">
                          {ids.length} {isRu ? 'модов' : 'mods'}
                        </span>
                      </div>
                      <div className="lopreset-item__actions">
                        <button
                          className="btn btn--tiny is-primary"
                          onClick={() => {
                            onApplyGamePreset(name, ids)
                            onClose()
                          }}
                          title={isRu ? 'Загрузить в редактор' : 'Load into editor'}
                        >
                          <Icon name="play" size={11} />
                          {isRu ? 'Применить' : 'Apply'}
                        </button>
                        <button
                          className="btn btn--tiny"
                          onClick={() => handleExportToText(name, ids)}
                          title={isRu ? 'Экспорт в текст' : 'Export to text'}
                        >
                          <Icon name="external" size={11} />
                          {isRu ? 'Экспорт' : 'Share'}
                        </button>
                        <button
                          className="btn btn-icon btn--danger"
                          onClick={() => void onDeleteGamePreset(name)}
                          title={isRu ? 'Удалить из игры' : 'Delete from game cfg'}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'share' && (
            <div className="lopresets-share">
              <div className="lopresets-share__toolbar">
                <button
                  className="btn btn--tiny"
                  onClick={() =>
                    setShareText(
                      exportShareText('Active List', currentMods, byModId)
                    )
                  }
                >
                  <Icon name="list" size={11} />
                  {isRu ? 'Заполнить текущим списком' : 'Fill from Current Order'}
                </button>
                <div className="toolbar__spacer" />
                <button className="btn btn--tiny" onClick={() => void handlePasteClipboard()}>
                  <Icon name="download" size={11} />
                  {isRu ? 'Вставить из буфера' : 'Paste'}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => void handleCopyClipboard()}
                  disabled={!shareText.trim()}
                >
                  <Icon name="copy" size={11} />
                  {isRu ? 'Скопировать' : 'Copy'}
                </button>
              </div>

              <textarea
                className="lopresets-share__box mono"
                value={shareText}
                onChange={(e) => setShareText(e.target.value)}
                placeholder={
                  isRu
                    ? 'Имя:mod1;mod2;...\nСтрока modIds;\nСтрока workshopIds;'
                    : 'Name:mod1;mod2;...\nmodIds;\nworkshopIds;'
                }
                spellCheck={false}
              />

              <div className="lopresets-share__footer">
                <span className="label wbmuted">
                  {isRu
                    ? 'Формат совместим с окном Share мода [B42] Mod Manager и публикациями в Steam Workshop.'
                    : 'Format is fully compatible with [B42] Mod Manager Share dialog and Steam Workshop.'}
                </span>
                <button
                  className="btn is-primary"
                  onClick={handleImportText}
                  disabled={!shareText.trim()}
                >
                  <Icon name="download" size={12} />
                  {isRu ? 'Применить этот текст в редактор' : 'Load Text into Editor'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
