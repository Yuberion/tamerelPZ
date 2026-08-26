import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutFile, LoadoutProfile, ModEntry } from '@shared/types'
import { Alert } from '@renderer/components/Form'
import { Hint } from '@renderer/components/Hint'
import { Icon, type IconName } from '@renderer/components/Icon'
import { MenuProvider } from '@renderer/components/Menu'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatBytes, formatCount, formatDate, shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { AvailablePanel, type Candidate } from './AvailablePanel'
import { OrderList, type OrderEntry } from './OrderList'
import {
  bareId,
  indexByModId,
  indexByWorkshopId,
  useLoadout,
  useMapFolders,
  type ListKind,
  type LoadoutDraft
} from './useLoadout'

const LS_LEFT = 'pz.loadout.leftWidth'

const TABS: Array<{ id: ListKind; labelKey: TKey; icon: IconName; only?: 'client' | 'server' }> = [
  { id: 'mods', labelKey: 'lo.tabMods', icon: 'list' },
  { id: 'maps', labelKey: 'lo.tabMaps', icon: 'map', only: 'client' },
  { id: 'workshop', labelKey: 'lo.tabWorkshop', icon: 'download', only: 'server' }
]

function readWidth(fallback: number): number {
  const raw = Number(localStorage.getItem(LS_LEFT))
  return Number.isFinite(raw) && raw > 200 ? raw : fallback
}

/** Field of `LoadoutDraft` each tab edits. */
const FIELD: Record<ListKind, keyof LoadoutDraft> = {
  mods: 'mods',
  maps: 'maps',
  workshop: 'workshopItems'
}

function targetLabel(file: LoadoutFile, t: (key: TKey) => string): string {
  return file.kind === 'client' ? t('lo.targetClient') : (file.serverName ?? file.id)
}

/** Move `from` to `to`, shifting everything in between. */
function reorder(values: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= values.length) return values
  const next = values.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

/** Profile key. Only has to be unique inside one settings file. */
function profileId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function Loadout({ onExit }: { onExit: () => void }) {
  return (
    <MenuProvider>
      <LoadoutBody onExit={onExit} />
    </MenuProvider>
  )
}

