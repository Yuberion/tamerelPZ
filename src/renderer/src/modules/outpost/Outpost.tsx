import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ServerFullConfig, ServerProfileSummary } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { formatBytes } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'

interface OutpostProps {
  onExit: () => void
}

export function Outpost({ onExit }: OutpostProps) {
  const { t } = useI18n()
  const { notify } = useToast()
  const { scan } = useAppStore()

  const [servers, setServers] = useState<ServerProfileSummary[]>([])
  const [selectedServerName, setSelectedServerName] = useState<string>('')
  const [config, setConfig] = useState<ServerFullConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'ini' | 'mods' | 'sandbox' | 'cockpit'>('ini')

  // Edit draft for server.ini properties
  const [iniProps, setIniProps] = useState<Record<string, string>>({})
  const [sandboxLua, setSandboxLua] = useState<string>('')

  // Loadout presets
  const [presets, setPresets] = useState<Array<{ name: string; mods: string[] }>>([])
  const [selectedPresetName, setSelectedPresetName] = useState<string>('')

  // Server cockpit state
  const [ramGb, setRamGb] = useState<number>(8)
  const [backupLoading, setBackupLoading] = useState(false)
  const [launchLoading, setLaunchLoading] = useState(false)
  const [lastLaunchedPid, setLastLaunchedPid] = useState<number>()

  const loadServers = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.pz.server.list()
      setServers(list)
      if (list.length > 0 && (!selectedServerName || !list.some((s) => s.name === selectedServerName))) {
        setSelectedServerName(list[0]!.name)
      }
    } catch (err) {
      notify(`Ошибка загрузки серверов: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setLoading(false)
    }
  }, [notify, selectedServerName])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  // Load selected server config
  const loadConfig = useCallback(async (sName: string) => {
    if (!sName) return
    try {
      const cfg = await window.pz.server.readConfig(sName)
      setConfig(cfg)
      setIniProps(cfg.iniProperties)
      setSandboxLua(cfg.sandboxLua || '')
    } catch (err) {
      notify(`Ошибка чтения конфигурации сервера: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }, [notify])

  useEffect(() => {
    if (selectedServerName) {
      void loadConfig(selectedServerName)
    }
  }, [loadConfig, selectedServerName])

  // Load Loadout presets
  useEffect(() => {
    void window.pz.loadout.getGamePresets().then((dict) => {
      const list = Object.entries(dict || {}).map(([name, mods]) => ({ name, mods }))
      setPresets(list)
      if (list.length > 0) setSelectedPresetName(list[0]!.name)
    })
  }, [])

  const handlePropChange = (key: string, val: string) => {
    setIniProps((prev) => ({ ...prev, [key]: val }))
  }

  const handleSaveConfig = async () => {
    if (!selectedServerName) return
    setSaving(true)
    try {
      const res = await window.pz.server.saveConfig({
        serverName: selectedServerName,
        iniProperties: iniProps,
        sandboxLua
      })

      if (res.ok) {
        notify(`Конфигурация сервера сохранена! Файл ${selectedServerName}.ini обновлен.`, 'ok')
        await loadConfig(selectedServerName)
      } else {
        throw new Error(res.error || 'Failed saving server config')
      }
    } catch (err) {
      notify(`Ошибка сохранения конфигурации: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setSaving(false)
    }
  }

  // Sync with selected Loadout preset
  const handleSyncFromPreset = async () => {
    if (!selectedServerName || !selectedPresetName) return
    const preset = presets.find((p) => p.name === selectedPresetName)
    if (!preset) return

    // Derive workshop IDs for the preset mods from scan
    const workshopIdSet = new Set<string>()
    if (scan?.mods) {
      const modMap = new Map(scan.mods.map((m) => [m.modId, m]))
      for (const mId of preset.mods) {
        const found = modMap.get(mId)
        if (found?.workshopId) {
          workshopIdSet.add(found.workshopId)
        }
      }
    }

    const workshopList = Array.from(workshopIdSet)

    try {
      const res = await window.pz.server.syncMods({
        serverName: selectedServerName,
        mods: preset.mods,
        workshopItems: workshopList
      })

      if (res.ok) {
        notify(
          `Моды успешно синхронизированы с сервером! Привязано модов: ${res.modsCount}, элементов Workshop: ${res.workshopCount}`,
          'ok'
        )
        await loadConfig(selectedServerName)
      } else {
        throw new Error(res.error || 'Failed syncing mods')
      }
    } catch (err) {
      notify(`Ошибка синхронизации модов: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }

  const handleBackup = async () => {
    if (!selectedServerName) return
    setBackupLoading(true)
    try {
      const res = await window.pz.server.backup(selectedServerName)
      if (res.ok) {
        notify(`Резервная копия сервера создана в Zomboid/ServerBackups/ (${formatBytes(res.bytes)})`, 'ok')
      } else {
        throw new Error(res.error || 'Failed creating backup')
      }
    } catch (err) {
      notify(`Ошибка создания резервной копии: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleLaunch = async () => {
    if (!selectedServerName) return
    setLaunchLoading(true)
    try {
      const res = await window.pz.server.launch({
        serverName: selectedServerName,
        ramGb
      })

      if (res.ok) {
        setLastLaunchedPid(res.pid)
        notify(`Выделенный сервер запущен! PID: ${res.pid}. Память: ${ramGb} GB.`, 'ok')
      } else {
        throw new Error(res.error || 'Failed launching server')
      }
    } catch (err) {
      notify(`Не удалось запустить сервер: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setLaunchLoading(false)
    }
  }

  const currentSummary = useMemo(() => {
    return servers.find((s) => s.name === selectedServerName)
  }, [servers, selectedServerName])

  return (
    <div className="outpost-module" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--slate)',
          borderBottom: '1px solid var(--rim)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onExit}
            title={t('tb.backToHub')}
          >
            <Icon name="arrow-left" size={16} />
          </button>

          <Icon name="server" size={20} color="var(--rust-hot)" />

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="stencil" style={{ fontSize: 13, letterSpacing: '0.06em', color: 'var(--bone)' }}>
                08 / OUTPOST — SERVER COCKPIT
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8'
                }}
              >
                Build 41 & 42
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
              Центр управления серверами Project Zomboid, синхронизация пресетов модов и запуск в 1 клик
            </div>
          </div>
        </div>

        {/* Server selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--ash)' }}>Сервер:</span>
          <select
            className="select"
            value={selectedServerName}
            onChange={(e) => setSelectedServerName(e.target.value)}
            disabled={loading}
            style={{
              minWidth: 180,
              background: 'var(--charcoal)',
              color: 'var(--bone)',
              border: '1px solid var(--rim)',
              borderRadius: 4,
              padding: '5px 10px',
              fontSize: 12
            }}
          >
            {servers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} (порт {s.port})
              </option>
            ))}
          </select>

          <button
            className="btn btn-icon btn-sm"
            onClick={() => void loadServers()}
            disabled={loading}
            title="Обновить список серверов"
          >
            <Icon name="refresh" size={13} className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {/* Navigation sub-tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          background: 'rgba(0, 0, 0, 0.2)',
          borderBottom: '1px solid var(--rim)'
        }}
      >
        <button
          className={`btn btn-sm ${activeTab === 'ini' ? 'btn-active' : ''}`}
          onClick={() => setActiveTab('ini')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
        >
          <Icon name="wrench" size={13} color={activeTab === 'ini' ? '#38bdf8' : undefined} />
          Настройки server.ini
        </button>

        <button
          className={`btn btn-sm ${activeTab === 'mods' ? 'btn-active' : ''}`}
          onClick={() => setActiveTab('mods')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
        >
          <Icon name="download" size={13} color={activeTab === 'mods' ? '#a78bfa' : undefined} />
          Синхронизация модов (Loadout)
        </button>

        <button
          className={`btn btn-sm ${activeTab === 'sandbox' ? 'btn-active' : ''}`}
          onClick={() => setActiveTab('sandbox')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
        >
          <Icon name="target" size={13} color={activeTab === 'sandbox' ? '#fbbf24' : undefined} />
          Песочница (SandboxVars)
        </button>

        <button
          className={`btn btn-sm ${activeTab === 'cockpit' ? 'btn-active' : ''}`}
          onClick={() => setActiveTab('cockpit')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
        >
          <Icon name="terminal" size={13} color={activeTab === 'cockpit' ? 'var(--rust-hot)' : undefined} />
          Cockpit & Запуск
        </button>

        <div style={{ flex: 1 }} />

        {currentSummary && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--ash)', display: 'flex', gap: 12 }}>
            <span>Игроков: <b style={{ color: 'var(--bone)' }}>{currentSummary.maxPlayers}</b></span>
            <span>Порт: <b style={{ color: '#38bdf8' }}>{currentSummary.port}</b></span>
            <span>Модов: <b style={{ color: '#a78bfa' }}>{currentSummary.modCount}</b></span>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      <div style={{ flex: 1, padding: 16 }}>
        {/* Tab 1: server.ini Configuration */}
        {activeTab === 'ini' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Card 1: Network & Access */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bone)', marginBottom: 12 }}>
                  Сетевые параметры и доступ
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                      Название сервера в списке (PublicName):
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={iniProps['PublicName'] || ''}
                      onChange={(e) => handlePropChange('PublicName', e.target.value)}
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                        Игровой порт (DefaultPort):
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={iniProps['DefaultPort'] || '16261'}
                        onChange={(e) => handlePropChange('DefaultPort', e.target.value)}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                        UDP порт (UDPPort):
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={iniProps['UDPPort'] || '16262'}
                        onChange={(e) => handlePropChange('UDPPort', e.target.value)}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                      Пароль сервера (Password):
                    </label>
                    <input
                      type="password"
                      className="input"
                      value={iniProps['Password'] || ''}
                      onChange={(e) => handlePropChange('Password', e.target.value)}
                      placeholder="Оставьте пустым для открытого входа"
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                      Максимум игроков (MaxPlayers):
                    </label>
                    <input
                      type="number"
                      className="input"
                      value={iniProps['MaxPlayers'] || '16'}
                      onChange={(e) => handlePropChange('MaxPlayers', e.target.value)}
                      style={{ width: 100, fontSize: 12 }}
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Gameplay Flags */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bone)', marginBottom: 12 }}>
                  Игровой процесс и правила
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--bone)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={iniProps['PVP'] === 'true'}
                      onChange={(e) => handlePropChange('PVP', e.target.checked ? 'true' : 'false')}
                    />
                    Разрешить PvP (игроки могут наносить урон друг другу)
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--bone)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={iniProps['PauseEmpty'] === 'true'}
                      onChange={(e) => handlePropChange('PauseEmpty', e.target.checked ? 'true' : 'false')}
                    />
                    Ставить сервер на паузу, когда на нём 0 игроков
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--bone)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={iniProps['Public'] === 'true'}
                      onChange={(e) => handlePropChange('Public', e.target.checked ? 'true' : 'false')}
                    />
                    Показывать в публичном глобальном списке серверов Steam
                  </label>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                      Точка спавна (SpawnPoint X,Y,Z):
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={iniProps['SpawnPoint'] || '0,0,0'}
                      onChange={(e) => handlePropChange('SpawnPoint', e.target.value)}
                      placeholder="0,0,0 для случайного выбора"
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ash)', display: 'block', marginBottom: 4 }}>
                      Порт RCON (RCONPort):
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={iniProps['RCONPort'] || '27015'}
                      onChange={(e) => handlePropChange('RCONPort', e.target.value)}
                      style={{ width: 120, fontSize: 12 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                className="btn btn-primary"
                onClick={handleSaveConfig}
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '7px 16px' }}
              >
                <Icon name="check" size={13} />
                {saving ? 'Сохранение...' : 'Сохранить server.ini'}
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Mod Sync from Loadout */}
        {activeTab === 'mods' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon name="download" size={16} color="#a78bfa" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bone)' }}>
                  Синхронизация с пресетами из модуля Loadout
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.5, marginBottom: 16 }}>
                Выберите сохранённый профиль модов из модуля <b>Loadout</b>. Outpost автоматически извлечёт список Mod ID и
                соответствующие Workshop ID, корректно заполнив строки <code className="mono">Mods=</code> и{' '}
                <code className="mono">WorkshopItems=</code> в файле <code className="mono">{selectedServerName}.ini</code>.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--ash)' }}>Пресет Loadout:</span>
                  <select
                    className="select"
                    value={selectedPresetName}
                    onChange={(e) => setSelectedPresetName(e.target.value)}
                    style={{
                      minWidth: 200,
                      background: 'var(--charcoal)',
                      color: 'var(--bone)',
                      border: '1px solid var(--rim)',
                      borderRadius: 4,
                      padding: '5px 10px',
                      fontSize: 12
                    }}
                  >
                    {presets.length === 0 ? (
                      <option value="">Нет сохраненных пресетов</option>
                    ) : (
                      presets.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.mods.length} модов)
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSyncFromPreset}
                  disabled={!selectedPresetName}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}
                >
                  <Icon name="refresh" size={13} />
                  Применить пресет к серверу
                </button>
              </div>
            </div>

            {/* Current Active Server Mods Preview */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className="stencil" style={{ fontSize: 11, color: 'var(--bone)' }}>
                    Активные моды (Mods=) ({config?.modsList.length ?? 0})
                  </span>
                </div>
                <div
                  className="mono"
                  style={{
                    maxHeight: 260,
                    overflowY: 'auto',
                    fontSize: 11,
                    color: 'var(--ash)',
                    background: 'rgba(0,0,0,0.3)',
                    padding: 8,
                    borderRadius: 4
                  }}
                >
                  {config?.modsList.length ? (
                    config.modsList.map((m, idx) => (
                      <div key={idx} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        {m}
                      </div>
                    ))
                  ) : (
                    <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Моды не привязаны</span>
                  )}
                </div>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className="stencil" style={{ fontSize: 11, color: 'var(--bone)' }}>
                    Мастерская Steam (WorkshopItems=) ({config?.workshopItemsList.length ?? 0})
                  </span>
                </div>
                <div
                  className="mono"
                  style={{
                    maxHeight: 260,
                    overflowY: 'auto',
                    fontSize: 11,
                    color: '#38bdf8',
                    background: 'rgba(0,0,0,0.3)',
                    padding: 8,
                    borderRadius: 4
                  }}
                >
                  {config?.workshopItemsList.length ? (
                    config.workshopItemsList.map((w, idx) => (
                      <div key={idx} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        {w}
                      </div>
                    ))
                  ) : (
                    <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Элементы мастерской не указаны</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: SandboxVars */}
        {activeTab === 'sandbox' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span className="stencil" style={{ fontSize: 12, color: 'var(--bone)' }}>
                  Конфигурация песочницы: {selectedServerName}_SandboxVars.lua
                </span>
                <span style={{ fontSize: 11, color: 'var(--ash)', marginLeft: 8 }}>
                  Строгое соблюдение B42 синтаксиса (VERSION = 1, и отсутствие BOM)
                </span>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleSaveConfig}
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}
              >
                <Icon name="check" size={13} />
                {saving ? 'Сохранение...' : 'Сохранить SandboxVars'}
              </button>
            </div>

            <textarea
              className="mono input"
              value={sandboxLua}
              onChange={(e) => setSandboxLua(e.target.value)}
              placeholder="-- SandboxVars.lua content..."
              spellCheck={false}
              style={{
                flex: 1,
                minHeight: 400,
                width: '100%',
                fontSize: 12,
                lineHeight: 1.5,
                background: 'var(--charcoal)',
                color: 'var(--bone)',
                padding: 12,
                borderRadius: 4
              }}
            />
          </div>
        )}

        {/* Tab 4: Cockpit & Launch */}
        {activeTab === 'cockpit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
            {/* Memory Slider */}
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="tools" size={16} color="var(--rust-hot)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bone)' }}>
                    Выделение оперативной памяти сервера (RAM Heap)
                  </span>
                </div>
                <span className="mono" style={{ fontSize: 14, color: '#38bdf8', fontWeight: 600 }}>
                  -Xmx{ramGb}g
                </span>
              </div>

              <input
                type="range"
                min={4}
                max={32}
                step={2}
                value={ramGb}
                onChange={(e) => setRamGb(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--rust-hot)', cursor: 'pointer' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ash)', marginTop: 4 }}>
                <span>4 GB (Для 2-3 игроков)</span>
                <span>8 GB (Стандартный сервер)</span>
                <span>16 GB (С модами и картами)</span>
                <span>32 GB (Тяжелый выделенный сервер)</span>
              </div>
            </div>

            {/* Server Launch & Backup Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Backup Card */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bone)', marginBottom: 8 }}>
                  Резервное копирование (Backup)
                </div>
                <p style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.5, marginBottom: 16 }}>
                  Создает полный снимок настроек сервера и мира в директорию <code className="mono">Zomboid/ServerBackups/</code>.
                </p>

                <button
                  className="btn"
                  onClick={handleBackup}
                  disabled={backupLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px' }}
                >
                  <Icon name="archive" size={13} />
                  {backupLoading ? 'Создание архива...' : 'Создать бэкап сервера'}
                </button>
              </div>

              {/* Launch Card */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--rim)', borderRadius: 6, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bone)', marginBottom: 8 }}>
                  Запуск сервера (Dedicated Host)
                </div>
                <p style={{ fontSize: 12, color: 'var(--ash)', lineHeight: 1.5, marginBottom: 16 }}>
                  Запускает <code className="mono">StartServer64.bat</code> с профилем <code className="mono">-servername {selectedServerName}</code> и выделением {ramGb} GB RAM.
                </p>

                <button
                  className="btn btn-primary"
                  onClick={handleLaunch}
                  disabled={launchLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '8px 16px',
                    background: 'var(--rust-hot)',
                    borderColor: 'var(--rust-hot)'
                  }}
                >
                  <Icon name="terminal" size={13} />
                  {launchLoading ? 'Запуск...' : 'Запустить выделенный сервер'}
                </button>

                {lastLaunchedPid && (
                  <div className="mono" style={{ fontSize: 11, color: '#34d399', marginTop: 8 }}>
                    ● Сервер запущен с PID: {lastLaunchedPid}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
