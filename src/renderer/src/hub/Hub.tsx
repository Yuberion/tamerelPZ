import { useMemo } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { formatCount, formatDuration } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { MODULES, type ModuleId } from './modules'

interface HubProps {
  onOpen: (id: ModuleId) => void
}

export function Hub({ onOpen }: HubProps) {
  const { scan, paths, scanning, progress, refresh, error } = useAppStore()
  const { notify } = useToast()

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
          <div className="hub__eyebrow label">Project Zomboid · management suite</div>
          <h1 className="hub__h1 stencil">PZ Management</h1>
          <div className="hub__rule" />
          <p className="hub__lede">
            Nine modules. One drive. Everything you installed, finally accounted for.
          </p>
        </div>

        <div className="hub__readout brackets">
          <div className="readout__head label">Site status</div>
          <Readout
            label="Build"
            value={paths?.gameVersion?.split(' ')[0] ?? (scanning ? 'scanning' : 'unknown')}
          />
          <Readout label="Mods found" value={formatCount(stats.total)} />
          <Readout label="Local" value={formatCount(stats.local)} />
          <Readout label="Workshop" value={formatCount(stats.workshop)} />
          <Readout
            label="Duplicate ids"
            value={formatCount(stats.duplicates)}
            tone={stats.duplicates ? 'warn' : undefined}
          />
          <Readout
            label="Broken requires"
            value={formatCount(stats.missing)}
            tone={stats.missing ? 'warn' : undefined}
          />
          <div className="readout__foot">
            {scanning ? (
              <div className="readout__scan">
                <Icon name="refresh" size={11} className="spin" />
                <span className="mono">
                  {progress?.label ?? 'Scanning'} {pct ? `${pct}%` : ''}
                </span>
              </div>
            ) : (
              <button className="btn btn--tiny" onClick={() => void refresh(true)}>
                <Icon name="refresh" size={12} />
                Rescan drive
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
                else notify(`${m.name.toUpperCase()} is sealed in this build`, 'warn')
              }}
            >
              <span className="tile__code mono">{m.code}</span>
              <span className="tile__icon">
                <Icon name={m.icon} size={30} strokeWidth={1.35} />
              </span>
              <span className="tile__body">
                <span className="tile__name stencil">{m.name}</span>
                <span className="tile__tagline label">{m.tagline}</span>
                <span className="tile__desc">{m.description}</span>
              </span>
              <span className="tile__foot">
                {live ? (
                  <>
                    <span className="tile__pulse" />
                    <span className="label tile__status">Online</span>
                    <Icon name="chevron-right" size={13} className="tile__go" />
                  </>
                ) : (
                  <>
                    <Icon name="lock" size={12} />
                    <span className="label tile__status">Sealed</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="hub__foot mono">
        <span>{paths?.gameDir ?? 'game directory not found'}</span>
        <span className="hub__foot-sep">·</span>
        <span>{paths?.zomboidDir ?? 'user directory not found'}</span>
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
