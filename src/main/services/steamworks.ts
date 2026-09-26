/**
 * Steamworks SDK Integration Service
 *
 * Connects directly to the user's running Steam client via AppID 108600 (Project Zomboid).
 * Allows 1-click native background subscribe and unsubscribe without switching to Steam.
 */

let steamClient: any = null
let initAttempted = false

export function getSteamworks(): any {
  if (steamClient) return steamClient
  if (initAttempted && !steamClient) return null

  initAttempted = true
  try {
    const steamworks = require('steamworks.js')
    steamClient = steamworks.init(108600)
    console.log('[steamworks] Connected to Steam client. User:', steamClient.localplayer.getName())
    return steamClient
  } catch (err) {
    console.warn('[steamworks] Could not connect to Steam client (Steam may be offline):', err)
    steamClient = null
    return null
  }
}

export function isSteamClientActive(): boolean {
  return Boolean(getSteamworks())
}

export function getSteamSubscribedIds(): Set<string> {
  const client = getSteamworks()
  if (!client) return new Set()
  try {
    const items = client.workshop.getSubscribedItems() as bigint[]
    return new Set(items.map((id) => id.toString()))
  } catch (err) {
    console.warn('[steamworks] getSubscribedItems error:', err)
    return new Set()
  }
}

export async function subscribeToWorkshopItem(
  publishedFileId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSteamworks()
  if (!client) {
    return { success: false, error: 'Steam is not running' }
  }

  try {
    const idBig = BigInt(publishedFileId)
    await client.workshop.subscribe(idBig)
    try {
      client.workshop.download(idBig, true)
    } catch {
      // download trigger fallback
    }
    return { success: true }
  } catch (err: any) {
    console.error('[steamworks] Subscribe failed for', publishedFileId, err)
    return { success: false, error: err?.message || String(err) }
  }
}

export async function unsubscribeFromWorkshopItem(
  publishedFileId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSteamworks()
  if (!client) {
    return { success: false, error: 'Steam is not running' }
  }

  try {
    const idBig = BigInt(publishedFileId)
    await client.workshop.unsubscribe(idBig)
    return { success: true }
  } catch (err: any) {
    console.error('[steamworks] Unsubscribe failed for', publishedFileId, err)
    return { success: false, error: err?.message || String(err) }
  }
}
