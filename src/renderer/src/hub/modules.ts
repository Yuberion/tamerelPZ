import type { IconName } from '@renderer/components/Icon'
import type { TKey } from '@renderer/i18n'

export type ModuleId =
  | 'stalker'
  | 'loadout'
  | 'workshop'
  | 'workbench'
  | 'triage'
  | 'cartograph'
  | 'tools'
  | 'outpost'
  | 'ledger'

export interface ModuleDef {
  id: ModuleId
  /** Two digit index printed on the tile. */
  code: string
  /** Codename, deliberately not translated — it is an identifier, like the wordmark. */
  name: string
  taglineKey: TKey
  descKey: TKey
  icon: IconName
  status: 'live' | 'sealed'
}

/** The nine hub tiles. STALKER, LOADOUT, WORKSHOP, WORKBENCH, TOOLS and LEDGER are wired up in this build. */
export const MODULES: ModuleDef[] = [
  {
    id: 'stalker',
    code: '01',
    name: 'Stalker',
    taglineKey: 'module.stalker.tagline',
    descKey: 'module.stalker.desc',
    icon: 'crosshair',
    status: 'live'
  },
  {
    id: 'loadout',
    code: '02',
    name: 'Loadout',
    taglineKey: 'module.loadout.tagline',
    descKey: 'module.loadout.desc',
    icon: 'list',
    status: 'live'
  },
  {
    id: 'workshop',
    code: '03',
    name: 'Workshop Overview',
    taglineKey: 'module.workshop.tagline',
    descKey: 'module.workshop.desc',
    icon: 'download',
    status: 'live'
  },
  {
    id: 'workbench',
    code: '04',
    name: 'Workbench',
    taglineKey: 'module.workbench.tagline',
    descKey: 'module.workbench.desc',
    icon: 'wrench',
    status: 'live'
  },
  {
    id: 'triage',
    code: '05',
    name: 'Triage',
    taglineKey: 'module.triage.tagline',
    descKey: 'module.triage.desc',
    icon: 'pulse',
    status: 'sealed'
  },
  {
    id: 'cartograph',
    code: '06',
    name: 'Cartograph',
    taglineKey: 'module.cartograph.tagline',
    descKey: 'module.cartograph.desc',
    icon: 'map',
    status: 'sealed'
  },
  {
    id: 'tools',
    code: '07',
    name: 'Tools',
    taglineKey: 'module.tools.tagline',
    descKey: 'module.tools.desc',
    icon: 'hammer',
    status: 'live'
  },
  {
    id: 'outpost',
    code: '08',
    name: 'Outpost',
    taglineKey: 'module.outpost.tagline',
    descKey: 'module.outpost.desc',
    icon: 'server',
    status: 'sealed'
  },
  {
    id: 'ledger',
    code: '09',
    name: 'Ledger',
    taglineKey: 'module.ledger.tagline',
    descKey: 'module.ledger.desc',
    icon: 'book',
    status: 'live'
  }
]

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown module ${id}`)
  return found
}
