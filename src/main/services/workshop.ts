import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import type {
  AppSettings,
  WorkshopDownloadResult,
  WorkshopItemDetails,
  WorkshopItemSummary,
  WorkshopSearchQuery,
  WorkshopSearchResult,
  WorkshopSyncResult
} from '../../shared/types'
import { pzFileUrl } from '../../shared/ipc'
import { PZ_APP_ID, detectPaths } from './paths'
import { getSteamSubscribedIds } from './steamworks'

/** Simple BBCode to HTML converter for Steam workshop descriptions */
export function bbcodeToHtml(bb: string): string {
  if (!bb) return ''
  let html = bb
    // Escape standard HTML tags first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h3 class="ws-h1">$1</h3>')
    .replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h4 class="ws-h2">$1</h4>')
    .replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h5 class="ws-h3">$1</h5>')
    // Bold, Italic, Underline, Strike
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span style="text-decoration: underline;">$1</span>')
    .replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi, '<del>$1</del>')
    // Images
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1" class="ws-desc-img" alt="image" loading="lazy" />')
    // Links
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noreferrer" class="ws-link">$2</a>')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noreferrer" class="ws-link">$1</a>')
    // Lists
    .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, '<ul class="ws-list">$1</ul>')
    .replace(/\[\*\]([^\n\r]*)/gi, '<li>$1</li>')
    // Linebreaks
    .replace(/\r?\n/g, '<br />')

  return html
}

export interface RawSteamItemDetail {
  publishedfileid: string
  result: number
  creator?: string
  creator_app_id?: number
  consumer_app_id?: number
  file_size?: string | number
  preview_url?: string
  title?: string
  description?: string
  time_created?: number
  time_updated?: number
  visibility?: number
  banned?: number
  subscriptions?: number
  favorited?: number
  views?: number
  tags?: Array<{ tag: string }>
}

/* =========================================================================
   In-Memory & Disk Metadata Cache
   ========================================================================= */

const steamMetadataCache = new Map<string, RawSteamItemDetail>()
let metadataCacheLoaded = false
let metadataSaveTimer: NodeJS.Timeout | null = null

function getCacheFilePath(): string {
  try {
    return join(app.getPath('userData'), 'workshop_metadata_cache.json')
  } catch {
    return join(process.cwd(), 'workshop_metadata_cache.json')
  }
}

async function loadMetadataCache(): Promise<void> {
  if (metadataCacheLoaded) return
  metadataCacheLoaded = true
  const filePath = getCacheFilePath()
  try {
    if (existsSync(filePath)) {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, RawSteamItemDetail>
      for (const [id, detail] of Object.entries(parsed)) {
        if (detail && detail.publishedfileid) {
          steamMetadataCache.set(id, detail)
        }
      }
    }
  } catch (err) {
    console.warn('[workshop] Failed to load disk metadata cache:', err)
  }
}

function queueSaveMetadataCache(): void {
  if (metadataSaveTimer) return
  metadataSaveTimer = setTimeout(async () => {
    metadataSaveTimer = null
    const filePath = getCacheFilePath()
    try {
      const obj: Record<string, RawSteamItemDetail> = {}
      for (const [id, detail] of steamMetadataCache.entries()) {
        obj[id] = detail
      }
      await fs.writeFile(filePath, JSON.stringify(obj), 'utf8')
    } catch (err) {
      console.warn('[workshop] Failed to write disk metadata cache:', err)
    }
  }, 2000)
}

/* =========================================================================
   Translation Cache & Service (Automatic Translation to Russian)
   ========================================================================= */

const translationsCache = new Map<string, string>()
let translationsLoaded = false

function getTranslationsFilePath(): string {
  try {
    return join(app.getPath('userData'), 'workshop_translations_cache.json')
  } catch {
    return join(process.cwd(), 'workshop_translations_cache.json')
  }
}

async function loadTranslationsCache(): Promise<void> {
  if (translationsLoaded) return
  translationsLoaded = true
  const fp = getTranslationsFilePath()
  try {
    if (existsSync(fp)) {
      const raw = await fs.readFile(fp, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(parsed)) {
        translationsCache.set(k, v)
      }
    }
  } catch {
    // ignore
  }
}

