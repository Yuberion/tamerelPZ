/**
 * Mesh intake: source formats in, one neutral mesh model out.
 *
 * Every importer produces the same shape — a shared position pool, polygons that
 * index into it, and normals/UVs listed once per polygon *corner*. That last
 * choice is deliberate: it is the only layout that survives every source format
 * without an index table, because OBJ, PLY, DirectX and glTF all disagree about
 * whether a normal belongs to a vertex, a face or a corner, and a corner is the
 * finest of the three.
 *
 * This file holds the model, the geometry passes and the formats with a flat
 * layout (OBJ, STL, PLY). `meshdcc.ts` holds the ones with a scene graph.
 */
import { basename, extname } from 'node:path'

export interface RawMesh {
  name: string
  /** Flat xyz triplets. */
  positions: number[]
  /** One entry per polygon; values index `positions / 3`. */
  polygons: number[][]
  /** Per polygon-vertex xyz, or empty. */
  normals: number[]
  /** Per polygon-vertex uv, or empty. */
  uvs: number[]
  /** Per polygon index into `materials`, or empty. */
  polygonMaterials: number[]
  materials: string[]
}

export interface MeshImport {
  /** Short format token for the report: `obj`, `stl-binary`, `x`, … */
  format: string
  meshes: RawMesh[]
  /**
   * Up axis the *file* declares, when it declares one. A declaration always
   * beats the user's "source is Z-up" guess.
   */
  upAxis?: 'y' | 'z'
  /**
   * Coordinate handedness of the source. DirectX `.x` is left-handed, so its
   * geometry has to be mirrored and rewound on the way into FBX or every model
   * arrives inside out.
   */
  handed?: 'left' | 'right'
  /** Stable note code surfaced in the UI. */
  note?: string
}

export function newMesh(name: string): RawMesh {
  return { name, positions: [], polygons: [], normals: [], uvs: [], polygonMaterials: [], materials: [] }
}

export function meshName(path: string): string {
  const base = basename(path, extname(path))
  return base.replace(/[^\w .\-]+/g, '_') || 'mesh'
}

/* --------------------------------------------------------------- passes ---- */

/**
 * Merge positions that land on the same point.
 *
 * Triangle-soup formats (STL above all) repeat every shared corner, so a cube
 * arrives as 36 vertices instead of 8. Welding is keyed on a 1e-5 grid rather
 * than exact equality because exporters round, and two corners that differ in
 * the seventh decimal are the same corner.
 */
export function weldMesh(mesh: RawMesh): void {
  const map = new Map<string, number>()
  const positions: number[] = []
  const remap = new Int32Array(mesh.positions.length / 3)

  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3]
    const y = mesh.positions[i * 3 + 1]
    const z = mesh.positions[i * 3 + 2]
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
    let index = map.get(key)
    if (index === undefined) {
      index = positions.length / 3
      map.set(key, index)
      positions.push(x, y, z)
    }
    remap[i] = index
  }

  if (positions.length === mesh.positions.length) return
  mesh.positions = positions
  for (const poly of mesh.polygons) {
    for (let i = 0; i < poly.length; i++) poly[i] = remap[poly[i]]
  }
}

/** Drop vertices no polygon references, then reindex. Keeps split parts lean. */
export function compactMesh(mesh: RawMesh): void {
  const used = new Int32Array(mesh.positions.length / 3).fill(-1)
  for (const poly of mesh.polygons) for (const index of poly) used[index] = 0
  const positions: number[] = []
  for (let i = 0; i < used.length; i++) {
    if (used[i] !== 0) continue
    used[i] = positions.length / 3
    positions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2])
  }
  if (positions.length === mesh.positions.length) return
  mesh.positions = positions
  for (const poly of mesh.polygons) {
    for (let i = 0; i < poly.length; i++) poly[i] = used[poly[i]]
  }
}

/**
 * Per-corner normals from polygon winding, using Newell's method.
 *
 * Newell rather than a single cross product because it is correct for n-gons and
 * for slightly non-planar quads, which is most quads in a hand-built model. The
 * result is flat shading — the source said nothing about smoothing, and inventing
 * a smoothing angle would be inventing data.
 */
