import type { IconName } from '@renderer/components/Icon'
import type { TKey } from '@renderer/i18n'

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
  /** Codename, deliberately not translated — it is an identifier, like the wordmark. */
  name: string
  taglineKey: TKey
  descKey: TKey
  icon: IconName
  status: 'live' | 'sealed'
}

/** The nine hub tiles. Only STALKER is wired up in this build. */
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
    status: 'sealed'
  },
  {
    id: 'signal',
    code: '03',
    name: 'Signal',
    taglineKey: 'module.signal.tagline',
    descKey: 'module.signal.desc',
    icon: 'radio',
    status: 'sealed'
  },
  {
    id: 'workbench',
    code: '04',
    name: 'Workbench',
    taglineKey: 'module.workbench.tagline',
    descKey: 'module.workbench.desc',
    icon: 'wrench',
    status: 'sealed'
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
    id: 'bunker',
    code: '07',
    name: 'Bunker',
    taglineKey: 'module.bunker.tagline',
    descKey: 'module.bunker.desc',
    icon: 'archive',
    status: 'sealed'
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
    status: 'sealed'
  }
]

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown module ${id}`)
  return found
}
