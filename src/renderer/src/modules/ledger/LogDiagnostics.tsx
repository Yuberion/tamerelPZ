import { useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { hasKey, useI18n } from '@renderer/i18n'
import type { Diagnosis } from './parseLog'

export interface LogDiagnosticsProps {
  diagnoses: Diagnosis[]
  selectedDiagId: string | undefined
  onSelectDiag: (id: string | undefined) => void
}

export function LogDiagnostics({
  diagnoses,
  selectedDiagId,
  onSelectDiag
}: LogDiagnosticsProps) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)

  if (diagnoses.length === 0) return null

  const active = diagnoses.find((d) => d.id === selectedDiagId)

  const tr = (k: string): string => (hasKey(k) ? t(k) : k)

  return (
    <div className="leddiag">
      <div className="leddiag__bar">
        <button
          className="leddiag__toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? t('led.diagExpand') : t('led.diagCollapse')}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
          <Icon name="alert" size={13} color="var(--rust)" />
          <span className="leddiag__title stencil">{t('led.diagTitle')}</span>
          <span className="leddiag__count mono">
            {diagnoses.length} {t('led.diagIssues')}
          </span>
        </button>

        <div className="toolbar__spacer" />

        {selectedDiagId && (
          <button
            className="btn btn--tiny leddiag__clearbtn"
            onClick={() => onSelectDiag(undefined)}
            title={t('led.diagShowAll')}
          >
            <Icon name="close" size={10} />
            {t('led.diagResetFilter')}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="leddiag__body">
          <div className="leddiag__cards">
            {diagnoses.map((diag) => {
              const isSelected = diag.id === selectedDiagId
              return (
                <div
                  key={diag.id}
                  className={`ledcard ledcard--${diag.severity} ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => onSelectDiag(isSelected ? undefined : diag.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectDiag(isSelected ? undefined : diag.id)
                    }
                  }}
                >
                  <div className="ledcard__head">
                    <Icon
                      name={diag.severity === 'error' ? 'x-circle' : 'alert'}
                      size={12}
                      className="ledcard__icon"
                    />
                    <span className="ledcard__title truncate">
                      {tr(diag.title)}
                    </span>
                    <span className="ledcard__count mono">x{diag.count}</span>
                  </div>

                  <div className="ledcard__desc truncate">{diag.desc}</div>

                  {diag.modName && (
                    <div className="ledcard__foot">
                      <span className="ledpill ledpill--mod truncate">{diag.modName}</span>
                      {diag.callSite && (
                        <span className="ledcard__site mono truncate" title={diag.callSite}>
                          {diag.callSite}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="ledcard__hint truncate">
                    <Icon name="info" size={10} />
                    <span>{tr(diag.hint)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {active && (
            <div className="leddiag__active">
              <span className="leddiag__activetxt">
                {t('led.diagFilteredTo', { title: tr(active.title) })}
              </span>
              <button
                className="btn btn--tiny"
                onClick={() => onSelectDiag(undefined)}
              >
                {t('led.diagShowAll')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