function LoadoutBody({ onExit }: { onExit: () => void }) {
  const { scan, scanning, refresh, settings, saveSettings } = useAppStore()
  const { t, p } = useI18n()
  const { notify } = useToast()
  const store = useLoadout()

  const [tab, setTab] = useState<ListKind>('mods')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number>()
  const [backup, setBackup] = useState(true)
  const [profileName, setProfileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [leftW, setLeftW] = useState(() => readWidth(320))

  const mods = useMemo(() => scan?.mods ?? [], [scan])
  const target = store.target
  const kind = target?.kind ?? 'client'

  // A tab that does not exist for this config kind falls back to the mod list,
  // so switching from a server ini to default.txt cannot land on a dead pane.
  const tabs = useMemo(() => TABS.filter((x) => !x.only || x.only === kind), [kind])
  const active: ListKind = tabs.some((x) => x.id === tab) ? tab : 'mods'

  const values = store.lists[FIELD[active]]

  const byModId = useMemo(() => indexByModId(mods), [mods])
  const byWorkshopId = useMemo(() => indexByWorkshopId(mods), [mods])
  const { folders: mapFolders, ready: mapsReady } = useMapFolders(mods, active === 'maps')

  const mapIndex = useMemo(() => {
    const index = new Map<string, ModEntry>()
    for (const folder of mapFolders) {
      const key = folder.name.toLowerCase()
      if (!index.has(key)) index.set(key, folder.mod)
    }
    return index
  }, [mapFolders])

  /**
   * Identity of one entry for "already listed" and duplicate checks.
   *
   * Mod ids are compared in their bare form, so `2725360492/Foo` and `Foo` count
   * as the same mod — they are. Map names and Workshop ids are plain tokens and
   * only need case folding.
   */
  const keyOf = useCallback(
    (value: string): string => (active === 'mods' ? bareId(value) : value.trim().toLowerCase()),
    [active]
  )

  /** Installed mod behind one raw config token, if any. */
  const lookup = useCallback(
    (value: string): ModEntry | undefined => {
      if (active === 'workshop') return byWorkshopId.get(value.trim())
      if (active === 'maps') return mapIndex.get(value.trim().toLowerCase())
      return byModId.get(bareId(value))
    },
    [active, byModId, byWorkshopId, mapIndex]
  )

  // Map names come from a directory listing, so "not installed" is only
  // trustworthy once that listing has finished.
  const resolve = active !== 'maps' || mapsReady

  const entries = useMemo<OrderEntry[]>(() => {
    const seen = new Set<string>()
    return values.map((value, index) => {
      const key = keyOf(value)
      const duplicate = seen.has(key)
      seen.add(key)
      const mod = lookup(value)
      return { value, index, mod, missing: !mod, duplicate }
    })
  }, [values, keyOf, lookup])

  const used = useMemo(() => new Set(values.map(keyOf)), [values, keyOf])
  const missingCount = resolve ? entries.filter((e) => e.missing).length : 0
  const duplicateCount = entries.filter((e) => e.duplicate).length

  const candidates = useMemo<Candidate[]>(() => {
    if (active === 'maps') {
      return mapFolders.map((f) => ({ value: f.name, label: f.name, mod: f.mod }))
    }
    if (active === 'workshop') {
      const seen = new Set<string>()
      const out: Candidate[] = []
      for (const mod of mods) {
        if (!mod.workshopId || seen.has(mod.workshopId)) continue
        seen.add(mod.workshopId)
        out.push({ value: mod.workshopId, label: mod.name, mod })
      }
      return out
    }
    const seen = new Set<string>()
    const out: Candidate[] = []
    for (const mod of mods) {
      const value = mod.modId ?? mod.folderName
      const key = keyOf(value)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ value, label: mod.name, mod })
    }
    return out
  }, [active, mods, mapFolders, keyOf])

  /* ---------------------------------------------------------------- editing -- */

  const setValues = useCallback(
    (next: string[]) => {
      store.patch({ [FIELD[active]]: next } as Partial<LoadoutDraft>)
    },
    [store, active]
  )

  const move = useCallback(
    (from: number, to: number) => {
      const clamped = Math.max(0, Math.min(to, values.length - 1))
      setValues(reorder(values, from, clamped))
      setSelected(clamped)
    },
    [values, setValues]
  )

  const remove = useCallback(
    (index: number) => {
      setValues(values.filter((_, i) => i !== index))
      setSelected(undefined)
    },
    [values, setValues]
  )

  const add = useCallback(
    (value: string) => {
      const token = value.trim()
      if (!token || used.has(keyOf(token))) return
      setValues([...values, token])
    },
    [values, used, keyOf, setValues]
  )

  const addAll = useCallback(
    (incoming: string[]) => {
      const seen = new Set(used)
      const extra: string[] = []
      for (const value of incoming) {
        const token = value.trim()
        const key = keyOf(token)
        if (!token || seen.has(key)) continue
        seen.add(key)
        extra.push(token)
      }
      if (extra.length === 0) return
      setValues([...values, ...extra])
      notify(t('lo.addedToast', { n: extra.length }), 'ok')
    },
    [values, used, keyOf, setValues, notify, t]
  )

  const dedupe = useCallback(() => {
    const seen = new Set<string>()
    const next = values.filter((v) => {
      const key = keyOf(v)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setValues(next)
    setSelected(undefined)
  }, [values, keyOf, setValues])

  const pruneMissing = useCallback(() => {
    setValues(entries.filter((e) => !e.missing).map((e) => e.value))
    setSelected(undefined)
  }, [entries, setValues])

  /**
   * Reorder so every mod sits after the mods it requires.
   *
   * Depth-first post-order over the `require=` edges of the entries that are
   * actually in the list: a mod is emitted only once everything it depends on
   * has been. Edges to mods that are not listed are ignored, and a dependency
   * cycle simply stops recursing instead of dropping an entry — the result is
   * always a permutation of the input.
   */
  const sortByRequires = useCallback(() => {
    const position = new Map<string, number>()
    values.forEach((value, i) => {
      const key = bareId(value)
      if (!position.has(key)) position.set(key, i)
    })
    const emitted = new Set<number>()
    const out: string[] = []
    const visit = (index: number, stack: Set<number>): void => {
      if (emitted.has(index) || stack.has(index)) return
      stack.add(index)
      for (const req of byModId.get(bareId(values[index]))?.requires ?? []) {
        const at = position.get(bareId(req))
        if (at !== undefined && at !== index) visit(at, stack)
      }
      stack.delete(index)
      if (emitted.has(index)) return
      emitted.add(index)
      out.push(values[index])
    }
    for (let i = 0; i < values.length; i++) visit(i, new Set())
    const moved = out.some((v, i) => v !== values[i])
    setValues(out)
    setSelected(undefined)
    notify(moved ? t('lo.sortedToast') : t('lo.sortedNoneToast'), 'ok')
  }, [values, byModId, setValues, notify, t])

  /** Server lists need the numeric ids too, or the server downloads nothing. */
  const fillWorkshopIds = useCallback(() => {
    const present = new Set(store.lists.workshopItems.map((v) => v.trim()))
    const extra: string[] = []
    for (const id of store.lists.mods) {
      const workshopId = byModId.get(bareId(id))?.workshopId
      if (!workshopId || present.has(workshopId)) continue
      present.add(workshopId)
      extra.push(workshopId)
    }
    if (extra.length === 0) {
      notify(t('lo.fillNoneToast'), 'info')
      return
    }
    store.patch({ workshopItems: [...store.lists.workshopItems, ...extra] })
    notify(t('lo.filledToast', { n: extra.length }), 'ok')
  }, [store, byModId, notify, t])

  /* ----------------------------------------------------------------- write -- */

  const canWrite = Boolean(target?.path) && !busy
  const [result, setResult] = useState<{ path: string; bytes: number; backupPath?: string }>()

  const apply = useCallback(async () => {
    if (!target?.path || busy) return
    setBusy(true)
    try {
      const written = await window.pz.loadout.apply({
        targetId: target.id,
        mods: store.lists.mods,
        maps: store.lists.maps,
        workshopItems: store.lists.workshopItems,
        backup
      })
      setResult({ path: written.path, bytes: written.bytes, backupPath: written.backupPath })
      await store.commit(target.id)
      notify(
        written.backupPath
          ? t('lo.appliedBackupToast', { bytes: formatBytes(written.bytes) })
          : t('lo.appliedToast', { bytes: formatBytes(written.bytes) }),
        'ok'
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    } finally {
      setBusy(false)
    }
  }, [target, busy, store, backup, notify, t])

  /* -------------------------------------------------------------- profiles -- */

  const profiles = settings?.loadoutProfiles ?? []

  const saveProfile = useCallback(async () => {
    const name = profileName.trim()
    if (!name) {
      notify(t('lo.profileNeedsName'), 'warn')
      return
    }
    const profile: LoadoutProfile = {
      id: profileId(),
      name,
      kind,
      mods: store.lists.mods,
      maps: store.lists.maps,
      workshopItems: store.lists.workshopItems,
      savedAt: Date.now()
    }
    const rest = profiles.filter((x) => x.name.toLowerCase() !== name.toLowerCase())
    await saveSettings({ loadoutProfiles: [profile, ...rest] })
    setProfileName('')
    notify(t('lo.profileSavedToast', { name }), 'ok')
  }, [profileName, kind, store.lists, profiles, saveSettings, notify, t])

  /**
   * Load a profile into the editor, never straight to disk.
   *
   * `mods` always transfers, because a client list and a server `Mods=` line hold
   * the same text ids. The other two are config-specific, so they only transfer
   * between configs of the same kind.
   */
  const loadProfile = useCallback(
    (profile: LoadoutProfile) => {
      const next: Partial<LoadoutDraft> = { mods: profile.mods }
      if (profile.kind === kind) {
        if (kind === 'client') next.maps = profile.maps
        else next.workshopItems = profile.workshopItems
      }
      store.patch(next)
      setSelected(undefined)
      notify(t('lo.profileLoadedToast', { name: profile.name }), 'ok')
    },
    [kind, store, notify, t]
  )

  const deleteProfile = useCallback(
    async (id: string) => {
      await saveSettings({ loadoutProfiles: profiles.filter((x) => x.id !== id) })
    },
    [profiles, saveSettings]
  )

  /* -------------------------------------------------------------- plumbing -- */

  const dragLeft = useCallback((dx: number) => {
    setLeftW((w) => {
      const next = Math.min(Math.max(w + dx, 240), 560)
      localStorage.setItem(LS_LEFT, String(next))
      return next
    })
  }, [])

  // Reset the cursor and the last write when the pane content changes under it.
  useEffect(() => {
    setSelected(undefined)
    setResult(undefined)
  }, [active, store.targetId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      if (e.key === 'F5') {
        e.preventDefault()
        void store.reload()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void apply()
        return
      }
      if (typing || selected === undefined) return
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        move(selected, selected - 1)
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        move(selected, selected + 1)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        remove(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, apply, move, remove, selected])

  const noUserDir = !store.loading && !target?.path

  return (
    <div className="loadout">
      <div className="toolbar">
        <div className="toolbar__row">
          <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
            <Icon name="arrow-left" size={13} />
            {t('tb.hub')}
          </button>
          <div className="divider-v" />

          <span className="label toolbar__legend">{t('lo.config')}</span>
          <div className="wbseg">
            {store.files.map((file) => (
              <button
                key={file.id}
                className={`wbseg__opt ${store.targetId === file.id ? 'is-on' : ''}`}
                onClick={() => store.selectTarget(file.id)}
                title={file.path || t('lo.noUserDir')}
              >
                {targetLabel(file, t)}
                {store.dirtyIds.has(file.id) && <span className="loseg__dot" />}
              </button>
            ))}
          </div>
          <Hint title={t('lo.config')} body={t('help.lo.config')} />

          <div className="toolbar__spacer" />

          <button
            className={`btn ${backup ? 'is-active' : ''}`}
            onClick={() => setBackup((v) => !v)}
            title={t('lo.backupTitle')}
          >
            <Icon name="shield" size={13} />
            {t('lo.backup')}
          </button>
          <button
            className="btn"
            onClick={store.revert}
            disabled={!store.dirty || busy}
            title={t('lo.revertTitle')}
          >
            <Icon name="rotate" size={13} />
            {t('lo.revert')}
          </button>
          <button
            className="btn is-primary"
            onClick={() => void apply()}
            disabled={!canWrite}
            title={t('lo.applyTitle')}
          >
            <Icon name={busy ? 'refresh' : 'save'} size={13} className={busy ? 'spin' : undefined} />
            {t('lo.apply')}
          </button>
          <Hint title={t('lo.apply')} body={t('help.lo.apply')} />
          <button
            className="btn btn-icon"
            onClick={() => void store.reload()}
            disabled={store.loading}
            title={t('lo.reloadTitle')}
          >
            <Icon name="refresh" size={13} className={store.loading ? 'spin' : undefined} />
          </button>
        </div>

        <div className="toolbar__row toolbar__row--filters">
          <span className="label toolbar__legend">{t('lo.profiles')}</span>
          <input
            className="loname"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder={t('lo.profilePlaceholder')}
            spellCheck={false}
          />
          <button className="btn" onClick={() => void saveProfile()} title={t('lo.profileSaveTitle')}>
            <Icon name="save" size={12} />
            {t('lo.profileSave')}
          </button>
          <Hint title={t('lo.profiles')} body={t('help.lo.profiles')} />
          {profiles.length === 0 ? (
            <span className="label wbmuted loprofiles__empty">{t('lo.profileNone')}</span>
          ) : (
            <div className="loprofiles">
              {profiles.map((profile) => (
                <span
                  key={profile.id}
                  className="loprofile"
                  title={t('lo.profileMeta', {
                    kind: t(profile.kind === 'client' ? 'lo.kindClient' : 'lo.kindServer'),
                    mods: formatCount(profile.mods.length),
                    date: formatDate(profile.savedAt)
                  })}
                >
                  <button className="loprofile__load" onClick={() => loadProfile(profile)}>
                    <Icon name="play" size={10} />
                    {profile.name}
                    <span className="loprofile__n mono">{formatCount(profile.mods.length)}</span>
                  </button>
                  <button
                    className="loprofile__del"
                    onClick={() => void deleteProfile(profile.id)}
                    title={t('lo.profileDelete')}
                  >
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="loadout__body">
        <section className="pane pane--left" style={{ width: leftW, flex: `0 0 ${leftW}px` }}>
          <div className="pane__head">
            <Icon name="package" size={13} color="var(--rust)" />
            <span className="pane__title stencil">{t('lo.paneAvailable')}</span>
            <span className="pane__count mono">{formatCount(candidates.length)}</span>
            <div className="pane__head-spacer" />
            <button
              className="btn btn-icon"
              onClick={() => void refresh(true)}
              disabled={scanning}
              title={t('tb.rescanTitle')}
            >
              <Icon name="refresh" size={12} className={scanning ? 'spin' : undefined} />
            </button>
            <Hint title={t('lo.paneAvailable')} body={t('help.lo.available')} />
          </div>
          <AvailablePanel
            candidates={candidates}
            used={used}
            keyOf={keyOf}
            query={query}
            onQuery={setQuery}
            onAdd={add}
            onAddAll={addAll}
            emptyLabel={active === 'maps' ? t('lo.noMaps') : t('lo.noCandidates')}
            emptyHint={active === 'maps' ? t('lo.noMapsHint') : t('lo.noCandidatesHint')}
            disabled={busy}
          />
        </section>

        <Splitter onDrag={dragLeft} onDoubleClick={() => setLeftW(320)} />

        <section className="pane pane--center">
          <div className="pane__head pane__head--tabs">
            {tabs.map((x) => (
              <button
                key={x.id}
                className={`ptab ${active === x.id ? 'is-on' : ''}`}
                onClick={() => setTab(x.id)}
              >
                <Icon name={x.icon} size={12} />
                {t(x.labelKey)}
              </button>
            ))}
            <Hint title={t('lo.paneOrder')} body={t('help.lo.order')} />
            <div className="pane__head-spacer" />
            <span className="pane__count mono">{formatCount(values.length)}</span>
          </div>

          <div className="lotools">
            {/* Keyed by tab so a half-typed mod id does not survive into the
                map list, where it would mean something else entirely. */}
            <ManualAdd
              key={active}
              onAdd={add}
              placeholder={t(`lo.manual.${active}` as TKey)}
              disabled={busy}
            />
            <div className="toolbar__spacer" />
            {active === 'mods' && (
              <button
                className="btn btn--tiny"
                onClick={sortByRequires}
                disabled={busy || values.length < 2}
                title={t('lo.sortRequiresTitle')}
              >
                <Icon name="sort" size={11} />
                {t('lo.sortRequires')}
              </button>
            )}
            {kind === 'server' && active === 'workshop' && (
              <button
                className="btn btn--tiny"
                onClick={fillWorkshopIds}
                disabled={busy || store.lists.mods.length === 0}
                title={t('lo.fillTitle')}
              >
                <Icon name="download" size={11} />
                {t('lo.fill')}
              </button>
            )}
            <button
              className="btn btn--tiny"
              onClick={dedupe}
              disabled={busy || duplicateCount === 0}
              title={t('lo.dedupeTitle')}
            >
              <Icon name="copy" size={11} />
              {t('lo.dedupe')}
            </button>
            <button
              className="btn btn--tiny"
              onClick={pruneMissing}
              disabled={busy || missingCount === 0}
              title={t('lo.pruneTitle')}
            >
              <Icon name="trash" size={11} />
              {t('lo.prune')}
            </button>
            <button
              className="btn btn--tiny"
              onClick={() => {
                setValues([])
                setSelected(undefined)
              }}
              disabled={busy || values.length === 0}
              title={t('lo.clearTitle')}
            >
              <Icon name="close" size={11} />
              {t('lo.clear')}
            </button>
          </div>

          {noUserDir && (
            <div className="lonotice">
              <Alert kind="warn" title={t('lo.noUserDir')}>
                {t('lo.noUserDirBody')}
              </Alert>
            </div>
          )}
          {store.error && (
            <div className="lonotice">
              <Alert kind="bad">{store.error}</Alert>
            </div>
          )}
          {!noUserDir && target && !target.exists && (
            <div className="lonotice">
              <Alert kind="info" title={t('lo.willCreate')}>
                {target.path}
              </Alert>
            </div>
          )}

          <OrderList
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            onMove={move}
            onRemove={remove}
            resolve={resolve}
            emptyLabel={t('lo.emptyList')}
            emptyHint={t('lo.emptyListHint')}
            disabled={busy}
          />
        </section>
      </div>

      <footer className="statusbar mono">
        <Icon name="list" size={12} />
        <span>
          {formatCount(values.length)} {p('entries', values.length)}
        </span>
        <span className="statusbar__sep">·</span>
        <span className={missingCount ? 'is-warn' : 'is-dim'}>
          {t('lo.sbMissing', { n: formatCount(missingCount) })}
        </span>
        <span className="statusbar__sep">·</span>
        <span className={duplicateCount ? 'is-warn' : 'is-dim'}>
          {t('lo.sbDuplicates', { n: formatCount(duplicateCount) })}
        </span>
        {result && (
          <>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">
              {t('lo.sbWritten', { bytes: formatBytes(result.bytes) })}
              {result.backupPath ? ` (${t('lo.sbBackup')})` : ''}
            </span>
          </>
        )}
        <span className="statusbar__spacer" />
        {store.dirty ? (
          <span className="wbdirty label">
            <span className="wbdirty__dot" />
            {t('lo.dirty')}
          </span>
        ) : (
          <span className="label is-dim">{t('lo.inSync')}</span>
        )}
        <span className="statusbar__sep">·</span>
        <span className="statusbar__path" title={target?.path}>
          {target?.path ? shortenPath(target.path, 4) : '—'}
        </span>
      </footer>
    </div>
  )
}

/** Free-text entry, for ids and map names that are not installed locally. */
function ManualAdd({
  onAdd,
  placeholder,
  disabled
}: {
  onAdd: (value: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [value, setValue] = useState('')

  const commit = (): void => {
    const token = value.trim()
    if (!token) return
    onAdd(token)
    setValue('')
  }

  return (
    <div className="loadd">
      <input
        className="loadd__input mono"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <button
        className="btn btn--tiny"
        onClick={commit}
        disabled={disabled || !value.trim()}
        title={t('lo.manualAddTitle')}
      >
        <Icon name="plus" size={11} />
        {t('lo.manualAdd')}
      </button>
    </div>
  )
}