async function saveTranslationsCache(): Promise<void> {
  const fp = getTranslationsFilePath()
  try {
    const obj: Record<string, string> = {}
    for (const [k, v] of translationsCache.entries()) {
      obj[k] = v
    }
    await fs.writeFile(fp, JSON.stringify(obj), 'utf8')
  } catch {
    // ignore
  }
}

export async function translateModDescription(
  id: string,
  text: string,
  targetLang = 'ru',
  force = false
): Promise<string> {
  if (!text || !text.trim()) return ''

  await loadTranslationsCache()
  const cacheKey = `${id}:${targetLang}`
  if (!force && translationsCache.has(cacheKey)) {
    const cached = translationsCache.get(cacheKey)!
    // Ensure cached entry is a valid Russian translation with Cyrillic characters
    if ((cached.match(/[\u0400-\u04FF]/g) || []).length >= 10) {
      return cached
    }
    translationsCache.delete(cacheKey)
  }

  // If text already has substantial Russian characters (>25%), return as is
  const cyrillicMatches = text.match(/[\u0400-\u04FF]/g) || []
  if (cyrillicMatches.length > text.length * 0.25) {
    return text
  }

  // Chunk text into larger chunks <= 3000 characters for high-throughput single POST requests
  const paragraphs = text.split(/\r?\n/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if ((current + '\n' + para).length > 3000) {
      if (current) chunks.push(current)
      current = para
    } else {
      current = current ? current + '\n' + para : para
    }
  }
  if (current) chunks.push(current)

  const results: string[] = []
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      results.push('')
      continue
    }

    let translatedPart = ''
    let attempts = 0
    while (attempts < 3) {
      attempts++
      try {
        const body = new URLSearchParams()
        body.append('client', 'gtx')
        body.append('sl', 'auto')
        body.append('tl', targetLang)
        body.append('dt', 't')
        body.append('q', chunk)

        const res = await fetch('https://translate.googleapis.com/translate_a/single', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body
        })

        if (res.ok) {
          const data = (await res.json()) as [Array<[string]>]
          translatedPart = (data[0] || []).map((c) => c[0] || '').join('')
          if (translatedPart) break
        }
      } catch {
        // network error, retry
      }
      if (attempts < 3) {
        await new Promise((r) => setTimeout(r, 300 * attempts))
      }
    }

    if (!translatedPart) {
      console.warn(`[workshop] Failed to translate chunk for mod ${id}`)
      return ''
    }
    results.push(translatedPart)
  }

  const translatedFull = results.join('\n')
  const cyrillicCount = (translatedFull.match(/[\u0400-\u04FF]/g) || []).length
  if (cyrillicCount >= 10) {
    translationsCache.set(cacheKey, translatedFull)
    void saveTranslationsCache()
    return translatedFull
  }

  return ''
}

/* =========================================================================
   ACF Parser: Reads Steam's appworkshop_108600.acf
   ========================================================================= */

export interface AcfItemInfo {
  id: string
  size: number
  timeUpdated: number
  manifest?: string
}

export function parseWorkshopAcf(raw: string): Map<string, AcfItemInfo> {
  const result = new Map<string, AcfItemInfo>()
  // Matches "566115016" { "size" "2020" "timeupdated" "1449329703" ... }
  const re = /"(\d{5,12})"\s*\{[\s\S]*?"size"\s*"(\d+)"[\s\S]*?"timeupdated"\s*"(\d+)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    result.set(match[1], {
      id: match[1],
      size: Number(match[2]) || 0,
      timeUpdated: Number(match[3]) || 0
    })
  }
  return result
}

/* =========================================================================
   Local Installed Items Scanning
   ========================================================================= */

interface LocalModMeta {
  name: string
  id: string
  author: string
  tags: string[]
  posterRel?: string
  posterAbs?: string
}

function parseModInfoQuick(content: string, modFolder: string): LocalModMeta {
  const res: LocalModMeta = { name: '', id: '', author: '', tags: [] }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim().toLowerCase()
    const val = trimmed.slice(eq + 1).trim()
    if (key === 'name' && !res.name) res.name = val
    else if (key === 'id' && !res.id) res.id = val
    else if ((key === 'author' || key === 'authors') && !res.author) res.author = val
    else if (key === 'tags') {
      res.tags = val.split(';').map((t) => t.trim()).filter(Boolean)
    } else if (key === 'poster' && !res.posterRel) {
      res.posterRel = val
      const abs = join(modFolder, val)
      if (existsSync(abs)) res.posterAbs = abs
    }
  }
  return res
}

