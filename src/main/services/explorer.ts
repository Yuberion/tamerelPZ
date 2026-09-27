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

/** Find all candidate media root directories for a model file (supports B41, B42 42/media, common/media) */
async function findCandidateMediaRoots(modelPath: string): Promise<string[]> {
  const norm = modelPath.replace(/\\/g, '/')
  const roots: string[] = []

  const mediaIdx = norm.toLowerCase().lastIndexOf('/media/')
  if (mediaIdx !== -1) {
    roots.push(modelPath.slice(0, mediaIdx + 6))
  }

  // Walk up to find mod root (directory containing mod.info)
  let curr = dirname(modelPath)
  let modRoot: string | null = null
  for (let i = 0; i < 7; i++) {
    if (await exists(join(curr, 'mod.info'))) {
      modRoot = curr
      break
    }
    const parent = dirname(curr)
    if (parent === curr) break
    curr = parent
  }

  if (modRoot) {
    const subMedia = [
      join(modRoot, '42', 'media'),
      join(modRoot, 'common', 'media'),
      join(modRoot, 'media'),
      join(modRoot, '41', 'media')
    ]
    for (const sm of subMedia) {
      if (!roots.includes(sm) && (await exists(sm))) {
        roots.push(sm)
      }
    }
  }

  return roots
}

