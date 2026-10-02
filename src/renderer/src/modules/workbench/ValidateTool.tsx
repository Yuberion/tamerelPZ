import { useEffect, useMemo, useState } from 'react'
import type {
  IssueCategory,
  ModEntry,
  QuickFixType,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity
} from '@shared/types'
import { Alert, Panel } from '@renderer/components/Form'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { hasKey, useI18n, type TKey } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDuration } from '@renderer/lib/format'

interface ValidateToolProps {
  mod: ModEntry
  /** Normalised ids of every mod on this machine, for `require=` resolution. */
  knownIds: string[]
}

type Filter = 'all' | IssueCategory | ValidationSeverity

const SEVERITY_META: Record<ValidationSeverity, { icon: IconName; cls: string; labelKey: TKey }> = {
  error: { icon: 'x-circle', cls: 'is-error', labelKey: 'wb.val.errors' },
  warn: { icon: 'alert-circle', cls: 'is-warn', labelKey: 'wb.val.warnings' },
  info: { icon: 'info', cls: 'is-info', labelKey: 'wb.val.infos' }
}

const CATEGORY_META: Record<IssueCategory, { icon: IconName; color: string; labelKey: TKey }> = {
  'critical': { icon: 'alert', color: '#f43f5e', labelKey: 'wb.doctor.category.critical' },
  'engine-api': { icon: 'terminal', color: '#38bdf8', labelKey: 'wb.doctor.category.engineApi' },
  'b42-syntax': { icon: 'code', color: '#a78bfa', labelKey: 'wb.doctor.category.b42Syntax' },
  'assets': { icon: 'cube', color: '#34d399', labelKey: 'wb.doctor.category.assets' },
  'overwrites': { icon: 'layers', color: '#fbbf24', labelKey: 'wb.doctor.category.overwrites' },
  'hygiene': { icon: 'shield', color: '#94a3b8', labelKey: 'wb.doctor.category.hygiene' }
}

