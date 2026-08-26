import { useMemo } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText, shortenPath } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'
import { LEVEL_ICON, LEVEL_KEY } from './LogList'
import type { LogIncident } from './parseLog'

/**
 * Full text of one entry, plus what can be done about it.
 *
 * The whole point of the module: an incident head is a single truncated line in
 * the list, and a Java or Lua trace only becomes useful when it is readable in
 * full. The `lua` tokenizer is a good enough fit for both — it colours strings,
 * numbers and the keywords that show up in Lua frames, and leaves Java frames
 * as plain text rather than mislabelling them.
 */
export function LogDetail({ incident }: { incident: LogIncident | undefined }) {
  const { t } = useI18n()
  const { notify } = useToast()

  const text = useMemo(
    () => (incident ? [incident.head, ...incident.body].join('\n') : ''),
    [incident]
  )
  /** What lands on the clipboard: the file's own bytes, not the cleaned view. */
  const verbatim = useMemo(
    () => (incident ? [incident.raw, ...incident.body].join('\r\n') : ''),
    [incident]
  )
  const tokens = useMemo(() => highlight(text, 'lua'), [text])

  if (!incident) {
    return (
      <div className="pane__scroll">
        <div className="pane__empty">
          <Icon name="book" size={22} />
          <span className="label">{t('led.noSelection')}</span>
          <span className="label wbmuted">{t('led.noSelectionHint')}</span>
        </div>
      </div>
    )
  }

  const copy = async (value: string, ok: string): Promise<void> => {
    notify((await copyText(value)) ? ok : t('led.copyFailed'), 'ok')
  }

  // Destructured so the narrowing survives into the click handlers below.
  const { modName, modPath, modId } = incident

  return (
    <div className="pane__scroll">
      <div className="leddetail">
        <div className="leddetail__meta">
          <span className={`ledlvl ledlvl--${incident.level}`}>
            <Icon name={LEVEL_ICON[incident.level]} size={11} />
            {t(LEVEL_KEY[incident.level])}
          </span>
          <span className="label is-dim mono">{t('led.line', { n: incident.line })}</span>
          {incident.category && <span className="ledpill mono">{incident.category}</span>}
          {incident.origin && (
            <span className="ledorigin mono truncate" title={incident.origin}>
              {incident.origin}
            </span>
          )}
          <div className="toolbar__spacer" />
          <button
            className="btn btn--tiny"
            onClick={() => void copy(verbatim, t('led.entryCopied'))}
            title={t('led.copyEntryTitle')}
          >
            <Icon name="copy" size={11} />
            {t('led.copyEntry')}
          </button>
        </div>

        <pre className="ledtrace mono">
          {tokens.map((tk, i) =>
            tk.cls ? (
              <span key={i} className={`tk-${tk.cls}`}>
                {tk.text}
              </span>
            ) : (
              <span key={i}>{tk.text}</span>
            )
          )}
        </pre>

        {modName && modPath ? (
          <div className="ledmod">
            <div className="ledmod__head">
              <Icon name="package" size={12} color="var(--rust)" />
              <span className="ledmod__name truncate" title={modName}>
                {modName}
              </span>
            </div>
            <span className="ledmod__path mono truncate" title={modPath}>
              {shortenPath(modPath, 3)}
            </span>
            <div className="ledmod__actions">
              <button
                className="btn btn--tiny"
                onClick={() => void window.pz.shell.reveal(modPath)}
                title={t('led.revealModTitle')}
              >
                <Icon name="external" size={11} />
                {t('led.revealMod')}
              </button>
              {modId && (
                <button
                  className="btn btn--tiny"
                  onClick={() => void copy(modId, t('led.modIdCopied'))}
                  title={t('led.copyModIdTitle')}
                >
                  <Icon name="copy" size={11} />
                  {t('led.copyModId')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <span className="label wbmuted leddetail__unlinked">{t('led.unlinked')}</span>
        )}
      </div>
    </div>
  )
}
