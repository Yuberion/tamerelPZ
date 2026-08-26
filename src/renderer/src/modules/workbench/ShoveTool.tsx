import { useEffect, useMemo, useState } from 'react'
import type {
  AuthoringTarget,
  BatchPackItemResult,
  BatchPackResult,
  BatchValidationPolicy,
  ModEntry,
  PackBuilds,
  PackMode,
  PackVisibility,
  WorkbenchProgress
} from '@shared/types'
import {
  Alert,
  CheckField,
  Group,
  OptionCard,
  Panel,
  Readout,
  SelectField,
  TextAreaField,
  TextField
} from '@renderer/components/Form'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatBytes, formatCount, formatDuration, fuzzyMatch } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'

interface ShoveToolProps {
  mods: ModEntry[]
  targets: AuthoringTarget[]
  knownIds: string[]
}

const BUILD_OPTIONS: Array<{ value: PackBuilds; labelKey: TKey }> = [
  { value: 'all', labelKey: 'wb.shove.buildsAll' },
  { value: 'b41', labelKey: 'wb.shove.buildsB41' },
  { value: 'b42', labelKey: 'wb.shove.buildsB42' }
]

const VALIDATION_OPTIONS: Array<{ value: BatchValidationPolicy; labelKey: TKey }> = [
  { value: 'none', labelKey: 'wb.shove.valNone' },
  { value: 'warn', labelKey: 'wb.shove.valWarn' },
  { value: 'strict', labelKey: 'wb.shove.valStrict' }
]

const VISIBILITY: Array<{ value: PackVisibility; labelKey: TKey }> = [
  { value: 'public', labelKey: 'wb.shove.visPublic' },
  { value: 'friendsOnly', labelKey: 'wb.shove.visFriends' },
  { value: 'private', labelKey: 'wb.shove.visPrivate' },
  { value: 'unlisted', labelKey: 'wb.shove.visUnlisted' }
]