export function ValidateTool({ mod, knownIds }: ValidateToolProps) {
  const { t, p } = useI18n()
  const { notify } = useToast()

  const [report, setReport] = useState<ValidationReport>()
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string>()
  const [expandedSnippets, setExpandedSnippets] = useState<Record<string, boolean>>({})

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
      const initExpanded: Record<string, boolean> = {}
      next.issues.slice(0, 5).forEach((iss, idx) => {
        if (iss.snippet) {
          initExpanded[`${iss.rule}-${iss.line}-${idx}`] = true
        }
      })
      setExpandedSnippets(initExpanded)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  // Auto-run validation when selected mod changes
  useEffect(() => {
    setReport(undefined)
    setFilter('all')
    void run()
  }, [mod.key])

  const fixableBoms = useMemo(() => {
    return (report?.issues ?? [])
      .filter((i) => i.rule === 'hygiene.bom' && i.file)
      .map((i) => i.file as string)
  }, [report])

  const hasVersionMax = useMemo(() => {
    return (report?.issues ?? []).some((i) => i.rule === 'modinfo.b42-versionmax')
  }, [report])

  const hasSandboxVersionFix = useMemo(() => {
    return (report?.issues ?? []).some(
      (i) => i.rule === 'sandbox.missing-trailing-comma' || i.rule === 'sandbox.missing-version'
    )
  }, [report])

  const hasAnyFixable = fixableBoms.length > 0 || hasVersionMax || hasSandboxVersionFix

  const runQuickFix = async (action: QuickFixType, files?: string[]): Promise<void> => {
    setFixing(true)
    try {
      const res = await window.pz.workbench.quickFix({
        modPath: mod.path,
        action,
        files
      })
      if (!res.ok) {
        notify(t('wb.qf.failedToast', { error: res.error ?? 'Unknown error' }), 'warn')
      } else {
        notify(t('wb.qf.fixedToast', { n: res.fixedFiles.length }), 'info')
        await run()
      }
    } catch (err) {
      notify(t('wb.qf.failedToast', { error: err instanceof Error ? err.message : String(err) }), 'warn')
    } finally {
      setFixing(false)
    }
  }

  const runAllFixes = async (): Promise<void> => {
    setFixing(true)
    try {
      const res = await window.pz.workbench.quickFix({
        modPath: mod.path,
        action: 'all'
      })
      if (!res.ok) {
        notify(t('wb.qf.failedToast', { error: res.error ?? 'Unknown error' }), 'warn')
      } else {
        notify(t('wb.qf.fixedToast', { n: res.fixedFiles.length }), 'ok')
        await run()
      }
    } catch (err) {
      notify(t('wb.qf.failedToast', { error: err instanceof Error ? err.message : String(err) }), 'warn')
    } finally {
      setFixing(false)
    }
  }

  const counts = useMemo(() => {
    const out = { error: 0, warn: 0, info: 0 }
    for (const issue of report?.issues ?? []) out[issue.severity]++
    return out
  }, [report])

  const catCounts = useMemo(() => {
    return report?.categories ?? {
      critical: 0,
      engineApi: 0,
      b42Syntax: 0,
      assets: 0,
      overwrites: 0,
      hygiene: 0
    }
  }, [report])

  const visible = useMemo(() => {
    const issues = report?.issues ?? []
    if (filter === 'all') return issues
    if (filter === 'error' || filter === 'warn' || filter === 'info') {
      return issues.filter((i) => i.severity === filter)
    }
    return issues.filter((i) => (i.category ?? 'hygiene') === filter)
  }, [report, filter])

  const copyReport = async (): Promise<void> => {
    if (!report) return
    const lines = [
      `=== ${mod.name} (${mod.modId}) — Mod Doctor Report ===`,
      `Score: ${report.healthScore.overall}% (Grade: ${report.healthScore.grade})`,
      `Path: ${mod.path}`,
      `Scanned: ${report.filesChecked} files, ${formatBytes(report.bytesChecked)}, in ${formatDuration(report.durationMs)}`,
      `Issues: ${report.issues.length} total (${counts.error} errors, ${counts.warn} warnings, ${counts.info} notes)`,
      ''
    ]
    for (const issue of report.issues) {
      const cat = issue.category ? `[${issue.category.toUpperCase()}] ` : ''
      const where = issue.file
        ? ` [${relative(issue.file, mod.path)}${issue.line ? `:${issue.line}` : ''}]`
        : ''
      lines.push(`${issue.severity.toUpperCase()} ${cat}${issue.rule}${where} — ${message(issue)}`)
    }
    await copyText(lines.join('\n'))
    notify(t('wb.val.reportCopied'), 'ok')
  }

  const score = report?.healthScore
  const gradeColor = useMemo(() => {
    if (!score) return 'var(--ash)'
    if (score.grade === 'A+' || score.grade === 'A') return '#10b981'
    if (score.grade === 'B') return '#3b82f6'
    if (score.grade === 'C') return '#f59e0b'
    if (score.grade === 'D') return '#f97316'
    return '#ef4444'
  }, [score])

  const toggleSnippet = (key: string) => {
    setExpandedSnippets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <Panel
      title={t('wb.doctor.title')}
      lede={`${mod.name} (${mod.modId || 'No ID'}) · ${mod.path}`}
      icon="pulse"
      actions={
        <>
          {report && (
            <button className="btn" onClick={() => void copyReport()} title={t('wb.val.copyReport')}>
              <Icon name="copy" size={13} />
              {t('wb.val.copyReport')}
            </button>
          )}
          <button className="btn is-primary" disabled={running} onClick={() => void run()}>
            <Icon name={running ? 'refresh' : 'play'} size={13} className={running ? 'spin' : undefined} />
            {running ? t('wb.val.running') : report ? t('wb.doctor.reAudit') : t('wb.doctor.runAudit')}
          </button>
        </>
      }
    >
      {error && <Alert kind="bad">{error}</Alert>}

      {!report && !running && !error && (
        <div className="pane__empty pane__empty--big">
          <Icon name="pulse" size={32} strokeWidth={1.2} />
          <span className="stencil">{t('wb.val.neverRun')}</span>
          <span className="label">{t('wb.val.neverRunBody')}</span>
        </div>
      )}

      {report && (
        <>
          {/* Health Score Hero Card */}
          <div
            className="doctor-hero"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              padding: '16px 20px',
              borderRadius: 8,
              background: 'linear-gradient(180deg, rgba(26, 32, 42, 0.9), rgba(18, 22, 29, 0.95))',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              marginBottom: 14,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)'
            }}
          >
            {/* Grade & Score */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  color: gradeColor,
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: `2px solid ${gradeColor}`,
                  boxShadow: `0 0 16px ${gradeColor}33`
                }}
              >
                {score?.grade ?? '—'}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--bone)' }}>
                    {score?.overall ?? 0}%
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ash)', fontWeight: 500 }}>
                    {t('wb.doctor.healthTitle')}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ash-dim)', marginTop: 2 }}>
                  {t('wb.val.summary', {
                    files: formatCount(report.filesChecked),
                    filesWord: p('files', report.filesChecked),
                    bytes: formatBytes(report.bytesChecked),
                    duration: formatDuration(report.durationMs)
                  })}
                </div>
              </div>
            </div>

            {/* Sub-scores breakdown */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', maxWidth: 440 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  fontSize: 11
                }}
              >
                <Icon name="terminal" size={12} color="#38bdf8" />
                <span style={{ color: 'var(--ash-dim)' }}>{t('wb.doctor.category.engineApi')}:</span>
                <span style={{ fontWeight: 600, color: '#38bdf8' }}>{score?.engineApi ?? 0}%</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(167, 139, 250, 0.1)',
                  border: '1px solid rgba(167, 139, 250, 0.25)',
                  fontSize: 11
                }}
              >
                <Icon name="code" size={12} color="#a78bfa" />
                <span style={{ color: 'var(--ash-dim)' }}>{t('wb.doctor.category.b42Syntax')}:</span>
                <span style={{ fontWeight: 600, color: '#a78bfa' }}>{score?.b42Syntax ?? 0}%</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(52, 211, 153, 0.1)',
                  border: '1px solid rgba(52, 211, 153, 0.25)',
                  fontSize: 11
                }}
              >
                <Icon name="cube" size={12} color="#34d399" />
                <span style={{ color: 'var(--ash-dim)' }}>{t('wb.doctor.category.assets')}:</span>
                <span style={{ fontWeight: 600, color: '#34d399' }}>{score?.assets ?? 0}%</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(251, 191, 36, 0.1)',
                  border: '1px solid rgba(251, 191, 36, 0.25)',
                  fontSize: 11
                }}
              >
                <Icon name="layers" size={12} color="#fbbf24" />
                <span style={{ color: 'var(--ash-dim)' }}>{t('wb.doctor.category.overwrites')}:</span>
                <span style={{ fontWeight: 600, color: '#fbbf24' }}>{score?.overwrites ?? 0}%</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(148, 163, 184, 0.1)',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  fontSize: 11
                }}
              >
                <Icon name="shield" size={12} color="#94a3b8" />
                <span style={{ color: 'var(--ash-dim)' }}>{t('wb.doctor.category.hygiene')}:</span>
                <span style={{ fontWeight: 600, color: '#94a3b8' }}>{score?.hygiene ?? 0}%</span>
              </div>
            </div>
          </div>

          {report.truncated && <Alert kind="warn">{t('wb.val.truncated')}</Alert>}

          {/* Quick-Fix All Banner */}
          {hasAnyFixable && (
            <div
              className="wb-quickfix-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'linear-gradient(90deg, rgba(235, 94, 40, 0.12), rgba(235, 94, 40, 0.04))',
                border: '1px solid rgba(235, 94, 40, 0.35)',
                borderRadius: 6,
                marginBottom: 14
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="wand" size={18} color="var(--ember)" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--bone)' }}>
                    {t('wb.doctor.quickFixAll')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ash-dim)' }}>
                    {t('wb.doctor.quickFixAllDesc')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {fixableBoms.length > 0 && (
                  <button className="btn" disabled={fixing} onClick={() => void runQuickFix('strip-bom', fixableBoms)}>
                    BOM ({fixableBoms.length})
                  </button>
                )}
                {hasVersionMax && (
                  <button className="btn" disabled={fixing} onClick={() => void runQuickFix('remove-version-max')}>
                    versionMax=
                  </button>
                )}
                {hasSandboxVersionFix && (
                  <button className="btn" disabled={fixing} onClick={() => void runQuickFix('fix-sandbox-version')}>
                    sandbox-options
                  </button>
                )}
                <button
                  className="btn is-primary"
                  disabled={fixing}
                  onClick={() => void runAllFixes()}
                  style={{ fontWeight: 600 }}
                >
                  <Icon name="wand" size={13} />
                  {t('wb.doctor.quickFixAll')}
                </button>
              </div>
            </div>
          )}

          {report.issues.length === 0 ? (
            <div
              className="wbclean"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '24px 20px',
                borderRadius: 8,
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                marginTop: 10
              }}
            >
              <Icon name="check-circle" size={36} color="#10b981" />
              <div>
                <div className="stencil wbclean__title" style={{ fontSize: 16, color: '#10b981', marginBottom: 4 }}>
                  {t('wb.doctor.perfect')}
                </div>
                <div className="label" style={{ color: 'var(--ash)' }}>
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
              {/* Category & Severity Filter Chips */}
              <div className="wbchips" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  className={`chip ${filter === 'all' ? 'is-on' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  {t('wb.doctor.category.all')}
                  <span className="chip__n mono">{report.issues.length}</span>
                </button>

                {/* Category filters */}
                {(['critical', 'engine-api', 'b42-syntax', 'assets', 'overwrites', 'hygiene'] as const).map((cat) => {
                  const count = catCounts[cat === 'engine-api' ? 'engineApi' : cat === 'b42-syntax' ? 'b42Syntax' : cat]
                  const meta = CATEGORY_META[cat]
                  if (count === 0) return null
                  return (
                    <button
                      key={cat}
                      className={`chip ${filter === cat ? 'is-on' : ''}`}
                      onClick={() => setFilter(cat)}
                      style={{
                        borderColor: filter === cat ? meta.color : undefined
                      }}
                    >
                      <Icon name={meta.icon} size={11} color={meta.color} />
                      {t(meta.labelKey)}
                      <span className="chip__n mono" style={{ color: meta.color }}>
                        {count}
                      </span>
                    </button>
                  )
                })}

                <div className="divider-v" style={{ height: 20, margin: '0 4px' }} />

                {/* Severity filters */}
                {(['error', 'warn', 'info'] as const).map((sev) => {
                  if (counts[sev] === 0) return null
                  return (
                    <button
                      key={sev}
                      className={`chip ${filter === sev ? 'is-on' : ''}`}
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
                  )
                })}
              </div>

              {/* Issues List with Code Snippets */}
              <div className="wbissues" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visible.map((issue, idx) => {
                  const issueKey = `${issue.rule}-${issue.line ?? 0}-${idx}`
                  const isExpanded = expandedSnippets[issueKey] ?? false

                  return (
                    <IssueCard
                      key={issueKey}
                      issue={issue}
                      modPath={mod.path}
                      message={message(issue)}
                      isExpanded={isExpanded}
                      onToggleSnippet={() => toggleSnippet(issueKey)}
                    />
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

function IssueCard({
  issue,
  modPath,
  message,
  isExpanded,
  onToggleSnippet
}: {
  issue: ValidationIssue
  modPath: string
  message: string
  isExpanded: boolean
  onToggleSnippet: () => void
}) {
  const { t } = useI18n()
  const { notify } = useToast()
  const meta = SEVERITY_META[issue.severity]
  const cat = issue.category ?? 'hygiene'
  const catMeta = CATEGORY_META[cat]
  const where = issue.file ? relative(issue.file, modPath) : t('wb.val.modScope')

  const openInEditor = async () => {
    if (!issue.file) return
    try {
      await window.pz.npp.open(issue.file, issue.line)
    } catch {
      await window.pz.shell.open(issue.file)
    }
  }

  const copyPath = async () => {
    if (!issue.file) return
    const pathWithLine = issue.line ? `${issue.file}:${issue.line}` : issue.file
    await copyText(pathWithLine)
    notify(t('toast.pathCopied'), 'ok')
  }

  return (
    <div
      className={`wbissue-card ${meta.cls}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 6,
        background: 'linear-gradient(180deg, #181d24, #14171d)',
        border: `1px solid ${issue.severity === 'error' ? 'rgba(239, 68, 68, 0.35)' : issue.severity === 'warn' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
        overflow: 'hidden'
      }}
    >
      {/* Top Header Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '10px 14px'
        }}
      >
        <Icon
          name={meta.icon}
          size={16}
          style={{
            marginTop: 2,
            flexShrink: 0,
            color: issue.severity === 'error' ? '#ef4444' : issue.severity === 'warn' ? '#f59e0b' : '#38bdf8'
          }}
        />

        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {/* Category tag */}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: `${catMeta.color}1f`,
                color: catMeta.color,
                border: `1px solid ${catMeta.color}40`
              }}
            >
              {t(catMeta.labelKey)}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ash-faint)' }}>
              {issue.rule}
            </span>
          </div>

          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--bone)', lineHeight: 1.45 }}>
            {message}
          </div>

          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ash-dim)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span style={{ color: 'var(--ash)' }}>{where}</span>
            {issue.line && (
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--ember)'
                }}
              >
                {t('wb.val.line', { n: issue.line })}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {issue.snippet && (
            <button
              className="btn btn-icon"
              title={isExpanded ? 'Скрыть код' : 'Показать код'}
              onClick={onToggleSnippet}
              style={{
                background: isExpanded ? 'rgba(255, 255, 255, 0.1)' : undefined,
                color: isExpanded ? 'var(--bone)' : 'var(--ash)'
              }}
            >
              <Icon name="code" size={13} />
            </button>
          )}

          {issue.file && (
            <>
              <button
                className="btn btn-icon"
                title={t('wb.doctor.copyPath')}
                onClick={() => void copyPath()}
              >
                <Icon name="copy" size={12} />
              </button>
              <button
                className="btn btn-icon"
                title={t('wb.doctor.openFile')}
                onClick={() => void openInEditor()}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                className="btn btn-icon"
                title={t('wb.val.openFile')}
                onClick={() => void window.pz.shell.reveal(issue.file as string)}
              >
                <Icon name="external" size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline Code Snippet Viewer */}
      {isExpanded && issue.snippet && issue.snippet.lines.length > 0 && (
        <div
          className="doctor-snippet"
          style={{
            margin: '0 14px 12px 14px',
            borderRadius: 4,
            background: '#0d1116',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            overflow: 'hidden',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            lineHeight: 1.6
          }}
        >
          <div
            style={{
              padding: '4px 10px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: 10.5,
              color: 'var(--ash-faint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>{t('wb.doctor.snippetTitle', { line: issue.line ?? 1 })}</span>
            <span style={{ textTransform: 'uppercase', fontSize: 9.5 }}>{issue.snippet.lang}</span>
          </div>

          <div style={{ padding: '6px 0', overflowX: 'auto' }}>
            {issue.snippet.lines.map((line) => (
              <div
                key={line.num}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: line.isTarget
                    ? issue.severity === 'error'
                      ? 'rgba(239, 68, 68, 0.18)'
                      : 'rgba(245, 158, 11, 0.18)'
                    : 'transparent',
                  borderLeft: line.isTarget
                    ? `3px solid ${issue.severity === 'error' ? '#ef4444' : '#f59e0b'}`
                    : '3px solid transparent',
                  padding: '1px 10px'
                }}
              >
                <span
                  style={{
                    width: 38,
                    textAlign: 'right',
                    paddingRight: 12,
                    color: line.isTarget ? 'var(--bone)' : 'var(--ash-faint)',
                    fontWeight: line.isTarget ? 700 : 400,
                    userSelect: 'none'
                  }}
                >
                  {line.num}
                </span>
                <span
                  style={{
                    color: line.isTarget ? '#fff' : 'var(--ash)',
                    whiteSpace: 'pre',
                    flex: '1 1 auto'
                  }}
                >
                  {line.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function relative(file: string, root: string): string {
  const lowerFile = file.toLowerCase()
  const lowerRoot = root.toLowerCase().replace(/[\\/]+$/, '')
  if (lowerFile.startsWith(lowerRoot)) {
    return file.slice(lowerRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
  }
  return file.replace(/\\/g, '/')
}
