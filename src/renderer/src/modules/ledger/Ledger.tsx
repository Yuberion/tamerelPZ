import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from '@renderer/components/Form'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDate, fuzzyMatch, shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { LogDetail } from './LogDetail'
import { LEVEL_ICON, LEVEL_KEY, LogList, type LogRow } from './LogList'
import { buildModIndex, parseLog, type LogLevel } from './parseLog'
import { useLogs } from './useLogs'

const LS_RIGHT = 'pz.ledger.rightWidth'

/** Chip order, loudest first — the reason anyone opens this module. */
const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

function readWidth(fallback: number): number {
  const raw = Number(localStorage.getItem(LS_RIGHT))
  return Number.isFinite(raw) && raw > 240 ? raw : fallback
}

export function Ledger({ onExit }: { onExit: () => void }) {
  const { scan } = useAppStore()
  const { t, p } = useI18n()
  const { notify } = useToast()
  const store = useLogs()

  const [query, setQuery] = useState('')
  const [muted, setMuted] = useState<Set<LogLevel>>(() => new Set())
  const [selectedId, setSelectedId] = useState<number>()
  const [rightW, setRightW] = useState(() => readWidth(420))
  const searchRef = useRef<HTMLInputElement>(null)

  const modIndex = useMemo(() => buildModIndex(scan?.mods ?? []), [scan])
  const parsed = useMemo(
    () => parseLog(store.content?.text ?? '', modIndex),
    [store.content, modIndex]
  )

  /**
   * Visible rows.
   *
   * Filtering and searching run over the already parsed entries, so neither one
   * costs an IPC round trip or a re-parse. The search looks at the body too — the
   * mod name in a stack frame is exactly what you want to grep for — but only the
   * head carries highlight positions, because that is the only part on screen.
   */
  const rows = useMemo<LogRow[]>(() => {
    const needle = query.trim()
    const deep = needle.toLowerCase()
    const out: LogRow[] = []
    for (const incident of parsed.incidents) {
      if (muted.has(incident.level)) continue
      if (!needle) {
        out.push({ incident, indices: [] })
        continue
      }
      const hit = fuzzyMatch(needle, incident.head)
      if (hit) {
        out.push({ incident, indices: hit.indices })
        continue
      }
      if (incident.body.some((line) => line.toLowerCase().includes(deep))) {
        out.push({ incident, indices: [] })
      }
    }
    return out
  }, [parsed, muted, query])

  const selected = useMemo(
    () => parsed.incidents.find((x) => x.id === selectedId),
    [parsed, selectedId]
  )

  const toggleLevel = useCallback((level: LogLevel) => {
    setMuted((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  const jumpFirstError = useCallback(() => {
    const first = parsed.incidents[parsed.firstError]
    if (!first) return
    // A muted or filtered-out error cannot be scrolled to, so clear what hides it.
    setMuted((prev) => {
      if (!prev.has('error')) return prev
      const next = new Set(prev)
      next.delete('error')
      return next
    })
    setQuery('')
    setSelectedId(first.id)
  }, [parsed])

  const copyPath = useCallback(async () => {
    const path = store.source?.path
    if (!path) return
    notify((await copyText(path)) ? t('led.pathCopied') : t('led.copyFailed'), 'ok')
  }, [store.source, notify, t])

  const dragRight = useCallback((dx: number) => {
    setRightW((w) => {
      const next = Math.min(Math.max(w - dx, 280), 720)
      localStorage.setItem(LS_RIGHT, String(next))
      return next
    })
  }, [])

  // The selected entry belongs to one parse of one file; keep nothing across a
  // reload or a source switch, or the detail pane would show a stale trace.
  useEffect(() => {
    setSelectedId(undefined)
  }, [store.content])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F5') {
        e.preventDefault()
        void store.reload()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const source = store.source
  const noUserDir = !store.loading && store.sources.length === 0
  const missing = Boolean(source) && !source?.exists
  const busy = store.loading || store.reading

  return (
    <div className="ledger">
      <div className="toolbar">
        <div className="toolbar__row">
          <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
            <Icon name="arrow-left" size={13} />
            {t('tb.hub')}
          </button>
          <div className="divider-v" />

          <span className="label toolbar__legend">{t('led.source')}</span>
          <div className="pick">
            <select
              className="ledpick"
              value={store.sourceId}
              disabled={store.sources.length === 0}
              onChange={(e) => store.select(e.target.value)}
            >
              {store.sources.length === 0 && <option value="">{t('led.noLogs')}</option>}
              {store.sources
                .filter((s) => s.kind === 'console')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {t('led.console')}
                  </option>
                ))}
              {store.sources.some((s) => s.kind === 'log') && (
                <optgroup label={t('led.archive')}>
                  {store.sources
                    .filter((s) => s.kind === 'log')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>
          <Hint title={t('led.source')} body={t('help.led.source')} />

          <div className="toolbar__spacer" />

          <button
            className="btn"
            onClick={() => void window.pz.shell.reveal(source?.path ?? '')}
            disabled={!source?.exists}
            title={t('led.revealTitle')}
          >
            <Icon name="external" size={13} />
            {t('led.reveal')}
          </button>
          <button
            className="btn"
            onClick={() => void window.pz.shell.open(source?.path ?? '')}
            disabled={!source?.exists}
            title={t('led.openTitle')}
          >
            <Icon name="file" size={13} />
            {t('led.open')}
          </button>
          <button
            className="btn btn-icon"
            onClick={() => void copyPath()}
            disabled={!source?.path}
            title={t('led.copyPath')}
          >
            <Icon name="copy" size={13} />
          </button>
          <button
            className="btn btn-icon"
            onClick={() => void store.reload()}
            disabled={busy}
            title={t('led.reloadTitle')}
          >
            <Icon name="refresh" size={13} className={busy ? 'spin' : undefined} />
          </button>
        </div>

        <div className="toolbar__row toolbar__row--filters">
          <span className="label toolbar__legend">{t('led.levels')}</span>
          {LEVELS.map((level) => (
            <button
              key={level}
              className={`chip ledchip ledchip--${level} ${muted.has(level) ? '' : 'is-on'}`}
              onClick={() => toggleLevel(level)}
              title={t('led.levelToggle')}
            >
              <Icon name={LEVEL_ICON[level]} size={10} />
              {t(LEVEL_KEY[level])}
              <span className="chip__n mono">{formatCount(parsed.counts[level])}</span>
            </button>
          ))}
          <Hint title={t('led.levels')} body={t('help.led.levels')} />

          <button
            className="btn btn--tiny"
            onClick={jumpFirstError}
            disabled={parsed.firstError < 0}
            title={t('led.firstErrorTitle')}
          >
            <Icon name="target" size={11} />
            {t('led.firstError')}
          </button>

          <div className="toolbar__spacer" />

          <div className="minisearch">
            <Icon name="search" size={12} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('led.searchPlaceholder')}
              spellCheck={false}
            />
            {query && (
              <button className="minisearch__clear" onClick={() => setQuery('')}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="ledger__body">
        <section className="pane pane--center">
          <div className="pane__head">
            <Icon name="book" size={13} color="var(--rust)" />
            <span className="pane__title stencil">{t('led.paneLog')}</span>
            <span className="pane__count mono">{formatCount(rows.length)}</span>
            {rows.length !== parsed.incidents.length && (
              <span className="pane__count pane__count-total mono">
                / {formatCount(parsed.incidents.length)}
              </span>
            )}
            <div className="pane__head-spacer" />
            {store.content?.truncated && (
              <span className="ledpill ledpill--tail" title={t('led.truncatedTitle')}>
                {t('led.truncated')}
              </span>
            )}
          </div>

          {(noUserDir || missing || store.error) && (
            <div className="lednotice">
              {noUserDir && (
                <Alert kind="warn" title={t('led.noUserDir')}>
                  {t('led.noUserDirBody')}
                </Alert>
              )}
              {missing && !noUserDir && (
                <Alert kind="info" title={t('led.missing')}>
                  {t('led.missingHint')}
                </Alert>
              )}
              {store.error && <Alert kind="bad">{store.error}</Alert>}
            </div>
          )}

          <LogList
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyIcon={parsed.incidents.length === 0 ? 'book' : 'filter'}
            emptyLabel={parsed.incidents.length === 0 ? t('led.empty') : t('led.noMatches')}
            emptyHint={parsed.incidents.length === 0 ? t('led.emptyHint') : t('led.noMatchesHint')}
          />
        </section>

        <Splitter onDrag={dragRight} onDoubleClick={() => setRightW(420)} />

        <section className="pane pane--right" style={{ width: rightW, flex: `0 0 ${rightW}px` }}>
          <div className="pane__head">
            <Icon name="code" size={13} color="var(--steel)" />
            <span className="pane__title stencil">{t('led.paneDetail')}</span>
            <div className="pane__head-spacer" />
            <Hint title={t('led.paneDetail')} body={t('help.led.detail')} />
          </div>
          <LogDetail incident={selected} />
        </section>
      </div>

      <footer className="statusbar mono">
        <Icon name="book" size={12} />
        <span>
          {formatCount(parsed.lines)} {p('lines', parsed.lines)}
        </span>
        <span className="statusbar__sep">·</span>
        <span className={parsed.counts.error ? 'is-warn' : 'is-dim'}>
          {t('led.sbErrors', { n: formatCount(parsed.counts.error) })}
        </span>
        <span className="statusbar__sep">·</span>
        <span className={parsed.counts.warn ? 'is-warn' : 'is-dim'}>
          {t('led.sbWarns', { n: formatCount(parsed.counts.warn) })}
        </span>
        {source && source.size > 0 && (
          <>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">{formatBytes(source.size)}</span>
          </>
        )}
        {source && source.mtime > 0 && (
          <>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">{t('led.sbUpdated', { date: formatDate(source.mtime) })}</span>
          </>
        )}
        <span className="statusbar__spacer" />
        <span className="statusbar__path" title={source?.path}>
          {source?.path ? shortenPath(source.path, 4) : '—'}
        </span>
      </footer>
    </div>
  )
}
