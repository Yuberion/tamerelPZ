import type { OrderValidationResult } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'

interface ValidationModalProps {
  result: OrderValidationResult
  onFixWithSort(): void
  onClose(): void
}

export function ValidationModal({ result, onFixWithSort, onClose }: ValidationModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'

  const missing = result.issues.filter((i) => i.type === 'missing')
  const rules = result.issues.filter((i) => i.type === 'rule')
  const incomp = result.issues.filter((i) => i.type === 'incompatible')
  const cycles = result.issues.filter((i) => i.type === 'cycle')

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--validation" onClick={(e) => e.stopPropagation()}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon
              name={result.valid ? 'check' : 'alert'}
              size={15}
              color={result.valid ? 'var(--moss)' : 'var(--ember)'}
            />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Диагностика порядка загрузки' : 'Load Order Diagnostics'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__body lomodal__body--validation">
          <div className="loval-summary">
            {result.valid ? (
              <div className="loval-status is-ok">
                <Icon name="check" size={18} />
                <span>
                  {isRu
                    ? 'Все зависимости, правила и порядок загрузки соблюдены!'
                    : 'All requirements, sorting rules, and order constraints are satisfied!'}
                </span>
              </div>
            ) : (
              <div className="loval-status is-warn">
                <Icon name="alert" size={18} />
                <span>
                  {isRu
                    ? `Обнаружено проблем: ${result.issues.length}`
                    : `Found ${result.issues.length} issue(s) with active load order`}
                </span>
              </div>
            )}

            <div className="loval-badges">
              {missing.length > 0 && (
                <span className="lopill lopill--missing">
                  {isRu ? `Отсутствуют / не на месте: ${missing.length}` : `Missing: ${missing.length}`}
                </span>
              )}
              {rules.length > 0 && (
                <span className="lopill lopill--dupe">
                  {isRu ? `Нарушен loadAfter: ${rules.length}` : `Rule issues: ${rules.length}`}
                </span>
              )}
              {incomp.length > 0 && (
                <span className="lopill lopill--missing">
                  {isRu ? `Несовместимы: ${incomp.length}` : `Incompatible: ${incomp.length}`}
                </span>
              )}
              {cycles.length > 0 && (
                <span className="lopill lopill--missing">
                  {isRu ? `Циклы: ${cycles.length}` : `Cycles: ${cycles.length}`}
                </span>
              )}
            </div>
          </div>

          <div className="loval-issues">
            {result.issues.map((issue, idx) => (
              <div key={idx} className={`loval-issue loval-issue--${issue.type}`}>
                <span className="loval-issue__icon">
                  <Icon
                    name={issue.type === 'incompatible' || issue.type === 'cycle' ? 'trash' : 'alert'}
                    size={12}
                  />
                </span>
                <div className="loval-issue__body">
                  <div className="loval-issue__head">
                    <span className="loval-issue__mod mono">{issue.modId}</span>
                    <span className="loval-issue__type label">
                      {issue.type === 'missing'
                        ? isRu
                          ? 'Зависимость'
                          : 'Requirement'
                        : issue.type === 'rule'
                          ? isRu
                            ? 'Правило'
                            : 'Rule'
                          : issue.type === 'incompatible'
                            ? isRu
                              ? 'Конфликт'
                              : 'Conflict'
                            : isRu
                              ? 'Цикл'
                              : 'Cycle'}
                    </span>
                  </div>
                  <div className="loval-issue__msg">{issue.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lomodal__foot">
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
          <div className="toolbar__spacer" />
          {!result.valid && (
            <button
              className="btn is-primary"
              onClick={() => {
                onFixWithSort()
                onClose()
              }}
            >
              <Icon name="refresh" size={12} />
              {isRu ? 'Исправить порядок (MLOS)' : 'Fix Order with MLOS'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
