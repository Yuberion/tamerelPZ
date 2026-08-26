/**
 * FBX container primitives: the node tree, the binary codec and the ASCII codec.
 *
 * FBX is a tree of records. Every record is a name, a flat list of typed
 * properties and a list of nested records — nothing more. Both encodings carry
 * the *same* tree, which is why this file owns the tree type and both writers:
 * `fbx.ts` builds one document and picks an encoding at the end.
 *
 * The suite ships with zero runtime dependencies, so there is no FBX SDK and no
 * `fbx-parser` to lean on. Node's `zlib` is a builtin, and FBX's array
 * properties are plain zlib streams, so that is the one thing borrowed.
 *
 * Two asymmetries between the encodings are worth knowing before touching this:
 *
 *  - Object names are stored *reversed* in binary. What ASCII writes as
 *    `"Model::Torso"` binary stores as `Torso\0\1Model`. That is what the `N`
 *    property type exists for — the document never spells either form itself.
 *  - Embedded media is raw bytes in binary and a comma-prefixed base64 string in
 *    ASCII (`Content: ,"iVBORw0K…"`), which is what the Autodesk writer emits.
 */
import { deflateSync, inflateSync } from 'node:zlib'

/** `Kaydara FBX Binary  \0` + `\x1a\0`. 23 bytes, then a u32 version. */
const HEAD_MAGIC = Buffer.from('Kaydara FBX Binary  \u0000\u001a\u0000', 'latin1')

/**
 * Closing magic every Autodesk-written binary FBX ends with.
 *
 * Importers do not need the footer — Blender stops reading at the top-level
 * sentinel — but the FBX SDK checks it, so a file without one is "corrupt" to
 * the tools most likely to open our output.
 */
const FOOT_MAGIC = Buffer.from('fabcab09d0c8d466b176fb831cf7267e', 'hex')

/** A record list is closed by an all-zero record header (FBX < 7500: 13 bytes). */
const SENTINEL = Buffer.alloc(13)

/** Arrays at least this long are worth a deflate pass. */
const COMPRESS_FROM = 128

export type FbxProp =
  /** bool */
  | { t: 'C'; v: boolean }
  /** int16 */
  | { t: 'Y'; v: number }
  /** int32 */
  | { t: 'I'; v: number }
  /** int64 — object ids and KTime values */
  | { t: 'L'; v: number }
  /** float32 */
  | { t: 'F'; v: number }
  /** float64 */
  | { t: 'D'; v: number }
  /** string */
  | { t: 'S'; v: string }
  /** raw bytes (embedded media) */
  | { t: 'R'; v: Buffer }
  /** `Class::Name`, stored reversed in binary */
  | { t: 'N'; cls: string; name: string }
  /** float64 array */
  | { t: 'd'; v: ArrayLike<number> }
  /** float32 array */
  | { t: 'f'; v: ArrayLike<number> }
  /** int32 array */
  | { t: 'i'; v: ArrayLike<number> }
  /** int64 array */
  | { t: 'l'; v: ArrayLike<number> }
  /** bool array */
  | { t: 'b'; v: ArrayLike<number> }

export interface FbxNode {
  name: string
  props: FbxProp[]
  children: FbxNode[]
}

/* ------------------------------------------------------------ builders ---- */

export function node(name: string, props: FbxProp[] = [], children: FbxNode[] = []): FbxNode {
  return { name, props, children }
}

export const C = (v: boolean): FbxProp => ({ t: 'C', v })
export const I = (v: number): FbxProp => ({ t: 'I', v })
export const L = (v: number): FbxProp => ({ t: 'L', v })
export const D = (v: number): FbxProp => ({ t: 'D', v })
export const S = (v: string): FbxProp => ({ t: 'S', v })
export const R = (v: Buffer): FbxProp => ({ t: 'R', v })
export const N = (cls: string, name: string): FbxProp => ({ t: 'N', cls, name })
export const darr = (v: ArrayLike<number>): FbxProp => ({ t: 'd', v })
export const iarr = (v: ArrayLike<number>): FbxProp => ({ t: 'i', v })

