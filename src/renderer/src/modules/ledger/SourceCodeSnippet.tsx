import { useEffect, useState } from 'react'
import { pzFileUrl } from '@shared/ipc'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'
import type { SourceResolution, SourceSnippetResult } from '@shared/types'

export interface SourceCodeSnippetProps {
  path: string
  line?: number
  modPath?: string
  gameDir?: string
  onOpenNpp?: () => void
  onScriptResolved?: (res: SourceResolution | undefined) => void
}

export function SourceCodeSnippet({
  path,
  line,
  modPath,
  gameDir,
  onOpenNpp,
  onScriptResolved
}: SourceCodeSnippetProps) {
  const { t, lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()
  const [radius, setRadius] = useState(10)
  const [snippet, setSnippet] = useState<SourceSnippetResult | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [scriptResolution, setScriptResolution] = useState<SourceResolution | undefined>(undefined)

  const isImage = /\.(png|jpe?g|webp|gif|bmp|tga|dds|ico)$/i.test(path)
  const targetLine = line && line > 0 ? line : 1
  const fileName = path.split(/[\\/]/).pop() ?? path

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    if (isImage) {
      // For images: do not read binary bytes as code!
      // Instead, search for an associated script (item, model, vehicle) in media/scripts
      const baseSymbol = fileName.replace(/\.[^.]+$/, '')
      window.pz.logs
        .resolveSource(baseSymbol, modPath, gameDir)
        .then((res) => {
          if (cancelled) return
          if (res && !/\.(png|jpe?g|webp|gif|bmp|tga|dds|ico)$/i.test(res.path)) {
            setScriptResolution(res)
            onScriptResolved?.(res)
            return window.pz.logs.readSnippet(res.path, res.line ?? 1, radius)
          }
          setScriptResolution(undefined)
          onScriptResolved?.(undefined)
          return undefined
        })
        .then((snip) => {
          if (!cancelled) {
            setSnippet(snip)
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSnippet(undefined)
            setLoading(false)
          }
        })
    } else {
      setScriptResolution(undefined)
      window.pz.logs
        .readSnippet(path, targetLine, radius)
        .then((res) => {
          if (!cancelled) {
            setSnippet(res)
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSnippet(undefined)
            setLoading(false)
          }
        })
    }

    return () => {
      cancelled = true
    }
  }, [path, targetLine, radius, isImage, fileName, modPath, gameDir])

  if (!snippet && !loading && !isImage) return null

  const handleCopyCode = async () => {
    if (!snippet) return
    const text = snippet.lines.map((l) => `${l.num.toString().padStart(4, ' ')}: ${l.text}`).join('\n')
    await copyText(text)
    notify(t('led.codeCopied'), 'ok')
  }

  const handleOpenEditor = () => {
    if (scriptResolution?.path) {
      void window.pz.npp.open(scriptResolution.path, scriptResolution.line ?? 1)
      notify(t('led.openedInNpp'), 'ok')
      return
    }
    if (onOpenNpp) {
      onOpenNpp()
    }
  }

  const scriptFileName = scriptResolution?.path ? scriptResolution.path.split(/[\\/]/).pop() : undefined

  return (
    <div className="ledsnippet">
      <div className="ledsnippet__header">
        <button
          className="btn btn--tiny btn--subtle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? t('led.expandSnippet') : t('led.collapseSnippet')}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={11} />
          <Icon name={isImage ? 'image' : 'code'} size={11} />
          <span className="mono bold">{fileName}</span>
          {snippet ? (
            <span className="wbmuted mono">
              ({scriptFileName ? `${scriptFileName}${scriptResolution?.line ? `:${scriptResolution.line}` : ''} · ` : ''}{t('led.linesRange', { from: snippet.startLine, to: snippet.endLine })})
            </span>
          ) : (
            <span className="wbmuted mono">({isRu ? 'текстура' : 'texture'})</span>
          )}
        </button>

        <div className="toolbar__spacer" />

        {!collapsed && (
          <>
            {isImage && (
              <button
                className="btn btn--tiny btn--subtle"
                onClick={() => void window.pz.shell.reveal(path)}
                title={isRu ? 'Показать файл на диске' : 'Reveal in Explorer'}
              >
                <Icon name="folder" size={10} />
                <span>{isRu ? 'В проводнике' : 'Reveal'}</span>
              </button>
            )}

            {snippet && (
              <>
                <button
                  className="btn btn--tiny"
                  onClick={() => setRadius((r) => (r >= 40 ? 10 : r + 15))}
                  title={t('led.expandRadiusTitle')}
                >
                  <Icon name="plus" size={10} />
                  {radius >= 40 ? t('led.resetRadius') : `+15 ${t('led.expandSnippet')}`}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => void handleCopyCode()}
                  title={t('led.copySnippet')}
                >
                  <Icon name="copy" size={10} />
                </button>
              </>
            )}

            {(onOpenNpp || scriptResolution) && (
              <button
                className="btn btn--tiny btn--primary"
                onClick={handleOpenEditor}
                title={
                  scriptResolution
                    ? isRu
                      ? `Открыть ${scriptFileName} в Notepad++ на строке ${scriptResolution.line ?? 1}`
                      : `Open ${scriptFileName} in Notepad++ at line ${scriptResolution.line ?? 1}`
                    : t('led.openInNppTitle')
                }
              >
                <Icon name="code" size={10} />
                {t('led.openInNpp')}
                {scriptResolution?.line ? ` (${scriptResolution.line})` : line ? ` (${line})` : ''}
              </button>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <div className="ledsnippet__body mono">
          {isImage && (
            <div
              className="imgpreview brackets"
              style={{
                margin: snippet ? '8px 8px 6px 8px' : 0,
                border: '1px solid var(--edge)',
                maxHeight: '260px',
                borderRadius: 'var(--radius)'
              }}
            >
              <img
                src={pzFileUrl(path)}
                alt={fileName}
                draggable={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '240px',
                  objectFit: 'contain',
                  display: 'block',
                  margin: '0 auto'
                }}
              />
            </div>
          )}

          {loading && <div className="ledsnippet__loading">{t('led.loadingCode')}</div>}

          {!loading && snippet && (
            <div className="ledsnippet__code">
              {snippet.lines.map((l) => {
                const tokens = highlight(l.text, snippet.lang === 'lua' ? 'lua' : 'modinfo')
                return (
                  <div
                    key={l.num}
                    className={`ledsnippet__line ${l.isTarget ? 'is-target' : ''}`}
                    title={l.isTarget ? `${t('led.targetLine')} ${l.num}` : undefined}
                  >
                    <span className="ledsnippet__num">{l.num}</span>
                    <span className="ledsnippet__text">
                      {tokens.map((tk, idx) =>
                        tk.cls ? (
                          <span key={idx} className={`tk-${tk.cls}`}>
                            {tk.text}
                          </span>
                        ) : (
                          <span key={idx}>{tk.text}</span>
                        )
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !snippet && isImage && (
            <div
              className="ledsnippet__hint wbmuted mono"
              style={{
                padding: '10px 14px',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderTop: '1px solid var(--edge)',
                marginTop: '6px'
              }}
            >
              <Icon name="info" size={12} />
              <span>
                {isRu
                  ? 'Скрипт предмета или модели для этой текстуры не найден в media/scripts'
                  : 'Item or model script definition for this texture was not found in media/scripts'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