// In-memory cache for installed items
let cachedInstalledList: WorkshopItemSummary[] | null = null
let cachedInstalledMap = new Map<string, WorkshopItemSummary>()
let lastInstalledScanTime = 0

export async function scanAllInstalledWorkshopItems(
  settings: AppSettings,
  forceRefresh = false
): Promise<WorkshopItemSummary[]> {
  const now = Date.now()
  if (!forceRefresh && cachedInstalledList && now - lastInstalledScanTime < 15_000) {
    return cachedInstalledList
  }

  await loadMetadataCache()

  const pathsReport = await detectPaths(settings)
  const workshopDirs = pathsReport.workshopDirs ?? []

  const itemMap = new Map<string, WorkshopItemSummary>()
  const missingDetailIds: string[] = []

  for (const wsDir of workshopDirs) {
    // wsDir is ".../steamapps/workshop/content/108600"
    // The sibling ACF file is at ".../steamapps/workshop/appworkshop_108600.acf"
    const workshopParent = dirname(dirname(wsDir))
    const acfPath = join(workshopParent, `appworkshop_${PZ_APP_ID}.acf`)
    let acfMap = new Map<string, AcfItemInfo>()

    if (existsSync(acfPath)) {
      try {
        const rawAcf = await fs.readFile(acfPath, 'utf8')
        acfMap = parseWorkshopAcf(rawAcf)
      } catch (err) {
        console.warn(`[workshop] Failed reading ${acfPath}:`, err)
      }
    }

    // Read content/108600 subdirectories
    let entries: string[] = []
    try {
      entries = await fs.readdir(wsDir)
    } catch {
      continue
    }

    for (const id of entries) {
      if (!/^\d{5,12}$/.test(id)) continue
      const itemFolder = join(wsDir, id)
      let mtimeMs = 0
      try {
        const stat = await fs.stat(itemFolder)
        if (!stat.isDirectory()) continue
        mtimeMs = stat.mtimeMs
      } catch {
        continue
      }

      const acf = acfMap.get(id)
      const cachedSteam = steamMetadataCache.get(id)
      if (!cachedSteam) {
        missingDetailIds.push(id)
      }

      // Inspect local mod.info (including B42 sub-folders: common, 42, 42.20, etc.)
      let localName = ''
      let localAuthor = ''
      let localTags: string[] = []
      let posterPath: string | undefined

      const modsDir = join(itemFolder, 'mods')
      if (existsSync(modsDir)) {
        try {
          const submods = await fs.readdir(modsDir)
          for (const sub of submods) {
            const subDir = join(modsDir, sub)
            // Candidate paths for mod.info in standard and B42 versions
            const infoCandidates = [
              join(subDir, 'mod.info'),
              join(subDir, 'common', 'mod.info'),
              join(subDir, '42', 'mod.info'),
              join(subDir, '42.20', 'mod.info')
            ]
            for (const candidate of infoCandidates) {
              if (existsSync(candidate)) {
                try {
                  const infoText = await fs.readFile(candidate, 'utf8')
                  const parsed = parseModInfoQuick(infoText, dirname(candidate))
                  if (parsed.name && !localName) localName = parsed.name
                  if (parsed.author && !localAuthor) localAuthor = parsed.author
                  if (parsed.tags.length) localTags = parsed.tags
                  if (parsed.posterAbs && !posterPath) posterPath = parsed.posterAbs
                } catch {
                  // ignore
                }
              }
            }
            if (localName) break
          }
        } catch {
          // ignore
        }
      }

      // Combine tags: Steam official tags take priority, fallback to local mod.info tags
      const steamTags = cachedSteam?.tags?.map((t) => t.tag) || []
      const combinedTags = Array.from(new Set([...steamTags, ...localTags]))

      const updatedSec = cachedSteam?.time_updated || acf?.timeUpdated || Math.floor(mtimeMs / 1000)
      const acfUpdatedSec = acf?.timeUpdated || Math.floor(mtimeMs / 1000)

      // Needs update only if Steam time is newer than local ACF time by > 60 seconds
      const needsUpdate = Boolean(
        cachedSteam?.time_updated &&
        acfUpdatedSec > 0 &&
        cachedSteam.time_updated > acfUpdatedSec + 60
      )

      let previewUrl = cachedSteam?.preview_url || ''
      if (!previewUrl && posterPath) {
        previewUrl = pzFileUrl(posterPath)
      }

      // Author name resolution: if Steam creator is raw 17-digit ID, prefer local author
      let authorDisplay = cachedSteam?.creator || localAuthor || ''
      if (/^7656119\d{10}$/.test(authorDisplay) && localAuthor) {
        authorDisplay = localAuthor
      }

      const summary: WorkshopItemSummary = {
        id,
        title: cachedSteam?.title || localName || `Workshop item #${id}`,
        previewUrl,
        posterPath,
        author: authorDisplay,
        authorId: cachedSteam?.creator,
        subscriptions: Number(cachedSteam?.subscriptions) || 0,
        favorited: Number(cachedSteam?.favorited) || 0,
        views: Number(cachedSteam?.views) || 0,
        timeCreated: cachedSteam?.time_created || 0,
        timeUpdated: updatedSec,
        fileSize: Number(cachedSteam?.file_size) || acf?.size || 0,
        tags: combinedTags,
        isInstalled: true,
        localPath: itemFolder,
        needsUpdate
      }

      itemMap.set(id, summary)
    }
  }

  // Asynchronously batch-fetch missing Steam metadata
  if (missingDetailIds.length > 0) {
    void fetchBatchSteamDetails(missingDetailIds).then(() => {
      // Re-enrich cached items with fetched Steam data
      for (const id of missingDetailIds) {
        const steam = steamMetadataCache.get(id)
        const existing = itemMap.get(id)
        if (steam && existing) {
          existing.title = steam.title || existing.title
          if (steam.preview_url) existing.previewUrl = steam.preview_url
          if (steam.creator && !existing.author) existing.author = steam.creator
          existing.subscriptions = Number(steam.subscriptions) || existing.subscriptions
          existing.favorited = Number(steam.favorited) || existing.favorited
          existing.views = Number(steam.views) || existing.views
          existing.timeCreated = steam.time_created || existing.timeCreated
          existing.timeUpdated = steam.time_updated || existing.timeUpdated
          if (steam.file_size) existing.fileSize = Number(steam.file_size)
          if (steam.tags) {
            existing.tags = Array.from(new Set([...steam.tags.map((t) => t.tag), ...existing.tags]))
          }
          if (existing.timeUpdated && steam.time_updated && steam.time_updated > existing.timeUpdated + 60) {
            existing.needsUpdate = true
          }
        }
      }
    })
  }

  // Sort by update time descending
  const list = Array.from(itemMap.values()).sort((a, b) => b.timeUpdated - a.timeUpdated)
  cachedInstalledList = list
  cachedInstalledMap = itemMap
  lastInstalledScanTime = now

  return list
}

