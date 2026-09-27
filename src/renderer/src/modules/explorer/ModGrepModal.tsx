import { useEffect, useRef, useState } from 'react'
import type { ModGrepMatch } from '@shared/types'
import { Icon } from '@renderer/components/Icon'

interface ModGrepModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectMatch: (modKey: string, filePath: string) => void
}

export function ModGrepModal({ isOpen, onClose, onSelectMatch }: ModGrepModalProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [extFilter, setExtFilter] = useState<'all' | 'lua' | 'txt' | 'xml'>('all')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ModGrepMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setResults([])
    }
  }, [isOpen])

  // Search execution
  const runSearch = async () => {
    const q = query.trim()
    if (!q || q.length < 2) return

    setLoading(true)
    try {
      const exts =
        extFilter === 'all'
          ? ['lua', 'txt', 'xml', 'ini', 'json']
          : [extFilter]
      const matches = await (window.pz.explorer || window.pz.stalker).grep({
        query: q,
        caseSensitive,
        fileExtensions: exts,
        maxResults: 200
      })
      setResults(matches)
    } catch (err) {
      console.error('Grep failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  // Trigger search on query change (debounced) or Enter
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        void runSearch()
      } else {
        setResults([])
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [query, caseSensitive, extFilter, isOpen])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="mod-grep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mod-grep__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="search" size={14} color="var(--rust-hot)" />
            <span className="label stencil" style={{ fontSize: '13px', color: 'var(--bone)' }}>
              ПОИСК ПО КОДУ ВСЕХ МОДОВ (GLOBAL GREP)
            </span>
          </div>
          <button className="btn btn-icon" onClick={onClose} title="Закрыть (Esc)">
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="mod-grep__search-bar">
          <input
            ref={inputRef}
            type="text"
            className="mod-grep__input mono"
            placeholder="Искать функцию, ID предмета, событие, переменную (например, Events.OnWeaponHit)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
              if (e.key === 'Escape') onClose()
            }}
          />

          <button
            type="button"
            className={`btn btn--tiny ${caseSensitive ? 'is-active' : ''}`}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Учитывать регистр символов (Case sensitive)"
          >
            Aa
          </button>

          <div style={{ display: 'flex', gap: 2 }}>
            {(['all', 'lua', 'txt', 'xml'] as const).map((ext) => (
              <button
                key={ext}
                type="button"
                className={`btn btn--tiny ${extFilter === ext ? 'is-active' : ''}`}
                onClick={() => setExtFilter(ext)}
              >
                .{ext}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn is-primary btn--tiny"
            onClick={() => void runSearch()}
            disabled={loading || query.trim().length < 2}
          >
            {loading ? <Icon name="refresh" size={11} className="spin" /> : <Icon name="search" size={11} />}
            <span>Искать</span>
          </button>
        </div>

        <div className="mod-grep__results">
          {loading && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ash-faint)' }}>
              <Icon name="refresh" size={16} className="spin" style={{ marginRight: 8 }} />
              <span>Поиск по файлам установленных модов…</span>
            </div>
          )}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ash-faint)' }}>
              <Icon name="search" size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>Ничего не найдено по запросу «{query}»</div>
            </div>
          )}

          {!loading && results.map((m, idx) => (
            <div
              key={`${m.filePath}:${m.line}:${idx}`}
              className="mod-grep__item"
              onClick={() => onSelectMatch(m.modKey, m.filePath)}
              title="Перейти к моду и файлу"
            >
              <div className="mod-grep__item-head">
                <span className="mod-grep__item-mod">{m.modName}</span>
                <span className="mod-grep__item-file mono">
                  {m.relPath}:{m.line}
                </span>
              </div>
              <div className="mod-grep__snippet mono">{m.snippet}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
