/**
 * FBX 7.4 document construction.
 *
 * One scene model in, one node tree out, then either encoding. Everything that
 * knows what an FBX *document* looks like lives here; everything that knows how
 * records are laid out on disk lives in `fbxbin.ts`.
 *
 * The object graph written for a mesh is the minimum every importer agrees on:
 *
 *     Geometry ──OO──▶ Model(Mesh) ──OO──▶ Model(Null) ──OO──▶ Scene root (0)
 *     Material ──OO──▶ Model(Mesh)
 *     Texture  ──OP──▶ Material ("DiffuseColor")
 *     Video    ──OO──▶ Texture
 *
 * Normals and UVs are written `ByPolygonVertex` / `Direct`, which is the one
 * mapping that never needs an index table and never mismatches a polygon: one
 * value per corner of every polygon, in the order the corners are listed.
 */
import { basename } from 'node:path'
import type { FbxEncoding } from '../../shared/types'
import {
  C,
  D,
  I,
  L,
  N,
  P,
  R,
  S,
  arrayLength,
  darr,
  decodeFbxBinary,
  encodeFbxAscii,
  encodeFbxBinary,
  findNode,
  findNodes,
  iarr,
  node,
  type FbxNode
} from './fbxbin'

export const FBX_VERSION = 7400

/** One mesh in the output scene. */
export interface FbxMeshPart {
  name: string
  /** Flat xyz triplets in output space. */
  positions: number[]
  /** One entry per polygon; values index `positions / 3`. */
  polygons: number[][]
  /** Per polygon-vertex xyz. Empty when the source had no normals. */
  normals: number[]
  /** Per polygon-vertex uv. Empty when the source had no texture coordinates. */
  uvs: number[]
  /** Per polygon index into `materials`. Empty means "one material, all faces". */
  polygonMaterials: number[]
  materials: string[]
}

/** A texture the scene references, optionally with its bytes embedded. */
export interface FbxMedia {
  name: string
  fileName: string
  absolutePath: string
  /** Present when the bytes travel inside the FBX. */
  data?: Buffer
}

export interface FbxScene {
  /** Name of the root null — normally the source file. */
  rootName: string
  creator: string
  meshes: FbxMeshPart[]
  /** Written as user-defined properties on the root null. */
  meta: Array<[string, string]>
  media?: FbxMedia
  /** `UnitScaleFactor`: 1 = centimetres, FBX's own unit. */
  unitScale: number
  /** Absolute path of the source file, recorded in `SceneInfo`. */
  sourcePath?: string
}

/* ------------------------------------------------------------ ids/time ---- */

/** Sequential object ids. Any unique non-zero int64 will do; readable helps. */
class Ids {
  private next = 4_000_000
  take(): number {
    this.next += 1
    return this.next
  }
}

function stamp(date: Date): FbxNode {
  return node('CreationTimeStamp', [], [
    node('Version', [I(1000)]),
    node('Year', [I(date.getFullYear())]),
    node('Month', [I(date.getMonth() + 1)]),
    node('Day', [I(date.getDate())]),
    node('Hour', [I(date.getHours())]),
    node('Minute', [I(date.getMinutes())]),
    node('Second', [I(date.getSeconds())]),
    node('Millisecond', [I(date.getMilliseconds())])
  ])
}

function pad(v: number, width = 2): string {
  return String(v).padStart(width, '0')
}

