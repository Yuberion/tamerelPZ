import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText } from '@renderer/lib/format'
import type { JavaDecompileResult } from '@shared/types'

export interface JavaDecompileModalProps {
  className: string
  methodName?: string
  onClose: () => void
}

export function JavaDecompileModal({ className, methodName, onClose }: JavaDecompileModalProps) {
  const { t } = useI18n()
  const { notify } = useToast()
  const [data, setData] = useState<JavaDecompileResult | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(methodName ?? '')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.pz.logs
      .decompileJava(className, methodName)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData({ className, decompiled: '', error: String(err) })
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [className, methodName])

  const filteredDecompiled = useMemo(() => {
    if (!data?.decompiled) return ''
    if (!filter.trim()) return data.decompiled
    const lines = data.decompiled.split(/\r?\n/)
    const needle = filter.trim().toLowerCase()
    return lines.filter((l) => l.toLowerCase().includes(needle) || l.includes('class ') || l.includes('{') || l.includes('}')).join('\n')
  }, [data?.decompiled, filter])

  const copyCode = async () => {
    if (!data?.decompiled) return
    await copyText(data.decompiled)
    notify(t('led.decompiledCopied'), 'ok')
  }

  return (
    <div className="wbmodal-backdrop" onClick={onClose}>
      <div className="wbmodal wbmodal--wide javamodal" onClick={(e) => e.stopPropagation()}>
        <div className="wbmodal__header">
          <div className="javamodal__title">
            <Icon name="coffee" size={16} color="var(--rust)" />
            <span className="mono bold truncate">{data?.fullClassName ?? className}</span>
            {data?.methodsCount ? (
              <span className="ledpill mono">{data.methodsCount} {t('led.methods')}</span>
            ) : null}
          </div>
          <div className="toolbar__spacer" />
          <button className="btn btn--tiny" onClick={() => void copyCode()} title={t('led.copyDecompiled')}>
            <Icon name="copy" size={12} />
            {t('led.copyDecompiled')}
          </button>
          <button className="btn btn-icon btn--tiny" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="javamodal__toolbar">
          <Icon name="search" size={12} className="wbmuted" />
          <input
            className="input input--tiny mono javamodal__search"
            placeholder={t('led.filterMethods')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="btn btn--tiny btn--subtle" onClick={() => setFilter('')}>
              <Icon name="close" size={10} />
            </button>
          )}
        </div>

        <div className="wbmodal__body javamodal__body">
          {loading && (
            <div className="javamodal__loading">
              <Icon name="coffee" size={24} className="pulse" />
              <span>{t('led.decompilingFromJar', { className })}</span>
            </div>
          )}

          {!loading && data?.error && (
            <div className="javamodal__error mono">
              <Icon name="alert" size={16} color="var(--rust)" />
              <span>{data.error}</span>
            </div>
          )}

          {!loading && !data?.error && (
            <pre className="javamodal__code mono">
              {filteredDecompiled}
            </pre>
          )}
        </div>

        <div className="wbmodal__footer">
          <span className="wbmuted text-xs">
            {t('led.javapNotice')}
          </span>
          <div className="toolbar__spacer" />
          <button className="btn btn--primary" onClick={onClose}>
            {t('led.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
