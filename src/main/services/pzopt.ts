/**
 * Tools (module 07) — PZ Optimization engine overrides manager.
 *
 * Implements a 2-stage architecture:
 *  1. Staging / Program Storage: PZ Management manages its own local copy of optimization
 *     classes in %APPDATA%/pz-management/pzopt-staging (synced from Workshop or GitHub).
 *  2. Deployment: Explicit 1-click Apply to Game or Remove from Game.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, relative } from 'node:path'
import { promisify } from 'node:util'
import type {
  AppSettings,
  PzoptApplyResult,
  PzoptCheckUpdateResult,
  PzoptDownloadResult,
  PzoptStagedPackage,
  PzoptState,
  PzoptStatus,
  PzoptUninstallResult
} from '../../shared/types'
import { exists, readTextSafe } from './fsx'
import { detectGameDir, detectPaths } from './paths'

const run = promisify(execFile)
const GITHUB_REPO = 'xD3I/PZ_Optimization'
const WORKSHOP_ITEM_ID = '3805285544'

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  published_at: string
  assets: GitHubReleaseAsset[]
}

/** Cache remote releases for 5 minutes. */
let releasesCache: { timestamp: number; releases: GitHubRelease[] } | null = null

async function fetchReleases(): Promise<GitHubRelease[]> {
  const now = Date.now()
  if (releasesCache && now - releasesCache.timestamp < 5 * 60 * 1000) {
    return releasesCache.releases
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=50`, {
    headers: {
      'User-Agent': 'PZ-Management-App',
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub API returned status ${res.status}: ${res.statusText}`)
  }
  const data = (await res.json()) as GitHubRelease[]
  releasesCache = { timestamp: now, releases: data }
  return data
}

/** Check if ProjectZomboid64 is running. */
export async function isPzRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq ProjectZomboid64.exe', '/NH'], {
      windowsHide: true
    })
    return stdout.toLowerCase().includes('projectzomboid64.exe')
  } catch {
    return false
  }
}

