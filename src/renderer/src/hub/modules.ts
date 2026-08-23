import type { IconName } from '@renderer/components/Icon'

export type ModuleId =
  | 'stalker'
  | 'loadout'
  | 'signal'
  | 'workbench'
  | 'triage'
  | 'cartograph'
  | 'bunker'
  | 'outpost'
  | 'ledger'

export interface ModuleDef {
  id: ModuleId
  /** Two digit index printed on the tile. */
  code: string
  name: string
  tagline: string
  description: string
  icon: IconName
  status: 'live' | 'sealed'
}

/** The nine hub tiles. Only STALKER is wired up in this build. */
export const MODULES: ModuleDef[] = [
  {
    id: 'stalker',
    code: '01',
    name: 'Stalker',
    tagline: 'Mod explorer',
    description:
      'Walk every mod on the drive. Structure, metadata, artwork and files — straight to Explorer.',
    icon: 'crosshair',
    status: 'live'
  },
  {
    id: 'loadout',
    code: '02',
    name: 'Loadout',
    tagline: 'Load order & profiles',
    description: 'Order mods, build named profiles and push them into the game config.',
    icon: 'list',
    status: 'sealed'
  },
  {
    id: 'signal',
    code: '03',
    name: 'Signal',
    tagline: 'Workshop sync',
    description: 'Track Workshop updates, spot stale downloads and re-subscribe broken items.',
    icon: 'radio',
    status: 'sealed'
  },
  {
    id: 'workbench',
    code: '04',
    name: 'Workbench',
    tagline: 'Authoring tools',
    description: 'Scaffold mods, edit mod.info, validate scripts and pack builds for upload.',
    icon: 'wrench',
    status: 'sealed'
  },
  {
    id: 'triage',
    code: '05',
    name: 'Triage',
    tagline: 'Conflict doctor',
    description: 'Duplicate ids, missing requirements, overwritten scripts and item collisions.',
    icon: 'pulse',
    status: 'sealed'
  },
  {
    id: 'cartograph',
    code: '06',
    name: 'Cartograph',
    tagline: 'Map manager',
    description: 'Map cell overlaps, spawn regions and the map load order that actually works.',
    icon: 'map',
    status: 'sealed'
  },
  {
    id: 'bunker',
    code: '07',
    name: 'Bunker',
    tagline: 'Backups & vault',
    description: 'Snapshot mods and saves before an update wipes a 300 hour run.',
    icon: 'archive',
    status: 'sealed'
  },
  {
    id: 'outpost',
    code: '08',
    name: 'Outpost',
    tagline: 'Server & collections',
    description: 'Generate server ini mod lines, Workshop id lists and shareable collections.',
    icon: 'server',
    status: 'sealed'
  },
  {
    id: 'ledger',
    code: '09',
    name: 'Ledger',
    tagline: 'Logs & settings',
    description: 'Crash logs, console noise, lua errors and the suite configuration.',
    icon: 'book',
    status: 'sealed'
  }
]

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown module ${id}`)
  return found
}
