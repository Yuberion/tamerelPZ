/**
 * Stalker backend services: 3D mesh preview, global mod grep, and vanilla overwrites detection.
 */
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { AppSettings } from '../../shared/types'
import { exists, extOf, isDir, readTextSafe, readdirSafe } from './fsx'
import { detectGameDir } from './paths'
import { getCachedMods } from './scanner'
import { importObj, importPly, importStl, meshName, type MeshImport, type RawMesh } from './mesh'
import { importCollada, importDirectX, importGltf } from './meshdcc'

/* =========================================================================
   1. 3D Mesh Preview Extraction
   ========================================================================= */

export interface MeshPreviewData {
  ok: boolean
  format: string
  meshName: string
  vertexCount: number
  triangleCount: number
  positions: number[]
  normals: number[]
  error?: string
}

/** Flatten RawMesh polygons into flat triangle vertex and normal buffers */
function flattenMeshTriangles(mesh: RawMesh): { positions: number[]; normals: number[] } {
  const positions: number[] = []
  const normals: number[] = []

  let cornerIdx = 0
  for (const poly of mesh.polygons) {
    const polyLen = poly.length
    if (polyLen < 3) {
      cornerIdx += polyLen
      continue
    }

    // Fan triangulation: (v0, vi, vi+1)
    const v0 = poly[0]
    const c0 = cornerIdx

    for (let i = 1; i < polyLen - 1; i++) {
      const v1 = poly[i]
      const v2 = poly[i + 1]
      const c1 = cornerIdx + i
      const c2 = cornerIdx + i + 1

      // Vertex 0
      positions.push(
        mesh.positions[v0 * 3] ?? 0,
        mesh.positions[v0 * 3 + 1] ?? 0,
        mesh.positions[v0 * 3 + 2] ?? 0
      )
      // Vertex 1
      positions.push(
        mesh.positions[v1 * 3] ?? 0,
        mesh.positions[v1 * 3 + 1] ?? 0,
        mesh.positions[v1 * 3 + 2] ?? 0
      )
      // Vertex 2
      positions.push(
        mesh.positions[v2 * 3] ?? 0,
        mesh.positions[v2 * 3 + 1] ?? 0,
        mesh.positions[v2 * 3 + 2] ?? 0
      )

      // Normals if present per corner
      if (mesh.normals.length > 0) {
        normals.push(
          mesh.normals[c0 * 3] ?? 0,
          mesh.normals[c0 * 3 + 1] ?? 1,
          mesh.normals[c0 * 3 + 2] ?? 0,
          mesh.normals[c1 * 3] ?? 0,
          mesh.normals[c1 * 3 + 1] ?? 1,
          mesh.normals[c1 * 3 + 2] ?? 0,
          mesh.normals[c2 * 3] ?? 0,
          mesh.normals[c2 * 3 + 1] ?? 1,
          mesh.normals[c2 * 3 + 2] ?? 0
        )
      }
    }

    cornerIdx += polyLen
  }

  return { positions, normals }
}

export async function parseMeshForPreview(filePath: string): Promise<MeshPreviewData> {
  if (!(await exists(filePath))) {
    return {
      ok: false,
      format: 'unknown',
      meshName: '',
      vertexCount: 0,
      triangleCount: 0,
      positions: [],
      normals: [],
      error: 'File not found'
    }
  }

  const ext = extOf(filePath).toLowerCase()
  let imported: MeshImport | undefined

  try {
    const buf = await fs.readFile(filePath)

    if (ext === 'x') {
      imported = importDirectX(buf, filePath)
    } else if (ext === 'obj') {
      imported = importObj(buf.toString('utf8'), filePath)
    } else if (ext === 'stl') {
      imported = importStl(buf, filePath)
    } else if (ext === 'ply') {
      imported = importPly(buf, filePath)
    } else if (ext === 'dae') {
      imported = importCollada(buf.toString('utf8'), filePath)
    } else if (ext === 'gltf' || ext === 'glb') {
      imported = await importGltf(buf, basename(filePath), filePath)
    } else {
      return {
        ok: false,
        format: ext,
        meshName: basename(filePath),
        vertexCount: 0,
        triangleCount: 0,
        positions: [],
        normals: [],
        error: `Unsupported 3D mesh extension: .${ext}`
      }
    }
  } catch (err) {
    return {
      ok: false,
      format: ext,
      meshName: basename(filePath),
      vertexCount: 0,
      triangleCount: 0,
      positions: [],
      normals: [],
      error: `Failed to parse 3D mesh: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (!imported || imported.meshes.length === 0) {
    return {
      ok: false,
      format: ext,
      meshName: basename(filePath),
      vertexCount: 0,
      triangleCount: 0,
      positions: [],
      normals: [],
      error: 'No 3D geometry found in file'
    }
  }

  // Combine meshes into single preview buffer
  const allPositions: number[] = []
  const allNormals: number[] = []
  let totalTris = 0
  let totalVerts = 0

  for (const m of imported.meshes) {
    totalVerts += m.positions.length / 3
    const { positions, normals } = flattenMeshTriangles(m)
    allPositions.push(...positions)
    allNormals.push(...normals)
    totalTris += positions.length / 9
  }

  return {
    ok: true,
    format: imported.format || ext,
    meshName: imported.meshes[0]?.name || meshName(filePath),
    vertexCount: totalVerts,
    triangleCount: totalTris,
    positions: allPositions,
    normals: allNormals
  }
}

/* =========================================================================
   2. Vanilla Overwrite Detection
   ========================================================================= */

/** Cache of relative paths present in vanilla Project Zomboid media directory */
let vanillaMediaCache: Set<string> | null = null

export async function getVanillaMediaFiles(settings: AppSettings): Promise<Set<string>> {
  if (vanillaMediaCache) return vanillaMediaCache

  const gameDir = await detectGameDir(settings)
  const set = new Set<string>()
  if (!gameDir) return set

  const mediaRoot = join(gameDir, 'media')
  if (!(await isDir(mediaRoot))) return set

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdirSafe(dir)
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${ent.name.toLowerCase()}` : ent.name.toLowerCase()
      if (ent.isDirectory()) {
        await walk(join(dir, ent.name), rel)
      } else {
        set.add(`media/${rel}`)
      }
    }
  }

  try {
    await walk(mediaRoot, '')
  } catch (err) {
    console.warn('[stalker] Failed to scan vanilla media files:', err)
  }

  vanillaMediaCache = set
  return set
}

