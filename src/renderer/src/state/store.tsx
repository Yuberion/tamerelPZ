import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppInfo,
  AppSettings,
  ModEntry,
  PathsReport,
  ScanProgress,
  ScanResult
} from '@shared/types'

interface AppStoreValue {
  info: AppInfo | undefined
  paths: PathsReport | undefined
  settings: AppSettings | undefined
  scan: ScanResult | undefined
  progress: ScanProgress | undefined
  scanning: boolean
  error: string | undefined
  /** Mods keyed by `ModEntry.key`. */
  byKey: Map<string, ModEntry>
  /** Mods keyed by normalised mod id (several entries = duplicate id). */
  byModId: Map<string, ModEntry[]>
  refresh(force?: boolean): Promise<void>
  saveSettings(patch: Partial<AppSettings>): Promise<void>
}

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo>()
  const [paths, setPaths] = useState<PathsReport>()
  const [settings, setSettings] = useState<AppSettings>()
  const [scan, setScan] = useState<ScanResult>()
  const [progress, setProgress] = useState<ScanProgress>()
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef<Promise<void> | undefined>(undefined)
  const booted = useRef(false)

  const refresh = useCallback(async (force = false): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const task = (async (): Promise<void> => {
      setScanning(true)
      setError(undefined)
      try {
        const [report, result] = await Promise.all([
          window.pz.paths.detect(),
          window.pz.mods.scan({ force })
        ])
        setPaths(report)
        setScan(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setScanning(false)
        inFlight.current = undefined
      }
    })()
    inFlight.current = task
    return task
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.pz.settings.set(patch)
    setSettings(next)
  }, [])

  useEffect(() => {
    const off = window.pz.mods.onProgress(setProgress)
    return off
  }, [])

  useEffect(() => {
    // StrictMode mounts effects twice in dev; only boot the scan once.
    if (booted.current) return
    booted.current = true
    void window.pz.app.info().then(setInfo)
    void window.pz.settings.get().then(setSettings)
    void refresh(false)
  }, [refresh])

  const byKey = useMemo(() => {
    const map = new Map<string, ModEntry>()
    for (const m of scan?.mods ?? []) map.set(m.key, m)
    return map
  }, [scan])

  const byModId = useMemo(() => {
    const map = new Map<string, ModEntry[]>()
    for (const m of scan?.mods ?? []) {
      if (!m.modId) continue
      const list = map.get(m.modId)
      if (list) list.push(m)
      else map.set(m.modId, [m])
    }
    return map
  }, [scan])

  const value = useMemo<AppStoreValue>(
    () => ({
      info,
      paths,
      settings,
      scan,
      progress,
      scanning,
      error,
      byKey,
      byModId,
      refresh,
      saveSettings
    }),
    [info, paths, settings, scan, progress, scanning, error, byKey, byModId, refresh, saveSettings]
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider')
  return ctx
}