export function buildFlatNormals(mesh: RawMesh): void {
  const normals: number[] = []
  for (const poly of mesh.polygons) {
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] * 3
      const b = poly[(i + 1) % poly.length] * 3
      const ax = mesh.positions[a]
      const ay = mesh.positions[a + 1]
      const az = mesh.positions[a + 2]
      const bx = mesh.positions[b]
      const by = mesh.positions[b + 1]
      const bz = mesh.positions[b + 2]
      nx += (ay - by) * (az + bz)
      ny += (az - bz) * (ax + bx)
      nz += (ax - bx) * (ay + by)
    }
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    for (let i = 0; i < poly.length; i++) normals.push(nx, ny, nz)
  }
  mesh.normals = normals
}

/** Quarter turn about X: Z-up right-handed becomes Y-up right-handed. */
function rotateZupToYup(values: number[]): void {
  for (let i = 0; i < values.length; i += 3) {
    const y = values[i + 1]
    const z = values[i + 2]
    values[i + 1] = z
    values[i + 2] = -y
  }
}

/** Mirror on Z and reverse winding: left-handed source into right-handed FBX. */
function mirrorZ(mesh: RawMesh): void {
  for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] = -mesh.positions[i]

  const corners = mesh.polygons.reduce((n, p) => n + p.length, 0)
  const hasNormals = mesh.normals.length === corners * 3
  const hasUvs = mesh.uvs.length === corners * 2
  const normals: number[] = []
  const uvs: number[] = []
  let cursor = 0

  for (const poly of mesh.polygons) {
    const size = poly.length
    if (hasNormals) {
      for (let i = size - 1; i >= 0; i--) {
        const at = (cursor + i) * 3
        normals.push(mesh.normals[at], mesh.normals[at + 1], -mesh.normals[at + 2])
      }
    }
    if (hasUvs) {
      for (let i = size - 1; i >= 0; i--) {
        const at = (cursor + i) * 2
        uvs.push(mesh.uvs[at], mesh.uvs[at + 1])
      }
    }
    poly.reverse()
    cursor += size
  }

  if (hasNormals) mesh.normals = normals
  if (hasUvs) mesh.uvs = uvs
}

export interface GeometryPass {
  scale: number
  /** Treat the source as Z-up. Ignored when the format declared its own axis. */
  assumeZup: boolean
  weld: boolean
  rebuildNormals: boolean
}

/**
 * Bring one import into FBX space.
 *
 * Order matters: handedness first (it reverses winding, which normals and UVs
 * follow), then the up-axis rotation, then welding, then scale. Normals are
 * rebuilt last so they describe the geometry that will actually be written.
 */
export function applyGeometryPass(imported: MeshImport, pass: GeometryPass): void {
  const zUp = imported.upAxis ? imported.upAxis === 'z' : pass.assumeZup

  for (const mesh of imported.meshes) {
    if (imported.handed === 'left') mirrorZ(mesh)
    if (zUp) {
      rotateZupToYup(mesh.positions)
      if (mesh.normals.length > 0) rotateZupToYup(mesh.normals)
    }
    if (pass.weld) weldMesh(mesh)
    compactMesh(mesh)
    if (pass.scale !== 1) {
      for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] *= pass.scale
    }
    const corners = mesh.polygons.reduce((n, p) => n + p.length, 0)
    if (mesh.normals.length !== corners * 3) mesh.normals = []
    if (mesh.uvs.length !== corners * 2) mesh.uvs = []
    if (mesh.normals.length === 0 && pass.rebuildNormals && corners > 0) buildFlatNormals(mesh)
  }

  imported.meshes = imported.meshes.filter((m) => m.positions.length >= 3 && m.polygons.length > 0)
}

/* ------------------------------------------------------------------ obj ---- */

/** Resolve an OBJ index: 1-based, or negative and relative to the current end. */
function objIndex(token: string, count: number): number {
  const value = Number.parseInt(token, 10)
  if (!Number.isFinite(value) || value === 0) return -1
  return value > 0 ? value - 1 : count + value
}

