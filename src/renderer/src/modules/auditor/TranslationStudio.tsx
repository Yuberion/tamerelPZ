import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModEntry, ModTranslationData } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { formatCount } from '@renderer/lib/format'

interface TranslationStudioProps {
  mod: ModEntry
}

const COMMON_LANGS = [
  { code: 'RU', label: 'Русский (RU)' },
  { code: 'ES', label: 'Español (ES)' },
  { code: 'DE', label: 'Deutsch (DE)' },
  { code: 'FR', label: 'Français (FR)' },
  { code: 'PL', label: 'Polski (PL)' },
  { code: 'IT', label: 'Italiano (IT)' },
  { code: 'PT', label: 'Português (PT)' },
  { code: 'CN', label: '简体中文 (CN)' },
  { code: 'KO', label: '한국어 (KO)' },
  { code: 'JA', label: '日本語 (JA)' },
  { code: 'TR', label: 'Türkçe (TR)' },
  { code: 'UK', label: 'Українська (UK)' },
  { code: 'EN', label: 'English (EN)' }
]

export function TranslationStudio({ mod }: TranslationStudioProps) {
  const { notify } = useToast()

  const [targetLang, setTargetLang] = useState('RU')
  const [data, setData] = useState<ModTranslationData>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'missing' | 'modified'>('all')

  // Local draft edits: key -> newTargetText
  const [edits, setEdits] = useState<Record<string, string>>({})

  const loadTranslations = useCallback(
    async (lang: string) => {
      setLoading(true)
      try {
        const res = await window.pz.translation.scan(mod.path, lang)
        setData(res)
        setEdits({})
      } catch (err) {
        notify(`Ошибка загрузки перевода: ${err instanceof Error ? err.message : String(err)}`, 'warn')
      } finally {
        setLoading(false)
      }
    },
    [mod.path, notify]
  )

  useEffect(() => {
    void loadTranslations(targetLang)
  }, [loadTranslations, targetLang])

  const handleTextChange = (key: string, val: string) => {
    setEdits((prev) => ({ ...prev, [key]: val }))
  }

  const handleCopySource = (key: string, sourceText: string) => {
    handleTextChange(key, sourceText)
  }

  const modifiedCount = Object.keys(edits).length

  const handleSave = async () => {
    if (!data || modifiedCount === 0) return
    setSaving(true)
    try {
      // Build full save list (existing entries updated with edits)
      const saveEntries = data.entries.map((e) => ({
        key: e.key,
        targetText: edits[e.key] !== undefined ? edits[e.key] : e.targetText,
        fileType: e.fileType
      }))

      const res = await window.pz.translation.save({
        modPath: mod.path,
        targetLang,
        entries: saveEntries
      })

      if (res.ok) {
        notify(
          `Перевод сохранён! Записано строк: ${res.totalSaved} в UTF-8 без BOM (${res.savedFiles.length} файлов).`,
          'ok'
        )
        // Reload fresh state
        await loadTranslations(targetLang)
      } else {
        throw new Error(res.error || 'Failed saving translations')
      }
    } catch (err) {
      notify(`Ошибка сохранения перевода: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    } finally {
      setSaving(false)
    }
  }

  // Filtered rows
  const filteredEntries = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()

    return data.entries.filter((item) => {
      const currentVal = edits[item.key] !== undefined ? edits[item.key] : item.targetText
      const isModified = edits[item.key] !== undefined && edits[item.key] !== item.targetText
      const isMissing = !currentVal.trim()

      if (filter === 'missing' && !isMissing) return false
      if (filter === 'modified' && !isModified) return false

      if (q) {
        const matchKey = item.key.toLowerCase().includes(q)
        const matchSource = item.sourceText.toLowerCase().includes(q)
        const matchTarget = currentVal.toLowerCase().includes(q)
        const matchType = item.fileType.toLowerCase().includes(q)
        if (!matchKey && !matchSource && !matchTarget && !matchType) return false
      }

      return true
    })
  }, [data, edits, filter, search])

  return (
    <div className="trans-studio" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Studio Header & Stats */}
      <div
        className="trans-studio__head"
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--rim)',
          background: 'var(--slate)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="terminal" size={18} color="var(--rust-hot)" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="stencil" style={{ fontSize: 13, letterSpacing: '0.06em', color: 'var(--bone)' }}>
                  Студия локализации
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
                  UTF-8 без BOM
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
                Двухпанельный редактор языковых словарей мода для Build 41 и Build 42
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Target Language Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--ash)' }}>Язык:</span>
              <select
                className="select"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                style={{
                  background: 'var(--charcoal)',
                  color: 'var(--bone)',
                  border: '1px solid var(--rim)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 12
                }}
              >
                {COMMON_LANGS.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Save Button */}
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || modifiedCount === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600
              }}
            >
              <Icon name="check" size={13} />
              Сохранить {modifiedCount > 0 ? `(${modifiedCount})` : ''}
            </button>
          </div>
        </div>

        {/* Filters and search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Quick Filters */}
          <div className="btn-group" style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn btn-sm ${filter === 'all' ? 'btn-active' : ''}`}
              onClick={() => setFilter('all')}
              style={{ fontSize: 11 }}
            >
              Все строки {data ? `(${formatCount(data.totalCount)})` : ''}
            </button>
            <button
              className={`btn btn-sm ${filter === 'missing' ? 'btn-active' : ''}`}
              onClick={() => setFilter('missing')}
              style={{
                fontSize: 11,
                color: (data?.missingCount ?? 0) > 0 ? '#f87171' : undefined
              }}
            >
              Непереведённые {data ? `(${data.missingCount})` : ''}
            </button>
            <button
              className={`btn btn-sm ${filter === 'modified' ? 'btn-active' : ''}`}
              onClick={() => setFilter('modified')}
              style={{
                fontSize: 11,
                color: modifiedCount > 0 ? '#38bdf8' : undefined
              }}
            >
              Изменённые ({modifiedCount})
            </button>
          </div>

          <div style={{ flex: 1 }} />

          {/* Search bar */}
          <div className="minisearch" style={{ minWidth: 260 }}>
            <Icon name="search" size={12} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ключу или значению..."
              spellCheck={false}
              style={{ fontSize: 11 }}
            />
            {search && (
              <button className="minisearch__clear" onClick={() => setSearch('')}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Table / Rows */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--ash)' }}>
            <Icon name="refresh" size={16} className="spin" />
            <span>Загрузка словарей мода...</span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--ash)', gap: 6 }}>
            <Icon name="info" size={24} color="var(--dim)" />
            <span style={{ fontSize: 12 }}>
              {data && data.totalCount === 0
                ? 'В этом моде пока нет файлов Translate (Translate/EN/ или Translate/RU/). Сохраните перевод, чтобы создать их.'
                : 'По выбранному фильтру ничего не найдено.'}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredEntries.map((item) => {
              const currentVal = edits[item.key] !== undefined ? edits[item.key] : item.targetText
              const isModified = edits[item.key] !== undefined && edits[item.key] !== item.targetText
              const isMissing = !currentVal.trim()

              return (
                <div
                  key={item.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(240px, 1fr) minmax(240px, 1.2fr) minmax(280px, 1.5fr)',
                    gap: 12,
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: isModified
                      ? 'rgba(56, 189, 248, 0.05)'
                      : isMissing
                      ? 'rgba(239, 68, 68, 0.04)'
                      : 'rgba(255, 255, 255, 0.02)',
                    border: isModified
                      ? '1px solid rgba(56, 189, 248, 0.3)'
                      : isMissing
                      ? '1px solid rgba(239, 68, 68, 0.2)'
                      : '1px solid var(--rim)',
                    transition: 'border-color 0.15s'
                  }}
                >
                  {/* Column 1: Key & File Type */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: 9,
                          padding: '1px 4px',
                          borderRadius: 2,
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--bone)',
                          textTransform: 'uppercase'
                        }}
                      >
                        {item.fileType}
                      </span>
                      {isMissing && (
                        <span style={{ fontSize: 9, color: '#f87171', fontWeight: 600 }}>
                          НЕТ ПЕРЕВОДА
                        </span>
                      )}
                      {isModified && (
                        <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 600 }}>
                          ИЗМЕНЕНО
                        </span>
                      )}
                    </div>
                    <span
                      className="mono truncate"
                      style={{ fontSize: 11, color: 'var(--bone)', fontWeight: 500 }}
                      title={item.key}
                    >
                      {item.key}
                    </span>
                  </div>

                  {/* Column 2: Source Text (EN) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: 'var(--ash)',
                        background: 'rgba(0, 0, 0, 0.25)',
                        padding: '6px 10px',
                        borderRadius: 4,
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                        wordBreak: 'break-word',
                        userSelect: 'text'
                      }}
                      title={item.sourceText}
                    >
                      {item.sourceText || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>—</span>}
                    </div>

                    <button
                      className="btn btn-icon btn-sm"
                      onClick={() => handleCopySource(item.key, item.sourceText)}
                      title="Скопировать оригинал в перевод"
                      style={{ opacity: 0.7 }}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  </div>

                  {/* Column 3: Target Text Input (Editable) */}
                  <div>
                    <input
                      type="text"
                      className="input"
                      value={currentVal}
                      onChange={(e) => handleTextChange(item.key, e.target.value)}
                      placeholder={`Перевод на ${targetLang}...`}
                      style={{
                        width: '100%',
                        fontSize: 12,
                        padding: '6px 10px',
                        background: 'var(--charcoal)',
                        color: 'var(--bone)',
                        border: isMissing
                          ? '1px solid rgba(239, 68, 68, 0.4)'
                          : '1px solid var(--rim)',
                        borderRadius: 4
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
