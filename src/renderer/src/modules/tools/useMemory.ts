import { useCallback, useEffect, useState } from 'react'
import type {
  ApplyMemoryRequest,
  ApplyMemoryResult,
  MemoryReport,
  SetEnvOptionsResult,
  ToggleReadOnlyRequest,
  ToggleReadOnlyResult
} from '../../../../shared/types'

export interface MemoryStore {
  report: MemoryReport | null
  loading: boolean
  busy: boolean
  error: string | undefined
  selectedXmxMb: number
  setSelectedXmxMb: (mb: number) => void
  targetJson: boolean
  setTargetJson: (v: boolean) => void
  targetBat: boolean
  setTargetBat: (v: boolean) => void
  targetServerBat: boolean
  setTargetServerBat: (v: boolean) => void
  protectReadOnly: boolean
  setProtectReadOnly: (v: boolean) => void
  refresh: () => Promise<void>
  apply: () => Promise<ApplyMemoryResult | undefined>
  setEnv: (val: string | null) => Promise<SetEnvOptionsResult | undefined>
  toggleReadOnly: (readOnly: boolean) => Promise<ToggleReadOnlyResult | undefined>
}

export function useMemory(): MemoryStore {
  const [report, setReport] = useState<MemoryReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const [selectedXmxMb, setSelectedXmxMb] = useState<number>(8192)
  const [targetJson, setTargetJson] = useState(true)
  const [targetBat, setTargetBat] = useState(true)
  const [targetServerBat, setTargetServerBat] = useState(true)
  const [protectReadOnly, setProtectReadOnly] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const rep = await window.pz.memory.report()
      setReport(rep)
      if (rep.clientJson?.xmxMb && rep.clientJson.xmxMb > 0) {
        setSelectedXmxMb(rep.clientJson.xmxMb)
      } else if (rep.clientBat?.xmxMb && rep.clientBat.xmxMb > 0) {
        setSelectedXmxMb(rep.clientBat.xmxMb)
      } else if (rep.lastSession?.jvmMaxMb && rep.lastSession.jvmMaxMb > 0) {
        setSelectedXmxMb(rep.lastSession.jvmMaxMb)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const apply = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const req: ApplyMemoryRequest = {
        targetJson,
        targetBat,
        targetServerBat,
        xmxMb: selectedXmxMb,
        protectReadOnly
      }
      const res = await window.pz.memory.apply(req)
      if (!res.ok) {
        setError(res.error ?? 'Failed to apply memory settings')
      }
      // Re-read report to reflect changes
      const rep = await window.pz.memory.report()
      setReport(rep)
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [targetJson, targetBat, targetServerBat, selectedXmxMb, protectReadOnly])

  const setEnv = useCallback(async (val: string | null) => {
    setBusy(true)
    setError(undefined)
    try {
      const res = await window.pz.memory.setEnv(val)
      if (!res.ok) {
        setError(res.error ?? 'Failed to update environment variable')
      }
      const rep = await window.pz.memory.report()
      setReport(rep)
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  const toggleReadOnly = useCallback(
    async (readOnly: boolean) => {
      setBusy(true)
      setError(undefined)
      try {
        const req: ToggleReadOnlyRequest = {
          targetJson,
          targetBat,
          targetServerBat,
          readOnly
        }
        const res = await window.pz.memory.setReadOnly(req)
        if (!res.ok) {
          setError(res.error ?? 'Failed to update file attributes')
        }
        const rep = await window.pz.memory.report()
        setReport(rep)
        return res
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [targetJson, targetBat, targetServerBat]
  )

  return {
    report,
    loading,
    busy,
    error,
    selectedXmxMb,
    setSelectedXmxMb,
    targetJson,
    setTargetJson,
    targetBat,
    setTargetBat,
    targetServerBat,
    setTargetServerBat,
    protectReadOnly,
    setProtectReadOnly,
    refresh,
    apply,
    setEnv,
    toggleReadOnly
  }
}
