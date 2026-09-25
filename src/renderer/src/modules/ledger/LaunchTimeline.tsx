import { Icon } from '@renderer/components/Icon'
import { useI18n, type TKey } from '@renderer/i18n'
import type { LaunchStage, LaunchStageId } from '@shared/types'

export interface LaunchTimelineProps {
  stages: LaunchStage[]
  selectedStageId: LaunchStageId | undefined
  onSelectStage: (stageId: LaunchStageId | undefined) => void
}

const STAGE_ICON: Record<LaunchStageId, 'terminal' | 'file' | 'package' | 'map' | 'play'> = {
  engine: 'terminal',
  scripts: 'file',
  mods: 'package',
  world: 'map',
  game: 'play'
}

const STAGE_NAME_KEYS: Record<LaunchStageId, TKey> = {
  engine: 'led.stage.engine',
  scripts: 'led.stage.scripts',
  mods: 'led.stage.mods',
  world: 'led.stage.world',
  game: 'led.stage.game'
}

export function LaunchTimeline({
  stages,
  selectedStageId,
  onSelectStage
}: LaunchTimelineProps) {
  const { t } = useI18n()

  if (stages.length === 0) return null

  return (
    <div className="ledtimeline" title={t('led.timelineHint')}>
      <div className="ledtimeline__label">
        <Icon name="timeline" size={12} color="var(--steel)" />
        <span>{t('led.launchPhases')}:</span>
      </div>

      <div className="ledtimeline__segments">
        {stages.map((st) => {
          const isSelected = selectedStageId === st.id
          const hasError = st.errorCount > 0
          const hasWarn = !hasError && st.warnCount > 0
          const statusClass = hasError ? 'has-error' : hasWarn ? 'has-warn' : 'is-clean'

          return (
            <button
              key={st.id}
              className={`ledtimeline__seg ${statusClass} ${isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelectStage(isSelected ? undefined : st.id)}
              title={`${st.label} (Lines ${st.startLine}-${st.endLine})\n${st.errorCount} ${t('led.lvl.error')}, ${st.warnCount} ${t('led.lvl.warn')}`}
            >
              <Icon name={STAGE_ICON[st.id]} size={11} className="ledtimeline__icon" />
              <span className="ledtimeline__name truncate">{t(STAGE_NAME_KEYS[st.id])}</span>

              {hasError ? (
                <span className="ledtimeline__count ledtimeline__count--error mono">
                  {st.errorCount}
                </span>
              ) : hasWarn ? (
                <span className="ledtimeline__count ledtimeline__count--warn mono">
                  {st.warnCount}
                </span>
              ) : null}
            </button>
          )
        })}

        {selectedStageId && (
          <button
            className="btn btn--tiny btn--subtle ledtimeline__reset"
            onClick={() => onSelectStage(undefined)}
            title={t('led.clearPhaseFilter')}
          >
            <Icon name="close" size={10} />
          </button>
        )}
      </div>
    </div>
  )
}