/* =========================================================================
   Steam Web API Batch Detail Fetching
   ========================================================================= */

async function fetchBatchSteamDetails(ids: string[]): Promise<void> {
  const chunkSize = 100
  let fetchedAny = false

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    try {
      const postBody = new URLSearchParams()
      postBody.append('itemcount', chunk.length.toString())
      chunk.forEach((id, idx) => {
        postBody.append(`publishedfileids[${idx}]`, id)
      })

      const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        body: postBody,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })

      if (res.ok) {
        const data = (await res.json()) as {
          response?: { publishedfiledetails?: RawSteamItemDetail[] }
        }
        for (const item of data.response?.publishedfiledetails ?? []) {
          if (item.publishedfileid && item.result === 1) {
            steamMetadataCache.set(item.publishedfileid, item)
            fetchedAny = true
          }
        }
      }
    } catch (err) {
      console.warn('[workshop] Batch details fetch error:', err)
    }
  }

  if (fetchedAny) {
    queueSaveMetadataCache()
  }
}

/* =========================================================================
   Live Steam Watcher for Automatic Sync
   ========================================================================= */

const activeWatchers: FSWatcher[] = []
let watcherDebounce: NodeJS.Timeout | null = null

export function initSteamWorkshopWatcher(
  settings: AppSettings,
  onChanged: (res: WorkshopSyncResult) => void
): void {
  // Clear previous watchers
  for (const w of activeWatchers) {
    try {
      w.close()
    } catch {
      // ignore
    }
  }
  activeWatchers.length = 0

  void detectPaths(settings).then((paths) => {
    for (const wsDir of paths.workshopDirs ?? []) {
      const acfDir = dirname(dirname(wsDir))
      const acfPath = join(acfDir, `appworkshop_${PZ_APP_ID}.acf`)
      if (existsSync(acfPath)) {
        try {
          const watcher = watch(acfPath, () => {
            if (watcherDebounce) clearTimeout(watcherDebounce)
            watcherDebounce = setTimeout(async () => {
              watcherDebounce = null
              console.log('[workshop] Detected change in appworkshop_108600.acf -> auto-syncing...')
              const syncRes = await syncSteamWorkshop(settings)
              onChanged(syncRes)
            }, 600)
          })
          activeWatchers.push(watcher)
        } catch (err) {
          console.warn(`[workshop] Failed to watch ${acfPath}:`, err)
        }
      }
    }
  })
}