/** `P: "name", "type", "label", "flags", …values` inside a `Properties70` block. */
export function P(name: string, type: string, label: string, flags: string, ...values: FbxProp[]): FbxNode {
  return node('P', [S(name), S(type), S(label), S(flags), ...values])
}

const ARRAY_TYPES = new Set(['d', 'f', 'i', 'l', 'b'])

function isArrayProp(p: FbxProp): p is Extract<FbxProp, { t: 'd' | 'f' | 'i' | 'l' | 'b' }> {
  return ARRAY_TYPES.has(p.t)
}

/* -------------------------------------------------------------- binary ---- */

/** Growable output that tracks its own absolute length, i.e. the file offset. */
class Sink {
  private readonly parts: Buffer[] = []
  len = 0

  push(b: Buffer): void {
    this.parts.push(b)
    this.len += b.length
  }

  done(): Buffer {
    return Buffer.concat(this.parts, this.len)
  }
}

function arrayPayload(p: Extract<FbxProp, { t: 'd' | 'f' | 'i' | 'l' | 'b' }>): {
  count: number
  raw: Buffer
} {
  const count = p.v.length
  if (p.t === 'd') {
    const raw = Buffer.alloc(count * 8)
    for (let i = 0; i < count; i++) raw.writeDoubleLE(p.v[i], i * 8)
    return { count, raw }
  }
  if (p.t === 'f') {
    const raw = Buffer.alloc(count * 4)
    for (let i = 0; i < count; i++) raw.writeFloatLE(p.v[i], i * 4)
    return { count, raw }
  }
  if (p.t === 'i') {
    const raw = Buffer.alloc(count * 4)
    for (let i = 0; i < count; i++) raw.writeInt32LE(p.v[i] | 0, i * 4)
    return { count, raw }
  }
  if (p.t === 'l') {
    const raw = Buffer.alloc(count * 8)
    for (let i = 0; i < count; i++) raw.writeBigInt64LE(BigInt(Math.trunc(p.v[i])), i * 8)
    return { count, raw }
  }
  const raw = Buffer.alloc(count)
  for (let i = 0; i < count; i++) raw[i] = p.v[i] ? 1 : 0
  return { count, raw }
}

function encodeProp(p: FbxProp): Buffer {
  switch (p.t) {
    case 'C': {
      const b = Buffer.alloc(2)
      b.write('C', 0, 'ascii')
      b[1] = p.v ? 1 : 0
      return b
    }
    case 'Y': {
      const b = Buffer.alloc(3)
      b.write('Y', 0, 'ascii')
      b.writeInt16LE(p.v, 1)
      return b
    }
    case 'I': {
      const b = Buffer.alloc(5)
      b.write('I', 0, 'ascii')
      b.writeInt32LE(p.v | 0, 1)
      return b
    }
    case 'L': {
      const b = Buffer.alloc(9)
      b.write('L', 0, 'ascii')
      b.writeBigInt64LE(BigInt(Math.trunc(p.v)), 1)
      return b
    }
    case 'F': {
      const b = Buffer.alloc(5)
      b.write('F', 0, 'ascii')
      b.writeFloatLE(p.v, 1)
      return b
    }
    case 'D': {
      const b = Buffer.alloc(9)
      b.write('D', 0, 'ascii')
      b.writeDoubleLE(p.v, 1)
      return b
    }
    case 'S':
    case 'N': {
      // Binary stores object names back to front: `Torso\0\1Model`.
      const text = p.t === 'S' ? p.v : `${p.name}\u0000\u0001${p.cls}`
      const body = Buffer.from(text, 'utf8')
      const head = Buffer.alloc(5)
      head.write('S', 0, 'ascii')
      head.writeUInt32LE(body.length, 1)
      return Buffer.concat([head, body])
    }
    case 'R': {
      const head = Buffer.alloc(5)
      head.write('R', 0, 'ascii')
      head.writeUInt32LE(p.v.length, 1)
      return Buffer.concat([head, p.v])
    }
    default: {
      const { count, raw } = arrayPayload(p)
      let encoding = 0
      let payload = raw
      if (count >= COMPRESS_FROM) {
        const packed = deflateSync(raw, { level: 6 })
        if (packed.length < raw.length) {
          encoding = 1
          payload = packed
        }
      }
      const head = Buffer.alloc(13)
      head.write(p.t, 0, 'ascii')
      head.writeUInt32LE(count, 1)
      head.writeUInt32LE(encoding, 5)
      head.writeUInt32LE(payload.length, 9)
      return Buffer.concat([head, payload])
    }
  }
}

