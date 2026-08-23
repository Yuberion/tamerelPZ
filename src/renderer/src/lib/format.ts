export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  const value = n / 1024 ** i
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[i]}`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export interface FuzzyHit {
  score: number
  indices: number[]
}

/**
 * Subsequence matcher with bonuses for exact substrings, word starts and
 * consecutive runs. Fast enough to run over ~1000 mods on every keystroke.
 */
export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  if (!query) return { score: 0, indices: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  const exact = t.indexOf(q)
  if (exact >= 0) {
    const indices: number[] = []
    for (let i = 0; i < q.length; i++) indices.push(exact + i)
    const wordStart = exact === 0 || /[^a-z0-9]/.test(t[exact - 1] ?? '')
    return { score: 1000 - exact + (wordStart ? 250 : 0) + q.length * 4, indices }
  }

  let ti = 0
  let score = 0
  let streak = 0
  const indices: number[] = []
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi] as string
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    const isWordStart = found === 0 || /[^a-z0-9]/.test(t[found - 1] ?? '')
    streak = found === ti ? streak + 1 : 0
    score += 10 + streak * 6 + (isWordStart ? 18 : 0) - Math.min(found - ti, 12)
    indices.push(found)
    ti = found + 1
  }
  return { score, indices }
}

/** Split text into matched/unmatched runs for highlight rendering. */
export function segmentByIndices(
  text: string,
  indices: number[]
): Array<{ text: string; hit: boolean }> {
  if (!indices.length) return [{ text, hit: false }]
  const set = new Set(indices)
  const out: Array<{ text: string; hit: boolean }> = []
  let buffer = ''
  let bufferHit = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== bufferHit) {
      if (buffer) out.push({ text: buffer, hit: bufferHit })
      buffer = ''
      bufferHit = hit
    }
    buffer += text[i]
  }
  if (buffer) out.push({ text: buffer, hit: bufferHit })
  return out
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx > 0 ? p.slice(0, idx) : p
}

/** Shorten a long path for display: `E:\...\mods\Foo\media`. */
export function shortenPath(p: string, keep = 3): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep + 1) return p
  return [parts[0], '…', ...parts.slice(-keep)].join('\\')
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
