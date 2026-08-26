/**
 * Workbench batch pack service ("POWER_SHOVE"): pack many mods in one run.
 *
 * Purely additive — it reuses the single-mod engine verbatim per item:
 * `packMod`, `collectFiles`, `defaultOutputDir`, `assertSafeName`,
 * `assertPathWritable` and the optional `validateMod` gate. Nothing here forks
 * packing logic, and the single-mod `PackTool` is untouched.
 *
 * The loop is deliberately sequential: `buildZip` assembles archives in memory,
 * so running N zips concurrently would risk unbounded heap growth. Sequential
 * keeps peak memory ≈ one mod's zip and makes progress monotonic and
 * cancellable at item boundaries.
 */
import type {
  AppSettings,
  BatchPackItem,
  BatchPackItemResult,
  BatchPackRequest,
  BatchPackResult,
  WorkbenchProgress
} from '../../shared/types'
import { assertPathWritable } from './guard'
import { defaultOutputDir, packMod } from './pack'
import { validateMod } from './validate'

export interface ShoveOptions {
  request: BatchPackRequest
  settings: AppSettings
  onProgress: (p: WorkbenchProgress) => void
  /** When this flips true the loop stops after the current item finishes. */
  isCancelled?: () => boolean
}

type Progress = (p: WorkbenchProgress) => void

/** Mirrors the single-mod default: `<modId | folderName>` sanitised. */
function sanitize(base: string): string {
  const cleaned = base.replace(/[^A-Za-z0-9._+-]+/g, '')
  return cleaned || 'Mod'
}

/** Tag every inner progress event with the current item context. */
function tagItem(
  onProgress: Progress,
  itemIndex: number,
  itemCount: number,
  itemLabel: string
): Progress {
  return (p) =>
    onProgress({
      ...p,
      itemIndex,
      itemCount,
      itemLabel
    })
}

interface PlanEntry {
  item: BatchPackItem
  outputName: string
  /** True when an earlier item already claimed this sanitised output name. */
  collision?: boolean
}

export async function shovelMods(opts: ShoveOptions): Promise<BatchPackResult> {
  const started = Date.now()
  const { request, settings, onProgress, isCancelled } = opts
  const count = request.items.length

  // 1. Resolve the shared output container and prove it is writable once, up
  //    front. An unwritable destination aborts the whole run before touching
  //    any item — the plan's one unrecoverable preflight condition.
  const outputDir = await assertPathWritable(
    request.outputDir ?? (await defaultOutputDir(settings))
  )

  // 2. Pre-compute sanitised output names and detect collisions up front.
  //    First occurrence wins; duplicates are marked skip and never attempted.
  //    The pipeline never auto-renames.
  const seen = new Set<string>()
  const plan: PlanEntry[] = []
  for (const item of request.items) {
    const outputName = sanitize(item.label)
    const key = outputName.toLowerCase()
    if (seen.has(key)) {
      plan.push({ item, outputName, collision: true })
    } else {
      seen.add(key)
      plan.push({ item, outputName })
    }
  }

  const results: BatchPackItemResult[] = []
  let ok = 0
  let errors = 0
  let skipped = 0
  let cancelled = false

  // 3. Sequential loop over the items.
  for (let i = 0; i < count; i++) {
    const entry = plan[i]!
    const itemIndex = i
    const itemLabel = entry.item.label
    const inner = tagItem(onProgress, itemIndex, count, itemLabel)

    // Cancellation is only checked at item boundaries.
    if (isCancelled?.()) {
      cancelled = true
      for (let j = i; j < count; j++) {
        results.push({
          modPath: plan[j]!.item.modPath,
          label: plan[j]!.item.label,
          status: 'cancel',
          reason: 'cancelled'
        })
      }
      break
    }

    if (entry.collision) {
      skipped++
      results.push({
        modPath: entry.item.modPath,
        label: itemLabel,
        status: 'skip',
        reason: 'collision',
        message: entry.outputName
      })
      continue
    }

    // Optional validation gate. Off by default; when on, blocked items are
    // skipped and the rest still pack.
    if (request.validation !== 'none') {
      const report = await validateMod(
        entry.item.modPath,
        { knownIds: request.knownIds },
        inner
      )
      const hasError = report.issues.some((iss) => iss.severity === 'error')
      const hasWarn = report.issues.some((iss) => iss.severity === 'warn')
      const block =
        request.validation === 'strict' ? hasError || hasWarn : hasError
      if (block) {
        skipped++
        results.push({
          modPath: entry.item.modPath,
          label: itemLabel,
          status: 'skip',
          reason: hasError ? 'validation-error' : 'validation-warn'
        })
        continue
      }
    }

    onProgress({
      task: 'batch-pack',
      phase: 'collect',
      done: 0,
      total: 0,
      label: '',
      itemIndex,
      itemCount: count,
      itemLabel
    })

    try {
      const result = await packMod(
        settings,
        {
          modPath: entry.item.modPath,
          mode: request.mode,
          builds: request.builds,
          outputName: entry.outputName,
          outputDir,
          exclude: request.exclude,
          preview: request.preview,
          workshop: request.workshop
        },
        inner
      )
      ok++
      results.push({
        modPath: entry.item.modPath,
        label: itemLabel,
        status: 'ok',
        output: result.output,
        result
      })
    } catch (e) {
      errors++
      results.push({
        modPath: entry.item.modPath,
        label: itemLabel,
        status: 'error',
        reason: 'pack-failed',
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // 4. Aggregate.
  return {
    mode: request.mode,
    outputDir,
    startedAt: started,
    durationMs: Date.now() - started,
    cancelled,
    ok,
    errors,
    skipped,
    items: results
  }
}