function creationTime(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(), 3)}`
  )
}

/* -------------------------------------------------------------- header ---- */

function headerExtension(scene: FbxScene, now: Date): FbxNode {
  const url = scene.sourcePath ?? scene.rootName
  return node('FBXHeaderExtension', [], [
    node('FBXHeaderVersion', [I(1003)]),
    node('FBXVersion', [I(FBX_VERSION)]),
    node('EncryptionType', [I(0)]),
    stamp(now),
    node('Creator', [S(scene.creator)]),
    node('SceneInfo', [N('SceneInfo', 'GlobalInfo'), S('UserData')], [
      node('Type', [S('UserData')]),
      node('Version', [I(100)]),
      node('MetaData', [], [
        node('Version', [I(100)]),
        node('Title', [S('')]),
        node('Subject', [S('')]),
        node('Author', [S('')]),
        node('Keywords', [S('')]),
        node('Revision', [S('')]),
        node('Comment', [S('')])
      ]),
      node('Properties70', [], [
        P('DocumentUrl', 'KString', 'Url', '', S(url)),
        P('SrcDocumentUrl', 'KString', 'Url', '', S(url)),
        P('Original', 'Compound', '', ''),
        P('Original|ApplicationVendor', 'KString', '', '', S('PZ MANAGEMENT')),
        P('Original|ApplicationName', 'KString', '', '', S('PZ MANAGEMENT — Tools')),
        P('Original|FileName', 'KString', '', '', S(basename(url))),
        P('LastSaved', 'Compound', '', ''),
        P('LastSaved|ApplicationVendor', 'KString', '', '', S('PZ MANAGEMENT')),
        P('LastSaved|ApplicationName', 'KString', '', '', S('PZ MANAGEMENT — Tools'))
      ])
    ])
  ])
}

function globalSettings(unitScale: number): FbxNode {
  return node('GlobalSettings', [], [
    node('Version', [I(1000)]),
    node('Properties70', [], [
      // Y-up, right-handed: what every importer treats as the default reading.
      P('UpAxis', 'int', 'Integer', '', I(1)),
      P('UpAxisSign', 'int', 'Integer', '', I(1)),
      P('FrontAxis', 'int', 'Integer', '', I(2)),
      P('FrontAxisSign', 'int', 'Integer', '', I(1)),
      P('CoordAxis', 'int', 'Integer', '', I(0)),
      P('CoordAxisSign', 'int', 'Integer', '', I(1)),
      P('OriginalUpAxis', 'int', 'Integer', '', I(1)),
      P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
      P('UnitScaleFactor', 'double', 'Number', '', D(unitScale)),
      P('OriginalUnitScaleFactor', 'double', 'Number', '', D(unitScale)),
      P('AmbientColor', 'ColorRGB', 'Color', '', D(0), D(0), D(0)),
      P('DefaultCamera', 'KString', '', '', S('Producer Perspective')),
      P('TimeMode', 'enum', '', '', I(6)),
      P('TimeSpanStart', 'KTime', 'Time', '', L(0)),
      P('TimeSpanStop', 'KTime', 'Time', '', L(46186158000)),
      P('CustomFrameRate', 'double', 'Number', '', D(-1))
    ])
  ])
}

function documents(ids: Ids): FbxNode {
  const id = ids.take()
  return node('Documents', [], [
    node('Count', [I(1)]),
    node('Document', [L(id), S(''), S('Scene')], [
      node('Properties70', [], [
        P('SourceObject', 'object', '', ''),
        P('ActiveAnimStackName', 'KString', '', '', S(''))
      ]),
      node('RootNode', [L(0)])
    ])
  ])
}

/* ------------------------------------------------------------- geometry --- */

/**
 * `PolygonVertexIndex`: every polygon's indices in order, with the *last* index
 * of each polygon bit-inverted. That inversion is the only polygon boundary FBX
 * records, which is why an n-gon costs nothing and a mesh with no faces is
 * indistinguishable from a point cloud.
 */
function polygonIndexArray(polygons: number[][]): number[] {
  const out: number[] = []
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const index = poly[i]
      out.push(i === poly.length - 1 ? ~index : index)
    }
  }
  return out
}

function layerElement(type: string): FbxNode {
  return node('LayerElement', [], [node('Type', [S(type)]), node('TypedIndex', [I(0)])])
}

function geometryNode(id: number, mesh: FbxMeshPart): FbxNode {
  const corners = mesh.polygons.reduce((n, p) => n + p.length, 0)
  const children: FbxNode[] = [
    node('Properties70', []),
    node('GeometryVersion', [I(124)]),
    node('Vertices', [darr(mesh.positions)]),
    node('PolygonVertexIndex', [iarr(polygonIndexArray(mesh.polygons))])
  ]
  const layers: FbxNode[] = []

  if (mesh.normals.length === corners * 3) {
    children.push(
      node('LayerElementNormal', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('')]),
        node('MappingInformationType', [S('ByPolygonVertex')]),
        node('ReferenceInformationType', [S('Direct')]),
        node('Normals', [darr(mesh.normals)])
      ])
    )
    layers.push(layerElement('LayerElementNormal'))
  }

  if (mesh.uvs.length === corners * 2) {
    children.push(
      node('LayerElementUV', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('UVMap')]),
        node('MappingInformationType', [S('ByPolygonVertex')]),
        node('ReferenceInformationType', [S('Direct')]),
        node('UV', [darr(mesh.uvs)])
      ])
    )
    layers.push(layerElement('LayerElementUV'))
  }

  if (mesh.materials.length > 0) {
    const perPolygon = mesh.polygonMaterials.length === mesh.polygons.length && mesh.materials.length > 1
    children.push(
      node('LayerElementMaterial', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('')]),
        node('MappingInformationType', [S(perPolygon ? 'ByPolygon' : 'AllSame')]),
        node('ReferenceInformationType', [S('IndexToDirect')]),
        node('Materials', [iarr(perPolygon ? mesh.polygonMaterials : [0])])
      ])
    )
    layers.push(layerElement('LayerElementMaterial'))
  }

  if (layers.length > 0) {
    children.push(node('Layer', [I(0)], [node('Version', [I(100)]), ...layers]))
  }

  return node('Geometry', [L(id), N('Geometry', mesh.name), S('Mesh')], children)
}

function modelNode(id: number, name: string, kind: 'Mesh' | 'Null', extra: FbxNode[] = []): FbxNode {
  return node('Model', [L(id), N('Model', name), S(kind)], [
    node('Version', [I(232)]),
    node('Properties70', [], [
      P('RotationActive', 'bool', '', '', I(1)),
      P('InheritType', 'enum', '', '', I(1)),
      P('DefaultAttributeIndex', 'int', 'Integer', '', I(0)),
      P('Lcl Translation', 'Lcl Translation', '', 'A', D(0), D(0), D(0)),
      P('Lcl Rotation', 'Lcl Rotation', '', 'A', D(0), D(0), D(0)),
      P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1)),
      ...extra
    ]),
    node('MultiLayer', [I(0)]),
    node('MultiTake', [I(0)]),
    node('Shading', [C(true)]),
    node('Culling', [S('CullingOff')])
  ])
}

function materialNode(id: number, name: string): FbxNode {
  return node('Material', [L(id), N('Material', name), S('')], [
    node('Version', [I(102)]),
    node('ShadingModel', [S('phong')]),
    node('MultiLayer', [I(0)]),
    node('Properties70', [], [
      P('ShadingModel', 'KString', '', '', S('phong')),
      P('AmbientColor', 'Color', '', 'A', D(0.1), D(0.1), D(0.1)),
      P('DiffuseColor', 'Color', '', 'A', D(0.8), D(0.8), D(0.8)),
      P('DiffuseFactor', 'Number', '', 'A', D(1)),
      P('SpecularColor', 'Color', '', 'A', D(0.2), D(0.2), D(0.2)),
      P('Shininess', 'Number', '', 'A', D(20)),
      P('Opacity', 'Number', '', 'A', D(1))
    ])
  ])
}

function textureNode(id: number, media: FbxMedia): FbxNode {
  return node('Texture', [L(id), N('Texture', media.name), S('')], [
    node('Type', [S('TextureVideoClip')]),
    node('Version', [I(202)]),
    node('TextureName', [N('Texture', media.name)]),
    node('Properties70', [], [
      P('UVSet', 'KString', '', '', S('UVMap')),
      P('UseMaterial', 'bool', '', '', I(1))
    ]),
    node('Media', [N('Video', media.name)]),
    node('FileName', [S(media.absolutePath)]),
    node('RelativeFilename', [S(media.fileName)]),
    node('ModelUVTranslation', [D(0), D(0)]),
    node('ModelUVScaling', [D(1), D(1)]),
    node('Texture_Alpha_Source', [S('None')]),
    node('Cropping', [I(0), I(0), I(0), I(0)])
  ])
}

/**
 * The media clip itself.
 *
 * `Content` appears only when the caller supplied bytes; without them the node is
 * a reference and the importer resolves `Filename` from disk. Both are valid, and
 * which one you get is the caller's "embed" decision, not this function's.
 */
function videoNode(id: number, media: FbxMedia): FbxNode {
  const children: FbxNode[] = [
    node('Type', [S('Clip')]),
    node('Properties70', [], [P('Path', 'KString', 'XRefUrl', '', S(media.absolutePath))]),
    node('UseMipMap', [I(0)]),
    node('Filename', [S(media.absolutePath)]),
    node('RelativeFilename', [S(media.fileName)])
  ]
  if (media.data) children.push(node('Content', [R(media.data)]))
  return node('Video', [L(id), N('Video', media.name), S('Clip')], children)
}

/* -------------------------------------------------------------- document -- */

/** Build the complete node tree for one scene. */
export function buildFbxDocument(scene: FbxScene, encoding: FbxEncoding, now = new Date()): FbxNode {
  const ids = new Ids()
  const objects: FbxNode[] = []
  const connections: FbxNode[] = []
  const connect = (child: number, parent: number): void => {
    connections.push(node('C', [S('OO'), L(child), L(parent)]))
  }

  const rootId = ids.take()
  const metaProps = scene.meta.map(([key, value]) => P(key, 'KString', '', 'U', S(value)))
  objects.push(modelNode(rootId, scene.rootName, 'Null', metaProps))
  connect(rootId, 0)

  // One Material object per distinct name, shared by every mesh that uses it.
  const materialIds = new Map<string, number>()
  const materialId = (name: string): number => {
    const found = materialIds.get(name)
    if (found !== undefined) return found
    const id = ids.take()
    materialIds.set(name, id)
    objects.push(materialNode(id, name))
    return id
  }

  for (const mesh of scene.meshes) {
    const geoId = ids.take()
    const modelId = ids.take()
    objects.push(geometryNode(geoId, mesh))
    objects.push(modelNode(modelId, mesh.name, 'Mesh'))
    connect(geoId, modelId)
    connect(modelId, rootId)
    // Connection order *is* the material index the layer element refers to.
    for (const name of mesh.materials) connect(materialId(name), modelId)
  }

  if (scene.media) {
    // A capsule has no mesh to hang a material on; give it one so the embedded
    // bytes are still reachable from the object graph.
    if (materialIds.size === 0) {
      const id = materialId(`${scene.rootName}_mat`)
      connect(id, rootId)
    }
    const textureId = ids.take()
    const videoId = ids.take()
    objects.push(textureNode(textureId, scene.media))
    objects.push(videoNode(videoId, scene.media))
    connect(videoId, textureId)
    for (const id of materialIds.values()) {
      connections.push(node('C', [S('OP'), L(textureId), L(id), S('DiffuseColor')]))
    }
  }

  const definitions: FbxNode[] = [
    node('Version', [I(100)]),
    node('Count', [I(objects.length + 1)]),
    node('ObjectType', [S('GlobalSettings')], [node('Count', [I(1)])]),
    node('ObjectType', [S('Model')], [node('Count', [I(scene.meshes.length + 1)])])
  ]
  if (scene.meshes.length > 0) {
    definitions.push(node('ObjectType', [S('Geometry')], [node('Count', [I(scene.meshes.length)])]))
  }
  if (materialIds.size > 0) {
    definitions.push(node('ObjectType', [S('Material')], [node('Count', [I(materialIds.size)])]))
  }
  if (scene.media) {
    definitions.push(node('ObjectType', [S('Texture')], [node('Count', [I(1)])]))
    definitions.push(node('ObjectType', [S('Video')], [node('Count', [I(1)])]))
  }

  const top: FbxNode[] = [headerExtension(scene, now)]
  if (encoding === 'binary') {
    // FileId is a binary-only record; the ASCII writer has no equivalent.
    top.push(node('FileId', [R(Buffer.from('28b3d5e1b1c2a3f4c5d6e7f809a1b2c3', 'hex'))]))
  }
  top.push(
    node('CreationTime', [S(creationTime(now))]),
    node('Creator', [S(scene.creator)]),
    globalSettings(scene.unitScale),
    documents(ids),
    node('References', []),
    node('Definitions', [], definitions),
    node('Objects', [], objects),
    node('Connections', [], connections),
    node('Takes', [], [node('Current', [S('')])])
  )

  return node('', [], top)
}

/** Build and serialise one scene. */
export function writeFbx(scene: FbxScene, encoding: FbxEncoding): Buffer {
  const doc = buildFbxDocument(scene, encoding)
  if (encoding === 'ascii') return Buffer.from(encodeFbxAscii(doc, FBX_VERSION), 'utf8')
  return encodeFbxBinary(doc, FBX_VERSION)
}

/* ---------------------------------------------------------------- verify -- */

export interface FbxExpectation {
  meshes: number
  /** Total position floats across every mesh. */
  positionFloats: number
  /** Total polygon corners across every mesh. */
  corners: number
}

export interface FbxVerification {
  ok: boolean
  version: number
  meshes: number
  positionFloats: number
  corners: number
  /** Stable, short descriptions of whatever did not line up. */
  problems: string[]
}

/**
 * Re-read a freshly written binary FBX and check it against what was intended.
 *
 * This is the difference between "the writer did not throw" and "the file is
 * readable and holds the geometry". Cheap enough to leave on by default: parsing
 * is a linear pass and the arrays it inflates are the ones just written.
 */
export function verifyFbxBinary(buf: Buffer, expect: FbxExpectation): FbxVerification {
  const problems: string[] = []
  const { version, root } = decodeFbxBinary(buf)
  if (version !== FBX_VERSION) problems.push(`version ${version}`)

  for (const required of ['FBXHeaderExtension', 'Definitions', 'Objects', 'Connections']) {
    if (!findNode(root, required)) problems.push(`missing ${required}`)
  }

  const geometries = findNodes(root, 'Geometry')
  let positionFloats = 0
  let corners = 0
  for (const geo of geometries) {
    const vertices = arrayLength(geo.children.find((c) => c.name === 'Vertices'))
    const indices = arrayLength(geo.children.find((c) => c.name === 'PolygonVertexIndex'))
    if (vertices < 0) problems.push('geometry without Vertices')
    if (indices < 0) problems.push('geometry without PolygonVertexIndex')
    positionFloats += Math.max(0, vertices)
    corners += Math.max(0, indices)
  }

  if (geometries.length !== expect.meshes) {
    problems.push(`mesh count ${geometries.length} != ${expect.meshes}`)
  }
  if (positionFloats !== expect.positionFloats) {
    problems.push(`vertex data ${positionFloats} != ${expect.positionFloats}`)
  }
  if (corners !== expect.corners) {
    problems.push(`polygon data ${corners} != ${expect.corners}`)
  }

  return { ok: problems.length === 0, version, meshes: geometries.length, positionFloats, corners, problems }
}
