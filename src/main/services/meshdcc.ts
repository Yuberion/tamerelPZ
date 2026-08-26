/**
 * Mesh intake for the formats that carry a scene graph.
 *
 * DirectX `.x`, Collada `.dae` and glTF/GLB all nest geometry under transforms,
 * so a naive reader that grabs the vertex arrays and ignores the hierarchy
 * silently piles every part at the origin. All three are flattened here: node
 * transforms are composed down the tree and baked into the positions, which is
 * what the FBX side wants anyway — it writes one identity-transform model per
 * mesh.
 *
 * Matrices are held in one convention: a flat 16-float array `m` where
 * `transformPoint` reads `x' = x*m[0] + y*m[4] + z*m[8] + m[12]`. That happens to
 * be simultaneously DirectX's row-major/row-vector layout *and* glTF's
 * column-major/column-vector layout, so both formats' matrices drop in
 * untouched and one `compose` serves both.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { newMesh, type MeshImport, type RawMesh } from './mesh'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** `compose(inner, outer)` applies `inner` first, then `outer`. */
function compose(inner: number[], outer: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += inner[i * 4 + k] * outer[k * 4 + j]
      out[i * 4 + j] = sum
    }
  }
  return out
}

function isIdentity(m: number[]): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(m[i] - IDENTITY[i]) > 1e-12) return false
  return true
}

/** Bake a transform into one mesh. Normals use the 3x3 part and are renormalised. */
function bakeTransform(mesh: RawMesh, m: number[]): void {
  if (isIdentity(m)) return
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const y = mesh.positions[i + 1]
    const z = mesh.positions[i + 2]
    mesh.positions[i] = x * m[0] + y * m[4] + z * m[8] + m[12]
    mesh.positions[i + 1] = x * m[1] + y * m[5] + z * m[9] + m[13]
    mesh.positions[i + 2] = x * m[2] + y * m[6] + z * m[10] + m[14]
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const x = mesh.normals[i]
    const y = mesh.normals[i + 1]
    const z = mesh.normals[i + 2]
    const nx = x * m[0] + y * m[4] + z * m[8]
    const ny = x * m[1] + y * m[5] + z * m[9]
    const nz = x * m[2] + y * m[6] + z * m[10]
    const len = Math.hypot(nx, ny, nz) || 1
    mesh.normals[i] = nx / len
    mesh.normals[i + 1] = ny / len
    mesh.normals[i + 2] = nz / len
  }
}

/* ======================================================== DirectX .x ====== */

/** Content of the `{ … }` that starts at `open`, brace-balanced and quote-aware. */
function balanced(text: string, open: number): { body: string; end: number } {
  let depth = 0
  let inString = false
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return { body: text.slice(open + 1), end: text.length }
}

interface XBlock {
  keyword: string
  /** Optional instance name from `Mesh Torso {`. */
  label: string
  body: string
}

/** Direct child blocks of `body`, in order. */
function xChildren(body: string): XBlock[] {
  const out: XBlock[] = []
  let i = 0
  while (i < body.length) {
    const open = body.indexOf('{', i)
    if (open < 0) break
    const { body: inner, end } = balanced(body, open)
    const [keyword, label] = xHeader(body.slice(i, open))
    out.push({ keyword, label, body: inner })
    i = end
  }
  return out
}

/**
 * The `<Keyword> [<Name>]` that introduces a block.
 *
 * Read from the *end* of the segment, not the start: a block's header is
 * preceded by its parent's own numeric data, so the first word before a brace is
 * usually the tail of a vertex list.
 */
function xHeader(segment: string): [string, string] {
  const words = segment.split(/\s+/).filter((w) => w.length > 0)
  const tail: string[] = []
  for (let i = words.length - 1; i >= 0 && tail.length < 2; i--) {
    if (!/^[A-Za-z_][\w-]*$/.test(words[i])) break
    tail.unshift(words[i])
  }
  return [tail[0] ?? '', tail[1] ?? '']
}

/**
 * `body` with every nested `{ … }` and its header removed.
 *
 * The header has to go too: a block named `Mesh Body01` would otherwise leak
 * "01" into the number stream and shift every index that follows it.
 */
