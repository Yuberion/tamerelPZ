import { useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import type { Diagnosis, LogIncident, ModAttribution } from './parseLog'

export interface ExportModalProps {
  open: boolean
  onClose: () => void
  sourceName: string
  sourcePath?: string
  incidents: LogIncident[]
  diagnoses: Diagnosis[]
  modAttributions: ModAttribution[]
}

function sanitizePaths(text: string, mask: boolean): string {
  if (!mask) return text
  // Mask Windows user directories: C:\Users\<Username>\ -> C:\Users\<user>\
  let out = text.replace(/([A-Za-z]:\\Users\\)[^\\/\r\n]+(?=[\\/])/gi, '$1<user>')
  // Mask Unix user directories: /home/<Username>/ -> /home/<user>/
  out = out.replace(/(\/home\/)[^\\/\r\n]+(?=[\\/])/gi, '$1<user>')
  return out
}

export function ExportModal({
  open,
  onClose,
  sourceName,
  sourcePath,
  incidents,
  diagnoses,
  modAttributions
}: ExportModalProps) {
  const { t } = useI18n()
  const { notify } = useToast()

  const [maskPaths, setMaskPaths] = useState(true)
  const [errorsOnly, setErrorsOnly] = useState(true)
  const [includeTraces, setIncludeTraces] = useState(true)

  const reportText = useMemo(() => {
    const lines: string[] = []

    lines.push('### 📋 Project Zomboid — Crash & Error Report')
    lines.push(`**Log Source**: \`${sourceName}\``)
    lines.push(`**Generated**: ${new Date().toLocaleString()}`)
    if (sourcePath) {
      lines.push(`**File**: \`${sanitizePaths(sourcePath, maskPaths)}\``)
    }
    lines.push('')

    // Issues summary
    if (diagnoses.length > 0) {
      lines.push('#### ⚠️ Detected Issues & Diagnoses')
      for (const d of diagnoses.slice(0, 5)) {
        lines.push(`- **${d.title}** (x${d.count}): ${d.desc}`)
        if (d.modName) lines.push(`  - Mod: \`${d.modName}\``)
      }
      lines.push('')
    }

    // Mod breakdown
    const faultyMods = modAttributions.filter((m) => m.errors > 0)
    if (faultyMods.length > 0) {
      lines.push('#### 📦 Mods with Errors')
      for (const m of faultyMods) {
        lines.push(`- **${m.modName}** (${m.modId ?? 'no id'}): ${m.errors} errors, ${m.warnings} warnings`)
      }
      lines.push('')
    }

    // Incidents
    const targetIncidents = errorsOnly
      ? incidents.filter((i) => i.level === 'error')
      : incidents.filter((i) => i.level === 'error' || i.level === 'warn')

    lines.push(`#### 🚨 Incidents (${targetIncidents.length} total, top 10 shown)`)
    for (const inc of targetIncidents.slice(0, 10)) {
      const tag = inc.modName ? ` [${inc.modName}]` : ''
      const repeat = inc.repeatCount && inc.repeatCount > 1 ? ` (x${inc.repeatCount})` : ''
      lines.push(`- **Line ${inc.line}** [${inc.level.toUpperCase()}]${tag}${repeat}: \`${inc.head}\``)
      if (inc.callSite) {
        lines.push(`  - Callsite: \`${inc.callSite.file}${inc.callSite.line ? `:${inc.callSite.line}` : ''}\``)
      }
      if (includeTraces && inc.body.length > 0) {
        lines.push('  ```lua')
        lines.push(
          inc.body
            .slice(0, 15)
            .map((l) => '  ' + l)
            .join('\n')
        )
        if (inc.body.length > 15) {
          lines.push(`  ... (${inc.body.length - 15} more lines folded)`)
        }
        lines.push('  ```')
      }
    }

    const raw = lines.join('\n')
    return sanitizePaths(raw, maskPaths)
  }, [
    sourceName,
    sourcePath,
    incidents,
    diagnoses,
    modAttributions,
    maskPaths,
    errorsOnly,
    includeTraces
  ])

  if (!open) return null

  const handleCopy = async () => {
    const ok = await copyText(reportText)
    notify(ok ? t('led.reportCopied') : t('led.copyFailed'), 'ok')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--large ledexport"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="modal__head">
          <Icon name="share" size={14} color="var(--rust)" />
          <span className="modal__title stencil">{t('led.exportTitle')}</span>
          <div className="toolbar__spacer" />
          <button className="btn btn-icon" onClick={onClose} title={t('led.close')}>
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="modal__body ledexport__body">
          <div className="ledexport__opts">
            <label className="ledexport__opt">
              <input
                type="checkbox"
                checked={maskPaths}
                onChange={(e) => setMaskPaths(e.target.checked)}
              />
              <span>{t('led.exportMaskPaths')}</span>
            </label>

            <label className="ledexport__opt">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(e) => setErrorsOnly(e.target.checked)}
              />
              <span>{t('led.exportErrorsOnly')}</span>
            </label>

            <label className="ledexport__opt">
              <input
                type="checkbox"
                checked={includeTraces}
                onChange={(e) => setIncludeTraces(e.target.checked)}
              />
              <span>{t('led.exportIncludeTraces')}</span>
            </label>
          </div>

          <pre className="ledexport__preview mono">{reportText}</pre>
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            {t('led.cancel')}
          </button>
          <button className="btn btn--primary" onClick={handleCopy}>
            <Icon name="copy" size={12} />
            {t('led.copyReport')}
          </button>
        </div>
      </div>
    </div>
  )
}
