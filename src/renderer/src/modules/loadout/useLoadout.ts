import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadoutFile, ModEntry, SortingRule } from '@shared/types'

/**
 * Editing state for the Loadout module.
 *
 * Supports:
 *  - Target selection (Client default.txt, Player Saves, Server inis)
 *  - Drafts per target
 *  - Sorting rules (sorting_rules.txt)
 *  - In-game presets (pz_modlist_settings.cfg)
 *  - Auto-detected Lua soft dependencies
 */

export type ListKind = 'mods' | 'maps' | 'workshop'

export interface LoadoutDraft {
  mods: string[]
  maps: string[]
  workshopItems: string[]
}

const EMPTY: LoadoutDraft = { mods: [], maps: [], workshopItems: [] }
const SEP = '\u0001'

function sameLists(a: LoadoutDraft, b: LoadoutDraft): boolean {
  return (
    a.mods.join(SEP) === b.mods.join(SEP) &&
    a.maps.join(SEP) === b.maps.join(SEP) &&
    a.workshopItems.join(SEP) === b.workshopItems.join(SEP)
  )
}

function listsOf(file: LoadoutFile | undefined): LoadoutDraft {
  if (!file) return EMPTY
  return { mods: file.mods, maps: file.maps, workshopItems: file.workshopItems }
}

/**
 * Bare form of a mod id.
 *
 * Build 42 workshop mods write their id as `<workshopId>/<ModId>`, and a config
 * may hold either spelling. The scanner normalises to the bare id, so list
 * entries are normalised the same way before they are matched against it.
 */
export function bareId(raw: string): string {
  const trimmed = raw.trim().replace(/^\\/, '')
  const m = /^\d+\/(.+)$/.exec(trimmed)
  return (m?.[1] ?? trimmed).trim().toLowerCase()
}

/** Mod ids indexed for entry resolution: bare id, raw id and folder name. */
export function indexByModId(mods: ModEntry[]): Map<string, ModEntry> {
  const index = new Map<string, ModEntry>()
  const put = (key: string | undefined, mod: ModEntry): void => {
    if (!key) return
    const k = bareId(key)
    if (k && !index.has(k)) index.set(k, mod)
  }
  for (const mod of mods) {
    put(mod.modId, mod)
    put(mod.rawModId, mod)
    put(mod.folderName, mod)
  }
  return index
}

export function indexByWorkshopId(mods: ModEntry[]): Map<string, ModEntry> {
  const index = new Map<string, ModEntry>()
  for (const mod of mods) {
    if (mod.workshopId && !index.has(mod.workshopId)) index.set(mod.workshopId, mod)
  }
  return index
}

export interface LoadoutStore {
  files: LoadoutFile[]
  target: LoadoutFile | undefined
  targetId: string
  selectTarget(id: string): void
  /** Lists as currently edited; identical to the file until something changes. */
  lists: LoadoutDraft
  patch(next: Partial<LoadoutDraft>): void
  /** Target ids carrying unsaved edits — drives the dot on the config picker. */
  dirtyIds: Set<string>
  dirty: boolean
  loading: boolean
  error: string | undefined
  /** Re-read every config, rules, and game presets from disk. */
  reload(): Promise<void>
  /** Re-read after a successful write, dropping only that target's draft. */
  commit(id: string): Promise<void>
  /** Restore the current target from disk without touching the other drafts. */
  revert(): void
  /** Sorting rules (sorting_rules.txt). */
  rules: Record<string, SortingRule>
  saveRule(modId: string, rule: SortingRule): Promise<boolean>
  deleteRule(modId: string): Promise<boolean>
  /** In-game presets (pz_modlist_settings.cfg). */
  gamePresets: Record<string, string[]>
  reloadGamePresets(): Promise<void>
  saveGamePresets(presets: Record<string, string[]>): Promise<boolean>
  /** Auto-detected Lua soft dependencies. */
  luaDeps: Record<string, string[]>
}