export async function checkVanillaOverwrites(
  settings: AppSettings,
  modPath: string
): Promise<string[]> {
  const vanillaFiles = await getVanillaMediaFiles(settings)
  if (vanillaFiles.size === 0) return []

  const overwrites: string[] = []

  // Check media/ in mod, and 42/media, common/media
  const roots = [
    { dir: join(modPath, 'media'), prefix: 'media' },
    { dir: join(modPath, 'common', 'media'), prefix: 'media' },
    { dir: join(modPath, '42', 'media'), prefix: 'media' }
  ]

  for (const root of roots) {
    if (!(await isDir(root.dir))) continue

    async function walk(dir: string, relPrefix: string): Promise<void> {
      const entries = await readdirSafe(dir)
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue
        const rel = `${relPrefix}/${ent.name}`
        const norm = rel.toLowerCase().replace(/\\/g, '/')
        if (ent.isDirectory()) {
          await walk(join(dir, ent.name), rel)
        } else {
          if (vanillaFiles.has(norm)) {
            overwrites.push(join(dir, ent.name))
          }
        }
      }
    }

    await walk(root.dir, root.prefix)
  }

  return overwrites
}

/* =========================================================================
   3. Global Mod Grep (Full-Text Code Search Across All Mods)
   ========================================================================= */

export interface ModGrepRequest {
  query: string
  caseSensitive?: boolean
  fileExtensions?: string[]
  maxResults?: number
}

export interface ModGrepMatch {
  modKey: string
  modName: string
  filePath: string
  relPath: string
  line: number
  snippet: string
}

export async function grepAllMods(req: ModGrepRequest): Promise<ModGrepMatch[]> {
  const query = req.query.trim()
  if (!query || query.length < 2) return []

  const caseSensitive = Boolean(req.caseSensitive)
  const maxResults = req.maxResults || 250
  const allowedExts = new Set(
    (req.fileExtensions && req.fileExtensions.length > 0
      ? req.fileExtensions
      : ['lua', 'txt', 'xml', 'ini', 'json']
    ).map((e) => e.toLowerCase().replace(/^\./, ''))
  )

  const allMods = getCachedMods()
  const results: ModGrepMatch[] = []

  const target = caseSensitive ? query : query.toLowerCase()

  for (const mod of allMods) {
    if (results.length >= maxResults) break
    if (!mod.path || !(await isDir(mod.path))) continue

    async function scanDir(dir: string): Promise<void> {
      if (results.length >= maxResults) return
      const entries = await readdirSafe(dir)
      for (const ent of entries) {
        if (results.length >= maxResults) return
        if (ent.name.startsWith('.')) continue

        const fullPath = join(dir, ent.name)
        if (ent.isDirectory()) {
          // Skip hidden, git, cache, audio banks
          if (/^(?:\.git|\.svn|node_modules|cache)$/i.test(ent.name)) continue
          await scanDir(fullPath)
        } else {
          const ext = extname(ent.name).slice(1).toLowerCase()
          if (!allowedExts.has(ext)) continue

          try {
            const content = await readTextSafe(fullPath, 512 * 1024)
            if (!content) continue

            const lines = content.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break
              const lineText = lines[i]
              const hay = caseSensitive ? lineText : lineText.toLowerCase()
              if (hay.includes(target)) {
                results.push({
                  modKey: mod.key,
                  modName: mod.name,
                  filePath: fullPath,
                  relPath: relative(mod.path, fullPath).replace(/\\/g, '/'),
                  line: i + 1,
                  snippet: lineText.trim()
                })
              }
            }
          } catch {
            // Ignore individual file read error
          }
        }
      }
    }

    await scanDir(mod.path)
  }

  return results
}