/** Autonomous cascading search for model texture file with diffuse prioritization */
async function resolveModelTexture(
  modelPath: string,
  hints: string[] = []
): Promise<{ path: string; name: string; url: string } | undefined> {
  const candidateExtensions = ['.png', '.tga', '.jpg', '.jpeg', '.webp', '.dds']
  const modelDir = dirname(modelPath)
  const baseName = basename(modelPath, extname(modelPath))
  const strippedName = cleanPzModelName(baseName)
  const norm = modelPath.replace(/\\/g, '/')

  const roots = await findCandidateMediaRoots(modelPath)

  // Subfolder relative to models/models_X (e.g. "weapons", "clothing", "vehicles")
  let subDir = ''
  const m = norm.match(/\/(?:models_X|models)\/(.+)\/[^/]+$/i)
  if (m && m[1]) subDir = m[1]

  const candidateNames = new Map<string, number>() // name (lowercase) -> priority score
  candidateNames.set(baseName.toLowerCase(), 80)
  if (strippedName && strippedName.toLowerCase() !== baseName.toLowerCase()) {
    candidateNames.set(strippedName.toLowerCase(), 70)
  }

  // 1. Direct hints from 3D model file (FBX relative filenames, X texture filenames, MTL)
  for (const h of hints) {
    const raw = h.replace(/\\/g, '/').trim()
    const f = basename(raw, extname(raw))
    if (f) candidateNames.set(f.toLowerCase(), 95)
  }

  // 2. Scan clothingItems XML definitions (for clothing/armor/accessories)
  for (const root of roots) {
    const clothingDir = join(root, 'clothing', 'clothingItems')
    if (await exists(clothingDir)) {
      try {
        const files = await readdirSafe(clothingDir)
        for (const f of files) {
          if (!f.name.endsWith('.xml')) continue
          const text = await readTextSafe(join(clothingDir, f.name), 64 * 1024)
          if (!text) continue
          if (
            text.includes(`<m_MaleModel>${baseName}</m_MaleModel>`) ||
            text.includes(`<m_FemaleModel>${baseName}</m_FemaleModel>`) ||
            text.includes(`<m_StaticModel>${baseName}</m_StaticModel>`) ||
            text.includes(`>${baseName}<`) ||
            (strippedName && text.includes(`>${strippedName}<`))
          ) {
            const matches = text.matchAll(/<(?:textureChoices|m_Textures|textureName)>([^<]+)<\//gi)
            for (const match of matches) {
              const rawTex = match[1].trim()
              const texBase = basename(rawTex, extname(rawTex))
              if (texBase) candidateNames.set(texBase.toLowerCase(), 100)
            }
          }
        }
      } catch {
        // Safe skip
      }
    }
  }

  // 3. Scan scripts txt definitions (for weapons, vehicles, items)
  for (const root of roots) {
    const scriptsDir = join(root, 'scripts')
    if (await exists(scriptsDir)) {
      try {
        const sFiles = await readdirSafe(scriptsDir)
        for (const sf of sFiles) {
          if (!sf.name.endsWith('.txt')) continue
          const text = await readTextSafe(join(scriptsDir, sf.name), 256 * 1024)
          if (!text) continue
          const meshRegex = new RegExp(`\\bmesh\\s*=\\s*(?:[\\w/]+\\/)?${baseName}\\b[\\s\\S]*?\\btexture\\s*=\\s*([\\w/.-]+)`, 'i')
          const match = meshRegex.exec(text)
          if (match && match[1]) {
            const tBase = basename(match[1].trim(), extname(match[1].trim()))
            if (tBase) candidateNames.set(tBase.toLowerCase(), 100)
          }
        }
      } catch {
        // Safe skip
      }
    }
  }

  // Search directories ordered by preference
  interface SearchDir {
    dir: string
    bonus: number
  }
  const searchDirs: SearchDir[] = []
  searchDirs.push({ dir: modelDir, bonus: 20 })

  for (const root of roots) {
    if (subDir) {
      searchDirs.push({ dir: join(root, 'textures', subDir), bonus: 30 })
    }
    searchDirs.push({ dir: join(root, 'textures'), bonus: 15 })
    searchDirs.push({ dir: join(root, 'textures', 'weapons'), bonus: 10 })
    searchDirs.push({ dir: join(root, 'textures', 'clothing'), bonus: 10 })
    searchDirs.push({ dir: join(root, 'textures', 'WorldItems'), bonus: 10 })
    searchDirs.push({ dir: join(root, 'clothing'), bonus: 5 })
  }

  let bestFile: string | null = null
  let bestScore = -Infinity

  for (const { dir, bonus: dirBonus } of searchDirs) {
    if (!(await exists(dir))) continue
    try {
      const files = await readdirSafe(dir)
      for (const ent of files) {
        if (ent.isDirectory()) continue
        const ext = extname(ent.name).toLowerCase()
        if (!candidateExtensions.includes(ext)) continue
        const nameWithoutExt = basename(ent.name, ext).toLowerCase()

        let matchScore = 0
        if (candidateNames.has(nameWithoutExt)) {
          matchScore = candidateNames.get(nameWithoutExt)!
        } else if (strippedName && nameWithoutExt.startsWith(strippedName.toLowerCase())) {
          matchScore = 30
        } else if (nameWithoutExt.startsWith(baseName.toLowerCase())) {
          matchScore = 35
        } else {
          continue
        }

        let score = matchScore + dirBonus
        if (ext === '.png') score += 10
        else if (ext === '.tga') score += 8
        else if (ext === '.jpg' || ext === '.jpeg') score += 6
        else if (ext === '.webp') score += 4

        if (isNonDiffuseMap(ent.name)) {
          score -= 300 // Heavy penalty for normal maps / masks / specular
        }

        if (score > bestScore) {
          bestScore = score
          bestFile = join(dir, ent.name)
        }
      }
    } catch {
      // Ignore
    }
  }

  // Fallback: If no match found by score, but model directory has exactly one image file
  if (!bestFile || bestScore <= 0) {
    try {
      const dirFiles = await readdirSafe(modelDir)
      const imgFiles = dirFiles.filter((f) => {
        const e = extname(f.name).toLowerCase()
        return candidateExtensions.includes(e) && !isNonDiffuseMap(f.name)
      })
      if (imgFiles.length === 1 && imgFiles[0]) {
        bestFile = join(modelDir, imgFiles[0].name)
      }
    } catch {
      // Ignore
    }
  }

  if (bestFile) {
    return makeTextureResult(bestFile)
  }

  return undefined
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
  const resolvedTexture = await resolveModelTexture(filePath, textureHints)

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
