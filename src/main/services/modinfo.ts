/** Parser for Project Zomboid `mod.info` files (`key=value`, repeated keys allowed). */

export type ModInfoFields = Record<string, string[]>

export function parseModInfo(text: string): ModInfoFields {
  const fields: ModInfoFields = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (!key) continue
    ;(fields[key] ??= []).push(value)
  }
  return fields
}

/** First non-empty value for any of the given keys. */
export function first(fields: ModInfoFields, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = fields[k]?.find((x) => x.length > 0)
    if (v) return v
  }
  return undefined
}

/** Every value across the given keys. */
export function all(fields: ModInfoFields, ...keys: string[]): string[] {
  const out: string[] = []
  for (const k of keys) for (const v of fields[k] ?? []) if (v) out.push(v)
  return out
}

/** Values across the given keys, additionally split on `,` and `;`. */
export function csv(fields: ModInfoFields, ...keys: string[]): string[] {
  const out: string[] = []
  for (const v of all(fields, ...keys)) {
    for (const part of v.split(/[,;]/)) {
      const t = part.trim()
      if (t) out.push(t)
    }
  }
  return [...new Set(out)]
}

/**
 * Build 42 workshop mods write their id as `<workshopId>/<ModId>`.
 * Normalise to the bare mod id so dependency and duplicate checks line up.
 */
export function normaliseModId(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const m = trimmed.match(/^\d+\/(.+)$/)
  return (m?.[1] ?? trimmed).trim()
}
