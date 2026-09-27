import type { ModEntry, SortingRule } from '@shared/types'
import { bareId } from './useLoadout'
import { isSeparator } from './OrderList'

export interface ModConflictTarget {
  id: string
  name: string
}

export interface ModMissingDepTarget {
  id: string
  name: string
  installed: boolean
}

export interface ModStatusInfo {
  incompatibleWith: ModConflictTarget[]
  missingDeps: ModMissingDepTarget[]
}

/**
 * Computes conflict and dependency status for all mods relative to the currently active mod list.
 */
export function computeModsStatus(
  activeTokens: string[],
  allMods: ModEntry[],
  byModId: Map<string, ModEntry>,
  rules: Record<string, SortingRule> = {}
): {
  statusMap: Map<string, ModStatusInfo>
  activeBareIds: Set<string>
} {
  const statusMap = new Map<string, ModStatusInfo>()

  // 1. Gather all active bare IDs
  const activeBareIds = new Set<string>()
  for (const token of activeTokens) {
    if (!isSeparator(token)) {
      const b = bareId(token)
      if (b) activeBareIds.add(b)
    }
  }

  // 2. Pre-index incompatibilities declared by active mods
  // Maps targetBareId -> Set of activeBareIds that declared this target as incompatible
  const activeDeclaringTargetIncompatible = new Map<string, Set<string>>()
  for (const activeBare of activeBareIds) {
    const activeMod = byModId.get(activeBare)
    const activeRule = rules[activeBare]
    const declaredIncompat = [
      ...(activeMod?.incompatible ?? []),
      ...(activeRule?.incompatibleMods ?? [])
    ]
    for (const bad of declaredIncompat) {
      const badBare = bareId(bad)
      if (!badBare) continue
      let set = activeDeclaringTargetIncompatible.get(badBare)
      if (!set) {
        set = new Set<string>()
        activeDeclaringTargetIncompatible.set(badBare, set)
      }
      set.add(activeBare)
    }
  }

  // 3. For each mod in allMods, calculate its conflict and missing dependency status
  for (const mod of allMods) {
    const mBare = bareId(mod.modId ?? mod.folderName)
    if (!mBare) continue

    // Incompatibility check:
    const conflictSet = new Set<string>()
    const mRule = rules[mBare]
    const mDeclaredIncompat = [
      ...(mod.incompatible ?? []),
      ...(mRule?.incompatibleMods ?? [])
    ]
    // A: Mod M declares an active mod as incompatible
    for (const bad of mDeclaredIncompat) {
      const badBare = bareId(bad)
      if (badBare && activeBareIds.has(badBare) && badBare !== mBare) {
        conflictSet.add(badBare)
      }
    }
    // B: An active mod declared Mod M as incompatible
    const declaredAgainstM = activeDeclaringTargetIncompatible.get(mBare)
    if (declaredAgainstM) {
      for (const activeBare of declaredAgainstM) {
        if (activeBare !== mBare) {
          conflictSet.add(activeBare)
        }
      }
    }

    const incompatibleWith: ModConflictTarget[] = []
    for (const conflictBare of conflictSet) {
      const conflictMod = byModId.get(conflictBare)
      incompatibleWith.push({
        id: conflictBare,
        name: conflictMod?.name ?? conflictBare
      })
    }

    // Missing dependencies check:
    const missingDeps: ModMissingDepTarget[] = []
    const seenReqs = new Set<string>()
    for (const req of mod.requires ?? []) {
      const reqBare = bareId(req)
      if (!reqBare || seenReqs.has(reqBare)) continue
      seenReqs.add(reqBare)

      // If required mod is NOT in activeBareIds, it is missing / not enabled
      if (!activeBareIds.has(reqBare)) {
        const reqMod = byModId.get(reqBare)
        missingDeps.push({
          id: req,
          name: reqMod?.name ?? req,
          installed: Boolean(reqMod)
        })
      }
    }

    statusMap.set(mBare, { incompatibleWith, missingDeps })
  }

  return { statusMap, activeBareIds }
}

/**
 * Helper to retrieve status for a token or mod entry safely.
 */
export function getModStatusForToken(
  token: string,
  mod: ModEntry | undefined,
  statusMap: Map<string, ModStatusInfo>
): ModStatusInfo {
  const b = bareId(token)
  const existing = statusMap.get(b)
  if (existing) return existing

  if (mod) {
    const modBare = bareId(mod.modId ?? mod.folderName)
    const modExisting = statusMap.get(modBare)
    if (modExisting) return modExisting
  }

  return { incompatibleWith: [], missingDeps: [] }
}
