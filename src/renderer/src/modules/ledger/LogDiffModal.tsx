import { useEffect, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import type { LogDiffItem, LogDiffResult, LogSource } from '@shared/types'

export interface LogDiffModalProps {
  currentSourceId: string
  sources: LogSource[]
  onClose: () => void
  onApplyNewErrorsFilter?: (queries: string[]) => void
}

export function LogDiffModal({
  currentSourceId,
  sources,
  onClose,
  onApplyNewErrorsFilter
}: LogDiffModalProps) {
  const { t } = useI18n()
  const otherSources = sources.filter((s) => s.id !== currentSourceId)
  const defaultTarget = otherSources[0]?.id ?? ''

  const [targetId, setTargetId] = useState(defaultTarget)
  const [diffResult, setDiffResult] = useState<LogDiffResult | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'new' | 'resolved' | 'recurring'>('new')

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)
    // Compare target (earlier log) -> current (live/selected log)
    window.pz.logs
      .diff(targetId, currentSourceId)
      .then((res) => {
        if (!cancelled) {
          setDiffResult(res)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffResult(undefined)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentSourceId, targetId])

  const currentItems: LogDiffItem[] =
    activeTab === 'new'
      ? diffResult?.newErrors ?? []
      : activeTab === 'resolved'
        ? diffResult?.resolvedErrors ?? []
        : diffResult?.recurringErrors ?? []

  const handleApplyFilter = () => {
    if (!diffResult || diffResult.newErrors.length === 0) return
    const queries = diffResult.newErrors.map((e) => e.head.slice(0, 40))
    onApplyNewErrorsFilter?.(queries)
    onClose()
  }

  return (
    <div className="wbmodal-backdrop" onClick={onClose}>
      <div className="wbmodal wbmodal--wide logdiff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wbmodal__header">
          <div className="logdiff-modal__title">
            <Icon name="diff" size={16} color="var(--rust)" />
            <span className="bold">{t('led.compareSessions')}</span>
          </div>
          <div className="toolbar__spacer" />
          <button className="btn btn-icon btn--tiny" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="logdiff-modal__selectors">
          <div className="logdiff-modal__side">
            <span className="label is-dim">{t('led.baseSession')}:</span>
            <select
              className="select select--tiny mono"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {otherSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <Icon name="arrow-right" size={14} className="wbmuted" />

          <div className="logdiff-modal__side">
            <span className="label is-dim">{t('led.currentSession')}:</span>
            <span className="mono bold truncate">{currentSourceId}</span>
          </div>
        </div>

        {/* Stats Header */}
        <div className="logdiff-modal__stats">
          <button
            className={`logdiff-stat ${activeTab === 'new' ? 'is-active is-new' : ''}`}
            onClick={() => setActiveTab('new')}
          >
            <span className="logdiff-stat__num">+{diffResult?.newErrors.length ?? 0}</span>
            <span className="logdiff-stat__label">{t('led.newErrors')}</span>
          </button>
          <button
            className={`logdiff-stat ${activeTab === 'resolved' ? 'is-active is-resolved' : ''}`}
            onClick={() => setActiveTab('resolved')}
          >
            <span className="logdiff-stat__num">-{diffResult?.resolvedErrors.length ?? 0}</span>
            <span className="logdiff-stat__label">{t('led.resolvedErrors')}</span>
          </button>
          <button
            className={`logdiff-stat ${activeTab === 'recurring' ? 'is-active is-recurring' : ''}`}
            onClick={() => setActiveTab('recurring')}
          >
            <span className="logdiff-stat__num">{diffResult?.recurringErrors.length ?? 0}</span>
            <span className="logdiff-stat__label">{t('led.recurringErrors')}</span>
          </button>
        </div>

        {/* Content list */}
        <div className="wbmodal__body logdiff-modal__body">
          {loading && (
            <div className="logdiff-modal__loading">
              <Icon name="refresh" size={20} className="spin" />
              <span>{t('led.analyzingDiff')}</span>
            </div>
          )}

          {!loading && currentItems.length === 0 && (
            <div className="pane__empty">
              <Icon name="check" size={24} color="var(--pine)" />
              <span className="label">{t('led.noDiffEntries')}</span>
            </div>
          )}

          {!loading && currentItems.length > 0 && (
            <div className="logdiff-list">
              {currentItems.map((item, idx) => (
                <div key={idx} className={`logdiff-row logdiff-row--${item.level}`}>
                  <span className={`ledlvl ledlvl--${item.level} mono`}>{item.level}</span>
                  <span className="logdiff-row__head mono truncate" title={item.head}>
                    {item.head}
                  </span>
                  {item.modName && (
                    <span className="ledpill ledpill--mod truncate" title={item.modName}>
                      {item.modName}
                    </span>
                  )}
                  {item.count > 1 && (
                    <span className="ledpill ledpill--repeat mono">x{item.count}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="wbmodal__footer">
          {activeTab === 'new' && (diffResult?.newErrors.length ?? 0) > 0 && onApplyNewErrorsFilter && (
            <button className="btn btn--primary" onClick={handleApplyFilter}>
              <Icon name="filter" size={12} />
              {t('led.filterOnlyNewErrors', { count: diffResult?.newErrors.length ?? 0 })}
            </button>
          )}
          <div className="toolbar__spacer" />
          <button className="btn" onClick={onClose}>
            {t('led.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
