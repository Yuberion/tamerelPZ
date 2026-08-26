import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogReadResult, LogSource } from '@shared/types'

/**
 * Data plumbing for the Ledger module.
 *
 * Two independent async lifetimes, so they get two independent race guards: the
 * list of sources (cheap, refreshed on demand) and the tail of the selected one
 * (expensive, re-read on every selection change). A slow read of the file the
 * user just navigated away from must never overwrite the pane, and PZ appends to
 * `console.txt` while the game runs, so re-reads are the normal case, not an
 * edge case.
 */

export interface LogStore {
  sources: LogSource[]
  sourceId: string
  source: LogSource | undefined
  select(id: string): void
  content: LogReadResult | undefined
  /** Enumerating the sources. */
  loading: boolean
  /** Reading the selected source. */
  reading: boolean
  error: string | undefined
  /** Re-enumerate and re-read the current selection (F5). */
  reload(): Promise<void>
}

function preferredId(sources: LogSource[], previous: string): string {
  if (previous && sources.some((s) => s.id === previous)) return previous
  // console.txt is the live session, which is what you want after a crash.
  const live = sources.find((s) => s.kind === 'console')
  return live?.id ?? sources[0]?.id ?? ''
}

export function useLogs(): LogStore {
  const [sources, setSources] = useState<LogSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [content, setContent] = useState<LogReadResult>()
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string>()

  const listRun = useRef(0)
  const readRun = useRef(0)
  /** Bumped by `reload` so the read effect re-runs for an unchanged selection. */
  const [readNonce, setReadNonce] = useState(0)

  const list = useCallback(async (): Promise<void> => {
    const run = ++listRun.current
    setLoading(true)
    try {
      const found = await window.pz.logs.list()
      if (run !== listRun.current) return
      setSources(found)
      setSourceId((prev) => preferredId(found, prev))
      setError(undefined)
    } catch (e) {
      if (run !== listRun.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (run === listRun.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void list()
  }, [list])

  useEffect(() => {
    if (!sourceId) {
      setContent(undefined)
      return
    }
    const run = ++readRun.current
    setReading(true)
    void (async () => {
      try {
        const read = await window.pz.logs.read(sourceId)
        if (run !== readRun.current) return
        setContent(read)
        setError(undefined)
      } catch (e) {
        if (run !== readRun.current) return
        setContent(undefined)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (run === readRun.current) setReading(false)
      }
    })()
  }, [sourceId, readNonce])

  const reload = useCallback(async (): Promise<void> => {
    await list()
    setReadNonce((n) => n + 1)
  }, [list])

  const source = useMemo(() => sources.find((s) => s.id === sourceId), [sources, sourceId])

  return useMemo(
    () => ({
      sources,
      sourceId,
      source,
      select: setSourceId,
      content,
      loading,
      reading,
      error,
      reload
    }),
    [sources, sourceId, source, content, loading, reading, error, reload]
  )
}