export function ShoveTool({ mods, targets, knownIds }: ShoveToolProps) {
  const { t } = useI18n()
  const { notify } = useToast()
  const { paths } = useAppStore()

  const defaultDir = paths?.zomboidDir ? `${paths.zomboidDir}\\Workshop` : t('wb.shove.noZomboid')

  // ---- options -------------------------------------------------------------
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<PackMode>('workshop')
  const [builds, setBuilds] = useState<PackBuilds>('all')
  const [outputDir, setOutputDir] = useState<string>()
  const [exclude, setExclude] = useState('')
  const [preview, setPreview] = useState(true)
  const [validation, setValidation] = useState<BatchValidationPolicy>('none')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<PackVisibility>('public')
  const [workshopId, setWorkshopId] = useState('')

  // ---- run state -----------------------------------------------------------
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<WorkbenchProgress>()
  const [result, setResult] = useState<BatchPackResult>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    const off = window.pz.workbench.onProgress(setProgress)
    return off
  }, [])

  const writableKeys = useMemo(() => {
    const roots = targets.map((p) => p.path.toLowerCase().replace(/[\\/]+$/, ''))
    const set = new Set<string>()
    for (const m of mods) {
      const lower = m.path.toLowerCase()
      if (roots.some((r) => lower === r || lower.startsWith(r + '\\') || lower.startsWith(r + '/'))) {
        set.add(m.key)
      }
    }
    return set
  }, [mods, targets])

  const visible = useMemo(() => {
    const needle = query.trim()
    if (!needle) return mods
    return mods.filter(
      (m) =>
        fuzzyMatch(needle, m.name) ??
        (m.modId ? fuzzyMatch(needle, m.modId) : null) ??
        fuzzyMatch(needle, m.folderName)
    )
  }, [mods, query])

  const selectedVisible = useMemo(
    () => visible.filter((m) => selected.has(m.key)),
    [visible, selected]
  )

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = (): void => setSelected(new Set(visible.map((m) => m.key)))
  const clearAll = (): void => setSelected(new Set())
  const selectWritable = (): void =>
    setSelected(new Set(visible.filter((m) => writableKeys.has(m.key)).map((m) => m.key)))

  const pick = async (): Promise<void> => {
    const chosen = await window.pz.paths.pickFolder(t('wb.shove.outputDir'))
    if (chosen) setOutputDir(chosen)
  }

  const run = async (): Promise<void> => {
    const items = selectedVisible.map((m) => ({ modPath: m.path, label: m.folderName }))
    if (items.length === 0) {
      setError(t('wb.shove.noSelection'))
      return
    }
    setBusy(true)
    setCancelling(false)
    setError(undefined)
    setResult(undefined)
    setProgress(undefined)
    try {
      const packed = await window.pz.workbench.shove({
        items,
        mode,
        builds,
        outputDir,
        exclude: exclude.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        preview,
        workshop:
          mode === 'workshop'
            ? {
                title: title.trim() || (selectedVisible[0]?.name ?? ''),
                description,
                tags: tags.split(';').map((s) => s.trim()).filter(Boolean),
                visibility,
                id: workshopId.trim()
              }
            : undefined,
        validation,
        knownIds
      })
      setResult(packed)
      if (packed.errors === 0 && packed.cancelled === false) {
        notify(t('wb.shove.resultSummary', { ok: packed.ok, errors: packed.errors, skipped: packed.skipped }), 'ok')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setCancelling(true)
    await window.pz.workbench.shoveCancel()
  }

  const revealOutputDir = (): void => {
    if (result?.outputDir) void window.pz.shell.open(result.outputDir)
  }

  const revealAll = (): void => {
    for (const item of result?.items ?? []) {
      if (item.status === 'ok' && item.output) void window.pz.shell.reveal(item.output)
    }
  }

  const running = busy || cancelling
  const canRun = selectedVisible.length > 0 && !running

  return (
    <Panel
      title={t('wb.shove.title')}
      lede={t('wb.shove.lede')}
      icon="layers"
      help={t('help.wb.shove.panel')}
      actions={
        running ? (
          <button className="btn is-danger" onClick={() => void cancel()} disabled={!busy}>
            <Icon name="close" size={13} />
            {cancelling ? t('wb.shove.cancelling') : t('wb.shove.cancel')}
          </button>
        ) : (
          <button className="btn is-primary" disabled={!canRun} onClick={() => void run()}>
            <Icon name="layers" size={13} />
            {t('wb.shove.run', { n: selectedVisible.length })}
          </button>
        )
      }
    >
      {error && <Alert kind="bad">{error}</Alert>}
      {result?.cancelled && <Alert kind="warn">{t('wb.shove.cancelledNotice')}</Alert>}

      {/* -------- selection ------------------------------------------------ */}
      <Group title={t('wb.shove.selection')} hint={t('wb.shove.selectionHint')} help={t('help.wb.shove.selection')}>
        <div className="wbtoolbar">
          <div className="minisearch wbtoolbar__search">
            <Icon name="search" size={12} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('wb.shove.searchPlaceholder')}
              spellCheck={false}
            />
            {query && (
              <button className="minisearch__clear" onClick={() => setQuery('')}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
          <div className="wbtoolbar__spacer" />
          <button className="btn" onClick={selectAll} disabled={running}>
            {t('wb.shove.selectAll')}
          </button>
          <button className="btn" onClick={selectWritable} disabled={running}>
            {t('wb.shove.selectWritable')}
          </button>
          <button className="btn" onClick={clearAll} disabled={running}>
            {t('wb.shove.selectNone')}
          </button>
          <span className="label wbmuted">{t('wb.shove.selectedCount', { n: selectedVisible.length })}</span>
        </div>

        {visible.length === 0 ? (
          <div className="pane__empty">
            <Icon name="layers" size={20} />
            <span className="label">{t('wb.shove.noMods')}</span>
          </div>
        ) : (
          <div className="wbsel">
            {visible.map((m) => {
              const on = selected.has(m.key)
              const writable = writableKeys.has(m.key)
              return (
                <label key={m.key} className={`wbrowse ${on ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={running}
                    onChange={() => toggle(m.key)}
                  />
                  <span className="wbrowse__box">{on && <Icon name="check" size={10} />}</span>
                  <span className="wbrowse__name">
                    {m.folderName}
                    {!writable && <span className="lock">· {m.sourceKind}</span>}
                  </span>
                  <span className="wbrowse__builds mono">{m.builds.join(', ')}</span>
                </label>
              )
            })}
          </div>
        )}
      </Group>

      {/* -------- options --------------------------------------------------- */}
      <Group title={t('wb.shove.options')}>
        <div className="wboptrow">
          <OptionCard
            on={mode === 'workshop'}
            onClick={() => setMode('workshop')}
            label={t('wb.pack.modeWorkshop')}
            hint={t('wb.pack.modeWorkshopHint')}
            icon="server"
            disabled={running}
          />
          <OptionCard
            on={mode === 'zip'}
            onClick={() => setMode('zip')}
            label={t('wb.pack.modeZip')}
            hint={t('wb.pack.modeZipHint')}
            icon="archive"
            disabled={running}
          />
        </div>

        <div className="wbgrid">
          <SelectField
            label={t('wb.shove.builds')}
            help={t('help.wb.pack.builds')}
            value={builds}
            onChange={setBuilds}
            disabled={running}
            options={BUILD_OPTIONS.map((b) => ({ value: b.value, label: t(b.labelKey) }))}
          />
          <SelectField
            label={t('wb.shove.validation')}
            help={t('help.wb.shove.validation')}
            value={validation}
            onChange={setValidation}
            disabled={running}
            options={VALIDATION_OPTIONS.map((v) => ({ value: v.value, label: t(v.labelKey) }))}
          />
        </div>

        <div className="wbfield wbfield--wide">
          <span className="wbfield__label label">
            {t('wb.shove.outputDir')}
            <Hint title={t('wb.shove.outputDir')} body={t('help.wb.shove.outputDir')} />
          </span>
          <div className="wbpick">
            <input className="wbfield__input mono" value={outputDir ?? ''} readOnly placeholder={defaultDir} />
            <button className="btn" onClick={() => void pick()} disabled={running}>
              <Icon name="folder-open" size={12} />
              {t('wb.shove.pickDir')}
            </button>
            {outputDir && (
              <button className="btn btn-icon" title={t('wb.shove.resetDir')} onClick={() => setOutputDir(undefined)}>
                <Icon name="rotate" size={12} />
              </button>
            )}
          </div>
        </div>

        <TextAreaField
          label={t('wb.shove.exclude')}
          hint={t('wb.shove.excludeHint')}
          help={t('help.wb.pack.exclude')}
          value={exclude}
          onChange={setExclude}
          rows={2}
          mono
          disabled={running}
          placeholder={'*.psd\ndocs'}
        />
        <CheckField
          label={t('wb.shove.preview')}
          help={t('help.wb.pack.preview')}
          checked={preview}
          onChange={setPreview}
          disabled={running}
        />
      </Group>

      {/* -------- shared workshop metadata ----------------------------------- */}
      {mode === 'workshop' && (
        <Group title={t('wb.shove.meta')} help={t('help.wb.shove.meta')}>
          <div className="wbgrid">
            <TextField
              label={t('wb.shove.metaTitle')}
              help={t('help.wb.pack.metaTitle')}
              value={title}
              onChange={setTitle}
              disabled={running}
              wide
            />
            <TextField
              label={t('wb.shove.metaTags')}
              hint={t('wb.shove.metaTagsHint')}
              value={tags}
              onChange={setTags}
              disabled={running}
            />
            <SelectField
              label={t('wb.shove.metaVisibility')}
              value={visibility}
              onChange={setVisibility}
              disabled={running}
              options={VISIBILITY.map((v) => ({ value: v.value, label: t(v.labelKey) }))}
            />
            <TextField
              label={t('wb.shove.metaId')}
              hint={t('wb.shove.metaIdHint')}
              value={workshopId}
              onChange={setWorkshopId}
              mono
              disabled={running}
            />
            <TextAreaField
              label={t('wb.shove.metaDescription')}
              value={description}
              onChange={setDescription}
              rows={3}
              disabled={running}
            />
          </div>
        </Group>
      )}

      {/* -------- progress --------------------------------------------------- */}
      {running && progress && (
        <Group title={t('wb.shove.running')}>
          <TwoLevelBar progress={progress} />
        </Group>
      )}

      {/* -------- results ---------------------------------------------------- */}
      {result && (
        <Group title={t('wb.shove.resultTitle')}>
          <div className="btnrow">
            <button className="btn" onClick={revealAll} disabled={result.items.every((i) => i.status !== 'ok')}>
              <Icon name="external" size={12} />
              {t('wb.shove.revealAll')}
            </button>
            <button className="btn" onClick={revealOutputDir}>
              <Icon name="folder-open" size={12} />
              {t('wb.shove.revealDir')}
            </button>
          </div>
          <Readout label={t('wb.shove.resultOutputDir')} value={result.outputDir} />
          {result.cancelled && <Alert kind="warn">{t('wb.shove.cancelledNotice')}</Alert>}
          <ResultTable items={result.items} />
          <p className="label wbmuted">
            {t('wb.shove.resultSummary', { ok: result.ok, errors: result.errors, skipped: result.skipped })} ·{' '}
            {formatDuration(result.durationMs)}
          </p>
        </Group>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ widgets -- */

function TwoLevelBar({ progress }: { progress: WorkbenchProgress }) {
  const { t } = useI18n()
  const itemIndex = progress.itemIndex ?? 0
  const itemCount = progress.itemCount ?? 1
  const innerPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="wbprog">
      <div className="wbprog__overall">
        <span className="label">
          {t('wb.shove.progressOverall', { i: itemIndex + 1, n: itemCount })}
        </span>
        {progress.itemLabel && <span className="mono wbmuted">{progress.itemLabel}</span>}
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${(itemIndex / itemCount) * 100}%` }} />
      </div>
      <div className="wbprog__inner">
        <span className="label">
          {t(`wb.phase.${progress.phase}` as TKey)}
          {progress.total > 0 && ` · ${formatCount(progress.done)}/${formatCount(progress.total)}`}
        </span>
        <span className="mono wbmuted is-trunc">{progress.label}</span>
        <span className="wbprog__pct mono">{innerPct}%</span>
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${innerPct}%` }} />
      </div>
    </div>
  )
}

function ResultTable({ items }: { items: BatchPackItemResult[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggleRow = (i: number): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  if (items.length === 0) {
    return (
      <div className="pane__empty">
        <Icon name="layers" size={20} />
        <span className="label">{t('wb.shove.emptyState')}</span>
      </div>
    )
  }

  return (
    <table className="wbtable">
      <thead>
        <tr>
          <th className="wbtable__expander" />
          <th>{t('wb.shove.colMod')}</th>
          <th>{t('wb.shove.colStatus')}</th>
          <th>{t('wb.shove.colReason')}</th>
          <th>{t('wb.shove.colOutput')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const expanded = open.has(i)
          const reason = item.reason ? (`wbshove.${item.reason}` as TKey) : undefined
          return (
            <ResultRow
              key={i}
              item={item}
              reason={reason}
              expanded={expanded}
              onToggle={() => toggleRow(i)}
            />
          )
        })}
      </tbody>
    </table>
  )
}

function ResultRow({
  item,
  reason,
  expanded,
  onToggle
}: {
  item: BatchPackItemResult
  reason: TKey | undefined
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  const statusKey = `wb.shove.status.${item.status}` as TKey
  const reveal = (): void => {
    if (item.output) void window.pz.shell.reveal(item.output)
  }

  return (
    <>
      <tr className={`wbtable__row wbstatus--${item.status}`}>
        <td className="wbtable__expander">
          {(item.status === 'ok' || item.status === 'error') && (
            <button className="btn btn-icon" onClick={onToggle} title={expanded ? '−' : '+'}>
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
            </button>
          )}
        </td>
        <td className="mono">{item.label}</td>
        <td>
          <span className={`wbpill wbpill--${item.status}`}>{t(statusKey)}</span>
        </td>
        <td>{reason ? t(reason) : <span className="label wbmuted">—</span>}</td>
        <td>
          {item.status === 'ok' && item.output ? (
            <button className="btn btn--tiny" onClick={reveal}>
              <Icon name="external" size={11} />
              {t('wb.shove.reveal')}
            </button>
          ) : (
            <span className="label wbmuted">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="wbtable__detail">
          <td />
          <td colSpan={4}>
            {item.result && (
              <div className="statgrid">
                <Stat label={t('wb.pack.resultFiles')} value={formatCount(item.result.files)} />
                <Stat label={t('wb.pack.resultSize')} value={formatBytes(item.result.bytes)} />
                <Stat label={t('wb.pack.resultWritten')} value={formatBytes(item.result.writtenBytes)} />
                <Stat label={t('wb.pack.resultSkipped')} value={formatCount(item.result.skipped)} />
              </div>
            )}
            {item.message && <p className="label wbmuted">{item.message}</p>}
            {item.output && <Readout label={t('wb.pack.resultOutput')} value={item.output} />}
          </td>
        </tr>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value mono">{value}</span>
      <span className="stat__label label">{label}</span>
    </div>
  )
}
