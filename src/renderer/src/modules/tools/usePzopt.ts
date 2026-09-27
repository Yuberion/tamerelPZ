import { useCallback, useEffect, useState } from 'react'
import type { PzoptCheckUpdateResult, PzoptStatus } from '@shared/types'

export interface PzoptStore {
  status: PzoptStatus | undefined
  loading: boolean
  busy: boolean
  error: string | undefined
  configText: string
  configDirty: boolean
  updateInfo: PzoptCheckUpdateResult | undefined
  refresh(): Promise<void>
  checkUpdate(): Promise<PzoptCheckUpdateResult | undefined>
  downloadToProgram(): Promise<boolean>
  applyToGame(): Promise<boolean>
  removeFromGame(): Promise<boolean>
  saveConfig(): Promise<boolean>
  setConfigText(text: string): void
}

export function usePzopt(): PzoptStore {
  const [status, setStatus] = useState<PzoptStatus>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [configText, setConfigTextState] = useState('')
  const [configDirty, setConfigDirty] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<PzoptCheckUpdateResult>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.pz.pzopt.status()
      setStatus(res)
      setConfigTextState(res.propertiesContent ?? '')
      setConfigDirty(false)
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

  const checkUpdate = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.pz.pzopt.checkUpdate()
      setUpdateInfo(res)
      setError(undefined)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  const downloadToProgram = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.pz.pzopt.downloadToProgram()
      if (!res.ok) {
        setError(res.error ?? 'Download failed')
        return false
      }
      await refresh()
      // Re-check update to clear outdated notice
      const updateRes = await window.pz.pzopt.checkUpdate()
      setUpdateInfo(updateRes)
      setError(undefined)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const applyToGame = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.pz.pzopt.applyToGame()
      if (!res.ok) {
        setError(res.error ?? 'Applying optimizations failed')
        return false
      }
      await refresh()
      setError(undefined)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const removeFromGame = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.pz.pzopt.removeFromGame()
      if (!res.ok) {
        setError(res.error ?? 'Removing optimizations failed')
        return false
      }
      await refresh()
      setError(undefined)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const saveConfig = useCallback(async () => {
    setBusy(true)
    try {
      await window.pz.pzopt.writeConfig(configText)
      setConfigDirty(false)
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [configText, refresh])

  const setConfigText = useCallback((text: string) => {
    setConfigTextState(text)
    setConfigDirty(true)
  }, [])

  return {
    status,
    loading,
    busy,
    error,
    configText,
    configDirty,
    updateInfo,
    refresh,
    checkUpdate,
    downloadToProgram,
    applyToGame,
    removeFromGame,
    saveConfig,
    setConfigText
  }
}