export function useLoadout(): LoadoutStore {
  const [files, setFiles] = useState<LoadoutFile[]>([])
  const [drafts, setDrafts] = useState<Record<string, LoadoutDraft>>({})
  const [targetId, setTargetId] = useState('client')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [rules, setRules] = useState<Record<string, SortingRule>>({})
  const [gamePresets, setGamePresets] = useState<Record<string, string[]>>({})
  const [luaDeps, setLuaDeps] = useState<Record<string, string[]>>({})

  const fetchFiles = useCallback(async (): Promise<LoadoutFile[]> => {
    const list = await window.pz.loadout.files()
    setFiles(list)
    setTargetId((prev) => (list.some((f) => f.id === prev) ? prev : (list[0]?.id ?? 'client')))
    return list
  }, [])

  const fetchAux = useCallback(async (): Promise<void> => {
    try {
      const [r, gp, ld] = await Promise.all([
        window.pz.loadout.getRules().catch(() => ({})),
        window.pz.loadout.getGamePresets().catch(() => ({})),
        window.pz.loadout.getLuaDeps().catch(() => ({}))
      ])
      setRules(r)
      setGamePresets(gp)
      setLuaDeps(ld)
    } catch {
      // non-fatal
    }
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await Promise.all([fetchFiles(), fetchAux()])
      setDrafts({})
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [fetchFiles, fetchAux])

  const commit = useCallback(
    async (id: string): Promise<void> => {
      await fetchFiles()
      setDrafts((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [fetchFiles]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const target = useMemo(() => files.find((f) => f.id === targetId), [files, targetId])
  const baseline = useMemo(() => listsOf(target), [target])
  const lists = drafts[targetId] ?? baseline

  const patch = useCallback(
    (next: Partial<LoadoutDraft>): void => {
      setDrafts((prev) => ({ ...prev, [targetId]: { ...(prev[targetId] ?? baseline), ...next } }))
    },
    [targetId, baseline]
  )

  const revert = useCallback((): void => {
    setDrafts((prev) => {
      if (!(targetId in prev)) return prev
      const next = { ...prev }
      delete next[targetId]
      return next
    })
  }, [targetId])

  const dirtyIds = useMemo(() => {
    const set = new Set<string>()
    for (const [id, draft] of Object.entries(drafts)) {
      const file = files.find((f) => f.id === id)
      if (!sameLists(draft, listsOf(file))) set.add(id)
    }
    return set
  }, [drafts, files])

  const saveRule = useCallback(
    async (modId: string, rule: SortingRule): Promise<boolean> => {
      const next = { ...rules, [modId]: rule }
      const ok = await window.pz.loadout.saveRules(next)
      if (ok) setRules(next)
      return ok
    },
    [rules]
  )

  const deleteRule = useCallback(
    async (modId: string): Promise<boolean> => {
      const next = { ...rules }
      delete next[modId]
      const ok = await window.pz.loadout.saveRules(next)
      if (ok) setRules(next)
      return ok
    },
    [rules]
  )

  const reloadGamePresets = useCallback(async (): Promise<void> => {
    try {
      const gp = await window.pz.loadout.getGamePresets()
      setGamePresets(gp)
    } catch {
      // non-fatal
    }
  }, [])

  const saveGamePresetsFn = useCallback(
    async (presets: Record<string, string[]>): Promise<boolean> => {
      const ok = await window.pz.loadout.saveGamePresets(presets)
      if (ok) setGamePresets(presets)
      return ok
    },
    []
  )

  return useMemo(
    () => ({
      files,
      target,
      targetId,
      selectTarget: setTargetId,
      lists,
      patch,
      dirtyIds,
      dirty: dirtyIds.has(targetId),
      loading,
      error,
      reload,
      commit,
      revert,
      rules,
      saveRule,
      deleteRule,
      gamePresets,
      reloadGamePresets,
      saveGamePresets: saveGamePresetsFn,
      luaDeps
    }),
    [
      files,
      target,
      targetId,
      lists,
      patch,
      dirtyIds,
      loading,
      error,
      reload,
      commit,
      revert,
      rules,
      saveRule,
      deleteRule,
      gamePresets,
      reloadGamePresets,
      saveGamePresetsFn,
      luaDeps
    ]
  )
}

/** One directory under a mod's `media/maps`, i.e. one selectable map name. */
export interface MapFolder {
  name: string
  mod: ModEntry
}

/**
 * Map folder names across every installed mod.
 *
 * The `maps { }` block holds folder names under `media/maps`, not mod ids, and a
 * single mod can ship several.
 */
export function useMapFolders(
  mods: ModEntry[],
  enabled: boolean
): { folders: MapFolder[]; ready: boolean } {
  const [folders, setFolders] = useState<MapFolder[]>([])
  const [ready, setReady] = useState(false)
  const run = useRef(0)

  const mapMods = useMemo(() => mods.filter((m) => m.mediaDirs.includes('maps')), [mods])

  useEffect(() => {
    if (!enabled) return
    const id = ++run.current
    setReady(false)
    void (async () => {
      const out: MapFolder[] = []
      for (const mod of mapMods) {
        const roots = [mod.path, ...mod.versionFolders.map((v) => v.path)]
        for (const root of roots) {
          let children: Awaited<ReturnType<typeof window.pz.fs.list>>
          try {
            children = await window.pz.fs.list(`${root}\\media\\maps`)
          } catch {
            continue
          }
          if (id !== run.current) return
          for (const child of children) {
            if (child.dir) out.push({ name: child.name, mod })
          }
        }
      }
      if (id !== run.current) return
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      setFolders(out)
      setReady(true)
    })()
  }, [mapMods, enabled])

  return { folders, ready }
}
