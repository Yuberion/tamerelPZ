import { basename, join } from 'node:path'
import type {
  AppSettings,
  ModEntry,
  ModSource,
  ModVersionFolder,
  ModWarning,
  ScanIssues,
  ScanProgress,
  ScanResult
} from '../../shared/types'
import { detectCategories, type ModEvidence } from './detect'
import { dirNameSet, exists, isDir, mtimeOf, pLimit, readTextSafe, readdirSafe } from './fsx'
import { csv, first, normaliseModId, parseModInfo, type ModInfoFields } from './modinfo'
import { buildSources } from './paths'

/** `common`, `42`, `42.20`, `41.78` ... */
const VERSION_DIR_RE = /^(?:common|4[0-9](?:\.\d+)*)$/i

const POSTER_FALLBACKS = ['poster.png', 'preview.png', 'thumbnail.png', 'generic.png', 'poster.jpg']
const ICON_FALLBACKS = ['icon.png', 'logo.png', 'logo_mini.png', 'icon.jpg']

interface Candidate {
  path: string
  source: ModSource
  workshopId?: string
}

/** Ordering weight for build sub-folders: highest wins when picking mod.info. */
function versionWeight(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'common') return 1
  const parts = lower.split('.')
  const major = Number.parseInt(parts[0] ?? '0', 10)
  const minor = Number.parseInt(parts[1] ?? '0', 10)
  if (!Number.isFinite(major)) return 0
  return major * 1000 + (Number.isFinite(minor) ? minor : 0)
}

/** Locate the mod folders inside one container, honouring each layout. */
async function enumerateCandidates(source: ModSource): Promise<Candidate[]> {
  const out: Candidate[] = []
  if (!source.exists) return out

  const topLevel = (await readdirSafe(source.path)).filter((e) => e.isDirectory())

  if (source.kind === 'workshop') {
    const lim = pLimit(32)
    await Promise.all(
      topLevel.map((item) =>
        lim(async () => {
          const itemPath = join(source.path, item.name)
          for (const rel of ['mods', join('Contents', 'mods')]) {
            const modsDir = join(itemPath, rel)
            const mods = (await readdirSafe(modsDir)).filter((e) => e.isDirectory())
            if (!mods.length) continue
            for (const m of mods) {
              out.push({ path: join(modsDir, m.name), source, workshopId: item.name })
            }
            break
          }
        })
      )
    )
    return out
  }

  if (source.kind === 'project') {
    const lim = pLimit(32)
    await Promise.all(
      topLevel.map((proj) =>
        lim(async () => {
          const projPath = join(source.path, proj.name)
          for (const rel of [join('Contents', 'mods'), 'mods']) {
            const modsDir = join(projPath, rel)
            const mods = (await readdirSafe(modsDir)).filter((e) => e.isDirectory())
            if (!mods.length) continue
            for (const m of mods) out.push({ path: join(modsDir, m.name), source })
            break
          }
        })
      )
    )
    return out
  }

  for (const d of topLevel) out.push({ path: join(source.path, d.name), source })
  return out
}

/** First existing file among `names`, searched across `dirs`. */
async function resolveAsset(dirs: string[], names: string[]): Promise<string | undefined> {
  for (const dir of dirs) {
    for (const name of names) {
      if (!name) continue
      const p = join(dir, name)
      if (await exists(p)) return p
    }
  }
  return undefined
}

/** Shallow listing of `media/scripts` (two levels) for classification. */
async function collectScriptNames(mediaDirs: string[]): Promise<string[]> {
  const names: string[] = []
  for (const media of mediaDirs) {
    const scriptsDir = join(media, 'scripts')
    for (const e of await readdirSafe(scriptsDir)) {
      names.push(e.name.toLowerCase())
      if (e.isDirectory() && names.length < 300) {
        for (const sub of await readdirSafe(join(scriptsDir, e.name))) {
          names.push(sub.name.toLowerCase())
          if (names.length >= 300) break
        }
      }
      if (names.length >= 300) break
    }
  }
  return names
}