/* =========================================================================
   Query Workshop (Dual Mode: 'workshop' online or 'installed' local library)
   ========================================================================= */

export async function queryWorkshop(
  settings: AppSettings,
  query: WorkshopSearchQuery
): Promise<WorkshopSearchResult> {
  const page = Math.max(1, query.page ?? 1)
  const numPerPage = query.numPerPage ?? 32
  const isInstalledMode = query.mode === 'installed' || query.installedOnly

  // Ensure installed cache is fresh
  const installedList = await scanAllInstalledWorkshopItems(settings)

  // -----------------------------------------------------------------------
  // MODE: INSTALLED (Local library view of all 392+ items)
  // -----------------------------------------------------------------------
  if (isInstalledMode) {
    let filtered = installedList

    // 1. Search text filter
    if (query.search && query.search.trim()) {
      const s = query.search.trim().toLowerCase()
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(s) ||
          item.author.toLowerCase().includes(s) ||
          item.id.includes(s)
      )
    }

    // 2. Tag / Category filter
    if (query.tags && query.tags.length > 0) {
      const targetTags = query.tags.map((t) => t.toLowerCase())
      filtered = filtered.filter((item) =>
        item.tags.some((t) => targetTags.some((target) => t.toLowerCase() === target))
      )
    }

    // 3. Updates only
    if (query.updatesOnly) {
      filtered = filtered.filter((item) => item.needsUpdate)
    }

    // 4. Sort
    switch (query.sort) {
      case 'popular':
        filtered.sort((a, b) => b.subscriptions - a.subscriptions)
        break
      case 'recent':
        filtered.sort((a, b) => b.timeCreated - a.timeCreated)
        break
      case 'updated':
      case 'trend':
      default:
        filtered.sort((a, b) => b.timeUpdated - a.timeUpdated)
        break
    }

    const total = filtered.length
    const startIdx = (page - 1) * numPerPage
    const paged = filtered.slice(startIdx, startIdx + numPerPage)

    return {
      items: paged,
      total,
      page,
      hasMore: startIdx + numPerPage < total
    }
  }

  // -----------------------------------------------------------------------
  // MODE: WORKSHOP (Steam Community Online Browse)
  // -----------------------------------------------------------------------
  const browseUrl = new URL('https://steamcommunity.com/workshop/browse/')
  browseUrl.searchParams.set('appid', PZ_APP_ID)
  browseUrl.searchParams.set('section', 'readytouseitems')
  browseUrl.searchParams.set('p', page.toString())
  browseUrl.searchParams.set('numperpage', numPerPage.toString())

  if (query.search && query.search.trim()) {
    browseUrl.searchParams.set('searchtext', query.search.trim())
  }

  // Sort
  switch (query.sort) {
    case 'popular':
      browseUrl.searchParams.set('browsesort', 'toprated')
      browseUrl.searchParams.set('days', String(query.days ?? -1))
      break
    case 'recent':
      browseUrl.searchParams.set('browsesort', 'mostrecent')
      break
    case 'updated':
      browseUrl.searchParams.set('browsesort', 'lastupdated')
      break
    case 'trend':
    default:
      browseUrl.searchParams.set('browsesort', 'trend')
      browseUrl.searchParams.set('days', String(query.days ?? 7))
      break
  }

  // Tags filter
  if (query.tags && query.tags.length > 0) {
    for (const tag of query.tags) {
      browseUrl.searchParams.append('requiredtags[]', tag)
    }
  }

  let html = ''
  try {
    const res = await fetch(browseUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    if (!res.ok) {
      throw new Error(`Steam community returned HTTP ${res.status} ${res.statusText}`)
    }
    html = await res.text()
  } catch (err) {
    console.error('[workshop] Failed to query Steam browse:', err)
    return { items: [], total: 0, page, hasMore: false }
  }

  // Extract item IDs
  const idRegex = /sharedfiles\/filedetails\/\?id=(\d+)/g
  const seenIds = new Set<string>()
  const orderedIds: string[] = []
  let match: RegExpExecArray | null

  while ((match = idRegex.exec(html)) !== null) {
    const id = match[1]
    if (!seenIds.has(id)) {
      seenIds.add(id)
      orderedIds.push(id)
    }
  }

  let totalCount = orderedIds.length
  const totalMatch = html.match(/(\d[\d,]*)\s+entries/i) || html.match(/Showing\s+\d+-\d+\s+of\s+([0-9,]+)/i)
  if (totalMatch) {
    totalCount = parseInt(totalMatch[1].replace(/,/g, ''), 10) || totalCount
  } else if (orderedIds.length >= numPerPage) {
    totalCount = page * numPerPage + 1
  }

  if (orderedIds.length === 0) {
    return { items: [], total: totalCount, page, hasMore: false }
  }

  // Ensure Steam metadata is fetched
  const missingFromCache = orderedIds.filter((id) => !steamMetadataCache.has(id))
  if (missingFromCache.length > 0) {
    await fetchBatchSteamDetails(missingFromCache)
  }

  // Map to summaries cross-referencing local installs and Steam subscriptions
  const steamSubs = getSteamSubscribedIds()
  const items: WorkshopItemSummary[] = []
  for (const id of orderedIds) {
    const raw = steamMetadataCache.get(id)
    const local = cachedInstalledMap.get(id)

    const updatedSec = raw?.time_updated ?? local?.timeUpdated ?? 0
    const isSubscribed = steamSubs.has(id)
    const isInstalled = Boolean(local) || isSubscribed
    const needsUpdate = Boolean(local?.needsUpdate)

    const summary: WorkshopItemSummary = {
      id,
      title: raw?.title || local?.title || `Workshop item #${id}`,
      previewUrl: raw?.preview_url || local?.previewUrl || '',
      author: raw?.creator || local?.author || '',
      authorId: raw?.creator,
      subscriptions: Number(raw?.subscriptions) || local?.subscriptions || 0,
      favorited: Number(raw?.favorited) || local?.favorited || 0,
      views: Number(raw?.views) || local?.views || 0,
      timeCreated: raw?.time_created || local?.timeCreated || 0,
      timeUpdated: updatedSec,
      fileSize: Number(raw?.file_size) || local?.fileSize || 0,
      tags: raw?.tags?.map((t) => t.tag) || local?.tags || [],
      isInstalled,
      isSubscribed,
      localPath: local?.localPath,
      needsUpdate
    }

    if (query.updatesOnly && !summary.needsUpdate) continue

    items.push(summary)
  }

  return {
    items,
    total: Math.max(totalCount, items.length),
    page,
    hasMore: orderedIds.length >= numPerPage
  }
}

