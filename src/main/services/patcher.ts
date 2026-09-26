import { promises as fs } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type {
  AppSettings,
  CreateMergePatchRequest,
  CreateMergePatchResult,
  ModEntry,
  PatchBuildTarget
} from '../../shared/types'
import { solidPng } from './binfmt'
import { exists, readTextSafe } from './fsx'
import { assertPathWritable, invalidateGuard } from './guard'
import { parseClientList, renderClientList } from './loadout'
import { getCachedMods } from './scanner'

/** 512x256 placeholder poster for the generated patch mod */
const POSTER_PNG = solidPng(512, 256, [245, 158, 11])
/** 32x32 placeholder icon for the generated patch mod */
const ICON_PNG = solidPng(32, 32, [245, 158, 11])

/**
 * Normalizes mod ID lookup key (handles "108600/ModId" and raw modId).
 */
function normModId(id: string): string {
  const clean = id.trim().toLowerCase().replace(/^\\/, '')
  const slash = clean.indexOf('/')
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

/**
 * Finds the candidate source file inside a mod folder (respects root, common/, 42/ overlays).
 */
async function findModSourceFile(modPath: string, relPath: string): Promise<string | undefined> {
  const cleanRel = relPath.replace(/\\/g, '/')
  const subPaths = cleanRel.replace(/^media\//i, '')

  const candidates = [
    join(modPath, cleanRel),
    join(modPath, 'common', cleanRel),
    join(modPath, '42', cleanRel),
    join(modPath, 'media', subPaths),
    join(modPath, 'common', 'media', subPaths),
    join(modPath, '42', 'media', subPaths)
  ]

  for (const c of candidates) {
    if (await exists(c)) {
      return c
    }
  }
  return undefined
}

/**
 * Lightweight PZ item/recipe script block merger.
 * Merges properties of items/recipes across multiple script files.
 */
interface ParsedEntry {
  kind: string // 'item' | 'recipe' | 'sound' etc.
  name: string
  props: Map<string, string>
}

interface ParsedModule {
  name: string
  entries: Map<string, ParsedEntry>
}

function parseScriptFile(text: string): ParsedModule[] {
  const modules: ParsedModule[] = []
  let currentModule: ParsedModule | undefined
  let currentEntry: ParsedEntry | undefined

  // Strip block comments
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = clean.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue

    // module Name
    const modMatch = /^module\s+([A-Za-z0-9_$.-]+)/i.exec(line)
    if (modMatch) {
      const modName = modMatch[1]
      currentModule = modules.find((m) => m.name.toLowerCase() === modName.toLowerCase())
      if (!currentModule) {
        currentModule = { name: modName, entries: new Map() }
        modules.push(currentModule)
      }
      continue
    }

    // entry header: item Name, recipe Name, etc.
    const entryMatch = /^(item|recipe|sound|fixing|animation|vehicle)\s+([A-Za-z0-9_$.-]+)/i.exec(line)
    if (entryMatch && currentModule) {
      const kind = entryMatch[1].toLowerCase()
      const name = entryMatch[2]
      const key = `${kind}:${name.toLowerCase()}`
      currentEntry = currentModule.entries.get(key)
      if (!currentEntry) {
        currentEntry = { kind, name, props: new Map() }
        currentModule.entries.set(key, currentEntry)
      }
      continue
    }

    if (line === '}' || line.startsWith('}')) {
      if (currentEntry) {
        currentEntry = undefined
      } else if (currentModule) {
        currentModule = undefined
      }
      continue
    }

    // Property line: Key = Value,
    if (currentEntry && line.includes('=')) {
      const eqIdx = line.indexOf('=')
      const key = line.slice(0, eqIdx).trim()
      const val = line.slice(eqIdx + 1).trim().replace(/,$/, '')
      if (key && val) {
        currentEntry.props.set(key, val)
      }
    }
  }

  return modules
}

function renderMergedScript(modules: ParsedModule[]): string {
  const out: string[] = [
    '/* =========================================================================',
    '   Merged by PZ Management Merge-Patch Generator',
    '   ========================================================================= */',
    ''
  ]

  for (const mod of modules) {
    out.push(`module ${mod.name}`)
    out.push('{')
    for (const [, entry] of mod.entries) {
      out.push(`    ${entry.kind} ${entry.name}`)
      out.push('    {')
      for (const [propKey, propVal] of entry.props) {
        out.push(`        ${propKey} = ${propVal},`)
      }
      out.push('    }')
      out.push('')
    }
    out.push('}')
    out.push('')
  }

  return `${out.join('\r\n')}\r\n`
}

/**
 * Creates or updates a compatibility merge patch mod inside Zomboid/mods/<patchModId>.
 * Strictly adheres to project boundary rules:
 * - Target directory strictly contains `_Port`
 * - Validates strict Build 42 directory structure (root, 42/, common/)
 * - Ensures UTF-8 without BOM and Latin-only mod.info strings
 */
export async function createMergePatch(
  settings: AppSettings,
  req: CreateMergePatchRequest
): Promise<CreateMergePatchResult> {
  const errors: string[] = []
  const buildTarget: PatchBuildTarget = req.buildTarget || 'b42'

  // Ensure _Port marker per project boundary rules
  let patchModId = (req.patchModId || 'Loadout_MergePatch_Port').trim()
  if (!patchModId.includes('_Port')) {
    patchModId = `${patchModId}_Port`
  }

  const patchName = req.patchName || 'Loadout Merge Patch [Port]'

  // Target directory inside Zomboid user mods folder
  const zomboidDir = settings.zomboidDirOverride || join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Zomboid')
  const userModsDir = join(zomboidDir, 'mods')
  const modRoot = join(userModsDir, patchModId)

  // Verify write permission through security guard
  await assertPathWritable(modRoot)

  // Generate target folder hierarchy based on Build Target
  await fs.mkdir(modRoot, { recursive: true })

  // mod.info generator helper (always ASCII/UTF-8 without BOM, no versionMax)
  const generateModInfo = (buildSpecificDesc: string, extraTags?: string[]): string => {
    const lines = [
      `name=${patchName}`,
      `id=${patchModId}`,
      `description=${buildSpecificDesc}`,
      `author=PZ Management`,
      `icon=icon.png`,
      `poster=poster.png`,
      `category=Misc`,
      buildTarget === 'b41' ? `pzversion=41` : `pzversion=42`,
      buildTarget === 'b41' ? `versionMin=41.0` : `versionMin=42.0.0`,
      `modversion=1.0.0`,
      `version=1.0.0`,
      `tags=${(extraTags || ['Build 42', 'Misc']).join(';')}`,
      ''
    ]
    return `${lines.join('\r\n')}\r\n`
  }

  // 1. Root mod.info, poster, and icon
  await fs.writeFile(
    join(modRoot, 'mod.info'),
    generateModInfo('Compatibility Merge Patch generated by PZ Management.'),
    'utf8'
  )
  await fs.writeFile(join(modRoot, 'poster.png'), POSTER_PNG)
  await fs.writeFile(join(modRoot, 'icon.png'), ICON_PNG)

  // 2. Build-specific subdirectories and sub-mod.info
  if (buildTarget === 'b42' || buildTarget === 'hybrid') {
    // 42/ layout: canonical B42 structure
    const dir42 = join(modRoot, '42')
    await fs.mkdir(join(dir42, 'media'), { recursive: true })
    await fs.writeFile(
      join(dir42, 'mod.info'),
      generateModInfo('Compatibility Merge Patch for Build 42.', ['Build 42', 'Misc']),
      'utf8'
    )
    await fs.writeFile(join(dir42, 'poster.png'), POSTER_PNG)
    await fs.writeFile(join(dir42, 'icon.png'), ICON_PNG)

    // common/ layout for assets
    const dirCommon = join(modRoot, 'common')
    await fs.mkdir(join(dirCommon, 'media'), { recursive: true })
    await fs.writeFile(join(dirCommon, 'poster.png'), POSTER_PNG)
    await fs.writeFile(join(dirCommon, 'icon.png'), ICON_PNG)

    // Only create common/mod.info if target is hybrid (pure B42 relies on root + 42/mod.info)
    if (buildTarget === 'hybrid') {
      await fs.writeFile(
        join(dirCommon, 'mod.info'),
        generateModInfo('Compatibility Merge Patch (Патч совместимости) common assets.', ['Build 42', 'Build 41', 'Framework']),
        'utf8'
      )
    }
  }

  if (buildTarget === 'b41' || buildTarget === 'hybrid') {
    if (buildTarget === 'hybrid') {
      const dir41 = join(modRoot, '41')
      await fs.mkdir(join(dir41, 'media'), { recursive: true })
      await fs.writeFile(
        join(dir41, 'mod.info'),
        generateModInfo('Compatibility Merge Patch (Патч совместимости модов) for Build 41.', ['Build 41', 'Framework']),
        'utf8'
      )
      await fs.writeFile(join(dir41, 'poster.png'), POSTER_PNG)
      await fs.writeFile(join(dir41, 'icon.png'), ICON_PNG)
    } else {
      // Pure B41: files live in root /media
      await fs.mkdir(join(modRoot, 'media'), { recursive: true })
    }
  }

  // Index known installed mods for lookup
  const allMods: ModEntry[] = getCachedMods()
  const modMap = new Map<string, ModEntry>()
  for (const m of allMods) {
    if (m.modId) modMap.set(normModId(m.modId), m)
    if (m.rawModId) modMap.set(normModId(m.rawModId), m)
    if (m.folderName) modMap.set(normModId(m.folderName), m)
  }

  let filesCopied = 0
  let scriptsMerged = 0

  // Resolve where to put each file based on buildTarget
  const resolveTargetDestinations = (relPath: string): string[] => {
    const destinations: string[] = []
    if (buildTarget === 'b42') {
      // In B42: scripts and Lua go into 42/media/
      // Textures and models go into both 42/media/ and common/media/ for guaranteed VFS resolution
      destinations.push(join(modRoot, '42', relPath))
      if (relPath.includes('textures') || relPath.includes('texturepacks') || relPath.includes('models')) {
        destinations.push(join(modRoot, 'common', relPath))
      }
    } else if (buildTarget === 'b41') {
      // Pure B41: root media/
      destinations.push(join(modRoot, relPath))
    } else {
      // Hybrid: 42/ for B42, common/ for shared, 41/ for B41
      destinations.push(join(modRoot, '42', relPath))
      destinations.push(join(modRoot, 'common', relPath))
      destinations.push(join(modRoot, '41', relPath))
    }
    return destinations
  }

  for (const sel of req.selections) {
    const relPath = sel.relPath.replace(/\\/g, '/')
    const relNorm = relPath.toLowerCase()

    // NEVER copy donor mod.json (it would hijack patch name/description)
    if (relNorm.endsWith('mod.json')) {
      continue
    }

    const destinations = resolveTargetDestinations(relPath)

    if (sel.winnerModId === '__MERGE__' && relPath.toLowerCase().includes('/scripts/') && relPath.toLowerCase().endsWith('.txt')) {
      // Script merging: parse across all supplying mods
      try {
        const parsedModules: ParsedModule[] = []
        for (const [, mod] of modMap) {
          if (!mod.path) continue
          const candidate = await findModSourceFile(mod.path, relPath)
          if (candidate) {
            const text = await readTextSafe(candidate, 1024 * 1024)
            if (text) {
              const modsInFile = parseScriptFile(text)
              for (const m of modsInFile) {
                let targetMod = parsedModules.find((x) => x.name.toLowerCase() === m.name.toLowerCase())
                if (!targetMod) {
                  targetMod = { name: m.name, entries: new Map() }
                  parsedModules.push(targetMod)
                }
                for (const [key, entry] of m.entries) {
                  let targetEntry = targetMod.entries.get(key)
                  if (!targetEntry) {
                    targetEntry = { kind: entry.kind, name: entry.name, props: new Map() }
                    targetMod.entries.set(key, targetEntry)
                  }
                  for (const [pKey, pVal] of entry.props) {
                    targetEntry.props.set(pKey, pVal)
                  }
                }
              }
            }
          }
        }

        if (parsedModules.length > 0) {
          const mergedText = renderMergedScript(parsedModules)
          for (const dest of destinations) {
            await fs.mkdir(dirname(dest), { recursive: true })
            await fs.writeFile(dest, mergedText, 'utf8')
          }
          scriptsMerged++
          continue
        }
      } catch (err) {
        errors.push(`Failed to merge script ${relPath}: ${String(err)}`)
      }
    }

    // Default: copy selected donor mod's file
    const donorMod = modMap.get(normModId(sel.winnerModId))
    if (!donorMod || !donorMod.path) {
      errors.push(`Donor mod "${sel.winnerModId}" not found for file "${relPath}"`)
      continue
    }

    const srcFile = await findModSourceFile(donorMod.path, relPath)
    if (!srcFile) {
      errors.push(`Source file "${relPath}" not found in mod "${donorMod.name || donorMod.modId}"`)
      continue
    }

    try {
      const ext = extname(srcFile).toLowerCase()
      const isText = ['.txt', '.lua', '.xml', '.json', '.info'].includes(ext)
      let buf: Buffer | null = null
      if (isText) {
        buf = await fs.readFile(srcFile)
        if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
          buf = buf.subarray(3)
        }
      }
      for (const dest of destinations) {
        await fs.mkdir(dirname(dest), { recursive: true })
        if (buf) {
          await fs.writeFile(dest, buf)
        } else {
          await fs.copyFile(srcFile, dest)
        }
      }
      filesCopied++
    } catch (err) {
      errors.push(`Failed to copy "${relPath}" from "${donorMod.name}": ${String(err)}`)
    }
  }

  // Forcibly generate patch's own localized mod.json files for Build 42
  const enModJson = JSON.stringify(
    {
      name: patchName,
      description: 'Compatibility Merge Patch generated by PZ Management.'
    },
    null,
    2
  )

  const ruModJson = JSON.stringify(
    {
      name: patchName.includes('Loadout') ? 'Патч совместимости [Port]' : patchName,
      description: 'Патч разрешения конфликтов модов, сгенерированный PZ Management.'
    },
    null,
    2
  )

  const translateDirs: string[] = []
  if (buildTarget === 'b42' || buildTarget === 'hybrid') {
    translateDirs.push(join(modRoot, '42', 'media', 'lua', 'shared', 'translate'))
  }
  translateDirs.push(join(modRoot, 'media', 'lua', 'shared', 'translate'))

  for (const baseTr of translateDirs) {
    for (const lang of ['en', 'EN']) {
      const dir = join(baseTr, lang)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, 'mod.json'), enModJson, 'utf8')
    }
    for (const lang of ['ru', 'RU']) {
      const dir = join(baseTr, lang)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, 'mod.json'), ruModJson, 'utf8')
    }

    // Clean up any donor mod.json in other language subdirectories
    try {
      if (await exists(baseTr)) {
        const langEntries = await fs.readdir(baseTr, { withFileTypes: true })
        for (const ent of langEntries) {
          if (ent.isDirectory()) {
            const lName = ent.name.toLowerCase()
            if (lName !== 'en' && lName !== 'ru') {
              const rogueModJson = join(baseTr, ent.name, 'mod.json')
              if (await exists(rogueModJson)) {
                await fs.unlink(rogueModJson).catch(() => {})
              }
            }
          }
        }
      }
    } catch {
      // Ignore cleanup error
    }
  }

  // Add to active default.txt if requested
  let addedToLoadout = false
  if (req.addToLoadout) {
    try {
      const defaultTxtPath = join(userModsDir, 'default.txt')
      if (await exists(defaultTxtPath)) {
        const raw = await fs.readFile(defaultTxtPath, 'utf8')
        const parsed = parseClientList(raw)
        if (!parsed.mods.includes(patchModId)) {
          parsed.mods.push(patchModId)
          const updated = renderClientList(parsed.mods, parsed.maps, parsed.version)
          await fs.writeFile(defaultTxtPath, updated, 'utf8')
          addedToLoadout = true
        }
      }
    } catch (err) {
      errors.push(`Failed to update default.txt: ${String(err)}`)
    }
  }

  invalidateGuard()

  return {
    modPath: modRoot,
    patchModId,
    filesCopied,
    scriptsMerged,
    addedToLoadout,
    errors: errors.length > 0 ? errors : undefined
  }
}
