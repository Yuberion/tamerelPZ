import { useMemo } from 'react'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatCount, formatDuration } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { MODULES, type ModuleId } from './modules'

interface HubProps {
  onOpen: (id: ModuleId) => void
}

const PROGRESS_KEYS: Record<string, TKey> = {
  sources: 'progress.sources',
  enumerate: 'progress.enumerate',
  analyze: 'progress.analyze',
  done: 'progress.done'
}

export function Hub({ onOpen }: HubProps) {
  const { scan, paths, scanning, progress, refresh, error } = useAppStore()
  const { notify } = useToast()
  const { t } = useI18n()

  const stats = useMemo(() => {
    const mods = scan?.mods ?? []
    const bySource = new Map<string, number>()
    for (const m of mods) bySource.set(m.sourceKind, (bySource.get(m.sourceKind) ?? 0) + 1)
    const issues = scan?.issues
    return {
      total: mods.length,
      local: bySource.get('local') ?? 0,
      workshop: bySource.get('workshop') ?? 0,
      game: bySource.get('game') ?? 0,
      duplicates: Object.keys(issues?.duplicateIds ?? {}).length,
      missing: Object.keys(issues?.missingRequires ?? {}).length,
      noInfo: issues?.missingInfo.length ?? 0
    }
  }, [scan])

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="hub">
      <div className="hub__top">
        <div className="hub__title">
          <div className="hub__eyebrow label">{t('hub.eyebrow')}</div>
          <h1 className="hub__h1 stencil">PZ Management</h1>
          <div className="hub__rule" />
          <p className="hub__lede">
            {t('hub.lede')}
            <Hint className="hint--inline" title="PZ Management" body={t('help.hub.modules')} />
          </p>
        </div>

        <div className="hub__readout brackets">
          <div className="readout__head label">
            {t('hub.status')}
            <Hint title={t('hub.status')} body={t('help.hub.status')} />
          </div>
          <Readout
            label={t('hub.build')}
            value={
              paths?.gameVersion?.split(' ')[0] ??
              (scanning ? t('hub.scanningShort') : t('hub.unknown'))
            }
          />
          <Readout label={t('hub.modsFound')} value={formatCount(stats.total)} />
          <Readout label={t('hub.local')} value={formatCount(stats.local)} />
          <Readout label={t('hub.workshop')} value={formatCount(stats.workshop)} />
          <Readout
            label={t('hub.duplicateIds')}
            value={formatCount(stats.duplicates)}
            tone={stats.duplicates ? 'warn' : undefined}
          />
          <Readout
            label={t('hub.brokenRequires')}
            value={formatCount(stats.missing)}
            tone={stats.missing ? 'warn' : undefined}
          />
          <div className="readout__foot">
            {scanning ? (
              <div className="readout__scan">
                <Icon name="refresh" size={11} className="spin" />
                <span className="mono">
                  {progress ? t(PROGRESS_KEYS[progress.phase] ?? 'hub.scanning') : t('hub.scanning')}{' '}
                  {pct ? `${pct}%` : ''}
                </span>
              </div>
            ) : (
              <button className="btn btn--tiny" onClick={() => void refresh(true)}>
                <Icon name="refresh" size={12} />
                {t('hub.rescanDrive')}
              </button>
            )}
            {scan && !scanning && (
              <span className="mono readout__time">{formatDuration(scan.durationMs)}</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="hub__error">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="hub__grid">
        {MODULES.map((m, i) => {
          const live = m.status === 'live'
          return (
            <button
              key={m.id}
              className={`tile ${live ? 'tile--live' : 'tile--sealed'}`}
              style={{ animationDelay: `${i * 28}ms` }}
              onClick={() => {
                if (live) onOpen(m.id)
                else notify(t('hub.sealedToast', { name: m.name.toUpperCase() }), 'warn')
              }}
            >
              <span className="tile__code mono">{m.code}</span>
              <span className="tile__icon">
                <Icon name={m.icon} size={30} strokeWidth={1.35} />
              </span>
              <span className="tile__body">
                <span className="tile__name stencil">{m.name}</span>
                <span className="tile__tagline label">{t(m.taglineKey)}</span>
                <span className="tile__desc">{t(m.descKey)}</span>
              </span>
              <span className="tile__foot">
                {live ? (
                  <>
                    <span className="tile__pulse" />
                    <span className="label tile__status">{t('hub.online')}</span>
                    <Icon name="chevron-right" size={13} className="tile__go" />
                  </>
                ) : (
                  <>
                    <Icon name="lock" size={12} />
                    <span className="label tile__status">{t('hub.sealed')}</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="hub__foot mono">
        <span>{paths?.gameDir ?? t('hub.noGameDir')}</span>
        <span className="hub__foot-sep">·</span>
        <span>{paths?.zomboidDir ?? t('hub.noUserDir')}</span>
      </div>
    </div>
  )
}

function Readout({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <div className="readout__row">
      <span className="readout__label label">{label}</span>
      <span className={`readout__value mono ${tone === 'warn' ? 'is-warn' : ''}`}>{value}</span>
    </div>
  )
}
