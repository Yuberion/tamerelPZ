import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConvertProgress,
  ConvertResult,
  FbxEncoding,
  ForgeInput,
  ForgeOutputMode
} from '@shared/types'

/**
 * Data plumbing for the FBX forge.
 *
 * The queue is deliberately *not* derived from anything: main hands back a
 * classified `ForgeInput` for each file the user picked, and that record is the
 * only proof the renderer has that a path may be converted. Re-deriving it from
 * a path string would be re-deriving permission, so the list is kept verbatim
 * and only ever grows through `add`.
 *
 * Options live in localStorage rather than settings: they are per-machine
 * preferences with no security weight. The output *directory* is the exception —
 * it lives in main's settings because it is a path, and paths only become
 * writable by passing through a native dialog.
 */

const LS_OPTIONS = 'pz.tools.forge'

export interface ForgeOptions {
  encoding: FbxEncoding
  /** Kept as text so a half-typed number does not reset the field. */
  scaleText: string
  outputMode: ForgeOutputMode
  yUp: boolean
  rebuildNormals: boolean
  weld: boolean
  embed: boolean
  verify: boolean
  overwrite: boolean
}

const DEFAULTS: ForgeOptions = {
  encoding: 'binary',
  scaleText: '1',
  outputMode: 'beside',
  yUp: false,
  rebuildNormals: true,
  weld: false,
  embed: true,
  verify: true,
  overwrite: false
}

function readOptions(): ForgeOptions {
  try {
    const raw = localStorage.getItem(LS_OPTIONS)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ForgeOptions>) }
  } catch {
    return DEFAULTS
  }
}

export function parseScale(text: string): number | undefined {
  const value = Number(text.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return undefined
  return value
}

export interface ForgeStore {
  inputs: ForgeInput[]
  options: ForgeOptions
  setOptions(patch: Partial<ForgeOptions>): void
  outputDir: string | undefined
  add(): Promise<void>
  remove(path: string): void
  clear(): void
  pickOutput(): Promise<void>
  run(): Promise<void>
  cancel(): Promise<void>
  busy: boolean
  progress: ConvertProgress | undefined
  result: ConvertResult | undefined
  error: string | undefined
  /** Inputs the forge can actually parse; the rest convert as capsules. */
  convertible: number
}

export function useForge(): ForgeStore {
  const [inputs, setInputs] = useState<ForgeInput[]>([])
  const [options, setOptionsState] = useState<ForgeOptions>(readOptions)
  const [outputDir, setOutputDir] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ConvertProgress>()
  const [result, setResult] = useState<ConvertResult>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void window.pz.settings.get().then((s) => setOutputDir(s.toolsOutputDir))
  }, [])

  useEffect(() => {
    const off = window.pz.tools.onProgress((p) => setProgress(p.phase === 'done' ? undefined : p))
    return off
  }, [])

  const setOptions = useCallback((patch: Partial<ForgeOptions>) => {
    setOptionsState((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(LS_OPTIONS, JSON.stringify(next))
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }, [])

  const add = useCallback(async () => {
    try {
      const picked = await window.pz.tools.pick()
      if (picked.length === 0) return
      setInputs((prev) => {
        const seen = new Set(prev.map((i) => i.path.toLowerCase()))
        return [...prev, ...picked.filter((i) => !seen.has(i.path.toLowerCase()))]
      })
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const remove = useCallback((path: string) => {
    setInputs((prev) => prev.filter((i) => i.path !== path))
  }, [])

  const clear = useCallback(() => {
    setInputs([])
    setResult(undefined)
  }, [])

  const pickOutput = useCallback(async () => {
    const picked = await window.pz.tools.pickOutput()
    if (!picked) return
    setOutputDir(picked)
    setOptions({ outputMode: 'custom' })
  }, [setOptions])

  const run = useCallback(async () => {
    const scale = parseScale(options.scaleText)
    if (inputs.length === 0 || scale === undefined) return
    setBusy(true)
    setResult(undefined)
    setError(undefined)
    try {
      const outcome = await window.pz.tools.convert({
        inputs: inputs.map((i) => i.path),
        outputMode: options.outputMode,
        encoding: options.encoding,
        scale,
        yUp: options.yUp,
        rebuildNormals: options.rebuildNormals,
        weld: options.weld,
        embed: options.embed,
        verify: options.verify,
        overwrite: options.overwrite
      })
      setResult(outcome)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }, [inputs, options])

  const cancel = useCallback(async () => {
    await window.pz.tools.cancel()
  }, [])

  const convertible = useMemo(
    () => inputs.filter((i) => i.supported && i.kind !== 'capsule').length,
    [inputs]
  )

  return useMemo(
    () => ({
      inputs,
      options,
      setOptions,
      outputDir,
      add,
      remove,
      clear,
      pickOutput,
      run,
      cancel,
      busy,
      progress,
      result,
      error,
      convertible
    }),
    [
      inputs,
      options,
      setOptions,
      outputDir,
      add,
      remove,
      clear,
      pickOutput,
      run,
      cancel,
      busy,
      progress,
      result,
      error,
      convertible
    ]
  )
}
