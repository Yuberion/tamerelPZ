/**
 * Workbench authoring service: mod scaffolding and `mod.info` read/write.
 *
 * This is the only module in the suite that creates files inside mod folders.
 * Every path it touches passes through `assertPathWritable`, and it never
 * deletes or moves anything — the strongest write it performs is replacing a
 * `mod.info` it has just backed up.
 */
import { promises as fs } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import type {
  AppSettings,
  AuthoringTarget,
  ModInfoDraft,
  ModInfoExtra,
  ScaffoldFolder,
  ScaffoldOptions,
  ScaffoldResult,
  WriteModInfoRequest,
  WriteModInfoResult
} from '../../shared/types'
import { solidPng } from './binfmt'
import { exists, readTextSafe } from './fsx'
import { assertPathWritable } from './guard'
import { all, first, parseModInfo } from './modinfo'
import { authoringTargets } from './paths'

/* --------------------------------------------------------------- naming -- */

/** Windows refuses these as file names regardless of extension. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

/**
 * Folder and mod ids come straight from a text input, and both end up
 * concatenated into a filesystem path. Restricting them to a conservative
 * charset is the primary defence — the write allowlist is the second.
 */
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/

export function assertSafeName(value: string, field: string): string {
  const trimmed = value.trim()
  if (!SAFE_NAME_RE.test(trimmed)) {
    throw new Error(
      `${field} must be 1-64 characters of A-Z, a-z, 0-9, dot, underscore, plus or hyphen`
    )
  }
  if (trimmed.endsWith('.') || RESERVED_NAMES.has(trimmed.toLowerCase())) {
    throw new Error(`${field} is a reserved Windows name`)
  }
  return trimmed
}

/** Strip characters that would break `key=value` parsing on a single line. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/* ------------------------------------------------------------- mod.info -- */

/** Keys the editor surfaces as dedicated fields; everything else is `extra`. */
const KNOWN_KEYS = new Set([
  'name', 'id', 'description', 'author', 'authors', 'modversion', 'version',
  'pzversion', 'versionmin', 'url', 'poster', 'icon', 'require', 'requires',
  'tags', 'category'
])

/** Emission order, so a rewritten `mod.info` always reads the same way. */
const FIELD_ORDER = [
  'name', 'id', 'description', 'author', 'modversion', 'pzversion', 'url', 'poster', 'icon'
] as const

/**
 * PZ writes `\n` in its own generated files and the parser splits on `\r?\n`,
 * so LF is safe and keeps diffs clean for authors using git.
 */
export function serialiseModInfo(draft: ModInfoDraft): string {
  const lines: string[] = []
  const push = (key: string, value: string): void => {
    const clean = oneLine(value)
    if (clean) lines.push(`${key}=${clean}`)
  }

  const values: Record<(typeof FIELD_ORDER)[number], string> = {
    name: draft.name,
    id: draft.id,
    description: draft.description,
    author: draft.authors,
    modversion: draft.modVersion,
    pzversion: draft.pzVersion,
    url: draft.url,
    poster: draft.poster,
    icon: draft.icon
  }
  for (const key of FIELD_ORDER) push(key, values[key])

  for (const r of draft.requires) push('require', r)
  const tags = draft.tags.map(oneLine).filter(Boolean)
  if (tags.length) lines.push(`tags=${tags.join(';')}`)
  for (const e of draft.extra) push(e.key, e.value)

  return lines.join('\n') + '\n'
}

