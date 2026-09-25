import { useEffect, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'
import type { SourceSnippetResult } from '@shared/types'

export interface SourceCodeSnippetProps {
  path: string
  line?: number
  onOpenNpp?: () => void
}

export function SourceCodeSnippet({ path, line, onOpenNpp }: SourceCodeSnippetProps) {
  const { t } = useI18n()
  const { notify } = useToast()
  const [radius, setRadius] = useState(10)
  const [snippet, setSnippet] = useState<SourceSnippetResult | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const targetLine = line && line > 0 ? line : 1

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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

    return () => {
      cancelled = true
    }
  }, [path, targetLine, radius])

  if (!snippet && !loading) return null

  const fileName = path.split(/[\\/]/).pop() ?? path

  const handleCopyCode = async () => {
    if (!snippet) return
    const text = snippet.lines.map((l) => `${l.num.toString().padStart(4, ' ')}: ${l.text}`).join('\n')
    await copyText(text)
    notify(t('led.codeCopied'), 'ok')
  }

  return (
    <div className="ledsnippet">
      <div className="ledsnippet__header">
        <button
          className="btn btn--tiny btn--subtle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? t('led.expandSnippet') : t('led.collapseSnippet')}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={11} />
          <Icon name="code" size={11} />
          <span className="mono bold">{fileName}</span>
          <span className="wbmuted mono">
            ({t('led.linesRange', { from: snippet?.startLine ?? 1, to: snippet?.endLine ?? 1 })})
          </span>
        </button>

        <div className="toolbar__spacer" />

        {!collapsed && snippet && (
          <>
            <button
              className="btn btn--tiny"
              onClick={() => setRadius((r) => (r >= 40 ? 10 : r + 15))}
              title={t('led.expandRadiusTitle')}
            >
              <Icon name="plus" size={10} />
              {radius >= 40 ? t('led.resetRadius') : `+15 ${t('led.expandSnippet')}`}
            </button>
            <button className="btn btn--tiny" onClick={() => void handleCopyCode()} title={t('led.copySnippet')}>
              <Icon name="copy" size={10} />
            </button>
            {onOpenNpp && (
              <button className="btn btn--tiny" onClick={onOpenNpp} title={t('led.openInNppTitle')}>
                <Icon name="external" size={10} />
                {t('led.openInNpp')}
              </button>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <div className="ledsnippet__body mono">
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
        </div>
      )}
    </div>
  )
}
