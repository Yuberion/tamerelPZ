import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutFile, LoadoutProfile, ModEntry, ModOverwritesSummary, OrderValidationResult } from '@shared/types'
import { Alert } from '@renderer/components/Form'
import { Hint } from '@renderer/components/Hint'
import { Icon, type IconName } from '@renderer/components/Icon'
import { MenuProvider } from '@renderer/components/Menu'
import { Splitter } from '@renderer/components/Splitter'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDate, shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import { AvailablePanel, type Candidate } from './AvailablePanel'
import { OrderList, isSeparator, type OrderEntry } from './OrderList'
import { RulesModal } from './RulesModal'
import { PresetsModal } from './PresetsModal'
import { ValidationModal } from './ValidationModal'
import { IntegrityModal } from './IntegrityModal'
import { MapConflictModal } from './MapConflictModal'
import { ServerSyncModal } from './ServerSyncModal'
import { BuildReportModal } from './BuildReportModal'
import { copyOrderText, detectMlosCategory, sortModsMLOS, validateOrder } from './mlos'
import { ModDetailPanel } from './ModDetailPanel'
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
const LS_RIGHT = 'pz.loadout.rightWidth'
const LS_SHOW_INFO = 'pz.loadout.showInfo'
const LS_SHOW_TOOLS = 'pz.loadout.showTools'
const LS_PINNED = 'pz.loadout.pinned'

const TABS: Array<{ id: ListKind; labelKey: TKey; icon: IconName; only?: 'client' | 'server' }> = [
  { id: 'mods', labelKey: 'lo.tabMods', icon: 'list' },
  { id: 'maps', labelKey: 'lo.tabMaps', icon: 'map', only: 'client' },
  { id: 'workshop', labelKey: 'lo.tabWorkshop', icon: 'download', only: 'server' }
]

function readWidth(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 200 ? raw : fallback
}

function readShowInfo(fallback: boolean): boolean {
  const raw = localStorage.getItem(LS_SHOW_INFO)
  return raw !== null ? raw === 'true' : fallback
}

function readShowTools(fallback: boolean): boolean {
  const raw = localStorage.getItem(LS_SHOW_TOOLS)
  return raw !== null ? raw === 'true' : fallback
}

function readPinnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_PINNED)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.map(bareId) : [])
  } catch {
    return new Set()
  }
}

/** Field of `LoadoutDraft` each tab edits. */
const FIELD: Record<ListKind, keyof LoadoutDraft> = {
  mods: 'mods',
  maps: 'maps',
  workshop: 'workshopItems'
}