/**
 * Wavefront OBJ.
 *
 * Kept as one mesh with per-polygon materials rather than split on `o`/`g`: the
 * position pool is shared across the whole file, so splitting would either
 * duplicate it into every part or need a remap for each — and a multi-material
 * mesh is exactly how a PZ model is authored anyway.
 */
export function importObj(text: string, name: string): MeshImport {
  const mesh = newMesh(name)
  const normalSrc: number[] = []
  const uvSrc: number[] = []
  const normalRefs: number[] = []
  const uvRefs: number[] = []
  let material = -1
  let missingNormal = false
  let missingUv = false

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const space = trimmed.indexOf(' ')
    if (space < 0) continue
    const keyword = trimmed.slice(0, space)
    const rest = trimmed.slice(space + 1).trim()

    if (keyword === 'v') {
      const parts = rest.split(/\s+/)
      mesh.positions.push(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0)
      continue
    }
    if (keyword === 'vn') {
      const parts = rest.split(/\s+/)
      normalSrc.push(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0)
      continue
    }
    if (keyword === 'vt') {
      const parts = rest.split(/\s+/)
      uvSrc.push(Number(parts[0]) || 0, Number(parts[1]) || 0)
      continue
    }
    if (keyword === 'usemtl') {
      const label = rest || 'default'
      material = mesh.materials.indexOf(label)
      if (material < 0) {
        mesh.materials.push(label)
        material = mesh.materials.length - 1
      }
      continue
    }
    if (keyword !== 'f') continue

    const corners = rest.split(/\s+/)
    if (corners.length < 3) continue
    const poly: number[] = []
    for (const corner of corners) {
      const [v, vt, vn] = corner.split('/')
      const vi = objIndex(v ?? '', mesh.positions.length / 3)
      if (vi < 0) continue
      poly.push(vi)
      const ti = vt ? objIndex(vt, uvSrc.length / 2) : -1
      const ni = vn ? objIndex(vn, normalSrc.length / 3) : -1
      uvRefs.push(ti)
      normalRefs.push(ni)
      if (ti < 0) missingUv = true
      if (ni < 0) missingNormal = true
    }
    if (poly.length < 3) {
      // A malformed face would desynchronise the corner-indexed attributes.
      uvRefs.length -= poly.length
      normalRefs.length -= poly.length
      continue
    }
    mesh.polygons.push(poly)
    if (material >= 0) mesh.polygonMaterials.push(material)
  }

  // Expand the per-corner references into the flat per-corner arrays FBX wants.
  if (!missingNormal && normalSrc.length > 0) {
    for (const ni of normalRefs) {
      const at = ni * 3
      mesh.normals.push(normalSrc[at] ?? 0, normalSrc[at + 1] ?? 0, normalSrc[at + 2] ?? 0)
    }
  }
  if (!missingUv && uvSrc.length > 0) {
    for (const ti of uvRefs) {
      const at = ti * 2
      mesh.uvs.push(uvSrc[at] ?? 0, uvSrc[at + 1] ?? 0)
    }
  }
  if (mesh.polygonMaterials.length !== mesh.polygons.length) mesh.polygonMaterials = []

  return { format: 'obj', meshes: [mesh], handed: 'right' }
}

/* ------------------------------------------------------------------ stl ---- */

function isAsciiStl(buf: Buffer): boolean {
  if (buf.length < 84) return true
  const head = buf.toString('latin1', 0, 80).trimStart().toLowerCase()
  if (!head.startsWith('solid')) return false
  // A binary STL can still open with "solid": trust the triangle count instead.
  const declared = buf.readUInt32LE(80)
  return 84 + declared * 50 !== buf.length
}

/**
 * STL, both flavours.
 *
 * STL has no vertex sharing at all — every triangle repeats its three corners —
 * so welding here is not an option the caller gets to decline. Facet normals are
 * kept when they are usable and dropped when the exporter left them at zero,
 * which is common enough to be worth checking.
 */
