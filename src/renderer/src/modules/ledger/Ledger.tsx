import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from '@renderer/components/Form'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDate, fuzzyMatch, shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import type { LaunchStageId } from '@shared/types'
import { ExportModal } from './ExportModal'
import { LaunchTimeline } from './LaunchTimeline'
import { LogDetail } from './LogDetail'
import { LogDiagnostics } from './LogDiagnostics'
import { LogDiffModal } from './LogDiffModal'
import { LEVEL_ICON, LEVEL_KEY, LogList, type LogRow } from './LogList'
import { buildModIndex, deduplicateIncidents, parseLog, resolveSourcePath, type LogIncident, type LogLevel } from './parseLog'
import { useLogs } from './useLogs'

const LS_RIGHT = 'pz.ledger.rightWidth'
const LS_DEDUPE = 'pz.ledger.dedupe'

/** Chip order, loudest first — the reason anyone opens this module. */
const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

function readWidth(fallback: number): number {
  const raw = Number(localStorage.getItem(LS_RIGHT))
  return Number.isFinite(raw) && raw > 240 ? raw : fallback
}

export function Ledger({ onExit }: { onExit: () => void }) {
  const { scan, paths } = useAppStore()
  const { t, p } = useI18n()
  const { notify } = useToast()
  const store = useLogs()

  const gameDir = paths?.gameDir

  const [query, setQuery] = useState('')
  const [muted, setMuted] = useState<Set<LogLevel>>(() => new Set())
  const [selectedId, setSelectedId] = useState<number>()
  const [rightW, setRightW] = useState(() => readWidth(420))
  const [dedupe, setDedupe] = useState<boolean>(() => localStorage.getItem(LS_DEDUPE) !== 'false')
  const [follow, setFollow] = useState<boolean>(false)
  const [selectedMod, setSelectedMod] = useState<string>('')
  const [selectedDiagId, setSelectedDiagId] = useState<string>()
  const [showExport, setShowExport] = useState<boolean>(false)
  const [showDiff, setShowDiff] = useState<boolean>(false)
  const [selectedStageId, setSelectedStageId] = useState<LaunchStageId | undefined>(undefined)
  const [diffFilterQueries, setDiffFilterQueries] = useState<string[] | undefined>(undefined)

  const searchRef = useRef<HTMLInputElement>(null)
  const prevErrorCount = useRef(0)

  const modIndex = useMemo(() => buildModIndex(scan?.mods ?? []), [scan])
  const parsed = useMemo(
    () => parseLog(store.content?.text ?? '', modIndex),
    [store.content, modIndex]
  )

  // Notify on new errors during live tailing
  useEffect(() => {
    if (store.live && parsed.counts.error > prevErrorCount.current && prevErrorCount.current > 0) {
      notify(t('led.newErrorsToast', { n: parsed.counts.error - prevErrorCount.current }), 'warn')
    }
    prevErrorCount.current = parsed.counts.error
  }, [parsed.counts.error, store.live, notify, t])

  // Automatically enable follow mode when activating live mode
  const toggleLive = useCallback(() => {
    store.setLive(!store.live)
    if (!store.live) {
      setFollow(true)
    }
  }, [store])

  const toggleDedupe = useCallback(() => {
    setDedupe((v) => {
      const next = !v
      localStorage.setItem(LS_DEDUPE, String(next))
      return next
    })
  }, [])

  // Deduplicate entries if option is active
  const effectiveIncidents = useMemo(() => {
    if (!dedupe) return parsed.incidents
    return deduplicateIncidents(parsed.incidents)
  }, [parsed.incidents, dedupe])

  const activeDiagnosis = useMemo(
    () => parsed.diagnoses.find((d) => d.id === selectedDiagId),
    [parsed.diagnoses, selectedDiagId]
  )

  const coreCount = useMemo(
    () => parsed.incidents.filter((i) => !i.modName).length,
    [parsed.incidents]
  )

  /**
   * Visible rows with all active filters applied:
   * 1. Muted levels
   * 2. Selected diagnosis
   * 3. Selected mod
   * 4. Search query
   */
  const rows = useMemo<LogRow[]>(() => {
    const needle = query.trim()
    const deep = needle.toLowerCase()
    const matchingDiagSet = activeDiagnosis ? new Set(activeDiagnosis.matchingIncidentIds) : null
    const stage = selectedStageId ? parsed.stages.find((s) => s.id === selectedStageId) : null

    const out: LogRow[] = []
    for (const incident of effectiveIncidents) {
      if (muted.has(incident.level)) continue

      if (stage && (incident.line < stage.startLine || incident.line > stage.endLine)) {
        continue
      }

      if (diffFilterQueries && diffFilterQueries.length > 0) {
        const matchDiff = diffFilterQueries.some((q) =>
          incident.head.toLowerCase().includes(q.toLowerCase())
        )
        if (!matchDiff) continue
      }

      if (matchingDiagSet && !matchingDiagSet.has(incident.id)) {
        continue
      }

      if (selectedMod) {
        if (selectedMod === '__core__') {
          if (incident.modName) continue
        } else if (incident.modName !== selectedMod) {
          continue
        }
      }

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
  }, [effectiveIncidents, muted, activeDiagnosis, selectedMod, query, selectedStageId, diffFilterQueries, parsed.stages])

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
    setMuted((prev) => {
      if (!prev.has('error')) return prev
      const next = new Set(prev)
      next.delete('error')
      return next
    })
    setQuery('')
    setSelectedMod('')
    setSelectedDiagId(undefined)
    setSelectedId(first.id)
  }, [parsed])

  const copyPath = useCallback(async () => {
    const path = store.source?.path
    if (!path) return
    notify((await copyText(path)) ? t('led.pathCopied') : t('led.copyFailed'), 'ok')
  }, [store.source, notify, t])

  const handleCleanArchive = useCallback(async () => {
    if (!window.confirm(t('led.cleanConfirm'))) return
    try {
      const res = await store.cleanArchive(10)
      notify(
        t('led.cleanedResult', {
          count: res.deleted,
          bytes: formatBytes(res.freedBytes)
        }),
        'ok'
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    }
  }, [store, notify, t])

  const handleOpenSource = useCallback(
    async (incident: LogIncident) => {
      const candidate =
        incident.callSite?.file ||
        incident.origin ||
        (incident.level === 'error' || incident.level === 'warn' ? incident.head : undefined)

      if (!candidate) {
        notify(t('led.noScriptInLog'), 'info')
        return
      }

      const res = await window.pz.logs.resolveSource(
        candidate,
        incident.modPath,
        gameDir,
        incident.callSite?.line
      )

      const targetPath =
        res?.path ??
        (incident.callSite?.file
          ? resolveSourcePath(incident.callSite.file, incident.modPath, gameDir)
          : undefined)
      const targetLine = res?.line ?? incident.callSite?.line

      if (!targetPath) {
        notify(t('led.fileNotFound'), 'warn')
        return
      }

      try {
        await window.pz.npp.open(targetPath, targetLine)
        notify(t('led.openedInNpp'), 'ok')
        return
      } catch {
        // Fallback to default shell open for single file
      }
      try {
        await window.pz.shell.open(targetPath)
        notify(t('led.openedInEditor'), 'ok')
      } catch {
        notify(t('led.fileNotFound'), 'warn')
      }
    },
    [gameDir, notify, t]
  )

  const dragRight = useCallback((dx: number) => {
    setRightW((w) => {
      const next = Math.min(Math.max(w - dx, 280), 720)
      localStorage.setItem(LS_RIGHT, String(next))
      return next
    })
  }, [])

  // Clear selection across reload or source switch
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
  const foldedCount = parsed.incidents.length - effectiveIncidents.length

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

          <div className="divider-v" />

          {/* Live Tail Toggle */}
          <button
            className={`btn ${store.live ? 'btn--active ledlive-btn' : ''}`}
            onClick={toggleLive}
            title={t('led.liveTitle')}
          >
            <span className={`ledlive-dot ${store.live ? 'is-live' : ''}`} />
            {t('led.live')}
          </button>

          {/* Follow Scroll Toggle */}
          <button
            className={`btn btn--tiny ${follow ? 'btn--active' : ''}`}
            onClick={() => setFollow(!follow)}
            title={t('led.followTitle')}
          >
            <Icon name="arrow-down" size={12} />
            {t('led.follow')}
          </button>

          {/* Full log read toggle */}
          {(store.content?.truncated || store.full) && (
            <button
              className={`btn btn--tiny ${store.full ? 'btn--active' : ''}`}
              onClick={() => store.setFull(!store.full)}
              title={store.full ? t('led.tailOnlyTitle') : t('led.loadFullTitle')}
            >
              <Icon name="book" size={11} />
              {store.full ? t('led.fullLoaded') : t('led.loadFull')}
            </button>
          )}

          {/* Export Report */}
          <button
            className="btn btn--tiny"
            onClick={() => setShowExport(true)}
            title={t('led.exportBtnTitle')}
          >
            <Icon name="share" size={12} />
            {t('led.exportBtn')}
          </button>

          {/* Log Diff */}
          <button
            className="btn btn--tiny"
            onClick={() => setShowDiff(true)}
            title={t('led.compareSessionsTitle')}
          >
            <Icon name="diff" size={12} />
            {t('led.compareSessions')}
          </button>

          {/* Clean Archive (shown if there are archived logs) */}
          {store.sources.filter((s) => s.kind === 'log').length > 5 && (
            <button
              className="btn btn--tiny"
              onClick={() => void handleCleanArchive()}
              title={t('led.cleanArchiveTitle')}
            >
              <Icon name="trash" size={11} />
              {t('led.cleanArchive')}
            </button>
          )}

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

          <div className="divider-v" />

          {/* Deduplicate Toggle */}
          <button
            className={`chip ledchip ${dedupe ? 'is-on' : ''}`}
            onClick={toggleDedupe}
            title={t('led.dedupeTitle')}
          >
            <Icon name="copy" size={10} />
            {t('led.dedupe')}
            {foldedCount > 0 && <span className="chip__n mono">-{foldedCount}</span>}
          </button>

          {/* Mod Filter Dropdown */}
          <div className="pick">
            <select
              className="ledmodpick"
              value={selectedMod}
              onChange={(e) => setSelectedMod(e.target.value)}
              title={t('led.filterModTitle')}
            >
              <option value="">{t('led.allMods')} ({parsed.incidents.length})</option>
              {coreCount > 0 && (
                <option value="__core__">
                  {t('led.coreEngine')} ({coreCount})
                </option>
              )}
              {parsed.modAttributions.map((m) => (
                <option key={m.modName} value={m.modName}>
                  {m.modName} ({m.errors ? `${m.errors} err` : `${m.warnings} warn`})
                </option>
              ))}
            </select>
          </div>

          {diffFilterQueries && diffFilterQueries.length > 0 && (
            <button
              className="chip ledchip is-on"
              onClick={() => setDiffFilterQueries(undefined)}
              title={t('led.clearDiffFilterTitle')}
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
            >
              <Icon name="diff" size={10} />
              {t('led.onlyNewErrors')} ({diffFilterQueries.length})
              <Icon name="close" size={10} />
            </button>
          )}

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

        {/* Launch Stages Timeline */}
        {parsed.stages && parsed.stages.length > 0 && (
          <LaunchTimeline
            stages={parsed.stages}
            selectedStageId={selectedStageId}
            onSelectStage={setSelectedStageId}
          />
        )}
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

            {store.live && (
              <span className="ledpill ledpill--live mono" title={t('led.liveActiveTitle')}>
                LIVE
              </span>
            )}
            {store.full && (
              <span className="ledpill ledpill--full mono">
                {t('led.fullLoaded')}
              </span>
            )}
            {store.content?.truncated && !store.full && (
              <span className="ledpill ledpill--tail" title={t('led.truncatedTitle')}>
                {t('led.truncated')}
              </span>
            )}
          </div>

          {/* Smart Diagnostics Banner */}
          <LogDiagnostics
            diagnoses={parsed.diagnoses}
            selectedDiagId={selectedDiagId}
            onSelectDiag={setSelectedDiagId}
          />

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
            autoScrollBottom={follow}
            onOpenSource={handleOpenSource}
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
          <LogDetail
            incident={selected}
            gameDir={gameDir}
            onFilterMod={(name) => setSelectedMod(name)}
          />
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
        {dedupe && foldedCount > 0 && (
          <>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">{t('led.sbFolded', { n: formatCount(foldedCount) })}</span>
          </>
        )}
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
        {store.live && (
          <>
            <span className="ledlive-dot is-live" />
            <span className="statusbar__live">{t('led.liveActive')}</span>
            <span className="statusbar__sep">·</span>
          </>
        )}
        <span className="statusbar__path" title={source?.path}>
          {source?.path ? shortenPath(source.path, 4) : '—'}
        </span>
      </footer>

      {/* Export Report Modal */}
      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        sourceName={source?.name ?? 'console.txt'}
        sourcePath={source?.path}
        incidents={parsed.incidents}
        diagnoses={parsed.diagnoses}
        modAttributions={parsed.modAttributions}
      />

      {/* Log Diff Modal */}
      {showDiff && (
        <LogDiffModal
          currentSourceId={store.sourceId}
          sources={store.sources}
          onClose={() => setShowDiff(false)}
          onApplyNewErrorsFilter={(sigs) => {
            setDiffFilterQueries(sigs)
            setShowDiff(false)
          }}
        />
      )}
    </div>
  )
}
