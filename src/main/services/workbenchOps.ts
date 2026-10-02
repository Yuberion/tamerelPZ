import { promises as fs } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type {
  AppSettings,
  DeployToGameRequest,
  DeployToGameResult,
  QuickFixRequest,
  QuickFixResult
} from '../../shared/types'
import { assertPathAllowed, assertPathWritable, invalidateGuard } from './guard'
import { extOf, readdirSafe, readTextSafe, stripBom } from './fsx'
import { detectPaths } from './paths'
import { parseModInfo, first } from './modinfo'

/**
 * Executes an automated quick-fix on a mod folder.
 * Guaranteed safe: only modifies the intended syntax/hygiene defects.
 */
export async function executeQuickFix(req: QuickFixRequest): Promise<QuickFixResult> {
  const modRoot = await assertPathWritable(req.modPath)
  const fixedFiles: string[] = []

  try {
    switch (req.action) {
      case 'all': {
        // 1. Strip BOM
        const targetFiles = await collectTextFiles(modRoot)
        for (const file of targetFiles) {
          const abs = normalize(file)
          await assertPathWritable(abs)
          const buf = await fs.readFile(abs)
          if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
            await fs.writeFile(abs, buf.subarray(3))
            fixedFiles.push(abs)
          } else {
            const text = buf.toString('utf8')
            if (text.charCodeAt(0) === 0xfeff) {
              await fs.writeFile(abs, text.slice(1), 'utf8')
              fixedFiles.push(abs)
            }
          }
        }

        // 2. Remove versionMax=
        const infoFiles = await findModInfoFiles(modRoot)
        for (const infoFile of infoFiles) {
          await assertPathWritable(infoFile)
          const text = await fs.readFile(infoFile, 'utf8')
          const lines = text.split(/\r?\n/)
          const filtered = lines.filter((line) => !/^\s*versionmax\s*=/i.test(line))
          if (filtered.length !== lines.length) {
            await fs.writeFile(infoFile, filtered.join('\n'), 'utf8')
            if (!fixedFiles.includes(infoFile)) fixedFiles.push(infoFile)
          }
        }

        // 3. Fix sandbox-options.txt VERSION = 1,
        const sbFiles = await findSandboxOptionsFiles(modRoot)
        for (const sbFile of sbFiles) {
          await assertPathWritable(sbFile)
          const raw = await fs.readFile(sbFile, 'utf8')
          const clean = stripBom(raw)
          const lines = clean.split(/\r?\n/)
          let modified = false
          let foundVersion = false
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (/^\s*VERSION\s*=\s*1\s*,/i.test(line)) {
              foundVersion = true
              break
            }
            if (/^\s*VERSION\s*=\s*1(?!\s*,)/i.test(line)) {
              lines[i] = 'VERSION = 1,'
              foundVersion = true
              modified = true
              break
            }
          }
          if (!foundVersion) {
            lines.unshift('VERSION = 1,')
            modified = true
          }
          if (modified || raw !== clean) {
            await fs.writeFile(sbFile, lines.join('\n'), 'utf8')
            if (!fixedFiles.includes(sbFile)) fixedFiles.push(sbFile)
          }
        }
        break
      }

      case 'strip-bom': {
        // Find files with UTF-8 BOM
        const targetFiles = req.files && req.files.length > 0 ? req.files : await collectTextFiles(modRoot)
        for (const file of targetFiles) {
          const abs = normalize(file)
          await assertPathWritable(abs)
          const buf = await fs.readFile(abs)
          if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
            await fs.writeFile(abs, buf.subarray(3))
            fixedFiles.push(abs)
          } else {
            // Also check charCode 0xfeff in utf-8
            const text = buf.toString('utf8')
            if (text.charCodeAt(0) === 0xfeff) {
              await fs.writeFile(abs, text.slice(1), 'utf8')
              fixedFiles.push(abs)
            }
          }
        }
        break
      }

      case 'remove-version-max': {
        // Find mod.info files in the mod root and subfolders
        const infoFiles = await findModInfoFiles(modRoot)
        for (const infoFile of infoFiles) {
          await assertPathWritable(infoFile)
          const text = await fs.readFile(infoFile, 'utf8')
          const lines = text.split(/\r?\n/)
          const filtered = lines.filter((line) => !/^\s*versionmax\s*=/i.test(line))
          if (filtered.length !== lines.length) {
            await fs.writeFile(infoFile, filtered.join('\n'), 'utf8')
            fixedFiles.push(infoFile)
          }
        }
        break
      }

      case 'fix-sandbox-version': {
        // Find sandbox-options.txt in media/ or common/media/
        const sbFiles = await findSandboxOptionsFiles(modRoot)
        for (const sbFile of sbFiles) {
          await assertPathWritable(sbFile)
          const raw = await fs.readFile(sbFile, 'utf8')
          const clean = stripBom(raw)
          const lines = clean.split(/\r?\n/)
          let modified = false
          let foundVersion = false

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (/^\s*VERSION\s*=\s*1\s*,/i.test(line)) {
              foundVersion = true
              break
            }
            if (/^\s*VERSION\s*=\s*1(?!\s*,)/i.test(line)) {
              lines[i] = 'VERSION = 1,'
              foundVersion = true
              modified = true
              break
            }
          }

          if (!foundVersion) {
            lines.unshift('VERSION = 1,')
            modified = true
          }

          if (modified || raw !== clean) {
            await fs.writeFile(sbFile, lines.join('\n'), 'utf8')
            fixedFiles.push(sbFile)
          }
        }
        break
      }

      default:
        throw new Error(`Unknown quick fix action: ${(req as { action: string }).action}`)
    }

    invalidateGuard()
    return { ok: true, action: req.action, fixedFiles }
  } catch (err) {
    return {
      ok: false,
      action: req.action,
      fixedFiles,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Deploys/syncs a mod folder directly into the user's active local mods folder (Zomboid/mods/<modId>).
 */
export async function deployModToGame(
  settings: AppSettings,
  req: DeployToGameRequest
): Promise<DeployToGameResult> {
  const started = Date.now()
  const sourceRoot = await assertPathAllowed(req.modPath)

  try {
    const paths = await detectPaths(settings)
    if (!paths.zomboidDir) {
      throw new Error('Zomboid user folder not detected (no paths.zomboidDir).')
    }

    // Determine target mod ID
    let modId = req.targetModId?.trim()
    if (!modId) {
      // Try to read id from mod.info
      const infoFiles = await findModInfoFiles(sourceRoot)
      if (infoFiles.length > 0) {
        const text = await readTextSafe(infoFiles[0], 64 * 1024)
        if (text) {
          const parsed = parseModInfo(text)
          modId = first(parsed, 'id')?.trim()
        }
      }
    }
    if (!modId) {
      // Fallback to directory name
      modId = sourceRoot.split(sep).filter(Boolean).pop() ?? 'Mod'
    }

    // Clean bare mod ID if it had workshop prefix: 12345/MyMod -> MyMod
    const bareModId = /^\d+\/(.+)$/.exec(modId)?.[1]?.trim() ?? modId
    const targetDir = normalize(join(paths.zomboidDir, 'mods', bareModId))

    // Check if source and destination are the exact same folder
    if (normalize(sourceRoot).toLowerCase() === targetDir.toLowerCase()) {
      return {
        ok: true,
        destPath: targetDir,
        copiedFiles: 0,
        bytes: 0,
        isExistingLocalMod: true,
        durationMs: Date.now() - started
      }
    }

    // Target must be inside writable roots
    await assertPathWritable(targetDir)

    // Clean existing destination if requested
    if (req.cleanExisting) {
      try {
        await fs.rm(targetDir, { recursive: true, force: true })
      } catch {
        // ignore if not existing
      }
    }

    await fs.mkdir(targetDir, { recursive: true })

    // Copy tree recursively
    let copiedFiles = 0
    let totalBytes = 0

    const copyRecursive = async (src: string, dst: string): Promise<void> => {
      const entries = await readdirSafe(src)
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const s = join(src, entry.name)
        const d = join(dst, entry.name)

        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase()
          if (lower === '.git' || lower === '.svn' || lower === 'node_modules') continue
          await fs.mkdir(d, { recursive: true })
          await copyRecursive(s, d)
        } else {
          let buf = await fs.readFile(s)
          // Strip BOM if requested
          if (req.stripBom) {
            const ext = extOf(entry.name)
            if (ext === 'lua' || ext === 'txt' || ext === 'json' || entry.name.toLowerCase() === 'mod.info') {
              if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
                buf = buf.subarray(3)
              }
            }
          }
          await fs.writeFile(d, buf)
          copiedFiles++
          totalBytes += buf.length
        }
      }
    }

    await copyRecursive(sourceRoot, targetDir)
    invalidateGuard()

    return {
      ok: true,
      destPath: targetDir,
      copiedFiles,
      bytes: totalBytes,
      isExistingLocalMod: false,
      durationMs: Date.now() - started
    }
  } catch (err) {
    return {
      ok: false,
      destPath: '',
      copiedFiles: 0,
      bytes: 0,
      isExistingLocalMod: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/* ------------------------------------------------------------- helpers ---- */

async function collectTextFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  const stack = [dir]

  while (stack.length) {
    const current = stack.pop()!
    const entries = await readdirSafe(current)
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase()
        if (lower === '.git' || lower === 'node_modules') continue
        stack.push(abs)
      } else {
        const ext = extOf(entry.name)
        if (ext === 'lua' || ext === 'txt' || ext === 'json' || entry.name.toLowerCase() === 'mod.info') {
          result.push(abs)
        }
      }
    }
  }

  return result
}

async function findModInfoFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  const rootInfo = join(dir, 'mod.info')
  try {
    await fs.access(rootInfo)
    result.push(rootInfo)
  } catch {
    // not in root
  }

  const entries = await readdirSafe(dir)
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const candidate = join(dir, entry.name, 'mod.info')
      try {
        await fs.access(candidate)
        result.push(candidate)
      } catch {
        // continue
      }
    }
  }

  return result
}

async function findSandboxOptionsFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  const candidates = [
    join(dir, 'media', 'sandbox-options.txt'),
    join(dir, 'common', 'media', 'sandbox-options.txt'),
    join(dir, '42', 'media', 'sandbox-options.txt')
  ]

  for (const c of candidates) {
    try {
      await fs.access(c)
      result.push(c)
    } catch {
      // ignore
    }
  }

  return result
}
