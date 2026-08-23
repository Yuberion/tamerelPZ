import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, extname } from 'node:path'
import type { FilePreview, FsNode, ModStats } from '../../shared/types'

/** Simple promise concurrency limiter (keeps thousands of stat calls from stampeding). */
export function pLimit(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    active--
    const fn = queue.shift()
    if (fn) fn()
  }
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active++
        void task().then(resolve, reject).finally(next)
      }
      if (active < concurrency) start()
      else queue.push(start)
    })
  }
}

/** Leaf I/O queue: individual stat/readdir calls. Nothing scheduled here may await it. */
const limit = pLimit(48)

/**
 * Separate queue for directory *recursion*.
 *
 * This must never be `limit`. A task that holds a slot while awaiting work from the
 * same limiter deadlocks it permanently as soon as every slot is held by such a
 * waiter — and because `limit` is a module singleton, that would strand `fs:list`,
 * `fs:tree` and `mods:stats` for the rest of the process. Ordering is one-way:
 * `treeLimit` tasks wait on `limit`, never the reverse.
 */
const treeLimit = pLimit(24)

export async function readdirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Directory entry names only, lowercased set — used heavily by mod detection. */
export async function dirNameSet(dir: string): Promise<Set<string>> {
  const set = new Set<string>()
  for (const e of await readdirSafe(dir)) set.add(e.name.toLowerCase())
  return set
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function mtimeOf(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

export async function readTextSafe(p: string, maxBytes = 1024 * 512): Promise<string | undefined> {
  try {
    const handle = await fs.open(p, 'r')
    try {
      const st = await handle.stat()
      const len = Math.min(st.size, maxBytes)
      const buf = Buffer.alloc(len)
      await handle.read(buf, 0, len, 0)
      return stripBom(buf.toString('utf8'))
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export function extOf(name: string): string {
  const e = extname(name)
  return e ? e.slice(1).toLowerCase() : ''
}

function compareNodes(a: FsNode, b: FsNode): number {
  if (a.dir !== b.dir) return a.dir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/** Direct children of `dir` as tree nodes. Directories get their child count. */
export async function listDir(dir: string, withChildCount = true): Promise<FsNode[]> {
  const ents = await readdirSafe(dir)
  const nodes = await Promise.all(
    ents.map((e) =>
      limit(async (): Promise<FsNode | undefined> => {
        const path = join(dir, e.name)
        const isDirectory = e.isDirectory()
        // Skip reparse points / junctions to avoid infinite recursion.
        if (e.isSymbolicLink()) return undefined
        let size = 0
        let mtime = 0
        try {
          const st = await fs.stat(path)
          size = st.isDirectory() ? 0 : st.size
          mtime = st.mtimeMs
        } catch {
          /* unreadable entry: still show it */
        }
        let childCount = 0
        if (isDirectory && withChildCount) childCount = (await readdirSafe(path)).length
        return {
          name: e.name,
          path,
          dir: isDirectory,
          size,
          mtime,
          ext: isDirectory ? '' : extOf(e.name),
          childCount
        }
      })
    )
  )
  return nodes.filter((n): n is FsNode => Boolean(n)).sort(compareNodes)
}

/**
 * Eagerly build a tree down to `depth` levels (depth 1 = direct children only).
 *
 * Expansion is breadth-first on purpose. The obvious recursive form —
 * `limit(() => buildTree(child, depth - 1))` — holds a slot for the whole subtree
 * while `listDir` underneath needs slots from that same limiter, so held slots
 * accumulate with depth until the queue is saturated by waiters and never drains.
 * Level-by-level expansion keeps every limiter acquisition short-lived instead.
 */
export async function buildTree(dir: string, depth: number): Promise<FsNode[]> {
  const roots = await listDir(dir)
  let frontier = depth > 1 ? roots.filter((c) => c.dir && c.childCount > 0) : []

  for (let level = 1; level < depth && frontier.length; level++) {
    const expanded = await Promise.all(frontier.map((node) => treeLimit(() => listDir(node.path))))
    const next: FsNode[] = []
    for (let i = 0; i < frontier.length; i++) {
      const children = expanded[i] ?? []
      frontier[i].children = children
      if (level + 1 < depth) {
        for (const c of children) if (c.dir && c.childCount > 0) next.push(c)
      }
    }
    frontier = next
  }
  return roots
}

const MAX_WALK_ENTRIES = 250_000

/** Recursive size/count statistics for a mod folder. */
export async function walkStats(root: string): Promise<ModStats> {
  const stats: ModStats = { files: 0, dirs: 0, bytes: 0, byExt: {}, truncated: false }
  let seen = 0
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (stack.length) {
    const batch = stack.splice(0, 24)
    const results = await Promise.all(
      batch.map(({ dir, depth }) =>
        limit(async () => {
          const ents = await readdirSafe(dir)
          const nested: Array<{ dir: string; depth: number }> = []
          let files = 0
          let dirs = 0
          let bytes = 0
          const byExt: Record<string, { n: number; bytes: number }> = {}
          for (const e of ents) {
            if (e.isSymbolicLink()) continue
            const p = join(dir, e.name)
            if (e.isDirectory()) {
              dirs++
              if (depth < 32) nested.push({ dir: p, depth: depth + 1 })
              continue
            }
            files++
            let size = 0
            try {
              size = (await fs.stat(p)).size
            } catch {
              /* ignore */
            }
            bytes += size
            const ext = extOf(e.name) || '·none'
            const slot = (byExt[ext] ??= { n: 0, bytes: 0 })
            slot.n++
            slot.bytes += size
          }
          return { nested, files, dirs, bytes, byExt }
        })
      )
    )
    for (const r of results) {
      stats.files += r.files
      stats.dirs += r.dirs
      stats.bytes += r.bytes
      for (const [ext, v] of Object.entries(r.byExt)) {
        const slot = (stats.byExt[ext] ??= { n: 0, bytes: 0 })
        slot.n += v.n
        slot.bytes += v.bytes
      }
      seen += r.files + r.dirs
      if (seen > MAX_WALK_ENTRIES) {
        stats.truncated = true
        return stats
      }
      stack.push(...r.nested)
    }
  }
  return stats
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const TEXT_EXTS = new Set([
  'lua', 'txt', 'info', 'xml', 'json', 'ini', 'cfg', 'md', 'csv', 'yml', 'yaml',
  'bat', 'sh', 'ps1', 'py', 'js', 'ts', 'html', 'css', 'log', 'properties',
  'vert', 'frag', 'glsl', 'shader', 'inl', 'tiles', 'reload', 'sdl'
])
const LANG_BY_EXT: Record<string, string> = {
  lua: 'lua', txt: 'text', info: 'ini', ini: 'ini', cfg: 'ini', properties: 'ini',
  xml: 'xml', html: 'xml', json: 'json', md: 'markdown', csv: 'text',
  js: 'js', ts: 'js', py: 'py', bat: 'shell', sh: 'shell', ps1: 'shell', log: 'text'
}

const PREVIEW_MAX = 256 * 1024

/** PNG / GIF / BMP intrinsic size from the header (no image decoding). */
function imageSize(buf: Buffer): { width?: number; height?: number } {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
    return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return {}
}

/** Read enough of a file to preview it in the info panel. */
export async function readPreview(path: string): Promise<FilePreview> {
  const st = await fs.stat(path)
  const ext = extOf(path)
  const base: FilePreview = { path, kind: 'binary', size: st.size, mtime: st.mtimeMs }

  if (IMAGE_EXTS.has(ext)) {
    const head = Buffer.alloc(Math.min(st.size, 64 * 1024))
    const handle = await fs.open(path, 'r')
    try {
      await handle.read(head, 0, head.length, 0)
    } finally {
      await handle.close()
    }
    return { ...base, kind: 'image', ...imageSize(head) }
  }

  const readLen = Math.min(st.size, PREVIEW_MAX)
  const buf = Buffer.alloc(readLen)
  const handle = await fs.open(path, 'r')
  try {
    await handle.read(buf, 0, readLen, 0)
  } finally {
    await handle.close()
  }

  const probe = buf.subarray(0, Math.min(buf.length, 8192))
  const looksBinary = probe.includes(0)
  if (!TEXT_EXTS.has(ext) && looksBinary) return base

  return {
    ...base,
    kind: 'text',
    text: stripBom(buf.toString('utf8')),
    truncated: st.size > readLen,
    lang: LANG_BY_EXT[ext] ?? 'text'
  }
}
