import { createPortal } from 'react-dom'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import type { ModConflictTarget, ModMissingDepTarget } from './conflicts'

export interface ModTooltipData {
  name: string
  id: string
  incompatibleWith?: ModConflictTarget[]
  missingDeps?: ModMissingDepTarget[]
  rect: DOMRect
}

interface ModStatusTooltipProps {
  data: ModTooltipData | null
}

const TOOLTIP_WIDTH = 290
const PADDING = 8

export function ModStatusTooltip({ data }: ModStatusTooltipProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'

  if (!data) return null

  const hasConflict = (data.incompatibleWith?.length ?? 0) > 0
  const hasMissing = (data.missingDeps?.length ?? 0) > 0

  if (!hasConflict && !hasMissing) return null

  const rect = data.rect

  // Horizontal position calculation
  let left = rect.right + PADDING
  if (left + TOOLTIP_WIDTH > window.innerWidth - 10) {
    left = Math.max(10, rect.left - TOOLTIP_WIDTH - PADDING)
  }

  // Vertical position calculation
  let top = rect.top - 4
  const estimatedHeight = (hasConflict ? 90 : 0) + (hasMissing ? 90 : 0) + 40
  if (top + estimatedHeight > window.innerHeight - 10) {
    top = Math.max(10, window.innerHeight - estimatedHeight - 10)
  }

  return createPortal(
    <div
      className="mod-status-tooltip"
      style={{
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        width: `${TOOLTIP_WIDTH}px`
      }}
    >
      <div className="mod-status-tooltip__header-main">
        <span className="mod-status-tooltip__mod-name truncate">{data.name}</span>
        <span className="mod-status-tooltip__mod-id mono truncate">{data.id}</span>
      </div>

      {hasConflict && (
        <div className="mod-status-tooltip__section mod-status-tooltip__section--conflict">
          <div className="mod-status-tooltip__sec-head">
            <Icon name="alert" size={12} color="#ef4444" />
            <span className="mod-status-tooltip__title mod-status-tooltip__title--conflict">
              {isRu ? 'Несовместимость' : 'Incompatibility Conflict'}
            </span>
          </div>
          <div className="mod-status-tooltip__desc">
            {isRu ? 'Конфликтует с активными модами:' : 'Conflicts with active mods:'}
          </div>
          <ul className="mod-status-tooltip__list">
            {data.incompatibleWith!.map((target) => (
              <li key={target.id} className="mod-status-tooltip__item">
                <span className="mod-status-tooltip__item-name truncate">{target.name}</span>
                <span className="mod-status-tooltip__item-id mono">({target.id})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasMissing && (
        <div className="mod-status-tooltip__section mod-status-tooltip__section--dep">
          <div className="mod-status-tooltip__sec-head">
            <Icon name="link" size={12} color="#f59e0b" />
            <span className="mod-status-tooltip__title mod-status-tooltip__title--dep">
              {isRu ? 'Требуемые зависимости' : 'Required Dependencies'}
            </span>
          </div>
          <div className="mod-status-tooltip__desc">
            {isRu ? 'Для работы необходимы моды:' : 'Requires following mods to be enabled:'}
          </div>
          <ul className="mod-status-tooltip__list">
            {data.missingDeps!.map((target) => (
              <li key={target.id} className="mod-status-tooltip__item">
                <span className="mod-status-tooltip__item-name truncate">{target.name}</span>
                <span className="mod-status-tooltip__item-id mono">({target.id})</span>
                <span
                  className={`mod-status-tooltip__badge ${target.installed ? 'is-inactive' : 'is-uninstalled'}`}
                >
                  {target.installed
                    ? (isRu ? 'не подключен' : 'not enabled')
                    : (isRu ? 'не установлен' : 'missing')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>,
    document.body
  )
}
