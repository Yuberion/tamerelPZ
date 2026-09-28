/**
 * Explorer backend services: 3D mesh preview, global mod grep, and vanilla overwrites detection.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { AppSettings, MeshPreviewData } from '../../shared/types'
import { exists, extOf, isDir, readTextSafe, readdirSafe } from './fsx'
import { detectGameDir } from './paths'
import { getCachedMods } from './scanner'
import { importObj, importPly, importStl, meshName, newMesh, type MeshImport, type RawMesh } from './mesh'
import { importCollada, importDirectX, importGltf } from './meshdcc'
import { decodeFbxBinary, type FbxNode, type FbxProp } from './fbxbin'
import { pzFileUrl } from '../../shared/ipc'

/* =========================================================================
   1. 3D Mesh Preview Extraction
   ========================================================================= */

export type { MeshPreviewData }

function fbxPropVal(prop?: FbxProp): unknown {
  return prop && 'v' in prop ? prop.v : undefined
}

/** Flatten RawMesh polygons into flat triangle vertex, normal and UV buffers without intermediate array spread */
function flattenMeshTriangles(
  mesh: RawMesh,
  outPositions: number[],
  outNormals: number[],
  outUvs: number[]
): number {
  let trianglesAdded = 0
  let cornerIdx = 0
  const hasNormals = mesh.normals.length > 0
  const hasUvs = mesh.uvs.length > 0

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
      outPositions.push(
        mesh.positions[v0 * 3] ?? 0,
        mesh.positions[v0 * 3 + 1] ?? 0,
        mesh.positions[v0 * 3 + 2] ?? 0
      )
      // Vertex 1
      outPositions.push(
        mesh.positions[v1 * 3] ?? 0,
        mesh.positions[v1 * 3 + 1] ?? 0,
        mesh.positions[v1 * 3 + 2] ?? 0
      )
      // Vertex 2
      outPositions.push(
        mesh.positions[v2 * 3] ?? 0,
        mesh.positions[v2 * 3 + 1] ?? 0,
        mesh.positions[v2 * 3 + 2] ?? 0
      )

      // Normals
      if (hasNormals) {
        outNormals.push(
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

      // UVs
      if (hasUvs) {
        outUvs.push(
          mesh.uvs[c0 * 2] ?? 0,
          mesh.uvs[c0 * 2 + 1] ?? 0,
          mesh.uvs[c1 * 2] ?? 0,
          mesh.uvs[c1 * 2 + 1] ?? 0,
          mesh.uvs[c2 * 2] ?? 0,
          mesh.uvs[c2 * 2 + 1] ?? 0
        )
      }

      trianglesAdded++
    }

    cornerIdx += polyLen
  }

  return trianglesAdded
}