/* =========================================================================
   Explicit Sync Action
   ========================================================================= */

export async function syncSteamWorkshop(settings: AppSettings): Promise<WorkshopSyncResult> {
  const installed = await scanAllInstalledWorkshopItems(settings, true)
  const totalBytes = installed.reduce((acc, it) => acc + it.fileSize, 0)
  const updatedCount = installed.filter((it) => it.needsUpdate).length

  return {
    installedCount: installed.length,
    updatedCount,
    totalBytes
  }
}

export async function getInstalledWorkshopCount(settings: AppSettings): Promise<number> {
  if (cachedInstalledList) return cachedInstalledList.length
  const items = await scanAllInstalledWorkshopItems(settings)
  return items.length
}

/* =========================================================================
   Single Item Details with Auto-Translation
   ========================================================================= */

export async function getWorkshopItemDetails(
  settings: AppSettings,
  publishedFileId: string,
  forceTranslate = false
): Promise<WorkshopItemDetails> {
  await loadMetadataCache()
  let raw = steamMetadataCache.get(publishedFileId)

  if (!raw) {
    await fetchBatchSteamDetails([publishedFileId])
    raw = steamMetadataCache.get(publishedFileId)
  }

  const screenshots: string[] = []
  if (raw?.preview_url) {
    screenshots.push(raw.preview_url)
  }

  // Scrape gallery screenshots from Steam community page
  try {
    const pageRes = await fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${publishedFileId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    })
    if (pageRes.ok) {
      const pageHtml = await pageRes.text()
      const scrRegex = /highlight_strip_item[\s\S]*?src="([^"]+)"/g
      let sm: RegExpExecArray | null
      while ((sm = scrRegex.exec(pageHtml)) !== null) {
        const u = sm[1].replace(/\?.*/, '')
        if (!screenshots.includes(u)) {
          screenshots.push(u)
        }
      }
    }
  } catch {
    // Non-critical, fallback to preview_url
  }

  // Check local installation & Steam subscription status
  const installedList = await scanAllInstalledWorkshopItems(settings)
  const local = installedList.find((it) => it.id === publishedFileId)
  const steamSubs = getSteamSubscribedIds()
  const isSubscribed = steamSubs.has(publishedFileId)
  const isInstalled = Boolean(local) || isSubscribed

  const originalDesc = raw?.description || ''
  const descHtml = bbcodeToHtml(originalDesc)

  // Auto-translate description to Russian
  let descRuHtml: string | undefined
  if (originalDesc) {
    try {
      const translatedText = await translateModDescription(publishedFileId, originalDesc, 'ru', forceTranslate)
      if (translatedText) {
        descRuHtml = bbcodeToHtml(translatedText)
      }
    } catch (err) {
      console.warn('[workshop] Translation failed for item', publishedFileId, err)
    }
  }

  return {
    id: publishedFileId,
    title: raw?.title || local?.title || `Workshop item #${publishedFileId}`,
    previewUrl: raw?.preview_url || local?.previewUrl || '',
    author: local?.author || raw?.creator || '',
    authorId: raw?.creator,
    subscriptions: Number(raw?.subscriptions) || local?.subscriptions || 0,
    favorited: Number(raw?.favorited) || local?.favorited || 0,
    views: Number(raw?.views) || local?.views || 0,
    timeCreated: raw?.time_created || local?.timeCreated || 0,
    timeUpdated: raw?.time_updated || local?.timeUpdated || 0,
    fileSize: Number(raw?.file_size) || local?.fileSize || 0,
    tags: raw?.tags?.map((t) => t.tag) || local?.tags || [],
    isInstalled,
    isSubscribed,
    localPath: local?.localPath,
    needsUpdate: Boolean(local?.needsUpdate),
    description: descHtml,
    descriptionRu: descRuHtml,
    screenshots,
    childrenIds: []
  }
}

