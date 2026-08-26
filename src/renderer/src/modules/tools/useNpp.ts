import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NppPackPreview, NppStatus } from '@shared/types'

/**
 * Data plumbing for the Notepad++ bridge.
 *
 * Status is re-probed rather than cached across mounts: the user may install
 * Notepad++, install the pack, or move a portable copy while this panel is open,
 * and every one of those changes the answer. The probe is three registry reads
 * and a handful of `stat` calls, so re-running it is cheaper than being wrong.
 */
export interface NppStore {
  status: NppStatus | undefined
  loading: boolean
  busy: boolean
  error: string | undefined
  refresh(): Promise<void>
  locate(): Promise<void>
  install(): Promise<{ written: number; bytes: number } | undefined>
  preview: NppPackPreview[]
  loadPreview(): Promise<void>
  /** True when nothing of the pack is on disk yet. */
  missing: boolean
  /** True when the pack is installed but from an older revision. */
  stale: boolean
}

export function useNpp(): NppStore {
  const [status, setStatus] = useState<NppStatus>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<NppPackPreview[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await window.pz.npp.status())
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const locate = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await window.pz.npp.locate())
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const install = useCallback(async () => {
    setBusy(true)
    try {
      const done = await window.pz.npp.install()
      setStatus(await window.pz.npp.status())
      setError(undefined)
      return { written: done.written.length, bytes: done.bytes }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  const loadPreview = useCallback(async () => {
    if (preview.length > 0) {
      setPreview([])
      return
    }
    try {
      setPreview(await window.pz.npp.preview())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [preview.length])

  const missing = useMemo(() => (status ? status.files.every((f) => !f.installed) : false), [status])
  const stale = useMemo(
    () => (status ? status.files.some((f) => f.installed && !f.current) : false),
    [status]
  )

  return useMemo(
    () => ({
      status,
      loading,
      busy,
      error,
      refresh,
      locate,
      install,
      preview,
      loadPreview,
      missing,
      stale
    }),
    [status, loading, busy, error, refresh, locate, install, preview, loadPreview, missing, stale]
  )
}
