import { useMemo, useState } from 'react'
import type {
  ModEntry,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity
} from '@shared/types'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { hasKey, useI18n, type TKey } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDuration } from '@renderer/lib/format'
import { Alert, Panel } from './Form'

interface ValidateToolProps {
  mod: ModEntry
  /** Normalised ids of every mod on this machine, for `require=` resolution. */
  knownIds: string[]
}

type Filter = 'all' | ValidationSeverity

const SEVERITY_META: Record<ValidationSeverity, { icon: IconName; cls: string; labelKey: TKey }> = {
  error: { icon: 'x-circle', cls: 'is-error', labelKey: 'wb.val.errors' },
  warn: { icon: 'alert-circle', cls: 'is-warn', labelKey: 'wb.val.warnings' },
  info: { icon: 'info', cls: 'is-info', labelKey: 'wb.val.infos' }
}

export function ValidateTool({ mod, knownIds }: ValidateToolProps) {
  const { t, p } = useI18n()
  const { notify } = useToast()

  const [report, setReport] = useState<ValidationReport>()
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string>()

  /** Resolve a rule id to a message, falling back to the raw id. */
  const message = (issue: ValidationIssue): string => {
    const key = `wbrule.${issue.rule}`
    return hasKey(key) ? t(key, issue.params) : issue.rule
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(undefined)
    try {
      const infoFile = mod.infoFile
      const next = await window.pz.workbench.validate(
        mod.path,
        infoFile ? { knownIds, infoFile } : { knownIds }
      )
      setReport(next)
      setFilter('all')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const counts = useMemo(() => {
    const out = { error: 0, warn: 0, info: 0 }
    for (const issue of report?.issues ?? []) out[issue.severity]++
    return out
  }, [report])

  const visible = useMemo(() => {
    const issues = report?.issues ?? []
    return filter === 'all' ? issues : issues.filter((i) => i.severity === filter)
  }, [report, filter])

  const copyReport = async (): Promise<void> => {
    if (!report) return
    const lines = [
      `${mod.name} — ${mod.path}`,
      `${report.filesChecked} files, ${formatBytes(report.bytesChecked)}, ${formatDuration(report.durationMs)}`,
      ''
    ]
    for (const issue of report.issues) {
      const where = issue.file
        ? ` [${relative(issue.file, mod.path)}${issue.line ? `:${issue.line}` : ''}]`
        : ''
      lines.push(`${issue.severity.toUpperCase()} ${issue.rule}${where} — ${message(issue)}`)
    }
    await copyText(lines.join('\n'))
    notify(t('wb.val.reportCopied'), 'ok')
  }

  return (
    <Panel
      title={t('wb.val.title')}
      lede={t('wb.val.lede')}
      icon="flask"
      actions={
        <>
          {report && (
            <button className="btn" onClick={() => void copyReport()}>
              <Icon name="copy" size={13} />
              {t('wb.val.copyReport')}
            </button>
          )}
          <button className="btn is-primary" disabled={running} onClick={() => void run()}>
            <Icon name={running ? 'refresh' : 'play'} size={13} className={running ? 'spin' : undefined} />
            {running ? t('wb.val.running') : report ? t('wb.val.rerun') : t('wb.val.run')}
          </button>
        </>
      }
    >
      {error && <Alert kind="bad">{error}</Alert>}

      {!report && !running && !error && (
        <div className="pane__empty pane__empty--big">
          <Icon name="flask" size={30} strokeWidth={1.2} />
          <span className="stencil">{t('wb.val.neverRun')}</span>
          <span className="label">{t('wb.val.neverRunBody')}</span>
        </div>
      )}

      {report && (
        <>
          <div className="wbsummary mono">
            {t('wb.val.summary', {
              files: formatCount(report.filesChecked),
              filesWord: p('files', report.filesChecked),
              bytes: formatBytes(report.bytesChecked),
              duration: formatDuration(report.durationMs)
            })}
          </div>

          {report.truncated && <Alert kind="warn">{t('wb.val.truncated')}</Alert>}

          {report.issues.length === 0 ? (
            <div className="wbclean">
              <Icon name="check-circle" size={26} color="var(--moss)" />
              <div>
                <div className="stencil wbclean__title">{t('wb.val.clean')}</div>
                <div className="label">
                  {t('wb.val.cleanBody', {
                    files: formatCount(report.filesChecked),
                    filesWord: p('files', report.filesChecked),
                    duration: formatDuration(report.durationMs)
                  })}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="wbchips">
                <button
                  className={`chip ${filter === 'all' ? 'is-on' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  {t('wb.val.filterAll')}
                  <span className="chip__n mono">{report.issues.length}</span>
                </button>
                {(['error', 'warn', 'info'] as const).map((sev) => (
                  <button
                    key={sev}
                    className={`chip ${filter === sev ? 'is-on' : ''}`}
                    disabled={counts[sev] === 0}
                    onClick={() => setFilter(sev)}
                  >
                    <Icon
                      name={SEVERITY_META[sev].icon}
                      size={11}
                      color={sev === 'error' ? 'var(--blood)' : sev === 'warn' ? 'var(--ember)' : undefined}
                    />
                    {t(SEVERITY_META[sev].labelKey)}
                    <span className="chip__n mono">{counts[sev]}</span>
                  </button>
                ))}
              </div>

              <div className="wbissues">
                {visible.map((issue, i) => (
                  <IssueRow
                    key={`${issue.rule}-${issue.file ?? ''}-${issue.line ?? 0}-${i}`}
                    issue={issue}
                    modPath={mod.path}
                    message={message(issue)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

function IssueRow({
  issue,
  modPath,
  message
}: {
  issue: ValidationIssue
  modPath: string
  message: string
}) {
  const { t } = useI18n()
  const meta = SEVERITY_META[issue.severity]
  const where = issue.file ? relative(issue.file, modPath) : t('wb.val.modScope')

  return (
    <div className={`wbissue ${meta.cls}`}>
      <Icon name={meta.icon} size={13} className="wbissue__glyph" />
      <div className="wbissue__body">
        <div className="wbissue__msg">{message}</div>
        <div className="wbissue__where mono">
          <span className="truncate">{where}</span>
          {issue.line ? <span className="wbissue__line">{t('wb.val.line', { n: issue.line })}</span> : null}
          <span className="wbissue__rule">{issue.rule}</span>
        </div>
      </div>
      {issue.file && (
        <button
          className="btn btn-icon"
          title={t('wb.val.openFile')}
          onClick={() => void window.pz.shell.reveal(issue.file as string)}
        >
          <Icon name="external" size={12} />
        </button>
      )}
    </div>
  )
}

/** `file` shown relative to the mod root, with forward slashes. */
function relative(file: string, root: string): string {
  const lowerFile = file.toLowerCase()
  const lowerRoot = root.toLowerCase().replace(/[\\/]+$/, '')
  if (lowerFile.startsWith(lowerRoot)) {
    return file.slice(lowerRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
  }
  return file.replace(/\\/g, '/')
}