/** Extract the game's revision string (e.g. b0bbce05d5) from projectzomboid.jar. */
export async function getGameJarRevision(gameDir: string): Promise<string | undefined> {
  const jarPath = join(gameDir, 'projectzomboid.jar')
  if (!(await exists(jarPath))) return undefined

  try {
    const { stdout } = await run('tar', ['-xf', jarPath, '-O', 'zombie/GitVersion.class'], {
      windowsHide: true,
      encoding: 'latin1',
      maxBuffer: 10 * 1024 * 1024
    })
    const match = stdout.match(/\b([0-9a-f]{10})\b/)
    if (match?.[1]) return match[1]
  } catch {
    try {
      const psScript = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [System.IO.Compression.ZipFile]::OpenRead('${jarPath.replace(/'/g, "''")}')
        try {
          $e = $z.GetEntry('zombie/GitVersion.class')
          if ($e) {
            $s = $e.Open(); $ms = New-Object System.IO.MemoryStream; $s.CopyTo($ms); $s.Dispose()
            [System.Text.Encoding]::ASCII.GetString($ms.ToArray())
          }
        } finally { $z.Dispose() }
      `
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        windowsHide: true
      })
      const match = stdout.match(/\b([0-9a-f]{10})\b/)
      if (match?.[1]) return match[1]
    } catch {
      // Return undefined if all failed
    }
  }

  return undefined
}

function getStagingDir(): string {
  return join(app.getPath('userData'), 'pzopt-staging')
}

function getStageInfoPath(): string {
  return join(getStagingDir(), 'stage-info.json')
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = []
  async function scan(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await scan(full)
      } else if (entry.isFile() && entry.name !== 'stage-info.json') {
        out.push(full)
      }
    }
  }
  await scan(dir)
  return out
}

async function getSha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  return createHash('sha256').update(buf).digest('hex').toLowerCase()
}

/** Locate Workshop mod folder if available. */
async function findWorkshopClasses(settings: AppSettings): Promise<string | undefined> {
  const paths = await detectPaths(settings)
  for (const wsRoot of paths.workshopDirs) {
    const candidate = join(wsRoot, WORKSHOP_ITEM_ID, 'mods', 'PZ_Optimization', '42', 'pzopt-classes')
    if (await exists(join(candidate, 'pzopt', 'build-info.properties'))) {
      return candidate
    }
  }
  return undefined
}

/** Get staged package inside PZ Management storage, auto-populating from workshop if empty. */
export async function getStagedPackage(settings: AppSettings): Promise<PzoptStagedPackage> {
  const stagingDir = getStagingDir()
  const infoPath = getStageInfoPath()

  if (await exists(infoPath)) {
    try {
      const raw = await fs.readFile(infoPath, 'utf8')
      const data = JSON.parse(raw) as PzoptStagedPackage
      if (await exists(join(stagingDir, 'pzopt', 'build-info.properties'))) {
        return data
      }
    } catch {
      // Fall through to auto-population
    }
  }

  // Auto-populate from local Workshop mod if available
  const wsDir = await findWorkshopClasses(settings)
  if (wsDir) {
    try {
      await fs.mkdir(stagingDir, { recursive: true })
      const wsFiles = await listFilesRecursive(wsDir)
      for (const src of wsFiles) {
        const rel = relative(wsDir, src)
        const dst = join(stagingDir, rel)
        await fs.mkdir(dirname(dst), { recursive: true })
        await fs.copyFile(src, dst)
      }

      const buildInfo = (await readTextSafe(join(stagingDir, 'pzopt', 'build-info.properties'))) ?? ''
      const revision = buildInfo.match(/^revision=(\S+)/m)?.[1]
      const commit = buildInfo.match(/^commit=(\S+)/m)?.[1]
      const tag = revision && commit ? `win-${revision}-${commit}` : undefined

      const staged: PzoptStagedPackage = {
        available: true,
        path: stagingDir,
        revision,
        commit,
        tag,
        downloadedAt: new Date().toISOString(),
        filesCount: wsFiles.length,
        source: 'workshop'
      }

      await fs.writeFile(infoPath, JSON.stringify(staged, null, 2), 'utf8')
      return staged
    } catch {
      // Best-effort
    }
  }

  return {
    available: false,
    path: stagingDir,
    filesCount: 0,
    source: 'github'
  }
}

/** Reset AOT cache and GC launcher flags in ProjectZomboid64.json. */
async function resetLauncherJson(gameDir: string): Promise<void> {
  const jsonPath = join(gameDir, 'ProjectZomboid64.json')
  if (!(await exists(jsonPath))) return

  try {
    const raw = await fs.readFile(jsonPath, 'utf8')
    const data = JSON.parse(raw)
    let changed = false

    const jar = 'pzopt/aot/pzopt.jar'
    if (Array.isArray(data.classpath)) {
      if (data.classpath.includes(jar)) {
        data.classpath = ['.', ...data.classpath.filter((p: string) => p !== '.' && p !== jar)]
        changed = true
      }
    }
    if (Array.isArray(data.vmArgs)) {
      const beforeLen = data.vmArgs.length
      data.vmArgs = data.vmArgs.filter(
        (arg: string) => !arg.startsWith('-XX:AOTCache') && !arg.startsWith('-Xlog:aot=')
      )
      if (data.vmArgs.length !== beforeLen) changed = true
    }

    const fixGc = (args: string[]): string[] => {
      const g1Marker = '-Dpzopt.gc=g1'
      const g1pMarker = '-Dpzopt.gc=g1,pause'
      const jitMarker = '-Dpzopt.jit=steady'
      if (!args.some((a) => a === g1Marker || a === g1pMarker || a === jitMarker)) return args

      changed = true
      return args
        .filter(
          (a) =>
            a !== g1Marker &&
            a !== g1pMarker &&
            a !== jitMarker &&
            !a.startsWith('-XX:MaxGCPauseMillis=') &&
            !a.startsWith('-XX:PerMethodTrapLimit=') &&
            !a.startsWith('-XX:PerBytecodeTrapLimit=')
        )
        .map((a) => (a === '-XX:+UseG1GC' ? '-XX:+UseZGC' : a))
    }

    if (Array.isArray(data.vmArgs)) {
      data.vmArgs = fixGc(data.vmArgs)
    }

    if (changed) {
      await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8')
    }

    const aotDir = join(gameDir, 'pzopt', 'aot')
    if (await exists(aotDir)) {
      await fs.rm(aotDir, { recursive: true, force: true }).catch(() => {})
    }
  } catch {
    // Ignore JSON reset failure
  }
}

/** Check status of PZ Optimization. */
export async function getPzoptStatus(settings: AppSettings): Promise<PzoptStatus> {
  const gameDir = await detectGameDir(settings)
  const gameJarExists = gameDir ? await exists(join(gameDir, 'projectzomboid.jar')) : false
  const gameRevision = gameDir && gameJarExists ? await getGameJarRevision(gameDir) : undefined
  const gameRunning = await isPzRunning()

  const staged = await getStagedPackage(settings)

  const manifestPath = gameDir ? join(gameDir, 'pzopt-installed.txt') : undefined
  const hasManifest = manifestPath ? await exists(manifestPath) : false

  let installed = false
  let installedRevision: string | undefined
  let installedTag: string | undefined
  let installedCommit: string | undefined
  let installedDate: string | undefined
  let installedFilesCount = 0
  let missingCount = 0
  let modifiedCount = 0
  let state: PzoptState = 'not_installed'

  if (gameDir && hasManifest && manifestPath) {
    const content = (await readTextSafe(manifestPath)) ?? ''
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
    const fileEntries: Array<{ rel: string; hash?: string }> = []

    for (const line of lines) {
      if (line.startsWith('#')) {
        const revMatch = line.match(/revision=(\S+)/)
        if (revMatch?.[1]) installedRevision = revMatch[1]
        const tagMatch = line.match(/tag=(\S+)/)
        if (tagMatch?.[1]) installedTag = tagMatch[1]
        const commitMatch = line.match(/commit=(\S+)/)
        if (commitMatch?.[1]) installedCommit = commitMatch[1]
        const dateMatch = line.match(/installed=(\S+)/)
        if (dateMatch?.[1]) installedDate = dateMatch[1]
      } else {
        const [rel, hash] = line.trim().split(/\s+/)
        if (rel) fileEntries.push({ rel, hash })
      }
    }

    installed = fileEntries.length > 0
    installedFilesCount = fileEntries.length

    if (installed) {
      for (const entry of fileEntries) {
        const fullPath = join(gameDir, entry.rel)
        if (!(await exists(fullPath))) {
          missingCount++
        }
      }

      if (gameRevision && installedRevision && gameRevision !== installedRevision) {
        state = 'mismatch'
      } else if (missingCount > 0) {
        state = 'corrupt'
      } else {
        state = 'ok'
      }
    }
  }

  const isGameUpToDateWithStaged =
    installed &&
    staged.available &&
    installedRevision === staged.revision &&
    (Boolean(staged.tag) ? installedTag === staged.tag : true) &&
    missingCount === 0

  const propertiesPath = gameDir ? join(gameDir, 'pzopt.properties') : undefined
  const propertiesExist = propertiesPath ? await exists(propertiesPath) : false
  const propertiesContent = propertiesExist && propertiesPath ? await readTextSafe(propertiesPath) : undefined

  return {
    gameDir,
    gameJarExists,
    gameRevision,
    installed,
    installedRevision,
    installedTag,
    installedCommit,
    installedFilesCount,
    manifestPath,
    state,
    missingCount,
    modifiedCount,
    installedDate,
    gameRunning,
    staged,
    isGameUpToDateWithStaged,
    propertiesPath,
    propertiesExist,
    propertiesContent
  }
}

/** Check GitHub for newer releases than what PZ Management currently has in staged storage. */
export async function checkPzoptUpdate(settings: AppSettings): Promise<PzoptCheckUpdateResult> {
  const status = await getPzoptStatus(settings)
  if (!status.gameDir || !status.gameRevision) {
    return { hasNewerVersion: false, error: 'Game directory or revision not detected' }
  }

  const gameRev = status.gameRevision
  const staged = status.staged

  try {
    const releases = await fetchReleases()
    const pattern = `pzopt-${gameRev}-classes.zip`

    for (const rel of releases) {
      const asset = rel.assets.find((a) => a.name === pattern)
      if (asset) {
        const commitMatch = rel.tag_name.match(/-([0-9a-f]{7,10})$/)
        const commit = commitMatch?.[1] ?? ''

        // Check if this release is newer than our staged package
        const isDifferentFromStaged =
          !staged.available ||
          staged.revision !== gameRev ||
          (Boolean(staged.tag) && staged.tag !== rel.tag_name) ||
          Boolean(staged.commit && commit && staged.commit !== commit)

        return {
          hasNewerVersion: isDifferentFromStaged,
          latestRelease: {
            tag: rel.tag_name,
            revision: gameRev,
            commit,
            downloadUrl: asset.browser_download_url,
            publishedAt: rel.published_at,
            assetName: asset.name,
            size: asset.size
          },
          gameRevision: gameRev,
          stagedRevision: staged.revision,
          stagedTag: staged.tag,
          installedRevision: status.installedRevision
        }
      }
    }

    return {
      hasNewerVersion: false,
      gameRevision: gameRev,
      stagedRevision: staged.revision,
      stagedTag: staged.tag,
      installedRevision: status.installedRevision,
      error: `No release found on GitHub for game revision ${gameRev} yet`
    }
  } catch (e) {
    return {
      hasNewerVersion: false,
      gameRevision: gameRev,
      stagedRevision: staged.revision,
      stagedTag: staged.tag,
      installedRevision: status.installedRevision,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * Step 1: Download new release from GitHub into PZ Management's internal staging storage.
 * Does NOT touch game directory!
 */
export async function downloadToProgram(settings: AppSettings): Promise<PzoptDownloadResult> {
  const status = await getPzoptStatus(settings)
  if (!status.gameRevision) {
    return { ok: false, tag: '', revision: '', filesCount: 0, error: 'Game revision could not be determined.' }
  }

  const gameRev = status.gameRevision
  const releases = await fetchReleases()
  const pattern = `pzopt-${gameRev}-classes.zip`

  let matchingRelease: GitHubRelease | undefined
  let downloadUrl: string | undefined

  for (const rel of releases) {
    const asset = rel.assets.find((a) => a.name === pattern)
    if (asset) {
      matchingRelease = rel
      downloadUrl = asset.browser_download_url
      break
    }
  }

  if (!matchingRelease || !downloadUrl) {
    return {
      ok: false,
      tag: '',
      revision: gameRev,
      filesCount: 0,
      error: `No release found on GitHub for revision ${gameRev}.`
    }
  }

  const stagingDir = getStagingDir()
  const tempZip = join(tmpdir(), `pzopt-${gameRev}-${Date.now()}.zip`)

  try {
    const resp = await fetch(downloadUrl)
    if (!resp.ok || !resp.body) {
      throw new Error(`Failed to download from GitHub: ${resp.status} ${resp.statusText}`)
    }

    const fileStream = createWriteStream(tempZip)
    const { Readable } = await import('node:stream')
    const readable = Readable.fromWeb(resp.body as unknown as import('node:stream/web').ReadableStream)
    await new Promise((resolve, reject) => {
      readable.pipe(fileStream)
      readable.on('error', reject)
      fileStream.on('finish', resolve)
    })

    // Wipe previous staging directory and extract freshly downloaded files
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(stagingDir, { recursive: true })

    // Extract using Windows built-in tar
    await run('tar', ['-xf', tempZip, '-C', stagingDir], { windowsHide: true })

    const files = await listFilesRecursive(stagingDir)
    const buildInfo = (await readTextSafe(join(stagingDir, 'pzopt', 'build-info.properties'))) ?? ''
    const revMatch = buildInfo.match(/^revision=(\S+)/m)?.[1] ?? gameRev
    const commitMatch = buildInfo.match(/^commit=(\S+)/m)?.[1] ?? ''

    const staged: PzoptStagedPackage = {
      available: true,
      path: stagingDir,
      revision: revMatch,
      commit: commitMatch,
      tag: matchingRelease.tag_name,
      downloadedAt: new Date().toISOString(),
      filesCount: files.length,
      source: 'github'
    }

    await fs.writeFile(getStageInfoPath(), JSON.stringify(staged, null, 2), 'utf8')

    return {
      ok: true,
      tag: matchingRelease.tag_name,
      revision: revMatch,
      filesCount: files.length
    }
  } catch (e) {
    return {
      ok: false,
      tag: '',
      revision: gameRev,
      filesCount: 0,
      error: e instanceof Error ? e.message : String(e)
    }
  } finally {
    await fs.unlink(tempZip).catch(() => {})
  }
}

/**
 * Step 2: Apply the staged package from PZ Management storage to Project Zomboid directory.
 */
export async function applyToGame(settings: AppSettings): Promise<PzoptApplyResult> {
  if (await isPzRunning()) {
    return {
      ok: false,
      writtenCount: 0,
      revision: '',
      error: 'Project Zomboid is currently running. Please close the game before applying optimizations.'
    }
  }

  const status = await getPzoptStatus(settings)
  if (!status.gameDir) {
    return { ok: false, writtenCount: 0, revision: '', error: 'Game directory not found.' }
  }

  const staged = status.staged
  if (!staged.available || staged.filesCount === 0) {
    return {
      ok: false,
      writtenCount: 0,
      revision: '',
      error: 'No optimization package in PZ Management storage. Download it into the program first.'
    }
  }

  const gameDir = status.gameDir

  // Clean old files from manifest first
  if (status.installed) {
    await removeFromGame(settings)
  }

  const stagedFiles = await listFilesRecursive(staged.path)
  const filesWritten: string[] = []

  for (const src of stagedFiles) {
    const rel = relative(staged.path, src).replace(/\\/g, '/')
    const dst = join(gameDir, rel)
    await fs.mkdir(dirname(dst), { recursive: true })
    await fs.copyFile(src, dst)
    filesWritten.push(rel)
  }

  // Write manifest
  const manifestPath = join(gameDir, 'pzopt-installed.txt')
  const manifestLines = [
    '# files written by PZ Management - do not edit',
    `# revision=${staged.revision ?? ''} tag=${staged.tag ?? ''} commit=${staged.commit ?? ''} installed=${new Date().toISOString()}`
  ]

  for (const rel of filesWritten) {
    const full = join(gameDir, rel)
    const hash = await getSha256(full).catch(() => 'unknown')
    manifestLines.push(`${rel} ${hash}`)
  }

  await fs.writeFile(manifestPath, manifestLines.join('\n'), 'utf8')

  return {
    ok: true,
    writtenCount: filesWritten.length,
    revision: staged.revision ?? ''
  }
}

