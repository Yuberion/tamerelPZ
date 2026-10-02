import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthoringTarget, ModEntry } from '@shared/types'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { MenuProvider, useMenu } from '@renderer/components/Menu'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText, formatCount, segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'
import { useAppStore } from '@renderer/state/store'
import { ValidateTool } from './ValidateTool'
import { useEditableMods, type EditableMod } from './useEditableMods'

const LS_LEFT = 'pz.workbench.leftWidth'
const ROW_H = 30

function readWidth(fallback: number): number {
  const raw = Number(localStorage.getItem(LS_LEFT))
  return Number.isFinite(raw) && raw > 200 ? raw : fallback
}

export function Auditor({ onExit }: { onExit: () => void }) {
  return (
    <MenuProvider>
      <AuditorBody onExit={onExit} />
    </MenuProvider>
  )
}

export const Workbench = Auditor

function AuditorBody({ onExit }: { onExit: () => void }) {
  const { scan, scanning, refresh, byKey, paths } = useAppStore()
  const { t } = useI18n()

  const [targets, setTargets] = useState<AuthoringTarget[]>([])
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>()
  const [leftW, setLeftW] = useState(() => readWidth(320))

  const mods = useMemo(() => scan?.mods ?? [], [scan])

  useEffect(() => {
    void window.pz.workbench.targets().then(setTargets)
  }, [scan])

  const knownIds = useMemo(() => {
    const set = new Set<string>()
    for (const m of mods) if (m.modId) set.add(m.modId)
    return [...set]
  }, [mods])

  const { rows, writableCount } = useEditableMods(mods, targets, query)

  // Default select first mod if none selected
  useEffect(() => {
    if (!selectedKey && rows.length > 0) {
      setSelectedKey(rows[0]!.mod.key)
    }
  }, [rows, selectedKey])

  const selected = selectedKey ? byKey.get(selectedKey) : undefined

  const selectMod = useCallback((mod: ModEntry) => {
    setSelectedKey(mod.key)
  }, [])

  const dragLeft = useCallback((dx: number) => {
    setLeftW((w) => {
      const next = Math.min(Math.max(w + dx, 220), 520)
      localStorage.setItem(LS_LEFT, String(next))
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        void refresh(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  return (
    <div className="auditor workbench">
      <div className="toolbar">
        <div className="toolbar__row">
          <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
            <Icon name="arrow-left" size={13} />
            {t('tb.hub')}
          </button>
          <div className="divider-v" />

          {/* Module branding */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px' }}>
            <Icon name="pulse" size={16} color="var(--rust-hot)" />
            <span
              className="stencil"
              style={{
                fontSize: 12,
                letterSpacing: '0.08em',
                color: 'var(--bone)',
                textTransform: 'uppercase'
              }}
            >
              {t('wb.doctor.title')}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontWeight: 600
              }}
              title={paths?.gameVersion ? `${t('wb.gameEngine')}: ${paths.gameVersion}` : t('wb.gameEngine')}
            >
              {paths?.gameVersion ? `PZ ${paths.gameVersion}` : t('wb.gameEngine')}
            </span>
          </div>

          <div className="toolbar__spacer" />

          {selected && (
            <div
              className="mono truncate"
              style={{
                fontSize: 11,
                color: 'var(--ash)',
                maxWidth: 380,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span className="truncate">{selected.name}</span>
              {getModVersionText(selected) && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#38bdf8',
                    flexShrink: 0
                  }}
                  title={selected.modVersion ? `${t('wb.sc.modVersion')}: ${selected.modVersion}` : undefined}
                >
                  {getModVersionText(selected)}
                </span>
              )}
            </div>
          )}

          <button
            className="btn btn-icon"
            onClick={() => void refresh(true)}
            disabled={scanning}
            title={t('tb.rescanTitle')}
          >
            <Icon name="refresh" size={13} className={scanning ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="workbench__body">
        <section className="pane pane--left" style={{ width: leftW }}>
          <div className="pane__head">
            <span className="pane__title stencil">{t('wb.paneMods')}</span>
            <span className="pane__count mono">
              {formatCount(writableCount)}
              {rows.length !== writableCount && (
                <span className="pane__count-total"> / {formatCount(rows.length)}</span>
              )}
            </span>
            <div className="pane__head-spacer" />
            <Hint title={t('wb.paneMods')} body={t('help.wb.mods')} />
          </div>
          <div className="wbsearch">
            <div className="minisearch">
              <Icon name="search" size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('wb.searchPlaceholder')}
                spellCheck={false}
              />
              {query && (
                <button className="minisearch__clear" onClick={() => setQuery('')}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
            <Hint title={t('wb.searchPlaceholder')} body={t('help.wb.search')} />
          </div>
          <ModList rows={rows} selectedKey={selectedKey} onSelect={selectMod} query={query} />
        </section>

        <Splitter onDrag={dragLeft} onDoubleClick={() => setLeftW(320)} />

        <section className="pane pane--center workbench__main">
          {selected ? (
            <ValidateTool mod={selected} knownIds={knownIds} />
          ) : (
            <PickPrompt />
          )}
        </section>
      </div>
    </div>
  )
}

function PickPrompt() {
  const { t } = useI18n()
  return (
    <div className="pane__empty pane__empty--big">
      <Icon name="pulse" size={36} strokeWidth={1.2} color="var(--rust-hot)" />
      <span className="stencil">{t('wb.pickMod')}</span>
      <span className="label">{t('wb.pickModHint')}</span>
    </div>
  )
}

function ModList({
  rows,
  selectedKey,
  onSelect,
  query
}: {
  rows: EditableMod[]
  selectedKey: string | undefined
  onSelect: (mod: ModEntry) => void
  query: string
}) {
  const { t } = useI18n()
  const { openMenu } = useMenu()
  const { notify } = useToast()
  const v = useVirtual(rows.length, ROW_H)

  if (rows.length === 0) {
    return (
      <div className="pane__scroll">
        <div className="pane__empty">
          <Icon name="pulse" size={22} />
          <span className="label">{t('wb.noMods')}</span>
          <span className="label wbmuted">{t('wb.noModsHint')}</span>
        </div>
      </div>
    )
  }

  const rowMenu = (e: React.MouseEvent, mod: ModEntry): void => {
    e.preventDefault()
    openMenu(e, [
      {
        label: t('wb.revealMod'),
        icon: 'external',
        onClick: () => void window.pz.shell.reveal(mod.path)
      },
      {
        label: t('wb.openMod'),
        icon: 'folder-open',
        onClick: () => void window.pz.shell.open(mod.path)
      },
      { separator: true },
      {
        label: t('menu.copyModId'),
        icon: 'hash',
        disabled: !mod.modId,
        onClick: () => {
          void copyText(mod.modId ?? '')
          notify(t('toast.modIdCopied'), 'ok')
        }
      },
      {
        label: t('menu.copyPath'),
        icon: 'copy',
        onClick: () => {
          void copyText(mod.path)
          notify(t('toast.pathCopied'), 'ok')
        }
      }
    ])
  }

  return (
    <div className="pane__scroll" ref={v.ref}>
      <div style={{ height: v.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${v.offset}px)` }}>
          {rows.slice(v.start, v.end).map(({ mod, writable, indices }) => {
            const src = SOURCE_META[mod.sourceKind]
            const segments = query ? segmentByIndices(mod.name, indices) : null
            const ver = getModVersionText(mod)
            return (
              <div
                key={mod.key}
                className={`wbrow ${selectedKey === mod.key ? 'is-selected' : ''} ${
                  writable ? '' : 'is-locked'
                }`}
                style={{ height: ROW_H }}
                onClick={() => onSelect(mod)}
                onContextMenu={(e) => rowMenu(e, mod)}
                title={writable ? mod.path : `${mod.path} — ${t('wb.lockedTitle')}`}
              >
                <span className="wbrow__src mono" style={{ color: src.color }} title={t(src.labelKey)}>
                  {src.glyph}
                </span>
                <span className="wbrow__body">
                  <span className="wbrow__name truncate">
                    {segments
                      ? segments.map((s, i) =>
                          s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
                        )
                      : mod.name}
                  </span>
                  <span className="wbrow__sub">
                    <span className="wbrow__id mono truncate">{mod.modId ?? mod.folderName}</span>
                    {ver && (
                      <span
                        className="wbrow__ver mono"
                        title={mod.modVersion ? `${t('wb.sc.modVersion')}: ${mod.modVersion}` : ver}
                      >
                        {ver}
                      </span>
                    )}
                  </span>
                </span>
                {!writable && <Icon name="lock" size={11} className="wbrow__lock" title={t('wb.locked')} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Formats a mod's version for display (e.g. "v1.2.0" or "PZ 41.78") */
export function getModVersionText(mod: ModEntry): string | null {
  if (mod.modVersion) {
    const v = mod.modVersion.trim()
    if (!v) return null
    return /^[vV]/.test(v) ? v : `v${v}`
  }
  if (mod.pzVersion) {
    const v = mod.pzVersion.trim()
    if (!v) return null
    return `PZ ${v}`
  }
  return null
}