function writeNode(n: FbxNode, out: Sink): void {
  const nameBytes = Buffer.from(n.name, 'utf8')
  if (nameBytes.length > 255) throw new Error(`FBX node name too long: ${n.name}`)

  // endOffset u32 | numProperties u32 | propertyListLen u32 | nameLen u8 | name
  const head = Buffer.alloc(13 + nameBytes.length)
  head.writeUInt32LE(n.props.length, 4)
  head.writeUInt8(nameBytes.length, 12)
  nameBytes.copy(head, 13)
  out.push(head)

  const propsStart = out.len
  for (const p of n.props) out.push(encodeProp(p))
  head.writeUInt32LE(out.len - propsStart, 8)

  // The sentinel closes a nested list. An empty record with no properties gets
  // one too: that is what the Autodesk writer does for `References: { }`, and
  // every parser tolerates it because the record's own end offset agrees.
  if (n.children.length > 0) {
    for (const c of n.children) writeNode(c, out)
    out.push(SENTINEL)
  } else if (n.props.length === 0) {
    out.push(SENTINEL)
  }

  head.writeUInt32LE(out.len, 0)
}

/**
 * Serialise a document as binary FBX.
 *
 * `root` is a carrier: only its children become top-level records.
 */
export function encodeFbxBinary(root: FbxNode, version: number): Buffer {
  const out = new Sink()
  const header = Buffer.alloc(4)
  header.writeUInt32LE(version, 0)
  out.push(HEAD_MAGIC)
  out.push(header)

  for (const child of root.children) writeNode(child, out)
  out.push(SENTINEL)

  // Footer. The 16-byte id, the alignment padding, the repeated version and the
  // 120 zero bytes are all fixed shape; only the closing magic is checked.
  out.push(FOOT_MAGIC)
  const pad = (16 - (out.len % 16)) % 16
  if (pad > 0) out.push(Buffer.alloc(pad))
  out.push(Buffer.alloc(4))
  const tailVersion = Buffer.alloc(4)
  tailVersion.writeUInt32LE(version, 0)
  out.push(tailVersion)
  out.push(Buffer.alloc(120))
  out.push(FOOT_MAGIC)

  return out.done()
}

/* --------------------------------------------------------------- ascii ---- */

function num(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Number.isInteger(v)) return String(v)
  // Enough digits to survive a round trip, without 17-digit noise everywhere.
  return String(Number(v.toFixed(6)))
}

function quote(v: string): string {
  return `"${v.replace(/[\\"]/g, '\\$&').replace(/[\u0000-\u001f]/g, ' ')}"`
}

/** `Torso\0\1Model` — the on-disk form of an object name in a binary file. */
const NAME_SEP = '\u0000\u0001'

function asciiProp(p: FbxProp): string {
  switch (p.t) {
    case 'C':
      return p.v ? 'T' : 'F'
    case 'Y':
    case 'I':
    case 'L':
      return String(Math.trunc(p.v))
    case 'F':
    case 'D':
      return num(p.v)
    case 'S': {
      // A string decoded from a binary file may *be* an object name. ASCII spells
      // the same value `Class::Name`, so transcoding has to turn it back around —
      // otherwise every object in the output is named after a control character.
      const at = p.v.indexOf(NAME_SEP)
      if (at < 0) return quote(p.v)
      return quote(`${p.v.slice(at + NAME_SEP.length)}::${p.v.slice(0, at)}`)
    }
    case 'N':
      return quote(`${p.cls}::${p.name}`)
    case 'R':
      // Autodesk's own quirk: embedded bytes arrive as a comma then base64.
      return `,${quote(p.v.toString('base64'))}`
    default:
      return `*${p.v.length}`
  }
}

