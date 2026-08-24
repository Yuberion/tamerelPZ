import { useMemo } from 'react'
import type { AuthoringTarget, ModEntry } from '@shared/types'
import { fuzzyMatch } from '@renderer/lib/format'

export interface EditableMod {
  mod: ModEntry
  /** True when the mod lives inside a Workbench write root. */
  writable: boolean
  score: number
  indices: number[]
}

/**
 * The mods the Workbench lists on the left.
 *
 * A mod is *editable* when it sits inside one of the authoring targets, i.e.
 * `Zomboid\mods`, `Zomboid\Workshop` or a custom container — the same roots the
 * write guard enforces. Workshop and game mods are shown too but flagged
 * read-only, so an author can inspect them without being tempted to edit a copy
 * Steam will overwrite.
 */
export function useEditableMods(
  mods: ModEntry[],
  targets: AuthoringTarget[],
  query: string
): { rows: EditableMod[]; writableCount: number } {
  return useMemo(() => {
    const roots = targets.map((t) => t.path.toLowerCase().replace(/[\\/]+$/, ''))
    const isWritable = (path: string): boolean => {
      const lower = path.toLowerCase()
      return roots.some((r) => lower === r || lower.startsWith(r + '\\') || lower.startsWith(r + '/'))
    }

    const needle = query.trim()
    const rows: EditableMod[] = []
    let writableCount = 0

    for (const mod of mods) {
      const writable = isWritable(mod.path)
      if (writable) writableCount++

      if (needle) {
        const hit =
          fuzzyMatch(needle, mod.name) ??
          (mod.modId ? fuzzyMatch(needle, mod.modId) : null) ??
          fuzzyMatch(needle, mod.folderName)
        if (!hit) continue
        rows.push({ mod, writable, score: hit.score, indices: hit.indices })
      } else {
        rows.push({ mod, writable, score: 0, indices: [] })
      }
    }

    rows.sort((a, b) => {
      // Editable mods first, then by search score, then by name.
      if (a.writable !== b.writable) return a.writable ? -1 : 1
      if (needle && b.score !== a.score) return b.score - a.score
      return a.mod.name.localeCompare(b.mod.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    return { rows, writableCount }
  }, [mods, targets, query])
}
