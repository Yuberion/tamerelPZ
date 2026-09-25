import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText, shortenPath } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'
import { LEVEL_ICON, LEVEL_KEY } from './LogList'
import { resolveSourcePath, type LogIncident } from './parseLog'
import { SourceCodeSnippet } from './SourceCodeSnippet'
import { JavaDecompileModal } from './JavaDecompileModal'

export interface LogDetailProps {
  incident: LogIncident | undefined
  gameDir?: string
  onFilterMod?: (modName: string) => void
}

/**
 * Full text of one entry, plus what can be done about it.
 *
 * The whole point of the module: an incident head is a single truncated line in
 * the list, and a Java or Lua trace only becomes useful when it is readable in
 * full. The `lua` tokenizer is a good enough fit for both — it colours strings,
 * numbers and the keywords that show up in Lua frames, and leaves Java frames
 * as plain text rather than mislabelling them.
 */
export function LogDetail({ incident, gameDir, onFilterMod }: LogDetailProps) {
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

  const { modName, modPath, modId, callSite } = incident ?? {}

  const [resolvedPath, setResolvedPath] = useState<string | undefined>(() => {
    if (!callSite?.file) return undefined
    return resolveSourcePath(callSite.file, modPath, gameDir)
  })
  const [resolvedLine, setResolvedLine] = useState<number | undefined>(callSite?.line)

  useEffect(() => {
    let cancelled = false
    setResolvedLine(callSite?.line)

    const candidate =
      callSite?.file ||
      incident?.origin ||
      (incident?.level === 'error' || incident?.level === 'warn' ? incident.head : undefined)

    if (!candidate) {
      setResolvedPath(undefined)
      return
    }

    const fallback = callSite?.file ? resolveSourcePath(callSite.file, modPath, gameDir) : undefined
    setResolvedPath(fallback)

    window.pz.logs
      .resolveSource(candidate, modPath, gameDir, callSite?.line)
      .then((found) => {
        if (!cancelled && found) {
          setResolvedPath(found.path)
          if (found.line) setResolvedLine(found.line)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [callSite?.file, callSite?.line, incident?.origin, incident?.head, incident?.level, modPath, gameDir])

  const [showJavaModal, setShowJavaModal] = useState(false)

  const javaTarget = useMemo<{ className: string; method?: string } | undefined>(() => {
    if (!incident) return undefined
    if (callSite?.isJava) {
      const m = /(?:at\s+)?([A-Za-z0-9_$.]+)\.([A-Za-z0-9_$]+)\(([A-Za-z0-9_$.]+\.java)/.exec(callSite.raw)
      if (m) return { className: m[1]!, method: m[2] }
      return { className: callSite.file }
    }
    if (incident.origin && incident.origin.includes('.')) {
      const parts = incident.origin.trim().split('.')
      const method = parts.pop()
      return { className: parts.join('.'), method }
    }
    for (const line of incident.body) {
      const m = /(?:at\s+)?([a-z][a-zA-Z0-9_$.]+)\.([A-Za-z0-9_$]+)\(([A-Za-z0-9_$.]+\.java:\d+)\)/.exec(line)
      if (m) {
        return { className: m[1]!, method: m[2] }
      }
    }
    return undefined
  }, [incident, callSite])

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

  const openInNpp = async () => {
    if (!resolvedPath) {
      notify(t('led.fileNotFound'), 'warn')
      return
    }
    try {
      await window.pz.npp.open(resolvedPath, resolvedLine ?? callSite?.line)
      notify(t('led.openedInNpp'), 'ok')
      return
    } catch {
      // Fallback to default shell open
    }
    try {
      await window.pz.shell.open(resolvedPath)
      notify(t('led.openedInEditor'), 'ok')
    } catch {
      notify(t('led.fileNotFound'), 'warn')
    }
  }

  const openDefault = async () => {
    if (!resolvedPath) {
      notify(t('led.fileNotFound'), 'warn')
      return
    }
    try {
      await window.pz.shell.open(resolvedPath)
      notify(t('led.openedInEditor'), 'ok')
    } catch {
      notify(t('led.fileNotFound'), 'warn')
    }
  }

  const revealFile = async () => {
    if (!resolvedPath) {
      notify(t('led.fileNotFound'), 'warn')
      return
    }
    await window.pz.shell.reveal(resolvedPath)
  }

  const shareDiscord = async () => {
    if (!incident) return
    const modStr = modName ? `**Mod**: \`${modName}\`${modId ? ` (\`${modId}\`)` : ''}` : `**Origin**: \`Vanilla / Core Engine\``
    const fileStr = resolvedPath
      ? `\`${resolvedPath.split(/[\\/]/).pop()}${resolvedLine ? `:${resolvedLine}` : ''}\``
      : callSite?.file
        ? `\`${callSite.file}${callSite.line ? `:${callSite.line}` : ''}\``
        : '`Unknown`'
    const bodyStr = incident.body.length > 0 ? incident.body.slice(0, 15).join('\n') : incident.head

    const discordCard = [
      `### [Project Zomboid Incident Report]`,
      `- **Level**: \`${incident.level.toUpperCase()}\` | **Line**: \`${incident.line}\``,
      `- ${modStr}`,
      `- **Source**: ${fileStr}`,
      `- **Message**: \`${incident.head.slice(0, 150)}\``,
      `\`\`\`lua`,
      bodyStr.slice(0, 1200),
      `\`\`\``
    ].join('\n')

    await copyText(discordCard)
    notify(t('led.discordCopied'), 'ok')
  }

  return (
    <div className="pane__scroll">
      <div className="leddetail">
        <div className="leddetail__meta">
          <span className={`ledlvl ledlvl--${incident.level}`}>
            <Icon name={LEVEL_ICON[incident.level]} size={11} />
            {t(LEVEL_KEY[incident.level])}
          </span>
          <span className="label is-dim mono">{t('led.line', { n: incident.line })}</span>
          {incident.repeatCount && incident.repeatCount > 1 ? (
            <span className="ledpill ledpill--repeat mono" title={`Repeated ${incident.repeatCount} times`}>
              x{incident.repeatCount}
            </span>
          ) : null}
          {incident.category && <span className="ledpill mono">{incident.category}</span>}
          {incident.origin && (
            <span className="ledorigin mono truncate" title={incident.origin}>
              {incident.origin}
            </span>
          )}
          <div className="toolbar__spacer" />
          <button
            className="btn btn--tiny"
            onClick={() => void shareDiscord()}
            title={t('led.shareDiscordTitle')}
          >
            <Icon name="share" size={11} />
            {t('led.shareDiscord')}
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => void copy(verbatim, t('led.entryCopied'))}
            title={t('led.copyEntryTitle')}
          >
            <Icon name="copy" size={11} />
            {t('led.copyEntry')}
          </button>
        </div>

        {/* Source File & Mod Action Card */}
        {(callSite || modName || gameDir || incident.level === 'error' || incident.level === 'warn') && (
          <div className="ledsource">
            <div className="ledsource__top">
              <div className="ledsource__who">
                {modName ? (
                  <>
                    <Icon name="package" size={13} color="var(--rust)" />
                    <span className="ledsource__modname truncate" title={modName}>
                      {modName}
                    </span>
                    {modId && <span className="ledpill mono truncate">{modId}</span>}
                  </>
                ) : (
                  <>
                    <Icon name="globe" size={13} color="var(--steel)" />
                    <span className="ledsource__modname truncate">{t('led.coreEngine')}</span>
                  </>
                )}
              </div>

              <div className="toolbar__spacer" />

              {onFilterMod && (
                <button
                  className="btn btn--tiny"
                  onClick={() => onFilterMod(modName ? modName : '__core__')}
                  title={modName ? t('led.filterByThisModTitle') : t('led.filterVanillaTitle')}
                >
                  <Icon name="filter" size={10} />
                  {modName ? t('led.filterByThisMod') : t('led.filterVanilla')}
                </button>
              )}
            </div>

            {(callSite || resolvedPath) && (
              <div className="ledsource__file">
                <Icon
                  name={callSite?.isLua || resolvedPath?.toLowerCase().endsWith('.lua') ? 'code' : 'cube'}
                  size={12}
                  className="ledcallsite__icon"
                />
                <span className="ledsource__filename mono truncate" title={resolvedPath ?? callSite?.file}>
                  {callSite?.file ?? (resolvedPath ? resolvedPath.split(/[\\/]/).pop() : '')}
                  {resolvedLine ? ` : line ${resolvedLine}` : callSite?.line ? ` : line ${callSite.line}` : ''}
                </span>
              </div>
            )}

            {resolvedPath && (
              <div className="ledsource__pathrow">
                <span className="ledsource__path mono truncate" title={resolvedPath}>
                  {shortenPath(resolvedPath, 4)}
                </span>
                <button
                  className="btn btn-icon btn--tiny"
                  onClick={() => void copy(resolvedPath, t('led.pathCopied'))}
                  title={t('led.copyPath')}
                >
                  <Icon name="copy" size={10} />
                </button>
              </div>
            )}

            <div className="ledsource__actions">
              {resolvedPath && (
                <>
                  <button
                    className="btn btn--tiny btn--primary"
                    onClick={() => void openInNpp()}
                    title={t('led.openInNppTitle')}
                  >
                    <Icon name="code" size={11} />
                    {t('led.openInNpp')}
                    {resolvedLine ? ` (${resolvedLine})` : callSite?.line ? ` (${callSite.line})` : ''}
                  </button>
                  <button
                    className="btn btn--tiny"
                    onClick={() => void openDefault()}
                    title={t('led.openEditorTitle')}
                  >
                    <Icon name="file" size={11} />
                    {t('led.openEditor')}
                  </button>
                  <button
                    className="btn btn--tiny"
                    onClick={() => void revealFile()}
                    title={t('led.revealFileTitle')}
                  >
                    <Icon name="external" size={11} />
                    {t('led.revealFile')}
                  </button>
                </>
              )}
              {javaTarget && (
                <button
                  className="btn btn--tiny btn--subtle"
                  onClick={() => setShowJavaModal(true)}
                  title={t('led.decompileJavaTitle', { cls: javaTarget.className })}
                >
                  <Icon name="coffee" size={11} color="var(--rust)" />
                  {t('led.decompileJava')}
                  {javaTarget.method ? ` (${javaTarget.method})` : ''}
                </button>
              )}
              {modPath && (
                <button
                  className="btn btn--tiny"
                  onClick={() => void window.pz.shell.reveal(modPath)}
                  title={t('led.revealModTitle')}
                >
                  <Icon name="folder" size={11} />
                  {t('led.revealMod')}
                </button>
              )}
              {!modName && gameDir && (
                <button
                  className="btn btn--tiny"
                  onClick={() => {
                    const luaDir = `${gameDir.replace(/\\/g, '/').replace(/\/+$/, '')}/media/lua`
                    void window.pz.shell.reveal(luaDir)
                  }}
                  title={t('led.revealGameLuaTitle')}
                >
                  <Icon name="folder" size={11} />
                  {t('led.revealGameLua')}
                </button>
              )}
            </div>
          </div>
        )}

        {resolvedPath && (
          <SourceCodeSnippet
            path={resolvedPath}
            line={resolvedLine ?? callSite?.line}
            onOpenNpp={() => void openInNpp()}
          />
        )}

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

        {!modName && !callSite && (
          <span className="label wbmuted leddetail__unlinked">{t('led.unlinked')}</span>
        )}

        {showJavaModal && javaTarget && (
          <JavaDecompileModal
            className={javaTarget.className}
            methodName={javaTarget.method}
            onClose={() => setShowJavaModal(false)}
          />
        )}
      </div>
    </div>
  )
}
