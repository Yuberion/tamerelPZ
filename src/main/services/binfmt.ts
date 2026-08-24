/**
 * Hand-rolled binary writers: CRC32, a minimal ZIP archive and a tiny PNG
 * encoder.
 *
 * The suite ships with zero runtime dependencies, so the Workbench cannot pull
 * in `archiver` or `pngjs`. Node's `zlib` is a builtin (not an npm dependency),
 * so DEFLATE compression is borrowed from it; everything around it — the CRC
 * table, the local/central ZIP records, the PNG chunk framing — is written here.
 */
import { deflateRawSync, deflateSync } from 'node:zlib'

/* ----------------------------------------------------------------- CRC32 -- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------------- ZIP -- */

export interface ZipEntry {
  /** Forward-slashed archive path. Directories end with `/`. */
  name: string
  /** Absent for directory entries. */
  data?: Buffer
  /** Last-modified time; defaults to now. */
  mtime?: Date
}

interface StagedEntry {
  nameBytes: Buffer
  crc: number
  compressed: Buffer
  size: number
  method: number
  dosTime: number
  dosDate: number
  isDir: boolean
  offset: number
}

/** MS-DOS packed date/time, the only timestamp format ZIP understands. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const packedDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: packedDate & 0xffff }
}

/**
 * Build a ZIP archive in memory.
 *
 * Entries under `store` (by extension) are archived uncompressed because they
 * are already compressed formats — recompressing PNGs and OGGs only burns CPU.
 * Everything else goes through raw DEFLATE, and a stored copy is kept whenever
 * deflate fails to shrink the data.
 */
export function buildZip(entries: ZipEntry[], store: Set<string> = STORE_EXTS): Buffer {
  const staged: StagedEntry[] = []
  const chunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const isDir = !entry.data
    const data = entry.data ?? Buffer.alloc(0)
    const { time, date } = dosDateTime(entry.mtime ?? new Date())
    const ext = extOf(entry.name)
    let method = 0
    let compressed = data
    if (!isDir && data.length > 0 && !store.has(ext)) {
      const deflated = deflateRawSync(data, { level: 9 })
      if (deflated.length < data.length) {
        method = 8
        compressed = deflated
      }
    }

    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = isDir ? 0 : crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra length

    chunks.push(local, nameBytes, compressed)
    staged.push({
      nameBytes,
      crc,
      compressed,
      size: data.length,
      method,
      dosTime: time,
      dosDate: date,
      isDir,
      offset
    })
    offset += local.length + nameBytes.length + compressed.length
  }

  const centralStart = offset
  for (const s of staged) {
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8) // UTF-8 flag
    central.writeUInt16LE(s.method, 10)
    central.writeUInt16LE(s.dosTime, 12)
    central.writeUInt16LE(s.dosDate, 14)
    central.writeUInt32LE(s.crc, 16)
    central.writeUInt32LE(s.compressed.length, 20)
    central.writeUInt32LE(s.size, 24)
    central.writeUInt16LE(s.nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(s.isDir ? 0x10 : 0, 38) // external attrs (dir bit)
    central.writeUInt32LE(s.offset, 42)
    chunks.push(central, s.nameBytes)
    offset += central.length + s.nameBytes.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(staged.length, 8)
  end.writeUInt16LE(staged.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20)
  chunks.push(end)

  return Buffer.concat(chunks)
}

/** Formats that are already compressed — storing them beats re-deflating. */
const STORE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ogg', 'mp3', 'wav', 'bank', 'fsb',
  'zip', 'rar', '7z', 'pack', 'bin', 'x', 'fbx'
])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/* ------------------------------------------------------------------- PNG -- */

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/**
 * Encode a solid RGBA image with a 1px inset border as a PNG.
 *
 * Deliberately tiny: used only for the scaffolder's placeholder poster, so an
 * author has a valid `poster.png` to replace rather than a missing-file
 * warning. Not a general-purpose encoder.
 */
export function solidPng(
  width: number,
  height: number,
  fill: [number, number, number],
  border: [number, number, number] = [168, 97, 58]
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // colour type: RGBA
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < width; x++) {
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2
      const [r, g, b] = edge ? border : fill
      const p = rowStart + 1 + x * 4
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = 255
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