/** Locate the `mod.info` a mod folder is actually driven by. */
async function resolveInfoFile(modPath: string): Promise<{ file: string; exists: boolean }> {
  const root = join(modPath, 'mod.info')
  if (await exists(root)) return { file: root, exists: true }

  // Build 42 layout: the canonical mod.info lives in a version sub-folder.
  const candidates: Array<{ file: string; weight: number }> = []
  for (const entry of await fs.readdir(modPath, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    if (!/^(?:common|4[0-9](?:\.\d+)*)$/i.test(entry.name)) continue
    const file = join(modPath, entry.name, 'mod.info')
    if (!(await exists(file))) continue
    const lower = entry.name.toLowerCase()
    const weight = lower === 'common' ? 1 : Number.parseInt(lower.split('.')[0] ?? '0', 10) * 1000
    candidates.push({ file, weight })
  }
  candidates.sort((a, b) => b.weight - a.weight)
  const best = candidates[0]
  return best ? { file: best.file, exists: true } : { file: root, exists: false }
}

export async function readModInfoDraft(modPath: string): Promise<ModInfoDraft> {
  const root = normalize(modPath)
  const { file, exists: fileExists } = await resolveInfoFile(root)
  const raw = fileExists ? ((await readTextSafe(file, 64 * 1024)) ?? '') : ''
  const fields = parseModInfo(raw)

  const extra: ModInfoExtra[] = []
  for (const [key, values] of Object.entries(fields)) {
    if (KNOWN_KEYS.has(key)) continue
    for (const value of values) extra.push({ key, value })
  }

  const tags = [
    ...new Set(
      all(fields, 'tags', 'category')
        .flatMap((v) => v.split(/[,;]/))
        .map((v) => v.trim())
        .filter(Boolean)
    )
  ]

  return {
    file,
    modPath: root,
    exists: fileExists,
    writable: await isWritable(file),
    raw,
    name: first(fields, 'name') ?? '',
    id: first(fields, 'id') ?? '',
    description: first(fields, 'description') ?? '',
    authors: first(fields, 'authors', 'author') ?? '',
    modVersion: first(fields, 'modversion', 'version') ?? '',
    pzVersion: first(fields, 'pzversion', 'versionmin') ?? '',
    url: first(fields, 'url') ?? '',
    poster: first(fields, 'poster') ?? '',
    icon: first(fields, 'icon') ?? '',
    requires: [
      ...new Set(
        all(fields, 'require', 'requires')
          .flatMap((v) => v.split(/[,;]/))
          .map((v) => v.trim())
          .filter(Boolean)
      )
    ],
    tags,
    extra
  }
}

async function isWritable(file: string): Promise<boolean> {
  try {
    await assertPathWritable(file)
    return true
  } catch {
    return false
  }
}

/** Write text to `file` atomically: temp file in the same directory, then rename. */
async function writeAtomic(file: string, text: string): Promise<number> {
  const data = Buffer.from(text, 'utf8')
  const tmp = `${file}.pzm-tmp`
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
  return data.length
}

export async function writeModInfo(req: WriteModInfoRequest): Promise<WriteModInfoResult> {
  const file = await assertPathWritable(req.file)
  if (!/mod\.info$/i.test(file)) throw new Error('Only mod.info files can be written here')

  const text = req.raw ?? (req.draft ? serialiseModInfo(req.draft) : undefined)
  if (text === undefined) throw new Error('Nothing to write: provide raw text or a draft')

  let backupFile: string | undefined
  if (req.backup && (await exists(file))) {
    // One rolling backup, not a timestamped pile: authors save repeatedly and a
    // growing set of .bak files in a mod folder is noise the game also scans.
    const previous = await fs.readFile(file).catch(() => undefined)
    if (previous) {
      backupFile = `${file}.bak`
      await fs.writeFile(backupFile, previous)
    }
  }

  const bytes = await writeAtomic(file, text)
  return backupFile ? { file, bytes, backupFile } : { file, bytes }
}

/* ------------------------------------------------------------- scaffold -- */

/** `media` sub-paths each scaffold option maps to. */
const FOLDER_MAP: Record<ScaffoldFolder, string[]> = {
  'lua-client': ['lua/client'],
  'lua-server': ['lua/server'],
  'lua-shared': ['lua/shared'],
  scripts: ['scripts'],
  textures: ['textures'],
  sounds: ['sound'],
  models: ['models_x', 'animations_x'],
  translate: ['lua/shared/Translate/EN'],
  maps: ['maps'],
  ui: ['ui']
}

export async function listAuthoringTargets(settings: AppSettings): Promise<AuthoringTarget[]> {
  return authoringTargets(settings)
}

/**
 * Create a mod skeleton.
 *
 * Refuses to touch an existing folder outright. Half-writing into a directory
 * an author already has work in is the one failure mode that could destroy
 * their data, so the check is a hard precondition rather than a merge strategy.
 */
export async function scaffoldMod(
  settings: AppSettings,
  opts: ScaffoldOptions
): Promise<ScaffoldResult> {
  const targets = await authoringTargets(settings)
  const target = targets.find((t) => t.id === opts.targetId)
  if (!target) throw new Error(`Unknown authoring target: ${opts.targetId}`)

  const folderName = assertSafeName(opts.folderName, 'Folder name')
  const modId = assertSafeName(opts.modId, 'Mod id')
  const name = oneLine(opts.name) || folderName

  const container = await assertPathWritable(target.path)
  const modPath = await assertPathWritable(join(container, folderName))
  if (await exists(modPath)) {
    throw new Error(`${folderName} already exists in ${container}`)
  }

  // Workshop projects need the Contents/mods wrapper the uploader expects.
  const projectRoot = target.kind === 'project' ? modPath : undefined
  const modRoot = projectRoot ? join(projectRoot, 'Contents', 'mods', folderName) : modPath

  /** Build sub-folders that get their own `media/` tree and `mod.info`. */
  const buildDirs =
    opts.layout === 'b41' ? [''] : opts.layout === 'b42' ? ['common'] : ['common', '41']

  const created: string[] = []
  let bytes = 0

  const mkdir = async (abs: string, rel: string): Promise<void> => {
    await fs.mkdir(abs, { recursive: true })
    if (rel) created.push(`${rel}/`)
  }
  const writeFile = async (abs: string, rel: string, data: Buffer | string): Promise<void> => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, buf, { flag: 'wx' })
    created.push(rel)
    bytes += buf.length
  }

  await mkdir(modRoot, '')

  const draft: ModInfoDraft = {
    file: join(modRoot, 'mod.info'),
    modPath: modRoot,
    exists: false,
    writable: true,
    raw: '',
    name,
    id: modId,
    description: oneLine(opts.description),
    authors: oneLine(opts.author),
    modVersion: oneLine(opts.modVersion) || '1.0.0',
    pzVersion: oneLine(opts.pzVersion),
    url: oneLine(opts.url),
    poster: opts.poster ? 'poster.png' : '',
    icon: '',
    requires: opts.requires.map(oneLine).filter(Boolean),
    tags: opts.tags.map(oneLine).filter(Boolean),
    extra: []
  }

  for (const build of buildDirs) {
    const buildRoot = build ? join(modRoot, build) : modRoot
    const relBuild = build ? `${build}/` : ''
    if (build) await mkdir(buildRoot, build)

    // Every build folder carries its own mod.info: that is how the game picks
    // the right metadata per build, and B42 ignores a root-only mod.info.
    const infoRel = `${relBuild}mod.info`
    await writeFile(join(buildRoot, 'mod.info'), infoRel, serialiseModInfo(draft))

    const media = join(buildRoot, 'media')
    await mkdir(media, `${relBuild}media`)

    for (const folder of opts.folders) {
      for (const sub of FOLDER_MAP[folder] ?? []) {
        await mkdir(join(media, ...sub.split('/')), `${relBuild}media/${sub}`)
      }
    }

    if (opts.examples) {
      await writeExamples(opts, modId, name, buildRoot, relBuild, writeFile)
    }

    if (opts.poster) {
      await writeFile(join(buildRoot, 'poster.png'), `${relBuild}poster.png`, POSTER)
    }
  }

  if (projectRoot) {
    await writeFile(
      join(projectRoot, 'workshop.txt'),
      'workshop.txt',
      workshopTxt({
        title: name,
        description: draft.description,
        tags: draft.tags,
        visibility: 'public',
        id: ''
      })
    )
    if (opts.poster) await writeFile(join(projectRoot, 'preview.png'), 'preview.png', POSTER)
  }

  created.sort()
  return { modPath: modRoot, infoFile: join(modRoot, 'mod.info'), created, bytes }
}

