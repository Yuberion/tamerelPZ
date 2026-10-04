import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import type {
  BackupServerResult,
  LaunchServerRequest,
  LaunchServerResult,
  SaveServerConfigRequest,
  SaveServerConfigResult,
  ServerFullConfig,
  ServerProfileSummary,
  SyncServerModsRequest,
  SyncServerModsResult
} from '../../shared/types'
import { exists, isDir, readTextSafe, readdirSafe } from './fsx'
import { detectGameDir, detectZomboidDir } from './paths'
import { getSettings } from './settings'

async function getServerDir(): Promise<string> {
  const settings = await getSettings()
  const zomboidDir = (await detectZomboidDir(settings)) || join(homedir(), 'Zomboid')
  const serverDir = join(zomboidDir, 'Server')
  if (!(await isDir(serverDir))) {
    await fs.mkdir(serverDir, { recursive: true }).catch(() => {})
  }
  return serverDir
}

/** Parse standard PZ server.ini file into key-value map */
function parseServerIni(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim()
      const val = trimmed.substring(eqIdx + 1).trim()
      result[key] = val
    }
  }
  return result
}

/** Serialize key-value map back into PZ server.ini format preserving structure */
function serializeServerIni(props: Record<string, string>): string {
  const lines: string[] = []
  lines.push('# PZ MANAGEMENT — Generated Server Config')
  lines.push('')
  for (const [k, v] of Object.entries(props)) {
    lines.push(`${k}=${v}`)
  }
  lines.push('')
  return lines.join('\r\n')
}

/** List all server configurations found in Zomboid/Server */
export async function listServers(): Promise<ServerProfileSummary[]> {
  const serverDir = await getServerDir()

  const entries = await readdirSafe(serverDir)
  const results: ServerProfileSummary[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ini')) continue
    const serverName = entry.name.replace(/\.ini$/i, '')
    const iniPath = join(serverDir, entry.name)

    const content = await readTextSafe(iniPath)
    if (!content) continue

    const props = parseServerIni(content)
    const stat = await fs.stat(iniPath).catch(() => null)

    const modsStr = props['Mods'] ?? ''
    const modsList = modsStr ? modsStr.split(';').filter(Boolean) : []

    const workshopStr = props['WorkshopItems'] ?? ''
    const workshopList = workshopStr ? workshopStr.split(';').filter(Boolean) : []

    const sandboxPath = join(serverDir, `${serverName}_SandboxVars.lua`)
    const hasSandbox = await exists(sandboxPath)

    results.push({
      name: serverName,
      iniPath,
      sandboxPath: hasSandbox ? sandboxPath : undefined,
      maxPlayers: parseInt(props['MaxPlayers'] ?? '16', 10) || 16,
      port: parseInt(props['DefaultPort'] ?? '16261', 10) || 16261,
      hasPassword: Boolean(props['Password']),
      rconPort: props['RCONPort'] ? parseInt(props['RCONPort'], 10) : undefined,
      modCount: modsList.length,
      workshopItemCount: workshopList.length,
      lastModified: stat ? stat.mtimeMs : Date.now()
    })
  }

  // If no server exists, provide default 'servertest' entry
  if (results.length === 0) {
    const defaultIni = join(serverDir, 'servertest.ini')
    const initialProps = {
      Public: 'false',
      PublicName: 'PZ Management Server',
      MaxPlayers: '16',
      DefaultPort: '16261',
      Mods: '',
      WorkshopItems: '',
      PauseEmpty: 'true',
      SpawnPoint: '0,0,0',
      SafetySystem: 'true',
      ShowSafety: 'true'
    }
    await fs.writeFile(defaultIni, Buffer.from(serializeServerIni(initialProps), 'utf8'))
    results.push({
      name: 'servertest',
      iniPath: defaultIni,
      maxPlayers: 16,
      port: 16261,
      hasPassword: false,
      modCount: 0,
      workshopItemCount: 0,
      lastModified: Date.now()
    })
  }

  return results.sort((a, b) => b.lastModified - a.lastModified)
}

/** Read full server properties and SandboxVars.lua */
export async function readServerConfig(serverName: string): Promise<ServerFullConfig> {
  const serverDir = await getServerDir()
  const iniPath = join(serverDir, `${serverName}.ini`)
  const content = (await readTextSafe(iniPath)) || ''
  const iniProperties = parseServerIni(content)

  const sandboxPath = join(serverDir, `${serverName}_SandboxVars.lua`)
  const sandboxLua = await readTextSafe(sandboxPath)

  const modsList = (iniProperties['Mods'] || '').split(';').map((s) => s.trim()).filter(Boolean)
  const workshopItemsList = (iniProperties['WorkshopItems'] || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    name: serverName,
    iniProperties,
    sandboxLua,
    modsList,
    workshopItemsList
  }
}