/** Remove optimization files from game directory. */
export async function removeFromGame(settings: AppSettings): Promise<PzoptUninstallResult> {
  if (await isPzRunning()) {
    return {
      ok: false,
      removedCount: 0,
      error: 'Project Zomboid is running. Please close the game before removing optimizations.'
    }
  }

  const gameDir = await detectGameDir(settings)
  if (!gameDir) {
    return { ok: false, removedCount: 0, error: 'Game directory not found.' }
  }

  await resetLauncherJson(gameDir)

  const manifestPath = join(gameDir, 'pzopt-installed.txt')
  const legacyFilesPath = join(gameDir, 'pzopt-files.txt')

  let filesToRemove: string[] = []

  if (await exists(manifestPath)) {
    const text = (await readTextSafe(manifestPath)) ?? ''
    filesToRemove = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0 && !l.startsWith('#'))
      .map((l) => l.trim().split(/\s+/)[0])
  } else if (await exists(legacyFilesPath)) {
    const text = (await readTextSafe(legacyFilesPath)) ?? ''
    filesToRemove = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }

  let removedCount = 0
  const normalizedGameDir = normalize(gameDir)

  for (const rel of filesToRemove) {
    const target = join(gameDir, rel)
    if (await exists(target)) {
      await fs.unlink(target).catch(() => {})
      removedCount++

      let parent = dirname(target)
      while (parent && normalize(parent) !== normalizedGameDir) {
        try {
          const contents = await fs.readdir(parent)
          if (contents.length === 0) {
            await fs.rmdir(parent)
            parent = dirname(parent)
          } else {
            break
          }
        } catch {
          break
        }
      }
    }
  }

  await fs.unlink(manifestPath).catch(() => {})
  await fs.unlink(legacyFilesPath).catch(() => {})

  return { ok: true, removedCount }
}

/** Read pzopt.properties. */
export async function readPzoptConfig(settings: AppSettings): Promise<string> {
  const gameDir = await detectGameDir(settings)
  if (!gameDir) return ''
  const propsPath = join(gameDir, 'pzopt.properties')
  return (await readTextSafe(propsPath)) ?? ''
}

/** Write pzopt.properties. */
export async function writePzoptConfig(settings: AppSettings, content: string): Promise<boolean> {
  const gameDir = await detectGameDir(settings)
  if (!gameDir) return false
  const propsPath = join(gameDir, 'pzopt.properties')
  await fs.writeFile(propsPath, content, 'utf8')
  return true
}
