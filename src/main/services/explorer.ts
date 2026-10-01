/**
 * Explorer backend services: 3D mesh preview, global mod grep, and vanilla overwrites detection.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { AppSettings, MeshPreviewData, PathsReport } from '../../shared/types'
import { exists, extOf, isDir, readTextSafe, readdirSafe } from './fsx'
import { detectGameDir, detectPaths } from './paths'
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
  const vertCount = Math.floor(mesh.positions.length / 3)
  const isPerVertexNormal = hasNormals && mesh.normals.length === mesh.positions.length
  const isPerVertexUv = hasUvs && mesh.uvs.length === vertCount * 2

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
        if (isPerVertexNormal) {
          outNormals.push(
            mesh.normals[v0 * 3] ?? 0,
            mesh.normals[v0 * 3 + 1] ?? 1,
            mesh.normals[v0 * 3 + 2] ?? 0,
            mesh.normals[v1 * 3] ?? 0,
            mesh.normals[v1 * 3 + 1] ?? 1,
            mesh.normals[v1 * 3 + 2] ?? 0,
            mesh.normals[v2 * 3] ?? 0,
            mesh.normals[v2 * 3 + 1] ?? 1,
            mesh.normals[v2 * 3 + 2] ?? 0
          )
        } else {
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
      }

      // UVs
      if (hasUvs) {
        if (isPerVertexUv) {
          outUvs.push(
            mesh.uvs[v0 * 2] ?? 0,
            mesh.uvs[v0 * 2 + 1] ?? 0,
            mesh.uvs[v1 * 2] ?? 0,
            mesh.uvs[v1 * 2 + 1] ?? 0,
            mesh.uvs[v2 * 2] ?? 0,
            mesh.uvs[v2 * 2 + 1] ?? 0
          )
        } else {
          outUvs.push(
            mesh.uvs[c0 * 2] ?? 0,
            mesh.uvs[c0 * 2 + 1] ?? 0,
            mesh.uvs[c1 * 2] ?? 0,
            mesh.uvs[c1 * 2 + 1] ?? 0,
            mesh.uvs[c2 * 2] ?? 0,
            mesh.uvs[c2 * 2 + 1] ?? 0
          )
        }
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

/** Convert DDS buffer (DXT1, DXT3, DXT5, RGBA) to a base64 PNG data-url */
function ddsToPngDataUrl(buf: Buffer): string | undefined {
  if (buf.length < 128) return undefined
  if (buf.readUInt32LE(0) !== 0x20534444) return undefined // 'DDS '
  const height = buf.readUInt32LE(12)
  const width = buf.readUInt32LE(16)
  if (width <= 0 || height <= 0) return undefined

  const pfFlags = buf.readUInt32LE(80)
  const fourCC = buf.toString('ascii', 84, 88)
  const isFourCC = (pfFlags & 0x04) !== 0

  let offset = 128
  const totalPixels = width * height
  const rgba = Buffer.alloc(totalPixels * 4)

  if (isFourCC && (fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5')) {
    const isDxt1 = fourCC === 'DXT1'
    const blockSize = isDxt1 ? 8 : 16
    const blocksWide = Math.ceil(width / 4)
    const blocksHigh = Math.ceil(height / 4)

    for (let by = 0; by < blocksHigh; by++) {
      for (let bx = 0; bx < blocksWide; bx++) {
        if (offset + blockSize > buf.length) break

        if (!isDxt1) {
          // Skip alpha block for diffuse RGB reconstruction
          offset += 8
        }

        // Color block (2 x 16-bit RGB565 + 4 bytes lookup)
        const c0 = buf.readUInt16LE(offset)
        const c1 = buf.readUInt16LE(offset + 2)
        const lookup = buf.readUInt32LE(offset + 4)
        offset += 8

        const r0 = ((c0 >> 11) & 0x1f) * 255 / 31
        const g0 = ((c0 >> 5) & 0x3f) * 255 / 63
        const b0 = (c0 & 0x1f) * 255 / 31
        const r1 = ((c1 >> 11) & 0x1f) * 255 / 31
        const g1 = ((c1 >> 5) & 0x3f) * 255 / 63
        const b1 = (c1 & 0x1f) * 255 / 31

        const colors = [
          [r0, g0, b0],
          [r1, g1, b1],
          c0 > c1 || !isDxt1
            ? [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3]
            : [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2],
          c0 > c1 || !isDxt1
            ? [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3]
            : [0, 0, 0]
        ]

        for (let py = 0; py < 4; py++) {
          const y = by * 4 + py
          if (y >= height) continue
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px
            if (x >= width) continue
            const pIdx = py * 4 + px
            const cCode = (lookup >> (pIdx * 2)) & 0x03
            const col = colors[cCode]
            const outIdx = (y * width + x) * 4
            rgba[outIdx] = Math.round(col[0])
            rgba[outIdx + 1] = Math.round(col[1])
            rgba[outIdx + 2] = Math.round(col[2])
            rgba[outIdx + 3] = (isDxt1 && c0 <= c1 && cCode === 3) ? 0 : 255
          }
        }
      }
    }
  } else if ((pfFlags & 0x40) !== 0) {
    const bpp = buf.readUInt32LE(88) / 8
    if (bpp === 4 || bpp === 3) {
      for (let i = 0; i < totalPixels && offset + bpp <= buf.length; i++) {
        const b = buf[offset++]
        const g = buf[offset++]
        const r = buf[offset++]
        const a = bpp === 4 ? buf[offset++] : 255
        const p = i * 4
        rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = a
      }
    }
  } else {
    return undefined
  }

  const pngBuf = encodeRgbaToPng(width, height, rgba)
  return `data:image/png;base64,${pngBuf.toString('base64')}`
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
    } else if (ext === '.dds') {
      const dataUrl = ddsToPngDataUrl(buf)
      if (dataUrl) {
        return { path: texturePath, name: basename(texturePath), url: dataUrl }
      }
    } else if (ext === '.bmp') {
      return {
        path: texturePath,
        name: basename(texturePath),
        url: `data:image/bmp;base64,${buf.toString('base64')}`
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

interface MediaRootInfo {
  path: string
  tier: 1 | 2 | 3
}

let cachedExternalRoots: { timestamp: number; roots: MediaRootInfo[] } | null = null

/** Discover external media roots from sibling local mods, steam workshop libraries, and vanilla game */
async function getExternalMediaRoots(pathsReport?: PathsReport): Promise<MediaRootInfo[]> {
  const now = Date.now()
  if (cachedExternalRoots && now - cachedExternalRoots.timestamp < 60_000) {
    return cachedExternalRoots.roots
  }

  const results: MediaRootInfo[] = []
  const seen = new Set<string>()

  const addRoot = (p: string, tier: 1 | 2 | 3): void => {
    const norm = p.replace(/\\/g, '/').toLowerCase()
    if (!seen.has(norm)) {
      seen.add(norm)
      results.push({ path: p, tier })
    }
  }

  // 1. Sibling local mods in zomboidDir/mods
  if (pathsReport?.zomboidDir) {
    const localModsDir = join(pathsReport.zomboidDir, 'mods')
    if (await exists(localModsDir)) {
      try {
        const ents = await readdirSafe(localModsDir)
        for (const ent of ents) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue
          const modP = join(localModsDir, ent.name)
          for (const sub of ['media', join('42', 'media'), join('common', 'media'), join('41', 'media')]) {
            const full = join(modP, sub)
            if (await exists(full)) addRoot(full, 2)
          }
        }
      } catch {
        // Safe skip
      }
    }
  }

  // 2. Steam Workshop mods
  if (pathsReport?.workshopDirs) {
    for (const wsDir of pathsReport.workshopDirs) {
      if (!(await exists(wsDir))) continue
      try {
        const itemIds = await readdirSafe(wsDir)
        for (const itemId of itemIds) {
          if (!itemId.isDirectory() || itemId.name.startsWith('.')) continue
          const modsDir = join(wsDir, itemId.name, 'mods')
          if (!(await exists(modsDir))) continue
          const modEntries = await readdirSafe(modsDir)
          for (const mEnt of modEntries) {
            if (!mEnt.isDirectory()) continue
            const mPath = join(modsDir, mEnt.name)
            for (const sub of [
              'media',
              join('common', 'media'),
              join('42', 'media'),
              join('42.0', 'media'),
              join('42.13', 'media'),
              join('41', 'media')
            ]) {
              const full = join(mPath, sub)
              if (await exists(full)) addRoot(full, 2)
            }
          }
        }
      } catch {
        // Safe skip
      }
    }
  }

  // 3. Vanilla game media fallback
  if (pathsReport?.gameDir) {
    const vanillaMedia = join(pathsReport.gameDir, 'media')
    if (await exists(vanillaMedia)) addRoot(vanillaMedia, 3)
  }

  cachedExternalRoots = { timestamp: now, roots: results }
  return results
}

/** Find all candidate media root directories for a model file (supports current mod, external siblings, workshop and vanilla) */
async function findCandidateMediaRoots(modelPath: string, pathsReport?: PathsReport): Promise<MediaRootInfo[]> {
  const norm = modelPath.replace(/\\/g, '/')
  const roots: MediaRootInfo[] = []
  const seen = new Set<string>()

  const add = (p: string, tier: 1 | 2 | 3): void => {
    const k = p.replace(/\\/g, '/').toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      roots.push({ path: p, tier })
    }
  }

  const mediaIdx = norm.toLowerCase().lastIndexOf('/media/')
  if (mediaIdx !== -1) {
    add(modelPath.slice(0, mediaIdx + 6), 1)
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
      if (await exists(p)) add(p, 1)
    }

    try {
      const subEntries = await readdirSafe(modDir)
      for (const ent of subEntries) {
        if (!ent.isDirectory()) continue
        const candidateP = join(modDir, ent.name, 'media')
        if (await exists(candidateP)) add(candidateP, 1)
        if (ent.name.toLowerCase() === 'legacy') {
          const legEntries = await readdirSafe(join(modDir, ent.name))
          for (const lent of legEntries) {
            if (!lent.isDirectory()) continue
            const legP = join(modDir, ent.name, lent.name, 'media')
            if (await exists(legP)) add(legP, 1)
          }
        }
      }
    } catch {
      // Safe skip
    }
  }

  // Tier 2 & 3: external roots (sibling local mods, workshop libraries, vanilla fallback)
  if (pathsReport) {
    const externalRoots = await getExternalMediaRoots(pathsReport)
    for (const ext of externalRoots) {
      add(ext.path, ext.tier)
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
  tier: 1 | 2 | 3
  inModelDir: boolean
}

async function indexTextures(
  rootInfos: MediaRootInfo[],
  modelDir: string,
  candidateExtensions: string[]
): Promise<IndexedTexture[]> {
  const textures: IndexedTexture[] = []
  const seenPaths = new Set<string>()

  async function scanFolder(dir: string, tier: 1 | 2 | 3): Promise<void> {
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
        tier,
        inModelDir: dirname(f).toLowerCase() === modelDir.toLowerCase()
      })
    }
  }

  await scanFolder(modelDir, 1)

  for (const root of rootInfos) {
    const texDir = join(root.path, 'textures')
    if (await exists(texDir)) {
      await scanFolder(texDir, root.tier)
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
  pathsReport?: PathsReport
): Promise<{ path: string; name: string; url: string } | undefined> {
  const candidateExtensions = ['.png', '.tga', '.jpg', '.jpeg', '.webp']
  const modelDir = dirname(modelPath)
  const baseName = basename(modelPath, extname(modelPath))
  const strippedName = cleanPzModelName(baseName)
  const rootInfos = await findCandidateMediaRoots(modelPath, pathsReport)
  const indexedTextures = await indexTextures(rootInfos, modelDir, candidateExtensions)

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

  // 1. Scan clothingItems XML definitions in candidate roots
  for (const root of rootInfos) {
    const clothingDir = join(root.path, 'clothing', 'clothingItems')
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

  // 2. Scan scripts txt definitions (model blocks, item blocks, vehicle skin definitions)
  for (const root of rootInfos) {
    const scriptsDir = join(root.path, 'scripts')
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
                const blockClose = txt.indexOf('\n\t}', searchIdx)
                const chunk = txt.slice(searchIdx, blockClose !== -1 ? blockClose + 3 : searchIdx + 400)
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
      // Vehicle skin variant prefix matching (e.g. vehicle_sportscarshell matches vehicle_sportscarbluecrashedshell.png)
      let isSkinVariant = false
      for (const cand of candidateBaseNames) {
        if (cand.endsWith('shell') && cand.length > 8) {
          const skinPrefix = cand.slice(0, -5)
          if (tex.baseNameLower.startsWith(skinPrefix) && tex.baseNameLower.endsWith('shell')) {
            score += 650
            isSkinVariant = true
            break
          }
        }
      }

      if (!isSkinVariant) {
        // Token overlap with precision weighting
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
          // Precision bonus: if all meaningful tokens in texture match the model name
          if (matchCount === texTokens.length) {
            score += 180
          }
        } else if (tex.baseNameLower.includes(baseName.toLowerCase()) || baseName.toLowerCase().includes(tex.baseNameLower)) {
          score += 200
        } else {
          continue
        }
      }
    }

    if (tex.isAuxiliary) score -= 450
    if (tex.ext === '.png') score += 20
    if (tex.inModelDir) score += 50
    if (tex.tier === 2) score -= 80
    if (tex.tier === 3) score -= 150

    if (score > bestScore) {
      bestScore = score
      bestFile = tex.fullPath
    }
  }

  // Fallback 1: single diffuse texture in model directory
  if (!bestFile || bestScore <= 0) {
    const dirImages = indexedTextures.filter((t) => t.inModelDir && !t.isAuxiliary)
    if (dirImages.length === 1 && dirImages[0]) {
      bestFile = dirImages[0].fullPath
    }
  }

  // Fallback 2: Hair / Beard models in PZ use base game hair textures
  if (!bestFile || bestScore <= 0) {
    const normModel = modelPath.replace(/\\/g, '/').toLowerCase()
    if (normModel.includes('/hair') || normModel.includes('hair_') || normModel.includes('_hair') || normModel.includes('/beard')) {
      const hairTex = indexedTextures.find((t) =>
        ['f_hair_blonde.png', 'f_hair_white.png', 'hair_blonde.png', 'f_hair.png'].includes(t.fileNameLower)
      )
      if (hairTex) {
        bestFile = hairTex.fullPath
      }
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

  // Auto-resolve attached texture across current mod, sibling mods, workshop and vanilla
  const pathsReport = settings ? await detectPaths(settings) : undefined
  const resolvedTexture = await resolveModelTexture(filePath, textureHints, pathsReport)

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