/** Read a single mod folder into a `ModEntry`. */
async function analyzeMod(c: Candidate): Promise<ModEntry | undefined> {
  const entries = await readdirSafe(c.path)
  if (!entries.length) return undefined

  const folderName = basename(c.path)
  const warnings: ModWarning[] = []
  const names = new Map(entries.map((e) => [e.name.toLowerCase(), e]))

  // --- build sub-folders (B42 layout) -------------------------------------
  const versionFolders: ModVersionFolder[] = []
  for (const e of entries) {
    if (!e.isDirectory() || !VERSION_DIR_RE.test(e.name)) continue
    const p = join(c.path, e.name)
    versionFolders.push({
      name: e.name,
      path: p,
      hasModInfo: await exists(join(p, 'mod.info')),
      weight: versionWeight(e.name)
    })
  }
  versionFolders.sort((a, b) => b.weight - a.weight)

  const hasRootInfo = names.has('mod.info')
  const hasRootMedia = names.has('media')
  const isModFolder = hasRootInfo || hasRootMedia || versionFolders.length > 0
  if (!isModFolder) return undefined

  // --- pick the most relevant mod.info -----------------------------------
  const infoDirs: string[] = []
  const bestVersioned = versionFolders.find((v) => v.hasModInfo)
  if (bestVersioned) infoDirs.push(bestVersioned.path)
  if (hasRootInfo) infoDirs.push(c.path)
  for (const v of versionFolders) if (v.hasModInfo && v.path !== bestVersioned?.path) infoDirs.push(v.path)

  let fields: ModInfoFields = {}
  let infoFile: string | undefined
  for (const dir of infoDirs) {
    const file = join(dir, 'mod.info')
    const text = await readTextSafe(file, 64 * 1024)
    if (!text) continue
    const parsed = parseModInfo(text)
    if (Object.keys(parsed).length) {
      fields = parsed
      infoFile = file
      break
    }
  }
  if (!infoFile) warnings.push('no-modinfo')

  // --- media evidence ----------------------------------------------------
  const mediaRoots: string[] = []
  if (hasRootMedia) mediaRoots.push(join(c.path, 'media'))
  for (const v of versionFolders) {
    const m = join(v.path, 'media')
    if (await isDir(m)) mediaRoots.push(m)
  }

  const mediaDirSet = new Set<string>()
  const luaDirSet = new Set<string>()
  let hasTranslate = false
  for (const media of mediaRoots) {
    for (const n of await dirNameSet(media)) mediaDirSet.add(n)
    for (const n of await dirNameSet(join(media, 'lua'))) luaDirSet.add(n)
    if (!hasTranslate) hasTranslate = await isDir(join(media, 'lua', 'shared', 'Translate'))
  }

  const scriptNames = mediaDirSet.has('scripts') ? await collectScriptNames(mediaRoots) : []

  // --- metadata ----------------------------------------------------------
  const rawModId = first(fields, 'id')
  const modId = normaliseModId(rawModId)
  const tags = csv(fields, 'tags', 'category')
  const name = first(fields, 'name') ?? folderName
  const requires = csv(fields, 'require', 'requires').map((r) => normaliseModId(r) ?? r)
  const loadAfter = csv(fields, 'loadafter', 'loadmodafter').map((r) => normaliseModId(r) ?? r)
  const loadBefore = csv(fields, 'loadbefore', 'loadmodbefore').map((r) => normaliseModId(r) ?? r)
  const incompatible = csv(fields, 'incompatible', 'incompatiblemods').map((r) => normaliseModId(r) ?? r)
  const declaredCategory = first(fields, 'category')

  const evidence: ModEvidence = {
    mediaDirs: mediaDirSet,
    luaDirs: luaDirSet,
    hasTranslate,
    scriptNames,
    tags,
    name,
    modId,
    hasTiledef: Boolean(fields['tiledef']?.length),
    hasPack: Boolean(fields['pack']?.length)
  }
  const categories = detectCategories(evidence)

  // --- build support -----------------------------------------------------
  const builds = new Set<string>()
  for (const v of versionFolders) {
    if (/^41/.test(v.name)) builds.add('B41')
    else if (/^42/.test(v.name)) builds.add('B42')
    else if (v.name.toLowerCase() === 'common') builds.add('B42')
  }
  if (!versionFolders.length && (hasRootMedia || hasRootInfo)) builds.add('B41')
  const pzVersion = first(fields, 'pzversion', 'versionmin')
  if (pzVersion?.startsWith('42')) builds.add('B42')
  if (pzVersion?.startsWith('41')) builds.add('B41')

  // --- artwork -----------------------------------------------------------
  const assetDirs = [
    ...(infoFile ? [join(infoFile, '..')] : []),
    c.path,
    ...versionFolders.map((v) => v.path)
  ]
  const posterNames = [...(fields['poster'] ?? []), ...POSTER_FALLBACKS]
  const iconNames = [...(fields['icon'] ?? []), ...ICON_FALLBACKS]
  const posterPath = await resolveAsset(assetDirs, posterNames)
  const iconPath = await resolveAsset(assetDirs, iconNames)

  if (infoFile && !modId) warnings.push('no-id')
  if (fields['poster']?.length && !posterPath) warnings.push('poster-missing')

  return {
    key: `${c.source.id}::${c.path}`,
    folderName,
    path: c.path,
    sourceId: c.source.id,
    sourceKind: c.source.kind,
    workshopId: c.workshopId,
    name,
    modId,
    rawModId,
    description: first(fields, 'description'),
    authors: first(fields, 'authors', 'author'),
    url: first(fields, 'url'),
    modVersion: first(fields, 'modversion', 'version'),
    pzVersion,
    posterPath,
    iconPath,
    requires,
    loadAfter,
    loadBefore,
    incompatible,
    declaredCategory,
    tags,
    categories,
    builds: [...builds].sort(),
    versionFolders,
    mediaDirs: [...mediaDirSet].sort(),
    infoFile,
    hasInfo: Boolean(infoFile),
    mtime: await mtimeOf(c.path),
    warnings
  }
}

