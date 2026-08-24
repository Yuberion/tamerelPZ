import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthoringTarget, ModEntry } from '@shared/types'
import { Icon, type IconName } from '@renderer/components/Icon'
import { MenuProvider, useMenu } from '@renderer/components/Menu'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText, formatCount, segmentByIndices } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'
import { useAppStore } from '@renderer/state/store'
import { InfoTool } from './InfoTool'
import { PackTool } from './PackTool'
import { ScaffoldTool } from './ScaffoldTool'
import { ValidateTool } from './ValidateTool'
import { useEditableMods, type EditableMod } from './useEditableMods'

const LS_LEFT = 'pz.workbench.leftWidth'
const ROW_H = 30

type Tab = 'scaffold' | 'info' | 'validate' | 'pack'

const TABS: Array<{ id: Tab; labelKey: TKey; icon: IconName }> = [
  { id: 'scaffold', labelKey: 'wb.tabScaffold', icon: 'folder-plus' },
  { id: 'info', labelKey: 'wb.tabInfo', icon: 'edit' },
  { id: 'validate', labelKey: 'wb.tabValidate', icon: 'flask' },
  { id: 'pack', labelKey: 'wb.tabPack', icon: 'package' }
]

function readWidth(fallback: number): number {
  const raw = Number(localStorage.getItem(LS_LEFT))
  return Number.isFinite(raw) && raw > 200 ? raw : fallback
}

export function Workbench({ onExit }: { onExit: () => void }) {
  return (
    <MenuProvider>
      <WorkbenchBody onExit={onExit} />
    </MenuProvider>
  )
}

function WorkbenchBody({ onExit }: { onExit: () => void }) {
  const { scan, scanning, refresh, byKey } = useAppStore()
  const { t } = useI18n()

  const [targets, setTargets] = useState<AuthoringTarget[]>([])
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>()
  const [tab, setTab] = useState<Tab>('scaffold')
  const [leftW, setLeftW] = useState(() => readWidth(300))

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

  const selected = selectedKey ? byKey.get(selectedKey) : undefined
  const selectedWritable = useMemo(() => {
    if (!selected) return false
    return rows.find((r) => r.mod.key === selected.key)?.writable ?? false
  }, [selected, rows])

  const selectMod = useCallback((mod: ModEntry) => {
    setSelectedKey(mod.key)
    setTab((prev) => (prev === 'scaffold' ? 'info' : prev))
  }, [])

  // After scaffolding, rescan so the new mod appears, then select it.
  const pendingSelect = useRef<string | undefined>(undefined)
  const onCreated = useCallback(
    (modPath: string) => {
      pendingSelect.current = modPath.toLowerCase()
      void refresh(true)
    },
    [refresh]
  )

  useEffect(() => {
    if (!pendingSelect.current) return
    const target = mods.find((m) => m.path.toLowerCase() === pendingSelect.current)
    if (target) {
      pendingSelect.current = undefined
      setSelectedKey(target.key)
      setTab('info')
    }
  }, [mods])

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

  // The mod.info / validate / pack tools all need a selected mod.
  const needsMod = tab !== 'scaffold'
  const showPicker = needsMod && !selected

  return (
    <div className="workbench">
      <div className="toolbar">
        <div className="toolbar__row">
          <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
            <Icon name="arrow-left" size={13} />
            {t('tb.hub')}
          </button>
          <div className="divider-v" />
          <div className="wbtabs">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                className={`wbtab ${tab === tb.id ? 'is-on' : ''}`}
                onClick={() => setTab(tb.id)}
              >
                <Icon name={tb.icon} size={13} />
                <span className="wbtab__label stencil">{t(tb.labelKey)}</span>
              </button>
            ))}
          </div>
          <div className="toolbar__spacer" />
          <button
            className="btn"
            onClick={() => {
              setTab('scaffold')
              setSelectedKey(undefined)
            }}
            title={t('wb.newModTitle')}
          >
            <Icon name="folder-plus" size={13} />
            {t('wb.newMod')}
          </button>
          <button className="btn btn-icon" onClick={() => void refresh(true)} disabled={scanning} title={t('tb.rescanTitle')}>
            <Icon name="refresh" size={13} className={scanning ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="workbench__body">
        <section className="pane pane--left" style={{ width: leftW, flex: `0 0 ${leftW}px` }}>
          <div className="pane__head">
            <Icon name="wrench" size={13} color="var(--rust)" />
            <span className="pane__title stencil">{t('wb.paneMods')}</span>
            <span className="pane__count mono">
              {formatCount(writableCount)}
              {rows.length !== writableCount && (
                <span className="pane__count-total"> / {formatCount(rows.length)}</span>
              )}
            </span>
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
          </div>
          <ModList rows={rows} selectedKey={selectedKey} onSelect={selectMod} query={query} />
        </section>

        <Splitter onDrag={dragLeft} onDoubleClick={() => setLeftW(300)} />

        <section className="pane pane--center workbench__main">
          {tab === 'scaffold' && <ScaffoldTool targets={targets} onCreated={onCreated} />}
          {tab !== 'scaffold' && showPicker && <PickPrompt />}
          {tab === 'info' && selected && <InfoTool mod={selected} writable={selectedWritable} />}
          {tab === 'validate' && selected && <ValidateTool mod={selected} knownIds={knownIds} />}
          {tab === 'pack' && selected && <PackTool mod={selected} />}
        </section>
      </div>
    </div>
  )
}

function PickPrompt() {
  const { t } = useI18n()
  return (
    <div className="pane__empty pane__empty--big">
      <Icon name="wrench" size={34} strokeWidth={1.2} />
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
          <Icon name="wrench" size={22} />
          <span className="label">{t('wb.noMods')}</span>
          <span className="label wbmuted">{t('wb.noModsHint')}</span>
        </div>
      </div>
    )
  }

  const rowMenu = (e: React.MouseEvent, mod: ModEntry): void => {
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
                  <span className="wbrow__id mono truncate">{mod.modId ?? mod.folderName}</span>
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