function xOwnData(body: string): string {
  let out = ''
  let i = 0
  while (i < body.length) {
    const open = body.indexOf('{', i)
    if (open < 0) {
      out += body.slice(i)
      break
    }
    out += body.slice(i, open).replace(/(?:[A-Za-z_][\w-]*\s+)?[A-Za-z_][\w-]*\s*$/, '')
    i = balanced(body, open).end
  }
  return out
}

/** Positional number reader: `.x` data blocks are pure ordered numerics. */
class Numbers {
  private readonly values: number[]
  private at = 0

  constructor(text: string) {
    const found = text.match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g)
    this.values = found ? found.map(Number) : []
  }

  get left(): number {
    return this.values.length - this.at
  }

  next(fallback = 0): number {
    if (this.at >= this.values.length) return fallback
    return this.values[this.at++]
  }
}

function xTransform(body: string): number[] {
  const numbers = new Numbers(xOwnData(body))
  const m: number[] = []
  for (let i = 0; i < 16; i++) m.push(numbers.next(IDENTITY[i]))
  return m
}

function parseXMesh(block: XBlock, index: number): RawMesh {
  const mesh = newMesh(block.label || `mesh_${index}`)
  const own = new Numbers(xOwnData(block.body))
  const children = xChildren(block.body)

  const vertexCount = Math.max(0, Math.trunc(own.next()))
  for (let i = 0; i < vertexCount; i++) {
    mesh.positions.push(own.next(), own.next(), own.next())
  }
  const faceCount = Math.max(0, Math.trunc(own.next()))
  for (let f = 0; f < faceCount && own.left > 0; f++) {
    const size = Math.max(0, Math.trunc(own.next()))
    const poly: number[] = []
    for (let c = 0; c < size; c++) poly.push(Math.trunc(own.next()))
    if (poly.length >= 3) mesh.polygons.push(poly)
  }

  const normalsBlock = children.find((c) => c.keyword === 'MeshNormals')
  if (normalsBlock) {
    const numbers = new Numbers(xOwnData(normalsBlock.body))
    const count = Math.max(0, Math.trunc(numbers.next()))
    const normals: number[] = []
    for (let i = 0; i < count; i++) normals.push(numbers.next(), numbers.next(), numbers.next())
    const faces = Math.max(0, Math.trunc(numbers.next()))
    // `.x` indexes normals per face corner, exactly like FBX wants them.
    for (let f = 0; f < faces && f < mesh.polygons.length; f++) {
      const size = Math.max(0, Math.trunc(numbers.next()))
      for (let c = 0; c < size; c++) {
        const at = Math.trunc(numbers.next()) * 3
        mesh.normals.push(normals[at] ?? 0, normals[at + 1] ?? 0, normals[at + 2] ?? 0)
      }
    }
  }

  const uvBlock = children.find((c) => c.keyword === 'MeshTextureCoords')
  if (uvBlock) {
    const numbers = new Numbers(xOwnData(uvBlock.body))
    const count = Math.max(0, Math.trunc(numbers.next()))
    const coords: number[] = []
    for (let i = 0; i < count; i++) coords.push(numbers.next(), numbers.next())
    for (const poly of mesh.polygons) {
      for (const vertex of poly) {
        mesh.uvs.push(coords[vertex * 2] ?? 0, coords[vertex * 2 + 1] ?? 0)
      }
    }
  }

  const materialBlock = children.find((c) => c.keyword === 'MeshMaterialList')
  if (materialBlock) {
    const numbers = new Numbers(xOwnData(materialBlock.body))
    const materialCount = Math.max(0, Math.trunc(numbers.next()))
    const faceIndexes = Math.max(0, Math.trunc(numbers.next()))
    const perFace: number[] = []
    for (let i = 0; i < faceIndexes; i++) perFace.push(Math.max(0, Math.trunc(numbers.next())))
    const named = xChildren(materialBlock.body).filter((c) => c.keyword === 'Material')
    for (let i = 0; i < Math.max(materialCount, named.length); i++) {
      mesh.materials.push(named[i]?.label || `material_${i}`)
    }
    if (perFace.length === mesh.polygons.length && mesh.materials.length > 1) {
      mesh.polygonMaterials = perFace.map((v) => Math.min(v, mesh.materials.length - 1))
    }
  }

  return mesh
}

