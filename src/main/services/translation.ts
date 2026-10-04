import { promises as fs } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type {
  ModTranslationData,
  ModTranslationEntry,
  SaveTranslationRequest,
  SaveTranslationResult
} from '../../shared/types'
import { isDir, readTextSafe, readdirSafe } from './fsx'
import { assertPathAllowed } from './guard'

/** Standard canonical PZ translation languages */
export const CANONICAL_LANGS = [
  'EN',
  'RU',
  'ES',
  'DE',
  'FR',
  'PL',
  'IT',
  'PT',
  'CN',
  'KO',
  'JA',
  'TR',
  'UK',
  'CS',
  'DA',
  'NL',
  'FI',
  'HU',
  'NO',
  'SV',
  'TH'
]

/** Parse a classic PZ Translate .txt file (e.g. ItemName_EN.txt) */
function parseClassicTxt(content: string): Map<string, string> {
  const map = new Map<string, string>()
  // Strip comments (-- comment or // comment)
  const cleaned = content.replace(/--.*$/gm, '').replace(/\/\/.*$/gm, '')

  // Matches Key = "Value" or Key = "Value",
  // Handles multiline or escaped quotes
  const regex = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(cleaned)) !== null) {
    const key = match[1]!.trim()
    // Unescape \" and \\
    const val = match[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    map.set(key, val)
  }
  return map
}

/** Parse JSON translation file */
function parseJson(content: string): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const obj = JSON.parse(content)
    if (typeof obj === 'object' && obj !== null) {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          map.set(k, v)
        }
      }
    }
  } catch {
    // ignore parse error
  }
  return map
}

/** Locate the primary Translate root inside a mod directory */
async function findTranslateRoots(modPath: string): Promise<string[]> {
  const candidates = [
    join(modPath, 'media', 'lua', 'shared', 'Translate'),
    join(modPath, '42', 'media', 'lua', 'shared', 'Translate'),
    join(modPath, 'common', 'media', 'lua', 'shared', 'Translate'),
    join(modPath, 'media', 'Translate'),
    join(modPath, 'Translate')
  ]

  const found: string[] = []
  for (const c of candidates) {
    if (await isDir(c)) {
      found.push(c)
    }
  }
  return found
}

/** Detect available languages in a Translate folder */
async function detectLanguages(roots: string[]): Promise<string[]> {
  const langs = new Set<string>()
  for (const root of roots) {
    const entries = await readdirSafe(root)
    for (const e of entries) {
      if (e.isDirectory()) {
        langs.add(e.name.toUpperCase())
      }
    }
  }
  return Array.from(langs).sort()
}

/** Extract file type from filename (e.g. ItemName_EN.txt -> ItemName) */
function getFileType(fileName: string, lang: string): string {
  const base = fileName.replace(extname(fileName), '')
  const langSuffix = `_${lang}`
  if (base.toUpperCase().endsWith(langSuffix.toUpperCase())) {
    return base.substring(0, base.length - langSuffix.length)
  }
  return base
}

/**
 * Scan all translations for a given mod, comparing source (e.g. EN) and target (e.g. RU).
 */