export function importStl(buf: Buffer, name: string): MeshImport {
  const mesh = newMesh(name)
  const facetNormals: number[] = []

  if (isAsciiStl(buf)) {
    const text = buf.toString('utf8')
    let poly: number[] = []
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('facet normal')) {
        const parts = trimmed.slice(12).trim().split(/\s+/)
        facetNormals.push(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0)
        poly = []
        continue
      }
      if (trimmed.startsWith('vertex')) {
        const parts = trimmed.slice(6).trim().split(/\s+/)
        poly.push(mesh.positions.length / 3)
        mesh.positions.push(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0)
        continue
      }
      if (trimmed.startsWith('endfacet')) {
        if (poly.length >= 3) mesh.polygons.push(poly.slice(0, 3))
        else facetNormals.length = Math.max(0, facetNormals.length - 3)
        poly = []
      }
    }
    finishStl(mesh, facetNormals)
    return { format: 'stl-ascii', meshes: [mesh], handed: 'right' }
  }

  const count = buf.readUInt32LE(80)
  const usable = Math.min(count, Math.max(0, Math.floor((buf.length - 84) / 50)))
  for (let i = 0; i < usable; i++) {
    const at = 84 + i * 50
    facetNormals.push(buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8))
    const poly: number[] = []
    for (let c = 0; c < 3; c++) {
      const v = at + 12 + c * 12
      poly.push(mesh.positions.length / 3)
      mesh.positions.push(buf.readFloatLE(v), buf.readFloatLE(v + 4), buf.readFloatLE(v + 8))
    }
    mesh.polygons.push(poly)
  }
  finishStl(mesh, facetNormals)
  return {
    format: 'stl-binary',
    meshes: [mesh],
    handed: 'right',
    note: usable < count ? 'truncated' : undefined
  }
}

function finishStl(mesh: RawMesh, facetNormals: number[]): void {
  if (facetNormals.length === mesh.polygons.length * 3) {
    const normals: number[] = []
    let usable = true
    for (let f = 0; f < mesh.polygons.length; f++) {
      const nx = facetNormals[f * 3]
      const ny = facetNormals[f * 3 + 1]
      const nz = facetNormals[f * 3 + 2]
      if (Math.hypot(nx, ny, nz) < 1e-9) {
        usable = false
        break
      }
      for (let c = 0; c < 3; c++) normals.push(nx, ny, nz)
    }
    if (usable) mesh.normals = normals
  }
  weldMesh(mesh)
}

/* ------------------------------------------------------------------ ply ---- */

interface PlyProp {
  name: string
  type: string
}

interface PlyElement {
  name: string
  count: number
  props: PlyProp[]
}

const PLY_SIZES: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8
}

function readPlyScalar(buf: Buffer, at: number, type: string): number {
  switch (type) {
    case 'char':
    case 'int8':
      return buf.readInt8(at)
    case 'uchar':
    case 'uint8':
      return buf.readUInt8(at)
    case 'short':
    case 'int16':
      return buf.readInt16LE(at)
    case 'ushort':
    case 'uint16':
      return buf.readUInt16LE(at)
    case 'int':
    case 'int32':
      return buf.readInt32LE(at)
    case 'uint':
    case 'uint32':
      return buf.readUInt32LE(at)
    case 'double':
    case 'float64':
      return buf.readDoubleLE(at)
    default:
      return buf.readFloatLE(at)
  }
}

/**
 * PLY, ASCII and little-endian binary.
 *
 * Big-endian binary is declined rather than misread: it is vanishingly rare from
 * the tools a PZ modder uses, and a silently byte-swapped mesh is worse than an
 * honest refusal.
 */