/** Depth-first walk of Frame blocks, composing FrameTransformMatrix as it goes. */
function walkXFrames(blocks: XBlock[], parent: number[], out: RawMesh[]): void {
  for (const block of blocks) {
    if (block.keyword === 'Mesh') {
      const mesh = parseXMesh(block, out.length)
      bakeTransform(mesh, parent)
      out.push(mesh)
      continue
    }
    if (block.keyword !== 'Frame') continue
    const children = xChildren(block.body)
    const local = children.find((c) => c.keyword === 'FrameTransformMatrix')
    const world = local ? compose(xTransform(local.body), parent) : parent
    walkXFrames(children, world, out)
  }
}

/**
 * DirectX `.x`, text flavour — the format Project Zomboid ships its models in.
 *
 * Binary and compressed `.x` are declined rather than guessed at: they are a
 * token stream with a completely different grammar, and half-decoding one
 * produces a mesh that looks plausible and is wrong.
 */
export function importDirectX(buf: Buffer, name: string): MeshImport {
  const raw = buf.toString('utf8').replace(/^\uFEFF/, '')
  const header = raw.slice(0, 16)
  if (!header.startsWith('xof ')) throw new Error('not a DirectX .x file')
  const flavour = header.slice(8, 12)
  if (flavour !== 'txt ') {
    const kind = flavour.startsWith('bin') ? 'binaryX' : 'compressedX'
    throw Object.assign(new Error(`unsupported .x flavour "${flavour.trim()}"`), { code: kind })
  }

  // The 16-byte header is dropped before anything else so comment stripping
  // cannot shift it, then templates go: both they and comments contain braces.
  let text = raw.slice(16).replace(/\/\/[^\n]*/g, '').replace(/#[^\n]*/g, '')
  for (;;) {
    const match = /\btemplate\b[^{]*\{/.exec(text)
    if (!match) break
    const open = text.indexOf('{', match.index)
    text = text.slice(0, match.index) + text.slice(balanced(text, open).end)
  }

  const meshes: RawMesh[] = []
  walkXFrames(xChildren(text), IDENTITY, meshes)
  if (meshes.length === 0) throw new Error('no Mesh block in .x file')
  if (meshes.length === 1 && meshes[0].name.startsWith('mesh_')) meshes[0].name = name
  // DirectX is left-handed; the pipeline mirrors and rewinds on the way out.
  return { format: 'x', meshes, handed: 'left', upAxis: 'y' }
}

/* ========================================================== Collada ====== */

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return match?.[1]
}

function floats(text: string): number[] {
  const found = text.match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g)
  return found ? found.map(Number) : []
}

interface DaeSource {
  values: number[]
  stride: number
}

/**
 * Collada, the subset every exporter actually writes.
 *
 * Scraped rather than parsed with a DOM: the suite has no XML dependency, and
 * `<triangles>` / `<polylist>` are regular enough in exporter output that the
 * shapes worth handling are the ones a regex can find. `<polygons>` with holes
 * and anything referencing a URI outside the document are out of scope.
 */
export function importCollada(text: string, name: string): MeshImport {
  const upAxis = /<up_axis>\s*Z_UP\s*<\/up_axis>/i.test(text) ? 'z' : 'y'
  const meshes: RawMesh[] = []

  for (const geometry of text.matchAll(/<geometry\b([^>]*)>([\s\S]*?)<\/geometry>/g)) {
    const head = geometry[1] ?? ''
    const body = geometry[2] ?? ''
    const label = attr(head, 'name') ?? attr(head, 'id') ?? `mesh_${meshes.length}`

    const sources = new Map<string, DaeSource>()
    for (const source of body.matchAll(/<source\b([^>]*)>([\s\S]*?)<\/source>/g)) {
      const id = attr(source[1] ?? '', 'id')
      if (!id) continue
      const array = /<float_array\b[^>]*>([\s\S]*?)<\/float_array>/.exec(source[2] ?? '')
      if (!array) continue
      const accessor = /<accessor\b([^>]*)>/.exec(source[2] ?? '')
      const stride = Number(attr(accessor?.[1] ?? '', 'stride') ?? '3') || 3
      sources.set(`#${id}`, { values: floats(array[1] ?? ''), stride })
    }

    // `<vertices>` is an indirection layer: it names the POSITION source.
    const vertexAliases = new Map<string, string>()
    for (const vertices of body.matchAll(/<vertices\b([^>]*)>([\s\S]*?)<\/vertices>/g)) {
      const id = attr(vertices[1] ?? '', 'id')
      const input = /<input\b[^>]*semantic\s*=\s*"POSITION"[^>]*>/.exec(vertices[2] ?? '')
      const source = input ? attr(input[0], 'source') : undefined
      if (id && source) vertexAliases.set(`#${id}`, source)
    }

    const mesh = newMesh(label)
    const positionsWritten = new Map<number, number>()

    for (const primitive of body.matchAll(/<(triangles|polylist)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const kind = primitive[1]
      const inner = primitive[3] ?? ''
      const material = attr(primitive[2] ?? '', 'material')
      const inputs: Array<{ semantic: string; source: string; offset: number; set: number }> = []
      for (const input of inner.matchAll(/<input\b([^>]*)\/?>/g)) {
        const tag = input[1] ?? ''
        const semantic = attr(tag, 'semantic') ?? ''
        const source = attr(tag, 'source') ?? ''
        inputs.push({
          semantic,
          source,
          offset: Number(attr(tag, 'offset') ?? '0') || 0,
          set: Number(attr(tag, 'set') ?? '0') || 0
        })
      }
      const stride = inputs.reduce((max, i) => Math.max(max, i.offset + 1), 1)
      const indices = floats(/<p>([\s\S]*?)<\/p>/.exec(inner)?.[1] ?? '')
      if (indices.length === 0) continue

      const vcounts =
        kind === 'polylist'
          ? floats(/<vcount>([\s\S]*?)<\/vcount>/.exec(inner)?.[1] ?? '')
          : new Array<number>(Math.floor(indices.length / stride / 3)).fill(3)

      const vertexInput = inputs.find((i) => i.semantic === 'VERTEX')
      const normalInput = inputs.find((i) => i.semantic === 'NORMAL')
      const uvInput = inputs.find((i) => i.semantic === 'TEXCOORD' && i.set === 0) ??
        inputs.find((i) => i.semantic === 'TEXCOORD')
      const positionSource = vertexInput
        ? sources.get(vertexAliases.get(vertexInput.source) ?? vertexInput.source)
        : undefined
      if (!vertexInput || !positionSource) continue
      const normalSource = normalInput ? sources.get(normalInput.source) : undefined
      const uvSource = uvInput ? sources.get(uvInput.source) : undefined

      let materialIndex = -1
      if (material) {
        materialIndex = mesh.materials.indexOf(material)
        if (materialIndex < 0) {
          mesh.materials.push(material)
          materialIndex = mesh.materials.length - 1
        }
      }

      let cursor = 0
      for (const rawSize of vcounts) {
        const size = Math.trunc(rawSize)
        if (size < 3 || (cursor + size) * stride > indices.length) break
        const poly: number[] = []
        for (let c = 0; c < size; c++) {
          const base = (cursor + c) * stride
          const sourceIndex = Math.trunc(indices[base + vertexInput.offset])
          let target = positionsWritten.get(sourceIndex)
          if (target === undefined) {
            target = mesh.positions.length / 3
            positionsWritten.set(sourceIndex, target)
            const at = sourceIndex * positionSource.stride
            mesh.positions.push(
              positionSource.values[at] ?? 0,
              positionSource.values[at + 1] ?? 0,
              positionSource.values[at + 2] ?? 0
            )
          }
          poly.push(target)
          if (normalSource && normalInput) {
            const at = Math.trunc(indices[base + normalInput.offset]) * normalSource.stride
            mesh.normals.push(
              normalSource.values[at] ?? 0,
              normalSource.values[at + 1] ?? 0,
              normalSource.values[at + 2] ?? 0
            )
          }
          if (uvSource && uvInput) {
            const at = Math.trunc(indices[base + uvInput.offset]) * uvSource.stride
            mesh.uvs.push(uvSource.values[at] ?? 0, uvSource.values[at + 1] ?? 0)
          }
        }
        mesh.polygons.push(poly)
        if (materialIndex >= 0) mesh.polygonMaterials.push(materialIndex)
        cursor += size
      }
    }

    if (mesh.polygons.length > 0) meshes.push(mesh)
  }

  if (meshes.length === 0) throw new Error('no readable geometry in the Collada document')
  if (meshes.length === 1) meshes[0].name = meshes[0].name || name
  return { format: 'dae', meshes, handed: 'right', upAxis }
}

/* ============================================================= glTF ====== */

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

interface GltfView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GltfNode {
  mesh?: number
  name?: string
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface GltfPrimitive {
  attributes?: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

interface GltfDoc {
  accessors?: GltfAccessor[]
  bufferViews?: GltfView[]
  buffers?: Array<{ uri?: string; byteLength?: number }>
  meshes?: Array<{ name?: string; primitives?: GltfPrimitive[] }>
  materials?: Array<{ name?: string }>
  nodes?: GltfNode[]
  scenes?: Array<{ nodes?: number[] }>
  scene?: number
}

const COMPONENT_SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COUNTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readComponent(buf: Buffer, at: number, componentType: number): number {
  switch (componentType) {
    case 5120:
      return buf.readInt8(at)
    case 5121:
      return buf.readUInt8(at)
    case 5122:
      return buf.readInt16LE(at)
    case 5123:
      return buf.readUInt16LE(at)
    case 5125:
      return buf.readUInt32LE(at)
    default:
      return buf.readFloatLE(at)
  }
}

function readAccessor(doc: GltfDoc, index: number, buffers: Buffer[]): number[] {
  const accessor = doc.accessors?.[index]
  if (!accessor) return []
  const components = TYPE_COUNTS[accessor.type] ?? 1
  if (accessor.bufferView === undefined) return new Array<number>(accessor.count * components).fill(0)
  const view = doc.bufferViews?.[accessor.bufferView]
  if (!view) return []
  const source = buffers[view.buffer]
  if (!source) return []

  const componentSize = COMPONENT_SIZES[accessor.componentType] ?? 4
  const packed = components * componentSize
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : packed
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const out: number[] = []
  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride
    if (at + packed > source.length) break
    for (let c = 0; c < components; c++) {
      out.push(readComponent(source, at + c * componentSize, accessor.componentType))
    }
  }
  return out
}

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix && node.matrix.length === 16) return node.matrix.slice()
  const out = IDENTITY.slice()
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  // Rotation matrix stored so that `transformPoint` reads it correctly.
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)
  ]
  const scales = [sx, sy, sz]
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 4 + row] = r[row * 3 + col] * scales[col]
    }
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  out[12] = tx
  out[13] = ty
  out[14] = tz
  return out
}