/** Cross-mod analysis: duplicate ids, unresolved `require=` entries. */
function analyseIssues(mods: ModEntry[]): ScanIssues {
  const byId = new Map<string, string[]>()
  for (const m of mods) {
    if (!m.modId) continue
    const list = byId.get(m.modId) ?? []
    list.push(m.key)
    byId.set(m.modId, list)
  }

  const duplicateIds: Record<string, string[]> = {}
  for (const [id, keys] of byId) if (keys.length > 1) duplicateIds[id] = keys

  const known = new Set(byId.keys())
  const missingRequires: Record<string, string[]> = {}
  for (const m of mods) {
    const missing = m.requires.filter((r) => r && !known.has(r))
    if (missing.length) missingRequires[m.key] = missing
  }

  return {
    duplicateIds,
    missingRequires,
    missingInfo: mods.filter((m) => !m.hasInfo).map((m) => m.key)
  }
}

/** In-memory cache so repeat scans in one session are near-instant. */
const cache = new Map<string, { mtime: number; entry: ModEntry }>()

export interface ScanOptions {
  force?: boolean
  sourceIds?: string[]
}

export async function scanMods(
  settings: AppSettings,
  opts: ScanOptions,
  onProgress: (p: ScanProgress) => void
): Promise<ScanResult> {
  const started = Date.now()
  onProgress({ phase: 'sources', done: 0, total: 0, label: 'Locating mod containers' })

  const sources = await buildSources(settings)
  const wanted = new Set(opts.sourceIds ?? [])
  const active = sources.filter(
    (s) => s.exists && s.enabled && (wanted.size === 0 || wanted.has(s.id))
  )

  onProgress({ phase: 'enumerate', done: 0, total: active.length, label: 'Enumerating mod folders' })
  const candidates: Candidate[] = []
  let doneSources = 0
  for (const s of active) {
    candidates.push(...(await enumerateCandidates(s)))
    doneSources++
    onProgress({
      phase: 'enumerate',
      done: doneSources,
      total: active.length,
      label: `Enumerating ${s.label}`
    })
  }

  if (opts.force) cache.clear()

  const lim = pLimit(28)
  const mods: ModEntry[] = []
  let done = 0
  let fromCache = 0
  const total = candidates.length

  await Promise.all(
    candidates.map((c) =>
      lim(async () => {
        try {
          const mtime = await mtimeOf(c.path)
          const hit = cache.get(c.path)
          if (hit && hit.mtime === mtime && mtime > 0) {
            mods.push(hit.entry)
            fromCache++
          } else {
            const entry = await analyzeMod(c)
            if (entry) {
              mods.push(entry)
              if (mtime > 0) cache.set(c.path, { mtime, entry })
            }
          }
        } catch {
          /* a single unreadable mod must not abort the scan */
        }
        done++
        if (done % 25 === 0 || done === total) {
          onProgress({ phase: 'analyze', done, total, label: 'Reading mod metadata' })
        }
      })
    )
  )

  const counts = new Map<string, number>()
  for (const m of mods) counts.set(m.sourceId, (counts.get(m.sourceId) ?? 0) + 1)
  for (const s of sources) s.modCount = counts.get(s.id) ?? 0

  mods.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

  onProgress({ phase: 'done', done: total, total, label: 'Scan complete' })

  return {
    sources,
    mods,
    issues: analyseIssues(mods),
    scannedAt: Date.now(),
    durationMs: Date.now() - started,
    fromCache
  }
}

export function getCachedMods(): ModEntry[] {
  return Array.from(cache.values()).map((v) => v.entry)
}