export async function scanModTranslations(
  modPath: string,
  targetLangInput?: string
): Promise<ModTranslationData> {
  await assertPathAllowed(modPath)

  const modName = basename(modPath)
  const roots = await findTranslateRoots(modPath)

  const availableLangs = await detectLanguages(roots)
  if (!availableLangs.includes('EN')) availableLangs.unshift('EN')
  if (!availableLangs.includes('RU')) availableLangs.push('RU')

  const sourceLang = 'EN'
  const targetLang = (targetLangInput || 'RU').toUpperCase()

  // Storage for source entries and target entries by fileType -> key -> value
  const sourceStore = new Map<string, Map<string, string>>() // fileType -> (key -> text)
  const targetStore = new Map<string, Map<string, string>>() // fileType -> (key -> text)

  for (const root of roots) {
    // 1. Read Source Language (e.g. EN)
    const sourceDir = join(root, sourceLang)
    if (await isDir(sourceDir)) {
      const files = await readdirSafe(sourceDir)
      for (const f of files) {
        if (!f.isFile()) continue
        const filePath = join(sourceDir, f.name)
        const content = await readTextSafe(filePath)
        if (!content) continue

        const fileType = getFileType(f.name, sourceLang)
        let parsed = new Map<string, string>()
        if (f.name.endsWith('.json')) {
          parsed = parseJson(content)
        } else if (f.name.endsWith('.txt')) {
          parsed = parseClassicTxt(content)
        }

        if (!sourceStore.has(fileType)) sourceStore.set(fileType, new Map())
        const store = sourceStore.get(fileType)!
        for (const [k, v] of parsed) {
          store.set(k, v)
        }
      }
    }

    // 2. Read Target Language (e.g. RU)
    const targetDir = join(root, targetLang)
    if (await isDir(targetDir)) {
      const files = await readdirSafe(targetDir)
      for (const f of files) {
        if (!f.isFile()) continue
        const filePath = join(targetDir, f.name)
        const content = await readTextSafe(filePath)
        if (!content) continue

        const fileType = getFileType(f.name, targetLang)
        let parsed = new Map<string, string>()
        if (f.name.endsWith('.json')) {
          parsed = parseJson(content)
        } else if (f.name.endsWith('.txt')) {
          parsed = parseClassicTxt(content)
        }

        if (!targetStore.has(fileType)) targetStore.set(fileType, new Map())
        const store = targetStore.get(fileType)!
        for (const [k, v] of parsed) {
          store.set(k, v)
        }
      }
    }
  }

  // If no source files were found, but target files exist, populate sourceStore with keys
  for (const [fileType, tMap] of targetStore) {
    if (!sourceStore.has(fileType)) {
      sourceStore.set(fileType, new Map())
    }
    const sMap = sourceStore.get(fileType)!
    for (const [k, v] of tMap) {
      if (!sMap.has(k)) {
        sMap.set(k, v)
      }
    }
  }

  // Compile entries
  const entries: ModTranslationEntry[] = []
  let translatedCount = 0
  let missingCount = 0

  for (const [fileType, sMap] of sourceStore) {
    const tMap = targetStore.get(fileType)
    for (const [key, sourceText] of sMap) {
      const targetText = tMap?.get(key) ?? ''
      const isMissing = !targetText.trim() || (sourceLang !== targetLang && targetText === sourceText)

      if (isMissing) {
        missingCount++
      } else {
        translatedCount++
      }

      entries.push({
        key,
        sourceText,
        targetText,
        fileType,
        isMissing
      })
    }
  }

  return {
    modKey: modPath,
    modName,
    modPath,
    sourceLang,
    targetLang,
    availableLangs,
    entries,
    totalCount: entries.length,
    translatedCount,
    missingCount
  }
}

/**
 * Save updated translations for a mod strictly in UTF-8 without BOM.
 */
export async function saveModTranslations(
  req: SaveTranslationRequest
): Promise<SaveTranslationResult> {
  const { modPath, targetLang, entries } = req
  await assertPathAllowed(modPath)

  if (!entries || entries.length === 0) {
    return { ok: true, savedFiles: [], totalSaved: 0 }
  }

  // Pick or create primary Translate folder
  const roots = await findTranslateRoots(modPath)
  let primaryRoot = roots[0]
  if (!primaryRoot) {
    // Default to B42 standard or classic
    primaryRoot = join(modPath, 'media', 'lua', 'shared', 'Translate')
  }

  const targetDir = join(primaryRoot, targetLang.toUpperCase())
  await fs.mkdir(targetDir, { recursive: true })

  // Group entries by fileType
  const groups = new Map<string, Array<{ key: string; targetText: string }>>()
  for (const e of entries) {
    if (!groups.has(e.fileType)) groups.set(e.fileType, [])
    groups.get(e.fileType)!.push({ key: e.key, targetText: e.targetText })
  }

  const savedFiles: string[] = []
  let totalSaved = 0

  for (const [fileType, list] of groups) {
    const fileName = `${fileType}_${targetLang.toUpperCase()}.txt`
    const targetFilePath = join(targetDir, fileName)

    // Build classic PZ format
    const lines: string[] = []
    lines.push(`${fileType}_${targetLang.toUpperCase()} = {`)
    for (const item of list) {
      const escaped = item.targetText.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      lines.push(`    ${item.key} = "${escaped}",`)
      totalSaved++
    }
    lines.push('}')
    lines.push('') // Trailing newline

    const fileContent = lines.join('\r\n')
    // Write strictly in UTF-8 without BOM (Buffer.from with utf8 does NOT include BOM)
    await fs.writeFile(targetFilePath, Buffer.from(fileContent, 'utf8'))
    savedFiles.push(targetFilePath)
  }

  return {
    ok: true,
    savedFiles,
    totalSaved
  }
}