function primitiveMesh(
  doc: GltfDoc,
  buffers: Buffer[],
  primitive: GltfPrimitive,
  label: string
): RawMesh | undefined {
  const mode = primitive.mode ?? 4
  if (mode !== 4 && mode !== 5 && mode !== 6) return undefined
  const positionIndex = primitive.attributes?.['POSITION']
  if (positionIndex === undefined) return undefined

  const mesh = newMesh(label)
  mesh.positions = readAccessor(doc, positionIndex, buffers)
  const vertexCount = mesh.positions.length / 3
  if (vertexCount < 3) return undefined

  const normalIndex = primitive.attributes?.['NORMAL']
  const uvIndex = primitive.attributes?.['TEXCOORD_0']
  const normals = normalIndex === undefined ? [] : readAccessor(doc, normalIndex, buffers)
  const uvs = uvIndex === undefined ? [] : readAccessor(doc, uvIndex, buffers)

  const indices =
    primitive.indices === undefined
      ? Array.from({ length: vertexCount }, (_, i) => i)
      : readAccessor(doc, primitive.indices, buffers).map((v) => Math.trunc(v))

  const triangles: number[][] = []
  if (mode === 4) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      triangles.push([indices[i], indices[i + 1], indices[i + 2]])
    }
  } else if (mode === 5) {
    for (let i = 0; i + 2 < indices.length; i++) {
      triangles.push(
        i % 2 === 0
          ? [indices[i], indices[i + 1], indices[i + 2]]
          : [indices[i + 1], indices[i], indices[i + 2]]
      )
    }
  } else {
    for (let i = 1; i + 1 < indices.length; i++) {
      triangles.push([indices[0], indices[i], indices[i + 1]])
    }
  }
  if (triangles.length === 0) return undefined
  mesh.polygons = triangles

  if (normals.length === vertexCount * 3) {
    for (const poly of triangles) {
      for (const index of poly) {
        mesh.normals.push(normals[index * 3] ?? 0, normals[index * 3 + 1] ?? 0, normals[index * 3 + 2] ?? 0)
      }
    }
  }
  if (uvs.length === vertexCount * 2) {
    for (const poly of triangles) {
      for (const index of poly) mesh.uvs.push(uvs[index * 2] ?? 0, uvs[index * 2 + 1] ?? 0)
    }
  }
  if (primitive.material !== undefined) {
    mesh.materials.push(doc.materials?.[primitive.material]?.name ?? `material_${primitive.material}`)
  }
  return mesh
}