export function importPly(buf: Buffer, name: string): MeshImport {
  const headEnd = buf.indexOf('end_header')
  if (headEnd < 0) throw new Error('PLY header not terminated')
  const headerText = buf.toString('latin1', 0, headEnd)
  const afterHeader = buf.indexOf('\n', headEnd) + 1

  let format = 'ascii'
  const elements: PlyElement[] = []
  for (const line of headerText.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'format') format = parts[1] ?? 'ascii'
    else if (parts[0] === 'element') {
      elements.push({ name: parts[1] ?? '', count: Number(parts[2]) || 0, props: [] })
    } else if (parts[0] === 'property') {
      const target = elements[elements.length - 1]
      if (!target) continue
      // `property float x`            -> name at 2
      // `property list uchar int idx` -> counter type at 2, item type at 3, name at 4
      if (parts[1] === 'list') target.props.push({ name: parts[4] ?? 'list', type: `list:${parts[2]}:${parts[3]}` })
      else target.props.push({ name: parts[2] ?? '', type: parts[1] ?? 'float' })
    }
  }
  if (format === 'binary_big_endian') throw new Error('big-endian binary PLY is not supported')

  const mesh = newMesh(name)
  const vertexElement = elements.find((e) => e.name === 'vertex')
  const faceElement = elements.find((e) => e.name === 'face')
  if (!vertexElement) throw new Error('PLY has no vertex element')

  const normals: number[] = []
  const uvs: number[] = []
  let hasNormals = false
  let hasUvs = false
  const faces: number[][] = []

  const takeVertex = (values: Map<string, number>): void => {
    mesh.positions.push(values.get('x') ?? 0, values.get('y') ?? 0, values.get('z') ?? 0)
    if (values.has('nx')) {
      hasNormals = true
      normals.push(values.get('nx') ?? 0, values.get('ny') ?? 0, values.get('nz') ?? 0)
    }
    const u = values.get('s') ?? values.get('u') ?? values.get('texture_u')
    const v = values.get('t') ?? values.get('v') ?? values.get('texture_v')
    if (u !== undefined) {
      hasUvs = true
      uvs.push(u, v ?? 0)
    }
  }

  if (format === 'ascii') {
    const rows = buf
      .toString('utf8', afterHeader)
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
    let row = 0
    for (const element of elements) {
      for (let i = 0; i < element.count && row < rows.length; i++, row++) {
        const cells = rows[row].trim().split(/\s+/)
        if (element === vertexElement) {
          const values = new Map<string, number>()
          element.props.forEach((prop, index) => values.set(prop.name, Number(cells[index]) || 0))
          takeVertex(values)
        } else if (element === faceElement) {
          const size = Number(cells[0]) || 0
          const poly: number[] = []
          for (let c = 0; c < size; c++) poly.push(Number(cells[c + 1]) || 0)
          if (poly.length >= 3) faces.push(poly)
        }
      }
    }
  } else {
    let at = afterHeader
    for (const element of elements) {
      for (let i = 0; i < element.count; i++) {
        if (element === vertexElement) {
          const values = new Map<string, number>()
          for (const prop of element.props) {
            if (prop.type.startsWith('list:')) continue
            values.set(prop.name, readPlyScalar(buf, at, prop.type))
            at += PLY_SIZES[prop.type] ?? 4
          }
          takeVertex(values)
          continue
        }
        for (const prop of element.props) {
          if (!prop.type.startsWith('list:')) {
            at += PLY_SIZES[prop.type] ?? 4
            continue
          }
          const [, countType, itemType] = prop.type.split(':')
          const size = readPlyScalar(buf, at, countType ?? 'uchar')
          at += PLY_SIZES[countType ?? 'uchar'] ?? 1
          const itemSize = PLY_SIZES[itemType ?? 'int'] ?? 4
          const poly: number[] = []
          for (let c = 0; c < size; c++) {
            poly.push(readPlyScalar(buf, at, itemType ?? 'int'))
            at += itemSize
          }
          if (element === faceElement && poly.length >= 3) faces.push(poly)
        }
      }
    }
  }

  mesh.polygons = faces
  // PLY attributes are per vertex; FBX wants them per corner, so fan them out.
  const vertexCount = mesh.positions.length / 3
  if (hasNormals && normals.length === vertexCount * 3) {
    for (const poly of faces) {
      for (const index of poly) {
        mesh.normals.push(normals[index * 3] ?? 0, normals[index * 3 + 1] ?? 0, normals[index * 3 + 2] ?? 0)
      }
    }
  }
  if (hasUvs && uvs.length === vertexCount * 2) {
    for (const poly of faces) {
      for (const index of poly) mesh.uvs.push(uvs[index * 2] ?? 0, uvs[index * 2 + 1] ?? 0)
    }
  }

  return { format: format === 'ascii' ? 'ply-ascii' : 'ply-binary', meshes: [mesh], handed: 'right' }
}