/** Import FBX mesh (binary or ASCII) and extract embedded texture references */
function importFbx(buf: Buffer, filePath: string): { imported: MeshImport; textureHints: string[] } {
  const textureHints: string[] = []
  const meshes: RawMesh[] = []

  const isBinary = buf.length >= 23 && buf.subarray(0, 20).toString('latin1').startsWith('Kaydara FBX Binary')

  if (isBinary) {
    try {
      const { root } = decodeFbxBinary(buf)

      // Collect texture hints
      const collectHints = (n: FbxNode): void => {
        if (n.name === 'Texture' || n.name === 'Video') {
          for (const c of n.children) {
            if (c.name === 'FileName' || c.name === 'RelativeFilename' || c.name === 'Filename') {
              for (const p of c.props) {
                const val = fbxPropVal(p)
                if (typeof val === 'string' && val.trim().length > 0) {
                  textureHints.push(val.trim())
                }
              }
            }
          }
        }
        for (const child of n.children) collectHints(child)
      }
      collectHints(root)

      // Find Geometry nodes
      const geometries: FbxNode[] = []
      const findGeos = (n: FbxNode): void => {
        if (n.name === 'Geometry') geometries.push(n)
        for (const child of n.children) findGeos(child)
      }
      findGeos(root)

      for (let gIdx = 0; gIdx < geometries.length; gIdx++) {
        const geo = geometries[gIdx]
        const nameProp = fbxPropVal(geo.props.find((p) => typeof fbxPropVal(p) === 'string' && String(fbxPropVal(p)).includes('Model'))) || `mesh_${gIdx}`
        const mesh = newMesh(String(nameProp).replace(/.*::/, '') || `mesh_${gIdx}`)

        // Vertices
        const vertNode = geo.children.find((c) => c.name === 'Vertices')
        const rawVerts = vertNode?.props.find((p) => p.t === 'd' || p.t === 'f')?.v as ArrayLike<number> | undefined
        if (rawVerts) {
          for (let i = 0; i < rawVerts.length; i++) mesh.positions.push(rawVerts[i])
        }

        // PolygonVertexIndex (negative indexes mark end of polygon)
        const polyNode = geo.children.find((c) => c.name === 'PolygonVertexIndex')
        const rawIndices = polyNode?.props.find((p) => p.t === 'i')?.v as ArrayLike<number> | undefined
        if (rawIndices) {
          const poly: number[] = []
          for (let i = 0; i < rawIndices.length; i++) {
            const idx = rawIndices[i]
            if (idx < 0) {
              poly.push(~idx)
              if (poly.length >= 3) mesh.polygons.push([...poly])
              poly.length = 0
            } else {
              poly.push(idx)
            }
          }
        }

        // Normals
        const normNode = geo.children.find((c) => c.name === 'LayerElementNormal')
        if (normNode) {
          const rawNormals = normNode.children.find((c) => c.name === 'Normals')?.props.find((p) => p.t === 'd' || p.t === 'f')?.v as ArrayLike<number> | undefined
          const mapType = fbxPropVal(normNode.children.find((c) => c.name === 'MappingInformationType')?.props[0])
          const refType = fbxPropVal(normNode.children.find((c) => c.name === 'ReferenceInformationType')?.props[0])

          if (rawNormals) {
            if (mapType === 'ByPolygonVertex' && refType === 'Direct') {
              for (let i = 0; i < rawNormals.length; i++) mesh.normals.push(rawNormals[i])
            } else if (mapType === 'ByControlPoint') {
              for (const poly of mesh.polygons) {
                for (const v of poly) {
                  mesh.normals.push(
                    rawNormals[v * 3] ?? 0,
                    rawNormals[v * 3 + 1] ?? 1,
                    rawNormals[v * 3 + 2] ?? 0
                  )
                }
              }
            }
          }
        }

        // UVs
        const uvNode = geo.children.find((c) => c.name === 'LayerElementUV')
        if (uvNode) {
          const rawUvs = uvNode.children.find((c) => c.name === 'UV')?.props.find((p) => p.t === 'd' || p.t === 'f')?.v as ArrayLike<number> | undefined
          const uvIndices = uvNode.children.find((c) => c.name === 'UVIndex')?.props.find((p) => p.t === 'i')?.v as ArrayLike<number> | undefined
          const mapType = fbxPropVal(uvNode.children.find((c) => c.name === 'MappingInformationType')?.props[0])
          const refType = fbxPropVal(uvNode.children.find((c) => c.name === 'ReferenceInformationType')?.props[0])

          if (rawUvs) {
            if (refType === 'IndexToDirect' && uvIndices) {
              if (mapType === 'ByPolygonVertex') {
                let corner = 0
                for (const poly of mesh.polygons) {
                  for (let c = 0; c < poly.length; c++) {
                    const uIdx = uvIndices[corner++] ?? 0
                    mesh.uvs.push(rawUvs[uIdx * 2] ?? 0, rawUvs[uIdx * 2 + 1] ?? 0)
                  }
                }
              } else if (mapType === 'ByControlPoint') {
                for (const poly of mesh.polygons) {
                  for (const v of poly) {
                    const uIdx = uvIndices[v] ?? 0
                    mesh.uvs.push(rawUvs[uIdx * 2] ?? 0, rawUvs[uIdx * 2 + 1] ?? 0)
                  }
                }
              }
            } else if (refType === 'Direct') {
              if (mapType === 'ByPolygonVertex') {
                for (let i = 0; i < rawUvs.length; i++) mesh.uvs.push(rawUvs[i])
              } else if (mapType === 'ByControlPoint') {
                for (const poly of mesh.polygons) {
                  for (const v of poly) {
                    mesh.uvs.push(rawUvs[v * 2] ?? 0, rawUvs[v * 2 + 1] ?? 0)
                  }
                }
              }
            }
          }
        }

        if (mesh.positions.length > 0 && mesh.polygons.length > 0) {
          meshes.push(mesh)
        }
      }

      return {
        imported: {
          format: 'fbx-binary',
          meshes
        },
        textureHints
      }
    } catch (err) {
      console.warn('[explorer] Failed to parse binary FBX:', err)
    }
  }

  // ASCII FBX fallback
  const text = buf.toString('utf8')
  const hintMatches = text.matchAll(/(?:RelativeFilename|FileName|TextureName):\s*"([^"]+)"/gi)
  for (const m of hintMatches) {
    if (m[1]) textureHints.push(m[1])
  }

  const asciiMesh = newMesh(meshName(filePath))
  const vertMatch = /Vertices:\s*\*?\d*\s*\{\s*a:\s*([^}]+)\}/i.exec(text)
  if (vertMatch) {
    const nums = vertMatch[1].match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g)
    if (nums) {
      for (let i = 0; i < nums.length; i++) asciiMesh.positions.push(Number(nums[i]))
    }
  }

  const polyMatch = /PolygonVertexIndex:\s*\*?\d*\s*\{\s*a:\s*([^}]+)\}/i.exec(text)
  if (polyMatch) {
    const nums = polyMatch[1].match(/-?\d+/g)
    if (nums) {
      const poly: number[] = []
      for (let i = 0; i < nums.length; i++) {
        const idx = parseInt(nums[i], 10)
        if (idx < 0) {
          poly.push(~idx)
          if (poly.length >= 3) asciiMesh.polygons.push([...poly])
          poly.length = 0
        } else {
          poly.push(idx)
        }
      }
    }
  }

  const normMatch = /Normals:\s*\*?\d*\s*\{\s*a:\s*([^}]+)\}/i.exec(text)
  if (normMatch) {
    const nums = normMatch[1].match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g)
    if (nums) {
      for (let i = 0; i < nums.length; i++) asciiMesh.normals.push(Number(nums[i]))
    }
  }

  const uvMatch = /\bUV:\s*\*?\d*\s*\{\s*a:\s*([^}]+)\}/i.exec(text)
  const uvIdxMatch = /\bUVIndex:\s*\*?\d*\s*\{\s*a:\s*([^}]+)\}/i.exec(text)
  if (uvMatch) {
    const rawUvs = (uvMatch[1].match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g) || []).map(Number)
    if (uvIdxMatch) {
      const uvIndices = (uvIdxMatch[1].match(/-?\d+/g) || []).map((s) => parseInt(s, 10))
      let corner = 0
      for (const poly of asciiMesh.polygons) {
        for (let c = 0; c < poly.length; c++) {
          const uIdx = uvIndices[corner++] ?? 0
          asciiMesh.uvs.push(rawUvs[uIdx * 2] ?? 0, rawUvs[uIdx * 2 + 1] ?? 0)
        }
      }
    } else {
      for (let i = 0; i < rawUvs.length; i++) asciiMesh.uvs.push(rawUvs[i])
    }
  }

  if (asciiMesh.positions.length > 0 && asciiMesh.polygons.length > 0) {
    meshes.push(asciiMesh)
  }

  return {
    imported: {
      format: isBinary ? 'fbx-binary' : 'fbx-ascii',
      meshes
    },
    textureHints
  }
}