/* =========================================================================
   Steam Client Interaction & Navigation
   ========================================================================= */

export async function openInSteamClient(publishedFileId: string): Promise<boolean> {
  const steamUrl = `steam://url/CommunityFilePage/${publishedFileId}`
  try {
    await shell.openExternal(steamUrl)
    return true
  } catch (err) {
    console.error('[workshop] Failed to open steam:// protocol:', err)
    await shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${publishedFileId}`)
    return false
  }
}

export async function openWorkshopFolder(settings: AppSettings, publishedFileId: string): Promise<boolean> {
  const pathsReport = await detectPaths(settings)
  for (const wsDir of pathsReport.workshopDirs ?? []) {
    const target = join(wsDir, publishedFileId)
    try {
      const stat = await fs.stat(target)
      if (stat.isDirectory()) {
        await shell.openPath(target)
        return true
      }
    } catch {
      // Continue
    }
  }
  return false
}

export async function downloadWorkshopItem(
  _settings: AppSettings,
  publishedFileId: string
): Promise<WorkshopDownloadResult> {
  const success = await openInSteamClient(publishedFileId)
  return {
    ok: success,
    itemId: publishedFileId,
    message: success
      ? 'Страница мода открыта в клиенте Steam для моментальной подписки/загрузки.'
      : 'Открыто в браузере.'
  }
}