/** `a: 1,2,3` wrapped so no single line grows past a few hundred columns. */
function asciiArray(p: Extract<FbxProp, { t: 'd' | 'f' | 'i' | 'l' | 'b' }>, indent: string): string[] {
  const perLine = p.t === 'i' || p.t === 'l' || p.t === 'b' ? 32 : 12
  const lines: string[] = []
  let current: string[] = []
  for (let i = 0; i < p.v.length; i++) {
    current.push(p.t === 'b' ? (p.v[i] ? '1' : '0') : num(p.v[i]))
    if (current.length === perLine) {
      lines.push(current.join(','))
      current = []
    }
  }
  if (current.length > 0) lines.push(current.join(','))
  if (lines.length === 0) return [`${indent}a: `]
  return lines.map((line, i) => `${indent}${i === 0 ? 'a: ' : ','}${line}`)
}

function writeAscii(n: FbxNode, depth: number, out: string[]): void {
  const indent = '\t'.repeat(depth)
  const head = n.props.map(asciiProp).join(', ')
  const arrayProp = n.props.find(isArrayProp)
  const hasBody = n.children.length > 0 || arrayProp !== undefined

  if (!hasBody) {
    out.push(`${indent}${n.name}:${head ? ` ${head}` : ' '}`)
    return
  }

  out.push(`${indent}${n.name}: ${head ? `${head} {` : ' {'}`)
  if (arrayProp) out.push(...asciiArray(arrayProp, '\t'.repeat(depth + 1)))
  for (const c of n.children) writeAscii(c, depth + 1, out)
  out.push(`${indent}}`)
}

/** Serialise a document as ASCII FBX. */
export function encodeFbxAscii(root: FbxNode, version: number): string {
  const major = Math.floor(version / 1000)
  const minor = Math.floor((version % 1000) / 100)
  const out: string[] = [
    `; FBX ${major}.${minor}.0 project file`,
    '; Written by PZ MANAGEMENT — Tools / FBX forge',
    '; ----------------------------------------------------',
    ''
  ]
  for (const child of root.children) {
    writeAscii(child, 0, out)
    out.push('')
  }
  return out.join('\r\n')
}

/* ---------------------------------------------------------------- read ---- */

/**
 * Minimal binary reader, used to verify what was just written.
 *
 * Anything the forge produces is read back with this before it is reported as a
 * success, which turns "the writer compiled" into "the file parses and holds the
 * geometry we intended". It handles the subset this codebase emits; it is not a
 * general FBX importer.
 */
export function decodeFbxBinary(buf: Buffer): { version: number; root: FbxNode } {
  if (buf.length < 27 || !buf.subarray(0, HEAD_MAGIC.length).equals(HEAD_MAGIC)) {
    throw new Error('not a binary FBX file')
  }
  const version = buf.readUInt32LE(HEAD_MAGIC.length)
  const root: FbxNode = { name: '', props: [], children: [] }
  let pos = HEAD_MAGIC.length + 4

  while (pos + 13 <= buf.length) {
    const endOffset = buf.readUInt32LE(pos)
    if (endOffset === 0) break
    const [child, next] = readNode(buf, pos)
    root.children.push(child)
    pos = next
  }
  return { version, root }
}

function readNode(buf: Buffer, pos: number): [FbxNode, number] {
  const endOffset = buf.readUInt32LE(pos)
  const numProps = buf.readUInt32LE(pos + 4)
  const propsLen = buf.readUInt32LE(pos + 8)
  const nameLen = buf.readUInt8(pos + 12)
  const name = buf.toString('utf8', pos + 13, pos + 13 + nameLen)
  if (endOffset > buf.length) throw new Error(`record "${name}" runs past end of file`)

  let cursor = pos + 13 + nameLen
  const propsEnd = cursor + propsLen
  const props: FbxProp[] = []
  for (let i = 0; i < numProps && cursor < propsEnd; i++) {
    const [prop, next] = readProp(buf, cursor)
    props.push(prop)
    cursor = next
  }

  const children: FbxNode[] = []
  cursor = propsEnd
  // Strictly less than `endOffset`: when a record has children, the last 13
  // bytes before its end are the all-zero sentinel, and reading *that* as a
  // record yields an end offset of 0 and walks the parser back to the header.
  while (cursor + 13 < endOffset) {
    if (buf.readUInt32LE(cursor) === 0) break
    const [child, next] = readNode(buf, cursor)
    children.push(child)
    cursor = next
  }
  return [{ name, props, children }, endOffset]
}

function readProp(buf: Buffer, pos: number): [FbxProp, number] {
  const type = String.fromCharCode(buf.readUInt8(pos))
  const at = pos + 1
  switch (type) {
    case 'C':
      return [{ t: 'C', v: buf.readUInt8(at) !== 0 }, at + 1]
    case 'Y':
      return [{ t: 'Y', v: buf.readInt16LE(at) }, at + 2]
    case 'I':
      return [{ t: 'I', v: buf.readInt32LE(at) }, at + 4]
    case 'L':
      return [{ t: 'L', v: Number(buf.readBigInt64LE(at)) }, at + 8]
    case 'F':
      return [{ t: 'F', v: buf.readFloatLE(at) }, at + 4]
    case 'D':
      return [{ t: 'D', v: buf.readDoubleLE(at) }, at + 8]
    case 'S': {
      const len = buf.readUInt32LE(at)
      return [{ t: 'S', v: buf.toString('utf8', at + 4, at + 4 + len) }, at + 4 + len]
    }
    case 'R': {
      const len = buf.readUInt32LE(at)
      return [{ t: 'R', v: Buffer.from(buf.subarray(at + 4, at + 4 + len)) }, at + 4 + len]
    }
    case 'd':
    case 'f':
    case 'i':
    case 'l':
    case 'b': {
      // `type` came out of a byte, so it is a plain string as far as TS knows.
      const kind = type as 'd' | 'f' | 'i' | 'l' | 'b'
      const count = buf.readUInt32LE(at)
      const encoding = buf.readUInt32LE(at + 4)
      const packedLen = buf.readUInt32LE(at + 8)
      const payload = buf.subarray(at + 12, at + 12 + packedLen)
      const raw = encoding === 1 ? inflateSync(payload) : payload
      return [{ t: kind, v: readArray(kind, raw, count) }, at + 12 + packedLen]
    }
    default:
      throw new Error(`unknown FBX property type "${type}"`)
  }
}

function readArray(type: 'd' | 'f' | 'i' | 'l' | 'b', raw: Buffer, count: number): ArrayLike<number> {
  if (type === 'd') {
    const out = new Float64Array(count)
    for (let i = 0; i < count; i++) out[i] = raw.readDoubleLE(i * 8)
    return out
  }
  if (type === 'f') {
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) out[i] = raw.readFloatLE(i * 4)
    return out
  }
  if (type === 'i') {
    const out = new Int32Array(count)
    for (let i = 0; i < count; i++) out[i] = raw.readInt32LE(i * 4)
    return out
  }
  if (type === 'l') {
    const out = new Float64Array(count)
    for (let i = 0; i < count; i++) out[i] = Number(raw.readBigInt64LE(i * 8))
    return out
  }
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) out[i] = raw.readUInt8(i)
  return out
}

/** First descendant with `name`, breadth-first. Used by the verifier. */
export function findNode(root: FbxNode, name: string): FbxNode | undefined {
  const queue: FbxNode[] = [...root.children]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (current.name === name) return current
    queue.push(...current.children)
  }
  return undefined
}

/** Every descendant with `name`, breadth-first. */
export function findNodes(root: FbxNode, name: string): FbxNode[] {
  const out: FbxNode[] = []
  const queue: FbxNode[] = [...root.children]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (current.name === name) out.push(current)
    queue.push(...current.children)
  }
  return out
}

/** Length of the node's first array property, or -1 when it has none. */
export function arrayLength(n: FbxNode | undefined): number {
  if (!n) return -1
  const found = n.props.find(isArrayProp)
  return found ? found.v.length : -1
}