/** Extract texture filename hints from DirectX .x buffer */
function extractXTextureHints(buf: Buffer): string[] {
  const text = buf.toString('latin1')
  const hints: string[] = []
  const matches = text.matchAll(/(?:TextureFilename\s*\{[^\}]*"([^"]+)"|([A-Za-z0-9_.-]+\.(?:png|tga|dds|jpg|jpeg|webp)))/gi)
  for (const m of matches) {
    const val = m[1] || m[2]
    if (val && !hints.includes(val) && !val.toLowerCase().endsWith('.x')) {
      hints.push(val)
    }
  }
  return hints
}

/** Convert TGA buffer to a base64 PNG data-url so WebGL / browser can load it */
function tgaToPngDataUrl(buf: Buffer): string | undefined {
  if (buf.length < 18) return undefined
  const idLength = buf[0]
  const imageType = buf[2]
  const width = buf.readUInt16LE(12)
  const height = buf.readUInt16LE(14)
  const bpp = buf[16]
  const descriptor = buf[17]
  const topDown = (descriptor & 0x20) !== 0

  if ((imageType !== 2 && imageType !== 10) || (bpp !== 24 && bpp !== 32) || width <= 0 || height <= 0) {
    return undefined
  }

  const bytesPerPixel = bpp / 8
  const totalPixels = width * height
  const rgba = Buffer.alloc(totalPixels * 4)
  let offset = 18 + idLength

  if (imageType === 2) {
    for (let i = 0; i < totalPixels && offset + bytesPerPixel <= buf.length; i++) {
      const b = buf[offset++]
      const g = buf[offset++]
      const r = buf[offset++]
      const a = bytesPerPixel === 4 ? buf[offset++] : 255
      const p = i * 4
      rgba[p] = r
      rgba[p + 1] = g
      rgba[p + 2] = b
      rgba[p + 3] = a
    }
  } else if (imageType === 10) {
    let pixelCount = 0
    while (pixelCount < totalPixels && offset < buf.length) {
      const packet = buf[offset++]
      const count = (packet & 0x7f) + 1
      const isRle = (packet & 0x80) !== 0
      if (isRle) {
        if (offset + bytesPerPixel > buf.length) break
        const b = buf[offset++]
        const g = buf[offset++]
        const r = buf[offset++]
        const a = bytesPerPixel === 4 ? buf[offset++] : 255
        for (let j = 0; j < count && pixelCount < totalPixels; j++) {
          const p = pixelCount++ * 4
          rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = a
        }
      } else {
        for (let j = 0; j < count && pixelCount < totalPixels && offset + bytesPerPixel <= buf.length; j++) {
          const b = buf[offset++]
          const g = buf[offset++]
          const r = buf[offset++]
          const a = bytesPerPixel === 4 ? buf[offset++] : 255
          const p = pixelCount++ * 4
          rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = a
        }
      }
    }
  }

  // Flip vertically if stored bottom-up
  if (!topDown) {
    const stride = width * 4
    const rowBuf = Buffer.alloc(stride)
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const topIdx = y * stride
      const botIdx = (height - 1 - y) * stride
      rgba.copy(rowBuf, 0, topIdx, topIdx + stride)
      rgba.copy(rgba, topIdx, botIdx, botIdx + stride)
      rowBuf.copy(rgba, botIdx, 0, stride)
    }
  }

  const pngBuf = encodeRgbaToPng(width, height, rgba)
  return `data:image/png;base64,${pngBuf.toString('base64')}`
}

