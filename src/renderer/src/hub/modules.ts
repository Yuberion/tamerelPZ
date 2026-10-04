import type { IconName } from '@renderer/components/Icon'
import type { TKey } from '@renderer/i18n'

export type ModuleId =
  | 'explorer'
  | 'loadout'
  | 'workshop'
  | 'auditor'
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

/** The nine hub tiles. EXPLORER, LOADOUT, WORKSHOP, AUDITOR, TOOLS and LEDGER are wired up in this build. */
export const MODULES: ModuleDef[] = [
  {
    id: 'explorer',
    code: '01',
    name: 'Explorer',
    taglineKey: 'module.explorer.tagline',
    descKey: 'module.explorer.desc',
    icon: 'folder-open',
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
    id: 'auditor',
    code: '04',
    name: 'Mod Auditor',
    taglineKey: 'module.workbench.tagline',
    descKey: 'module.workbench.desc',
    icon: 'pulse',
    status: 'live'
  },
  {
    id: 'triage',
    code: '05',
    name: 'Triage',
    taglineKey: 'module.triage.tagline',
    descKey: 'module.triage.desc',
    icon: 'map',
    status: 'live'
  },
  {
    id: 'tools',
    code: '06',
    name: 'Tools',
    taglineKey: 'module.tools.tagline',
    descKey: 'module.tools.desc',
    icon: 'tools',
    status: 'live'
  },
  {
    id: 'outpost',
    code: '07',
    name: 'Outpost',
    taglineKey: 'module.outpost.tagline',
    descKey: 'module.outpost.desc',
    icon: 'server',
    status: 'live'
  },
  {
    id: 'ledger',
    code: '08',
    name: 'Ledger',
    taglineKey: 'module.ledger.tagline',
    descKey: 'module.ledger.desc',
    icon: 'book',
    status: 'live'
  },
  {
    id: 'cartograph',
    code: '09',
    name: 'Cartograph',
    taglineKey: 'module.cartograph.tagline',
    descKey: 'module.cartograph.desc',
    icon: 'map-pin',
    status: 'sealed'
  }
]

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown module ${id}`)
  return found
}