const GLB_MAGIC = 0x46546c67
const GLB_JSON = 0x4e4f534a
const GLB_BIN = 0x004e4942

function splitGlb(buf: Buffer): { json: string; bin?: Buffer } {
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB container')
  let at = 12
  let json = ''
  let bin: Buffer | undefined
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32LE(at)
    const type = buf.readUInt32LE(at + 4)
    const start = at + 8
    const end = Math.min(start + length, buf.length)
    if (type === GLB_JSON) json = buf.toString('utf8', start, end)
    else if (type === GLB_BIN) bin = Buffer.from(buf.subarray(start, end))
    at = start + length
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { json, bin }
}

/**
 * glTF 2.0, both `.gltf` and `.glb`.
 *
 * External buffers are resolved next to the document and nowhere else: a `uri`
 * with a path separator or a scheme is refused. A glTF is untrusted input like
 * any other file on the drive, and following its URIs anywhere it points would
 * turn a converter into a file reader.
 */
export async function importGltf(buf: Buffer, name: string, path: string): Promise<MeshImport> {
  const glb = buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC
  const { json, bin } = glb ? splitGlb(buf) : { json: buf.toString('utf8'), bin: undefined }
  const doc = JSON.parse(json) as GltfDoc

  const buffers: Buffer[] = []
  const declared = doc.buffers ?? []
  for (let i = 0; i < declared.length; i++) {
    const uri = declared[i]?.uri
    if (!uri) {
      buffers.push(bin ?? Buffer.alloc(0))
      continue
    }
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',')
      const payload = comma >= 0 ? uri.slice(comma + 1) : ''
      buffers.push(Buffer.from(decodeURIComponent(payload), 'base64'))
      continue
    }
    const sibling = decodeURIComponent(uri)
    if (/[\\/]/.test(sibling) || sibling.includes('..') || /^[a-z]+:/i.test(sibling)) {
      throw new Error(`refusing external glTF buffer "${uri}"`)
    }
    buffers.push(await fs.readFile(join(dirname(path), sibling)))
  }

  const meshes: RawMesh[] = []
  const emit = (meshIndex: number, label: string, world: number[]): void => {
    const source = doc.meshes?.[meshIndex]
    const primitives = source?.primitives ?? []
    primitives.forEach((primitive, i) => {
      const partName = primitives.length > 1 ? `${label}_${i}` : label
      const mesh = primitiveMesh(doc, buffers, primitive, partName)
      if (!mesh) return
      bakeTransform(mesh, world)
      meshes.push(mesh)
    })
  }

  const nodes = doc.nodes ?? []
  const visited = new Set<number>()
  const walk = (index: number, parent: number[]): void => {
    if (visited.has(index)) return
    visited.add(index)
    const current = nodes[index]
    if (!current) return
    const world = compose(nodeMatrix(current), parent)
    if (current.mesh !== undefined) {
      emit(current.mesh, current.name ?? doc.meshes?.[current.mesh]?.name ?? `mesh_${meshes.length}`, world)
    }
    for (const child of current.children ?? []) walk(child, world)
  }

  const roots = doc.scenes?.[doc.scene ?? 0]?.nodes
  if (roots && roots.length > 0) {
    for (const root of roots) walk(root, IDENTITY)
  } else if (nodes.length > 0) {
    for (let i = 0; i < nodes.length; i++) walk(i, IDENTITY)
  } else {
    // No scene graph at all: take the meshes as authored.
    const authored = doc.meshes ?? []
    for (let i = 0; i < authored.length; i++) {
      emit(i, authored[i]?.name ?? `mesh_${i}`, IDENTITY)
    }
  }

  if (meshes.length === 0) throw new Error('no readable geometry in the glTF document')
  if (meshes.length === 1) meshes[0].name = meshes[0].name || name
  // glTF is right-handed Y-up by specification, which is FBX's own reading.
  return { format: glb ? 'glb' : 'gltf', meshes, handed: 'right', upAxis: 'y' }
}
