import type { ModInfoDraft, ModInfoExtra } from '@shared/types'

/**
 * Renderer-side `mod.info` serialise/parse.
 *
 * The main process owns the authoritative writer — this is its mirror, used
 * only so the editor can switch between the form and the raw text without a
 * round trip that would discard unsaved edits. Keep the two in step: the field
 * order here matches `serialiseModInfo` in main/services/authoring.ts.
 */

const FIELD_ORDER = [
  'name', 'id', 'description', 'author', 'modversion', 'pzversion', 'url', 'poster', 'icon'
] as const

/** Keys the form owns; anything else round-trips through `extra`. */
const KNOWN_KEYS = new Set([
  'name', 'id', 'description', 'author', 'authors', 'modversion', 'version',
  'pzversion', 'versionmin', 'url', 'poster', 'icon', 'require', 'requires',
  'tags', 'category'
])

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function serializeDraft(draft: ModInfoDraft): string {
  const lines: string[] = []
  const push = (key: string, value: string): void => {
    const clean = oneLine(value)
    if (clean) lines.push(`${key}=${clean}`)
  }

  const values: Record<(typeof FIELD_ORDER)[number], string> = {
    name: draft.name,
    id: draft.id,
    description: draft.description,
    author: draft.authors,
    modversion: draft.modVersion,
    pzversion: draft.pzVersion,
    url: draft.url,
    poster: draft.poster,
    icon: draft.icon
  }
  for (const key of FIELD_ORDER) push(key, values[key])

  for (const r of draft.requires) push('require', r)
  const tags = draft.tags.map(oneLine).filter(Boolean)
  if (tags.length) lines.push(`tags=${tags.join(';')}`)
  for (const e of draft.extra) push(e.key, e.value)

  return lines.join('\n') + '\n'
}

/** Parse raw text back into the editable projection, keeping file metadata. */
export function parseDraft(raw: string, base: ModInfoDraft): ModInfoDraft {
  const fields = new Map<string, string[]>()
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (!key) continue
    const list = fields.get(key)
    if (list) list.push(value)
    else fields.set(key, [value])
  }

  const first = (...keys: string[]): string => {
    for (const k of keys) {
      const v = fields.get(k)?.find((x) => x.length > 0)
      if (v) return v
    }
    return ''
  }
  const split = (...keys: string[]): string[] => {
    const out: string[] = []
    for (const k of keys) {
      for (const v of fields.get(k) ?? []) {
        for (const part of v.split(/[,;]/)) {
          const trimmed = part.trim()
          if (trimmed) out.push(trimmed)
        }
      }
    }
    return [...new Set(out)]
  }

  const extra: ModInfoExtra[] = []
  for (const [key, values] of fields) {
    if (KNOWN_KEYS.has(key)) continue
    for (const value of values) extra.push({ key, value })
  }

  return {
    ...base,
    raw,
    name: first('name'),
    id: first('id'),
    description: first('description'),
    authors: first('authors', 'author'),
    modVersion: first('modversion', 'version'),
    pzVersion: first('pzversion', 'versionmin'),
    url: first('url'),
    poster: first('poster'),
    icon: first('icon'),
    requires: split('require', 'requires'),
    tags: split('tags', 'category'),
    extra
  }
}