/** Save server.ini and optional SandboxVars.lua */
export async function saveServerConfig(
  req: SaveServerConfigRequest
): Promise<SaveServerConfigResult> {
  const { serverName, iniProperties, sandboxLua } = req
  const serverDir = await getServerDir()
  const iniPath = join(serverDir, `${serverName}.ini`)

  // Backup current ini
  let backupPath: string | undefined
  if (await exists(iniPath)) {
    backupPath = join(serverDir, `${serverName}.ini.bak_${Date.now()}`)
    await fs.copyFile(iniPath, backupPath)
  }

  const iniContent = serializeServerIni(iniProperties)
  await fs.writeFile(iniPath, Buffer.from(iniContent, 'utf8'))

  if (typeof sandboxLua === 'string' && sandboxLua.trim()) {
    const sandboxPath = join(serverDir, `${serverName}_SandboxVars.lua`)
    await fs.writeFile(sandboxPath, Buffer.from(sandboxLua, 'utf8'))
  }

  return {
    ok: true,
    iniPath,
    backupPath
  }
}

/** Sync mod list and workshop item list into server.ini */
export async function syncServerMods(
  req: SyncServerModsRequest
): Promise<SyncServerModsResult> {
  const { serverName, mods, workshopItems } = req
  const serverDir = await getServerDir()
  const iniPath = join(serverDir, `${serverName}.ini`)

  const content = (await readTextSafe(iniPath)) || ''
  const props = parseServerIni(content)

  props['Mods'] = mods.filter(Boolean).join(';')
  props['WorkshopItems'] = workshopItems.filter(Boolean).join(';')

  const res = await saveServerConfig({
    serverName,
    iniProperties: props
  })

  return {
    ok: res.ok,
    iniPath,
    modsCount: mods.length,
    workshopCount: workshopItems.length,
    error: res.error
  }
}

/** Backup server config and world */
export async function backupServer(serverName: string): Promise<BackupServerResult> {
  const settings = await getSettings()
  const zomboidDir = (await detectZomboidDir(settings)) || join(homedir(), 'Zomboid')
  const serverDir = await getServerDir()
  const backupsDir = join(zomboidDir, 'ServerBackups')
  await fs.mkdir(backupsDir, { recursive: true })

  const backupTarget = join(backupsDir, `${serverName}_backup_${Date.now()}`)
  await fs.mkdir(backupTarget, { recursive: true })

  let bytes = 0
  const serverFiles = await readdirSafe(serverDir)
  for (const f of serverFiles) {
    if (f.name.startsWith(serverName)) {
      const src = join(serverDir, f.name)
      const dst = join(backupTarget, f.name)
      const s = await fs.stat(src).catch(() => null)
      if (s && s.isFile()) {
        bytes += s.size
        await fs.copyFile(src, dst)
      }
    }
  }

  return {
    ok: true,
    backupPath: backupTarget,
    bytes
  }
}

/** Launch server process with JVM memory flags */
export async function launchServer(req: LaunchServerRequest): Promise<LaunchServerResult> {
  const { serverName, ramGb } = req
  const gameDir = await detectGameDir(await getSettings())

  if (!gameDir) {
    return {
      ok: false,
      commandLine: '',
      error: 'Project Zomboid game directory not found.'
    }
  }

  // Check for StartServer64.bat or ProjectZomboid64.bat
  const candidates = [
    join(gameDir, 'StartServer64.bat'),
    join(gameDir, 'ProjectZomboid64.bat')
  ]

  let batFile: string | undefined
  for (const c of candidates) {
    if (await exists(c)) {
      batFile = c
      break
    }
  }

  if (!batFile) {
    return {
      ok: false,
      commandLine: '',
      error: 'StartServer64.bat not found in game directory.'
    }
  }

  const memoryFlag = `-Xmx${ramGb}g`
  const args = [`-servername`, serverName, memoryFlag]

  try {
    const child = spawn(batFile, args, {
      cwd: gameDir,
      detached: true,
      stdio: 'ignore',
      shell: true
    })
    child.unref()

    return {
      ok: true,
      pid: child.pid,
      commandLine: `"${batFile}" ${args.join(' ')}`
    }
  } catch (err) {
    return {
      ok: false,
      commandLine: `"${batFile}" ${args.join(' ')}`,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