function targetLabel(file: LoadoutFile, t: (key: TKey) => string, isRu: boolean): string {
  if (file.kind === 'client') return isRu ? 'Клиент (default.txt)' : t('lo.targetClient')
  if (file.kind === 'save') return (isRu ? 'Сейв: ' : 'Save: ') + (file.saveName ?? file.id)
  return (isRu ? 'Сервер: ' : 'Server: ') + (file.serverName ?? file.id)
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

function collectDependencies(
  modId: string,
  byModId: Map<string, ModEntry>,
  alreadyUsed: Set<string>
): { resolved: string[]; missing: string[] } {
  const missing: string[] = []
  const resolved: string[] = []
  const visited = new Set<string>()

  function recurse(id: string) {
    const bare = bareId(id)
    if (visited.has(bare)) return
    visited.add(bare)

    const target = byModId.get(bare)
    if (!target) {
      if (!alreadyUsed.has(bare) && !resolved.map(bareId).includes(bare)) {
        missing.push(id)
      }
      return
    }

    for (const req of target.requires ?? []) {
      const reqBare = bareId(req)
      if (!alreadyUsed.has(reqBare) && !resolved.map(bareId).includes(reqBare)) {
        recurse(req)
      }
    }

    const val = target.modId ?? target.folderName
    const valBare = bareId(val)
    if (!alreadyUsed.has(valBare) && !resolved.map(bareId).includes(valBare)) {
      resolved.push(val)
    }
  }

  recurse(modId)
  return { resolved, missing }
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
  const { t, p, lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()
  const store = useLoadout()

  const [tab, setTab] = useState<ListKind>('mods')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number>()
  const [backup, setBackup] = useState(true)
  const [profileName, setProfileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoResolve, setAutoResolve] = useState(true)
  const [leftW, setLeftW] = useState(() => readWidth(LS_LEFT, 320))
  const [rightW, setRightW] = useState(() => readWidth(LS_RIGHT, 340))
  const [showInfo, setShowInfo] = useState(() => readShowInfo(true))
  const [showTools, setShowTools] = useState(() => readShowTools(true))
  const [inspectedModId, setInspectedModId] = useState<string | null>(null)

  const [rulesModId, setRulesModId] = useState<string | null>(null)
  const [showPresetsModal, setShowPresetsModal] = useState(false)
  const [showValidationModal, setShowValidationModal] = useState(false)
  const [showIntegrityModal, setShowIntegrityModal] = useState(false)
  const [showMapConflictModal, setShowMapConflictModal] = useState(false)
  const [showServerSyncModal, setShowServerSyncModal] = useState(false)
  const [showAddSepModal, setShowAddSepModal] = useState(false)
  const [sepTitle, setSepTitle] = useState('')
  const [sepColor, setSepColor] = useState('#3b82f6')
  const [overwritesSummary, setOverwritesSummary] = useState<ModOverwritesSummary>()
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinnedIds())
  const [showReportModal, setShowReportModal] = useState(false)

  useEffect(() => {
    let cancelled = false
    const activeMods = store.lists.mods
    if (activeMods.length === 0) {
      setOverwritesSummary(undefined)
      return
    }

    const timer = setTimeout(() => {
      window.pz.loadout
        .getFileOverwrites(activeMods)
        .then((res) => {
          if (!cancelled) setOverwritesSummary(res)
        })
        .catch(() => {})
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [store.lists.mods])

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

  const inspectedMod = useMemo<ModEntry | undefined>(() => {
    if (inspectedModId) {
      return lookup(inspectedModId)
    }
    if (selected !== undefined && values[selected]) {
      return lookup(values[selected])
    }
    if (values.length > 0) {
      return lookup(values[0])
    }
    return undefined
  }, [inspectedModId, selected, values, lookup])

  // Map names come from a directory listing, so "not installed" is only
  // trustworthy once that listing has finished.
  const resolve = active !== 'maps' || mapsReady

  const validationResult = useMemo<OrderValidationResult>(() => {
    if (active !== 'mods') return { valid: true, issues: [], cycles: [], issuesByMod: new Map() }
    return validateOrder(values, byModId, store.rules)
  }, [active, values, byModId, store.rules])

  const entries = useMemo<OrderEntry[]>(() => {
    const seen = new Set<string>()
    return values.map((value, index) => {
      if (isSeparator(value)) {
        return { value, index, missing: false, duplicate: false }
      }
      const key = keyOf(value)
      const duplicate = seen.has(key)
      seen.add(key)
      const mod = lookup(value)
      const category =
        active === 'mods' && mod ? detectMlosCategory(mod, store.rules[key]?.category) : undefined
      const issues = active === 'mods' ? validationResult.issuesByMod?.get(key) : undefined
      const hasRule = active === 'mods' && Boolean(store.rules[key])
      return { value, index, mod, missing: !mod, duplicate, category, issues, hasRule }
    })
  }, [values, keyOf, lookup, active, store.rules, validationResult])

  const used = useMemo(() => new Set(values.filter((v) => !isSeparator(v)).map(keyOf)), [values, keyOf])
  const missingCount = resolve ? entries.filter((e) => !isSeparator(e.value) && e.missing).length : 0
  const duplicateCount = entries.filter((e) => !isSeparator(e.value) && e.duplicate).length

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

  const removeValue = useCallback(
    (value: string) => {
      const key = keyOf(value)
      setValues(values.filter((v) => keyOf(v) !== key))
      setSelected(undefined)
    },
    [values, keyOf, setValues]
  )

  const add = useCallback(
    (value: string) => {
      const token = value.trim()
      if (!token || used.has(keyOf(token))) return

      if (active === 'mods' && autoResolve) {
        const { resolved, missing } = collectDependencies(token, byModId, used)
        if (missing.length > 0) {
          notify(
            isRu
              ? `Отсутствуют необходимые моды: ${missing.join(', ')}`
              : `Missing required mods: ${missing.join(', ')}`,
            'warn'
          )
        }
        const extraDeps = resolved.filter((v) => keyOf(v) !== keyOf(token))
        if (extraDeps.length > 0) {
          notify(
            isRu
              ? `Авто-подключено зависимостей (${extraDeps.length}): ${extraDeps.map((id) => lookup(id)?.name ?? id).join(', ')}`
              : `Auto-resolved ${extraDeps.length} dependencies: ${extraDeps.join(', ')}`,
            'ok'
          )
        }
        setValues([...values, ...resolved])
      } else {
        setValues([...values, token])
      }
    },
    [values, used, keyOf, setValues, active, autoResolve, byModId, isRu, notify, lookup]
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

  const handleAddSeparator = useCallback(
    (title: string, color: string) => {
      const clean = title.trim().toUpperCase() || 'CATEGORY'
      const token = `__SEP__:${clean}:${color}`
      const next = [...values]
      if (selected !== undefined && selected >= 0 && selected <= next.length) {
        next.splice(selected + 1, 0, token)
      } else {
        next.push(token)
      }
      setValues(next)
      setShowAddSepModal(false)
      setSepTitle('')
    },
    [values, selected, setValues]
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
  const sortMLOS = useCallback(() => {
    const { sorted } = sortModsMLOS(values, byModId, store.rules, store.luaDeps, pinnedIds)
    const moved = sorted.some((v, i) => v !== values[i])
    setValues(sorted)
    setSelected(undefined)
    notify(
      moved
        ? (isRu
            ? (pinnedIds.size > 0
                ? `Порядок оптимизирован MLOS (с фиксацией ${pinnedIds.size} модов)`
                : 'Порядок оптимизирован алгоритмом MLOS')
            : (pinnedIds.size > 0
                ? `Order sorted via MLOS (${pinnedIds.size} mods locked)`
                : 'List sorted with MLOS algorithm'))
        : (isRu ? 'Порядок уже оптимален по MLOS' : 'Order is already optimal'),
      'ok'
    )
  }, [values, byModId, store.rules, store.luaDeps, pinnedIds, setValues, notify, isRu])

  const handleCopyOrder = useCallback(async () => {
    const text = copyOrderText(values, byModId)
    await copyText(text)
    notify(isRu ? 'Список ID скопирован в буфер обмена' : 'Order copied to clipboard', 'ok')
  }, [values, byModId, notify, isRu])

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

  const dragRight = useCallback((dx: number) => {
    setRightW((w) => {
      const next = Math.min(Math.max(w - dx, 240), 580)
      localStorage.setItem(LS_RIGHT, String(next))
      return next
    })
  }, [])

  const toggleShowInfo = useCallback(() => {
    setShowInfo((prev) => {
      const next = !prev
      localStorage.setItem(LS_SHOW_INFO, String(next))
      return next
    })
  }, [])

  const toggleShowTools = useCallback(() => {
    setShowTools((prev) => {
      const next = !prev
      try {
        localStorage.setItem(LS_SHOW_TOOLS, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const togglePin = useCallback((val: string) => {
    const key = bareId(val)
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(LS_PINNED, JSON.stringify(Array.from(next)))
      } catch {
        /* ignore */
      }
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
                <Icon
                  name={file.kind === 'client' ? 'user' : file.kind === 'save' ? 'save' : 'server'}
                  size={12}
                />
                {targetLabel(file, t, isRu)}
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
          <div className="divider-v" />
          <button
            className={`btn ${showInfo ? 'is-active' : ''}`}
            onClick={toggleShowInfo}
            title={isRu ? 'Панель информации и превью мода' : 'Mod details & preview pane'}
          >
            <Icon name="eye" size={13} />
            {isRu ? 'Инфо' : 'Info'}
          </button>
        </div>

        <div className="toolbar__row toolbar__row--filters">
          <span className="label toolbar__legend">{t('lo.profiles')}</span>
          <button
            className="btn is-active"
            onClick={() => setShowPresetsModal(true)}
            title={
              isRu
                ? 'Менеджер пресетов, пресеты игры и обмен текстом'
                : 'Presets manager, in-game presets and text share'
            }
          >
            <Icon name="book" size={12} />
            {isRu ? 'Пресеты и обмен…' : 'Presets & Share…'}
          </button>
          <div className="divider-v" />
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
            onRemove={removeValue}
            onAddAll={addAll}
            onInspect={(val) => setInspectedModId(val)}
            inspectedValue={inspectedModId ?? undefined}
            emptyLabel={active === 'maps' ? t('lo.noMaps') : t('lo.noCandidates')}
            emptyHint={active === 'maps' ? t('lo.noMapsHint') : t('lo.noCandidatesHint')}
            disabled={busy}
            showCategoryFilters={active === 'mods'}
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
            {active === 'mods' && (
              <button
                className={`btn btn--tiny lotools__toggle-btn ${showTools ? 'is-active' : ''}`}
                onClick={toggleShowTools}
                title={
                  isRu
                    ? 'Панель действий и инструментов (MLOS, аудит, коллизии, разделители, очистка)'
                    : 'Actions & tools panel (MLOS, audit, conflicts, separators, cleanup)'
                }
              >
                <Icon name="wrench" size={11} />
                {isRu ? 'Действия' : 'Actions'}
                {validationResult.issues.length > 0 && (
                  <span className="lomlos-badge-count">{validationResult.issues.length}</span>
                )}
                <Icon name={showTools ? 'chevron-down' : 'chevron-right'} size={10} />
              </button>
            )}

            <div className="toolbar__spacer" />

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
          </div>

          {showTools && active === 'mods' && (
            <div className="lotools-panel">
              <div className="lotools-panel__group">
                <span className="lotools-panel__label">{isRu ? 'Порядок:' : 'Order:'}</span>
                <button
                  className="btn btn--tiny is-primary"
                  onClick={sortMLOS}
                  disabled={busy || values.length < 2}
                  title={
                    isRu
                      ? 'Умная топологическая сортировка MLOS (категории, require, loadAfter, Lua soft-deps)'
                      : 'Smart MLOS topological sort (categories, require, loadAfter, Lua soft-deps)'
                  }
                >
                  <Icon name="sort" size={11} />
                  {isRu ? 'Сортировка MLOS' : 'MLOS Sort'}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => setShowAddSepModal(true)}
                  title={isRu ? 'Добавить категорию / визуальный разделитель' : 'Add category separator'}
                >
                  <Icon name="plus" size={11} />
                  {isRu ? 'Разделитель' : 'Separator'}
                </button>
                <button
                  className={`btn btn--tiny ${autoResolve ? 'is-active' : ''}`}
                  onClick={() => setAutoResolve(!autoResolve)}
                  title={
                    isRu
                      ? 'Автоматически подключать недостающие зависимости при добавлении мода'
                      : 'Automatically resolve dependencies when adding a mod'
                  }
                >
                  <Icon
                    name={autoResolve ? 'check' : 'link'}
                    size={11}
                    color={autoResolve ? '#10b981' : undefined}
                  />
                  {isRu ? 'Авто-зависимости' : 'Auto-Deps'}
                </button>
                {pinnedIds.size > 0 && (
                  <button
                    className="btn btn--tiny"
                    onClick={() => {
                      setPinnedIds(new Set())
                      try {
                        localStorage.removeItem(LS_PINNED)
                      } catch {
                        /* ignore */
                      }
                    }}
                    title={isRu ? `Снять фиксацию со всех (${pinnedIds.size}) модов` : `Unpin all (${pinnedIds.size}) mods`}
                  >
                    <Icon name="lock" size={10} color="#f59e0b" />
                    {isRu ? `Снять замки (${pinnedIds.size})` : `Unpin (${pinnedIds.size})`}
                  </button>
                )}
              </div>

              <div className="divider-v" />

              <div className="lotools-panel__group">
                <span className="lotools-panel__label">{isRu ? 'Анализ & Синхр:' : 'Audit & Sync:'}</span>
                <button
                  className={`btn btn--tiny ${validationResult.issues.length > 0 ? 'btn--warn' : ''}`}
                  onClick={() => setShowIntegrityModal(true)}
                  title={
                    isRu
                      ? 'Глубокий аудит порядка, зависимостей, циклов и правил MLOS'
                      : 'Deep integrity audit: requirements, cycles, order inversions & rules'
                  }
                >
                  <Icon name={validationResult.valid ? 'check' : 'alert'} size={11} />
                  {isRu ? 'Аудит порядка' : 'Integrity Audit'}
                  {validationResult.issues.length > 0 && (
                    <span className="lomlos-badge-count">{validationResult.issues.length}</span>
                  )}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => setShowMapConflictModal(true)}
                  title={
                    isRu
                      ? 'Инспектор коллизий и пересечений чанков карт'
                      : 'Map conflict and chunk overlap inspector'
                  }
                >
                  <Icon name="map" size={11} color="var(--blue-light, #38bdf8)" />
                  {isRu ? 'Карты и коллизии' : 'Map Conflicts'}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => setShowServerSyncModal(true)}
                  title={
                    isRu
                      ? 'Экспорт и прямая синхронизация с конфигурацией сервера (server.ini)'
                      : 'Export & direct sync with server INI config'
                  }
                >
                  <Icon name="server" size={11} color="var(--ember)" />
                  {isRu ? 'Сервер INI' : 'Server INI'}
                </button>
              </div>

              <div className="divider-v" />

              <div className="lotools-panel__group">
                <span className="lotools-panel__label">{isRu ? 'Список:' : 'List:'}</span>
                <button
                  className="btn btn--tiny"
                  onClick={() => void handleCopyOrder()}
                  disabled={values.length === 0}
                  title={isRu ? 'Скопировать список ID модов в буфер обмена' : 'Copy mod IDs to clipboard'}
                >
                  <Icon name="copy" size={11} />
                  {isRu ? 'Копировать' : 'Copy'}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={() => setShowReportModal(true)}
                  title={
                    isRu
                      ? 'Сформировать красивый отчет о сборке для Discord / форума / модпака'
                      : 'Generate formatted modpack report for Discord / forums / server'
                  }
                >
                  <Icon name="book" size={11} color="var(--rust-light)" />
                  {isRu ? 'Отчет сборки' : 'Build Report'}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={dedupe}
                  disabled={busy || duplicateCount === 0}
                  title={t('lo.dedupeTitle')}
                >
                  <Icon name="copy" size={11} />
                  {t('lo.dedupe')}
                  {duplicateCount > 0 && (
                    <span className="loprofile__n mono">{formatCount(duplicateCount)}</span>
                  )}
                </button>
                <button
                  className="btn btn--tiny"
                  onClick={pruneMissing}
                  disabled={busy || missingCount === 0}
                  title={t('lo.pruneTitle')}
                >
                  <Icon name="trash" size={11} />
                  {t('lo.prune')}
                  {missingCount > 0 && (
                    <span className="loprofile__n mono">{formatCount(missingCount)}</span>
                  )}
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

              <div className="toolbar__spacer" />

              <button
                className="btn btn-icon btn--tiny lotools-panel__close"
                onClick={toggleShowTools}
                title={isRu ? 'Скрыть панель действий' : 'Hide actions panel'}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          )}

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
            onSelect={(idx) => {
              setSelected(idx)
              if (idx !== undefined && values[idx]) {
                setInspectedModId(values[idx])
              }
            }}
            onMove={move}
            onRemove={remove}
            onEditRule={(modId) => setRulesModId(modId)}
            resolve={resolve}
            emptyLabel={t('lo.emptyList')}
            emptyHint={t('lo.emptyListHint')}
            disabled={busy}
            overwritesSummary={overwritesSummary}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
          />
        </section>

        {showInfo && (
          <>
            <Splitter onDrag={dragRight} onDoubleClick={() => setRightW(340)} />
            <section
              className="pane pane--right"
              style={{ width: rightW, flex: `0 0 ${rightW}px` }}
            >
              <ModDetailPanel
                mod={inspectedMod}
                rule={
                  inspectedMod?.modId
                    ? store.rules[bareId(inspectedMod.modId)]
                    : undefined
                }
                onEditRule={(id) => setRulesModId(id)}
                onClose={toggleShowInfo}
                activeMods={store.lists.mods}
                onAddRequirement={(reqId) => {
                  add(reqId)
                }}
                overwritesSummary={overwritesSummary}
              />
            </section>
          </>
        )}
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

      {rulesModId && (
        <RulesModal
          modId={rulesModId}
          modName={byModId.get(rulesModId)?.name}
          initialRule={store.rules[rulesModId]}
          onSave={async (rule) => {
            await store.saveRule(rulesModId, rule)
            notify(isRu ? 'Правило сохранено' : 'Rule saved', 'ok')
          }}
          onDelete={async () => {
            await store.deleteRule(rulesModId)
            notify(isRu ? 'Правило удалено' : 'Rule deleted', 'ok')
          }}
          onClose={() => setRulesModId(null)}
        />
      )}

      {showPresetsModal && (
        <PresetsModal
          currentMods={store.lists.mods}
          currentKind={kind}
          byModId={byModId}
          profiles={profiles}
          gamePresets={store.gamePresets}
          onSaveProfile={async (name) => {
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
            notify(isRu ? `Пресет «${name}» сохранён` : `Saved preset "${name}"`, 'ok')
          }}
          onDeleteProfile={deleteProfile}
          onApplyProfile={(profile) => {
            loadProfile(profile)
          }}
          onApplyGamePreset={(name, ids) => {
            store.patch({ mods: ids })
            notify(
              isRu ? `Применён пресет «${name}» (${ids.length} модов)` : `Applied preset "${name}"`,
              'ok'
            )
          }}
          onImportGamePresets={async (gp) => {
            const imported: LoadoutProfile[] = Object.entries(gp).map(([pName, pMods]) => ({
              id: profileId(),
              name: `[Game] ${pName}`,
              kind: 'client',
              mods: pMods,
              maps: [],
              workshopItems: [],
              savedAt: Date.now()
            }))
            await saveSettings({ loadoutProfiles: [...imported, ...profiles] })
          }}
          onDeleteGamePreset={async (name) => {
            const next = { ...store.gamePresets }
            delete next[name]
            await store.saveGamePresets(next)
            notify(
              isRu
                ? `Пресет «${name}» удалён из pz_modlist_settings.cfg`
                : `Preset deleted from game cfg`,
              'ok'
            )
          }}
          onImportCustomList={(_name, modIds) => {
            store.patch({ mods: modIds })
            setSelected(undefined)
          }}
          onClose={() => setShowPresetsModal(false)}
        />
      )}

      {showValidationModal && (
        <ValidationModal
          result={validationResult}
          onFixWithSort={() => {
            sortMLOS()
          }}
          onClose={() => setShowValidationModal(false)}
        />
      )}

      {showAddSepModal && (
        <div className="lomodal-backdrop" onClick={() => setShowAddSepModal(false)}>
          <div className="lomodal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="lomodal__head">
              <div className="lomodal__titlebox">
                <Icon name="plus" size={14} color="var(--rust-hot)" />
                <h3 className="lomodal__title stencil">
                  {isRu ? 'Новый разделитель категории' : 'New Category Separator'}
                </h3>
              </div>
              <button className="btn btn-icon" onClick={() => setShowAddSepModal(false)}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="lomodal__body" style={{ padding: '16px 20px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--ash)', marginBottom: 6 }}>
                {isRu ? 'Название категории / группы:' : 'Category Name / Group:'}
              </label>
              <input
                className="input"
                style={{ width: '100%', padding: '7px 10px', background: '#14181e', color: 'var(--bone)', border: '1px solid #28313e', borderRadius: '4px', textTransform: 'uppercase' }}
                value={sepTitle}
                placeholder="e.g. 01. LIBRARIES & FRAMEWORKS"
                autoFocus
                onChange={(e) => setSepTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSeparator(sepTitle, sepColor)
                }}
              />

              {/* Quick Preset Buttons */}
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: '10.5px', color: 'var(--ash-faint)', display: 'block', marginBottom: 5 }}>
                  {isRu ? 'Быстрые шаблоны категорий:' : 'Quick Presets:'}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {['LIBRARIES', 'MAPS', 'VEHICLES', 'WEAPONS', 'CLOTHING', 'ITEMS', 'TWEAKS', 'UI', 'AUDIO', 'MISC'].map((cat) => (
                    <button
                      key={cat}
                      className="btn btn--tiny"
                      onClick={() => setSepTitle(cat)}
                      style={{ fontSize: '10px' }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Accents */}
              <div style={{ marginTop: 12 }}>
                <span style={{ fontSize: '10.5px', color: 'var(--ash-faint)', display: 'block', marginBottom: 5 }}>
                  {isRu ? 'Цвет полосы акцента:' : 'Accent Color:'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { color: '#3b82f6', label: 'Blue' },
                    { color: '#10b981', label: 'Emerald' },
                    { color: '#f59e0b', label: 'Amber' },
                    { color: '#ef4444', label: 'Crimson' },
                    { color: '#a855f7', label: 'Purple' },
                    { color: '#06b6d4', label: 'Cyan' },
                    { color: '#64748b', label: 'Slate' }
                  ].map((c) => (
                    <button
                      key={c.color}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: c.color,
                        border: sepColor === c.color ? '2px solid #fff' : '2px solid transparent',
                        cursor: 'pointer'
                      }}
                      onClick={() => setSepColor(c.color)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="lomodal__foot">
              <button className="btn" onClick={() => setShowAddSepModal(false)}>
                {isRu ? 'Отмена' : 'Cancel'}
              </button>
              <div className="toolbar__spacer" />
              <button
                className="btn is-primary"
                onClick={() => handleAddSeparator(sepTitle, sepColor)}
              >
                <Icon name="check" size={12} />
                {isRu ? 'Добавить разделитель' : 'Add Separator'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showIntegrityModal && (
        <IntegrityModal
          activeList={values}
          byModId={byModId}
          rules={store.rules}
          luaDeps={store.luaDeps}
          onApplyFixed={(fixed) => {
            setValues(fixed)
            setSelected(undefined)
          }}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}

      {showMapConflictModal && (
        <MapConflictModal
          activeModIds={store.lists.mods}
          currentMaps={store.lists.maps}
          onApplyMapOrder={(newMaps) => {
            store.patch({ maps: newMaps })
            notify(isRu ? 'Порядок карт обновлён' : 'Map order updated', 'ok')
          }}
          onClose={() => setShowMapConflictModal(false)}
        />
      )}

      {showServerSyncModal && (
        <ServerSyncModal
          activeMods={store.lists.mods}
          activeMaps={store.lists.maps}
          byModId={byModId}
          serverFiles={store.files.filter((f) => f.kind === 'server')}
          onSyncComplete={() => {
            void store.reload()
          }}
          onClose={() => setShowServerSyncModal(false)}
        />
      )}

      {showReportModal && (
        <BuildReportModal
          activeList={values}
          byModId={byModId}
          targetFile={target}
          overwritesSummary={overwritesSummary}
          onClose={() => setShowReportModal(false)}
        />
      )}
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