/** 512x256 placeholder so `poster=poster.png` resolves from the first launch. */
const POSTER = solidPng(512, 256, [22, 26, 31])

type WriteFn = (abs: string, rel: string, data: Buffer | string) => Promise<void>

/** Starter files that actually run, rather than empty folders. */
async function writeExamples(
  opts: ScaffoldOptions,
  modId: string,
  name: string,
  buildRoot: string,
  relBuild: string,
  writeFile: WriteFn
): Promise<void> {
  const has = (f: ScaffoldFolder): boolean => opts.folders.includes(f)
  const media = join(buildRoot, 'media')
  const emit = (parts: string[], body: string): Promise<void> =>
    writeFile(join(media, ...parts), `${relBuild}media/${parts.join('/')}`, body)

  if (has('lua-client')) {
    await emit(
      ['lua', 'client', `${modId}_Client.lua`],
      [
        `-- ${name}: client entry point.`,
        `-- Loaded on every client, including the host of a co-op game.`,
        '',
        `local ${modId} = {}`,
        '',
        `function ${modId}.onGameStart()`,
        `    print("[${modId}] client loaded")`,
        'end',
        '',
        `Events.OnGameStart.Add(${modId}.onGameStart)`,
        '',
        `return ${modId}`,
        ''
      ].join('\n')
    )
  }

  if (has('lua-server')) {
    await emit(
      ['lua', 'server', `${modId}_Server.lua`],
      [
        `-- ${name}: server entry point.`,
        `-- Never loaded on a pure client, so keep client-only calls out of here.`,
        '',
        `local function onInitGlobalModData(isNewGame)`,
        `    print("[${modId}] server loaded, new game: " .. tostring(isNewGame))`,
        'end',
        '',
        'Events.OnInitGlobalModData.Add(onInitGlobalModData)',
        ''
      ].join('\n')
    )
  }

  if (has('lua-shared')) {
    await emit(
      ['lua', 'shared', `${modId}_Shared.lua`],
      [
        `-- ${name}: shared definitions, loaded first on both sides.`,
        '',
        `${modId} = ${modId} or {}`,
        `${modId}.version = "1.0.0"`,
        ''
      ].join('\n')
    )
  }

  if (has('scripts')) {
    await emit(
      ['scripts', `${modId}.txt`],
      [
        'module Base',
        '{',
        `    item ${modId}_Example`,
        '    {',
        '        DisplayCategory = Material,',
        '        Type = Normal,',
        `        DisplayName = ${name} Example,`,
        `        Icon = ${modId}_Example,`,
        '        Weight = 0.3,',
        '    }',
        '}',
        ''
      ].join('\n')
    )
  }

  if (has('translate')) {
    await emit(
      ['lua', 'shared', 'Translate', 'EN', 'ItemName_EN.txt'],
      [
        'ItemName_EN = {',
        `    ItemName_Base.${modId}_Example = "${name} Example",`,
        '}',
        ''
      ].join('\n')
    )
  }
}

/**
 * `workshop.txt` as the in-game uploader writes it.
 *
 * Order and casing matter: the uploader reads the file back with a plain
 * key match, and an unexpected key makes it fall back to defaults.
 */
export function workshopTxt(meta: {
  title: string
  description: string
  tags: string[]
  visibility: 'public' | 'friends' | 'private'
  id: string
}): string {
  return [
    'version=1',
    `id=${oneLine(meta.id)}`,
    `title=${oneLine(meta.title)}`,
    `description=${meta.description.replace(/\r?\n/g, '\\n')}`,
    `tags=${meta.tags.map(oneLine).filter(Boolean).join(';')}`,
    `visibility=${meta.visibility}`,
    ''
  ].join('\n')
}
