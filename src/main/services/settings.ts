import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, GroupMode, SortMode } from '../../shared/types'

const DEFAULTS: AppSettings = {
  disabledSources: [],
  customSources: [],
  sortMode: 'name' as SortMode,
  groupMode: 'type' as GroupMode
}

let cache: AppSettings | undefined

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    cache = {
      ...DEFAULTS,
      ...parsed,
      disabledSources: parsed.disabledSources ?? [],
      customSources: parsed.customSources ?? []
    }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  const next: AppSettings = { ...current, ...patch }
  cache = next
  const file = settingsFile()
  try {
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch {
    /* settings are best-effort */
  }
  return next
}