function encodeRgbaToPng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride)
  }

  const CRC_TABLE = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    CRC_TABLE[n] = c >>> 0
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.concat([typeBuf, data])
    let c = 0xffffffff
    for (let i = 0; i < crcBuf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ crcBuf[i]) & 0xff]
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

async function makeTextureResult(texturePath: string): Promise<{ path: string; name: string; url: string }> {
  const ext = extname(texturePath).toLowerCase()
  try {
    const buf = await fs.readFile(texturePath)
    if (ext === '.tga') {
      const dataUrl = tgaToPngDataUrl(buf)
      if (dataUrl) {
        return { path: texturePath, name: basename(texturePath), url: dataUrl }
      }
    } else if (ext === '.png') {
      return {
        path: texturePath,
        name: basename(texturePath),
        url: `data:image/png;base64,${buf.toString('base64')}`
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      return {
        path: texturePath,
        name: basename(texturePath),
        url: `data:image/jpeg;base64,${buf.toString('base64')}`
      }
    } else if (ext === '.webp') {
      return {
        path: texturePath,
        name: basename(texturePath),
        url: `data:image/webp;base64,${buf.toString('base64')}`
      }
    }
  } catch (err) {
    console.warn('[explorer] Failed to read texture buffer for data URL:', err)
  }
  return {
    path: texturePath,
    name: basename(texturePath),
    url: pzFileUrl(texturePath)
  }
}

/** Strip common PZ limb, gender, status, and attachment suffixes */
function cleanPzModelName(name: string): string {
  return name
    .replace(/(?:_Male|_Female|_Ground|_Static|_World|_Item|_Equipped|_Holster|_LeftHand|_RightHand)$/i, '')
    .replace(/(?:[_-][RLrl]|[RLrl])$/, '')
    .replace(/(?:[_-][mMfF]|[mMfF])$/, '')
}

/** Check if image file is a non-diffuse auxiliary map (normal, roughness, mask, etc.) */
function isNonDiffuseMap(filename: string): boolean {
  return /(?:_normal|_norm|_n|_mask|_roughness|_metallic|_metal|_spec|_bump|_height|_ao|_disp)\.[a-z0-9]+$/i.test(filename)
}

/** Recursively find files satisfying a predicate */
async function findFilesRecursive(
  dir: string,
  predicate: (name: string, isDir: boolean) => boolean,
  maxDepth = 6,
  currentDepth = 0
): Promise<string[]> {
  if (currentDepth > maxDepth || !(await exists(dir))) return []
  const results: string[] = []
  try {
    const entries = await readdirSafe(dir)
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (predicate(ent.name, true)) {
          const sub = await findFilesRecursive(full, predicate, maxDepth, currentDepth + 1)
          results.push(...sub)
        }
      } else {
        if (predicate(ent.name, false)) {
          results.push(full)
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return results
}

/** Find all candidate media root directories for a model file (supports B41, B42 42/media, common/media, legacy) */
async function findCandidateMediaRoots(modelPath: string, gameDir?: string): Promise<string[]> {
  const norm = modelPath.replace(/\\/g, '/')
  const roots: string[] = []

  const mediaIdx = norm.toLowerCase().lastIndexOf('/media/')
  if (mediaIdx !== -1) {
    roots.push(modelPath.slice(0, mediaIdx + 6))
  }

  let curr = dirname(modelPath)
  const candidateModDirs = new Set<string>()

  for (let i = 0; i < 8; i++) {
    const parent = dirname(curr)
    if (await exists(join(curr, 'mod.info'))) {
      candidateModDirs.add(curr)
      const currBase = basename(curr).toLowerCase()
      if (/^(?:4[12](?:\.\d+)*|common|legacy)$/i.test(currBase)) {
        if (await exists(join(parent, 'mod.info'))) {
          candidateModDirs.add(parent)
        }
      }
    }
    if (parent === curr) break
    curr = parent
  }

  for (const modDir of candidateModDirs) {
    const knownSubs = [
      'media',
      join('42', 'media'),
      join('common', 'media'),
      join('41', 'media')
    ]
    for (const sub of knownSubs) {
      const p = join(modDir, sub)
      if (!roots.includes(p) && (await exists(p))) {
        roots.push(p)
      }
    }

    try {
      const subEntries = await readdirSafe(modDir)
      for (const ent of subEntries) {
        if (!ent.isDirectory()) continue
        const candidateP = join(modDir, ent.name, 'media')
        if (!roots.includes(candidateP) && (await exists(candidateP))) {
          roots.push(candidateP)
        }
        if (ent.name.toLowerCase() === 'legacy') {
          const legEntries = await readdirSafe(join(modDir, ent.name))
          for (const lent of legEntries) {
            if (!lent.isDirectory()) continue
            const legP = join(modDir, ent.name, lent.name, 'media')
            if (!roots.includes(legP) && (await exists(legP))) {
              roots.push(legP)
            }
          }
        }
      }
    } catch {
      // Safe skip
    }
  }

  if (gameDir) {
    const vanillaMedia = join(gameDir, 'media')
    if (!roots.includes(vanillaMedia) && (await exists(vanillaMedia))) {
      roots.push(vanillaMedia)
    }
  }

  return roots
}

interface IndexedTexture {
  fullPath: string
  relPathNorm: string
  fileNameLower: string
  baseNameLower: string
  ext: string
  isAuxiliary: boolean
  isVanilla: boolean
  inModelDir: boolean
}

async function indexTextures(
  roots: string[],
  modelDir: string,
  candidateExtensions: string[]
): Promise<IndexedTexture[]> {
  const textures: IndexedTexture[] = []
  const seenPaths = new Set<string>()

  async function scanFolder(dir: string, isVanilla = false): Promise<void> {
    const files = await findFilesRecursive(
      dir,
      (name, isDir) => {
        if (isDir) return !name.startsWith('.') && name !== 'node_modules'
        const ext = extname(name).toLowerCase()
        return candidateExtensions.includes(ext)
      },
      6
    )

    for (const f of files) {
      const lower = f.toLowerCase()
      if (seenPaths.has(lower)) continue
      seenPaths.add(lower)

      const ext = extname(f).toLowerCase()
      const baseName = basename(f, ext)
      const normF = f.replace(/\\/g, '/')
      let relPathNorm = ''
      const texIdx = normF.toLowerCase().lastIndexOf('/textures/')
      if (texIdx !== -1) {
        relPathNorm = normF.slice(texIdx + 10).replace(/\.[^/.]+$/, '').toLowerCase()
      } else {
        relPathNorm = baseName.toLowerCase()
      }

      textures.push({
        fullPath: f,
        relPathNorm,
        fileNameLower: basename(f).toLowerCase(),
        baseNameLower: baseName.toLowerCase(),
        ext,
        isAuxiliary: isNonDiffuseMap(f),
        isVanilla,
        inModelDir: dirname(f).toLowerCase() === modelDir.toLowerCase()
      })
    }
  }

  await scanFolder(modelDir, false)

  for (const root of roots) {
    const texDir = join(root, 'textures')
    if (await exists(texDir)) {
      const isVanilla = root.includes('common\\ProjectZomboid') || root.includes('common/ProjectZomboid')
      await scanFolder(texDir, isVanilla)
    }
  }

  return textures
}

function tokenize(str: string): string[] {
  return str
    .replace(/([0-9]+)/g, '_$1_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 1 &&
        !['model', 'mesh', 'item', 'vehicles', 'vehicle', 'skinned', 'clothes', 'worlditems', 'ammo'].includes(w)
    )
}

function tokenMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true
  if (t1.length >= 3 && t2.length >= 3) {
    if (t1.includes(t2) || t2.includes(t1)) return true
    if (t1.startsWith(t2) || t2.startsWith(t1)) return true
  }
  return false
}

/** Autonomous cascading search for model texture file with diffuse prioritization across any mod */
async function resolveModelTexture(
  modelPath: string,
  hints: string[] = [],
  gameDir?: string
): Promise<{ path: string; name: string; url: string } | undefined> {
  const candidateExtensions = ['.png', '.tga', '.jpg', '.jpeg', '.webp']
  const modelDir = dirname(modelPath)
  const baseName = basename(modelPath, extname(modelPath))
  const strippedName = cleanPzModelName(baseName)
  const roots = await findCandidateMediaRoots(modelPath, gameDir)
  const indexedTextures = await indexTextures(roots, modelDir, candidateExtensions)

  const candidateRelPaths = new Set<string>()
  const candidateBaseNames = new Set<string>()
  const modelDefAliases = new Set<string>()

  candidateBaseNames.add(baseName.toLowerCase())
  if (strippedName) candidateBaseNames.add(strippedName.toLowerCase())

  // Direct hints from 3D model file (FBX relative filenames, X texture filenames, MTL)
  for (const h of hints) {
    const raw = h.replace(/\\/g, '/').trim().replace(/^\/+/, '')
    if (!raw) continue
    const cleanRel = raw.replace(/\.[^/.]+$/, '').toLowerCase()
    candidateRelPaths.add(cleanRel)
    const f = basename(raw, extname(raw))
    if (f) candidateBaseNames.add(f.toLowerCase())
  }

  // 1. Scan clothingItems XML definitions
  for (const root of roots) {
    const clothingDir = join(root, 'clothing', 'clothingItems')
    if (await exists(clothingDir)) {
      const xmls = await findFilesRecursive(clothingDir, (n, isD) => isD || n.toLowerCase().endsWith('.xml'))
      for (const x of xmls) {
        try {
          const txt = await readTextSafe(x, 128 * 1024)
          if (!txt) continue
          const hasMatch =
            txt.toLowerCase().includes(baseName.toLowerCase()) ||
            (strippedName ? txt.toLowerCase().includes(strippedName.toLowerCase()) : false)
          if (!hasMatch) continue

          const modelMatches = txt.matchAll(/<(?:m_MaleModel|m_FemaleModel|m_StaticModel|m_Model)>([^<]+)<\//gi)
          let matchedXml = false
          for (const mm of modelMatches) {
            const mVal = basename(mm[1].trim().replace(/\\/g, '/')).toLowerCase()
            if (mVal === baseName.toLowerCase() || (strippedName && mVal === strippedName.toLowerCase())) {
              matchedXml = true
              break
            }
          }
          if (matchedXml) {
            const texMatches = txt.matchAll(/<(?:textureChoices|m_Textures|textureName)>([^<]+)<\//gi)
            for (const tm of texMatches) {
              const raw = tm[1].trim().replace(/\\/g, '/').replace(/^\/+/, '')
              candidateRelPaths.add(raw.replace(/\.[^/.]+$/, '').toLowerCase())
              candidateBaseNames.add(basename(raw, extname(raw)).toLowerCase())
            }
          }
        } catch {
          // Safe skip
        }
      }
    }
  }

  // 2. Scan scripts txt definitions (recursive)
  for (const root of roots) {
    const scriptsDir = join(root, 'scripts')
    if (await exists(scriptsDir)) {
      const txts = await findFilesRecursive(scriptsDir, (n, isD) => isD || n.toLowerCase().endsWith('.txt'))
      for (const t of txts) {
        try {
          const txt = await readTextSafe(t, 256 * 1024)
          if (!txt) continue
          const baseLower = baseName.toLowerCase()
          const stripLower = strippedName ? strippedName.toLowerCase() : ''

          // Pass A: model blocks
          const modelBlocks = txt.matchAll(/\bmodel\s+([A-Za-z0-9_.-]+)\s*\{([^}]+)\}/gi)
          for (const mb of modelBlocks) {
            const modelDefName = mb[1]
            const blockContent = mb[2]
            const meshM = /mesh\s*=\s*([^,;\r\n]+)/i.exec(blockContent)
            const texM = /texture\s*=\s*([^,;\r\n]+)/i.exec(blockContent)
            if (meshM) {
              const rawMesh = meshM[1].trim().replace(/\\/g, '/')
              const meshBase = basename(rawMesh, extname(rawMesh)).toLowerCase()
              if (meshBase === baseLower || (stripLower && meshBase === stripLower)) {
                modelDefAliases.add(modelDefName.toLowerCase())
                if (texM) {
                  const rawTex = texM[1].trim().replace(/\\/g, '/').replace(/["']/g, '')
                  candidateRelPaths.add(rawTex.replace(/\.[^/.]+$/, '').toLowerCase())
                  candidateBaseNames.add(basename(rawTex, extname(rawTex)).toLowerCase())
                }
              }
            }
          }

          // Pass B: item blocks
          const itemBlocks = txt.matchAll(/\bitem\s+([A-Za-z0-9_.-]+)\s*\{([^}]+)\}/gi)
          for (const ib of itemBlocks) {
            const itemContent = ib[2]
            let itemMatches = false
            for (const alias of [baseLower, stripLower, ...modelDefAliases]) {
              if (alias && itemContent.toLowerCase().includes(alias)) {
                itemMatches = true
                break
              }
            }
            if (itemMatches) {
              const texM = /(?:Texture|Icon)\s*=\s*([^,;\r\n]+)/i.exec(itemContent)
              if (texM) {
                const rawTex = texM[1].trim().replace(/\\/g, '/').replace(/["']/g, '')
                candidateRelPaths.add(rawTex.replace(/\.[^/.]+$/, '').toLowerCase())
                candidateBaseNames.add(basename(rawTex, extname(rawTex)).toLowerCase())
              }
            }
          }

          // Pass C: vehicle definitions with skin/texture
          if (modelDefAliases.size > 0 || txt.toLowerCase().includes(baseLower)) {
            for (const alias of [baseLower, stripLower, ...modelDefAliases]) {
              if (!alias) continue
              let searchIdx = txt.toLowerCase().indexOf(alias)
              while (searchIdx !== -1) {
                const endIdx = txt.indexOf('}\n}', searchIdx)
                const chunk = txt.slice(searchIdx, endIdx !== -1 ? endIdx + 3 : searchIdx + 800)
                const texMatches = chunk.matchAll(/(?:texture|textureMask|textureLights)\s*=\s*([^,;\r\n]+)/gi)
                for (const tm of texMatches) {
                  const rawTex = tm[1].trim().replace(/\\/g, '/').replace(/["']/g, '')
                  candidateRelPaths.add(rawTex.replace(/\.[^/.]+$/, '').toLowerCase())
                  candidateBaseNames.add(basename(rawTex, extname(rawTex)).toLowerCase())
                }
                searchIdx = txt.toLowerCase().indexOf(alias, searchIdx + alias.length)
              }
            }
          }
        } catch {
          // Safe skip
        }
      }
    }
  }

  const modelTokens = tokenize(baseName)
  let bestFile: string | null = null
  let bestScore = -Infinity

  for (const tex of indexedTextures) {
    let score = 0

    if (candidateRelPaths.has(tex.relPathNorm)) {
      score += 1000
    } else if (candidateBaseNames.has(tex.baseNameLower)) {
      score += 700
    } else if (tex.inModelDir && tex.baseNameLower === baseName.toLowerCase()) {
      score += 800
    } else if (tex.baseNameLower === baseName.toLowerCase()) {
      score += 600
    } else if (strippedName && tex.baseNameLower === strippedName.toLowerCase()) {
      score += 500
    } else if (
      tex.baseNameLower === 'item_' + baseName.toLowerCase() ||
      (strippedName && tex.baseNameLower === 'item_' + strippedName.toLowerCase())
    ) {
      score += 480
    } else if (tex.baseNameLower === 'vehicle_' + baseName.toLowerCase()) {
      score += 480
    } else {
      // Token overlap
      const texTokens = tokenize(tex.baseNameLower)
      let matchCount = 0
      for (const mt of modelTokens) {
        for (const tt of texTokens) {
          if (tokenMatch(mt, tt)) {
            matchCount++
            break
          }
        }
      }
      if (matchCount >= 2) {
        score += 250 + matchCount * 80
      } else if (tex.baseNameLower.includes(baseName.toLowerCase()) || baseName.toLowerCase().includes(tex.baseNameLower)) {
        score += 200
      } else {
        continue
      }
    }

    if (tex.isAuxiliary) score -= 450
    if (tex.ext === '.png') score += 20
    if (tex.inModelDir) score += 50
    if (tex.isVanilla) score -= 150

    if (score > bestScore) {
      bestScore = score
      bestFile = tex.fullPath
    }
  }

  // Fallback: single diffuse texture in model directory
  if (!bestFile || bestScore <= 0) {
    const dirImages = indexedTextures.filter((t) => t.inModelDir && !t.isAuxiliary)
    if (dirImages.length === 1 && dirImages[0]) {
      bestFile = dirImages[0].fullPath
    }
  }

  if (bestFile) {
    return makeTextureResult(bestFile)
  }

  return undefined
}

export async function parseMeshForPreview(filePath: string, settings?: AppSettings): Promise<MeshPreviewData> {
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
  let textureHints: string[] = []

  try {
    const buf = await fs.readFile(filePath)

    if (ext === 'fbx') {
      const fbxRes = importFbx(buf, filePath)
      imported = fbxRes.imported
      textureHints = fbxRes.textureHints
    } else if (ext === 'x') {
      imported = importDirectX(buf, filePath)
      textureHints = extractXTextureHints(buf)
    } else if (ext === 'obj') {
      imported = importObj(buf.toString('utf8'), filePath)
      const mtlMatches = buf.toString('utf8').matchAll(/\b(?:mtllib|map_Kd)\s+([^\r\n]+)/gi)
      for (const m of mtlMatches) if (m[1]) textureHints.push(m[1].trim())
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
  const allUvs: number[] = []
  let totalTris = 0
  let totalVerts = 0

  for (const m of imported.meshes) {
    totalVerts += m.positions.length / 3
    totalTris += flattenMeshTriangles(m, allPositions, allNormals, allUvs)
  }

  // Auto-resolve attached texture
  const gameDir = settings ? await detectGameDir(settings) : undefined
  const resolvedTexture = await resolveModelTexture(filePath, textureHints, gameDir)

  return {
    ok: true,
    format: imported.format || ext,
    meshName: imported.meshes[0]?.name || meshName(filePath),
    vertexCount: totalVerts,
    triangleCount: totalTris,
    positions: allPositions,
    normals: allNormals,
    uvs: allUvs.length > 0 ? allUvs : undefined,
    texturePath: resolvedTexture?.path,
    textureUrl: resolvedTexture?.url,
    textureName: resolvedTexture?.name
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
    console.warn('[explorer] Failed to scan vanilla media files:', err)
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
