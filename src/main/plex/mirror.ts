import type { MirrorStatus, ServerContext } from '../../shared/plex.js'
import { listResources } from './resources.js'
import { fetchUser } from './pin-auth.js'
import {
  getMirrorPlexToken,
  setMirrorPlexToken,
  getValue,
  setValue,
  getFromRecord,
  patchRecord,
  deleteFromRecord
} from '../store.js'
import { resolveServerContext } from './connection.js'
import { listPlaylists, getPlaylistItems, syncSmartPlaylist, deletePlaylist } from './playlists.js'

// Playlist mirroring to a second Plex account (the shop's "Shop Amp").
//
// Plex has no cross-account playlist sharing — playlists are welded to the
// account that created them. So Cratedigger maintains twins: for each
// mirrored playlist we read the source items with the signed-in account and
// clear+refill an identically-named playlist under the mirror account's
// token. Track ratingKeys are SERVER-scoped, not account-scoped, so the
// same ids are valid for both accounts as long as the mirror account can
// see the library.
//
// The source→mirror ratingKey map lives in electron-store
// (`playlistMirrors`); presence in the map is what "mirrored" means.

const mirrorCtxCache = new Map<string, ServerContext>()

export function clearMirrorContextCache(): void {
  mirrorCtxCache.clear()
}

export function mirrorStatus(): MirrorStatus {
  const token = getMirrorPlexToken()
  return {
    connected: token !== null,
    account: token !== null ? getValue('mirrorAccountName') || null : null,
    mirrored: getValue('playlistMirrors')
  }
}

export async function connectMirror(token: string): Promise<MirrorStatus> {
  const user = await fetchUser(token)
  setMirrorPlexToken(token)
  setValue('mirrorAccountName', user.username || user.title || '')
  clearMirrorContextCache()
  return mirrorStatus()
}

export function disconnectMirror(): void {
  setMirrorPlexToken(null)
  setValue('mirrorAccountName', '')
  // Keep the rk map: reconnecting the same account picks the twins back up;
  // syncSmartPlaylist recreates cleanly if they were deleted meanwhile.
  clearMirrorContextCache()
}

// Like resolveServerContext but authenticated as the mirror account. The
// mirror account must have the server shared to it (Shop Amp does).
async function resolveMirrorContext(serverId: string): Promise<ServerContext> {
  const cached = mirrorCtxCache.get(serverId)
  if (cached) return cached
  const token = getMirrorPlexToken()
  if (!token) throw new Error('No mirror account connected')

  const resources = await listResources(token)
  const server = resources.find((r) => r.clientIdentifier === serverId)
  if (!server) throw new Error('The mirror account cannot see this server')
  if (!server.accessToken) throw new Error('No access token for the mirror account')

  // Reuse the primary account's probed baseUrl — same server, same network
  // path; only the token differs.
  const primary = await resolveServerContext(serverId)
  const ctx: ServerContext = {
    id: server.clientIdentifier,
    name: server.name,
    baseUrl: primary.baseUrl,
    token: server.accessToken
  }
  mirrorCtxCache.set(serverId, ctx)
  return ctx
}

/**
 * Sync ONE playlist to the mirror account: read the source's current items,
 * clear+refill (or create) the twin, remember the twin's ratingKey.
 * Item-grain, order-preserving.
 */
export async function mirrorPlaylist(
  serverId: string,
  sourceRatingKey: string,
  title: string
): Promise<{ mirrorRatingKey: string; itemCount: number }> {
  const primary = await resolveServerContext(serverId)
  const mirror = await resolveMirrorContext(serverId)
  const items = await getPlaylistItems(primary, sourceRatingKey)
  const itemRks = items.map((i) => i.ratingKey).filter((rk) => rk !== '')
  const existing = getFromRecord('playlistMirrors', sourceRatingKey)
  const mirrorRatingKey = await syncSmartPlaylist(mirror, existing, title, itemRks)
  patchRecord('playlistMirrors', sourceRatingKey, mirrorRatingKey)
  return { mirrorRatingKey, itemCount: itemRks.length }
}

function playlistTitleKey(title: string): string {
  return title.trim().toLowerCase()
}

function unionRatingKeys(primary: string[], mirror: string[]): string[] {
  const seen = new Set<string>()
  return [...primary, ...mirror].filter((ratingKey) => {
    if (!ratingKey || seen.has(ratingKey)) return false
    seen.add(ratingKey)
    return true
  })
}

/**
 * Merge every ordinary audio playlist across both accounts. A playlist that
 * exists on only one side is created on the other; same-name playlists are
 * replaced on both sides with the union of their tracks. This operation is
 * intentionally additive: it never deletes a playlist or a track.
 */
export async function mirrorAllPlaylists(
  serverId: string
): Promise<{ playlistCount: number; createdOnPrimary: number; createdOnMirror: number }> {
  const primary = await resolveServerContext(serverId)
  const mirror = await resolveMirrorContext(serverId)
  const [primaryLists, mirrorLists] = await Promise.all([
    listPlaylists(primary),
    listPlaylists(mirror)
  ])

  const primaryByTitle = new Map(
    primaryLists.filter((playlist) => !playlist.smart).map((playlist) => [playlistTitleKey(playlist.title), playlist])
  )
  const mirrorByTitle = new Map(
    mirrorLists.filter((playlist) => !playlist.smart).map((playlist) => [playlistTitleKey(playlist.title), playlist])
  )
  const titles = new Set([...primaryByTitle.keys(), ...mirrorByTitle.keys()])
  let createdOnPrimary = 0
  let createdOnMirror = 0

  for (const titleKey of titles) {
    const primaryPlaylist = primaryByTitle.get(titleKey)
    const mirrorPlaylist = mirrorByTitle.get(titleKey)
    const [primaryItems, mirrorItems] = await Promise.all([
      primaryPlaylist ? getPlaylistItems(primary, primaryPlaylist.ratingKey) : Promise.resolve([]),
      mirrorPlaylist ? getPlaylistItems(mirror, mirrorPlaylist.ratingKey) : Promise.resolve([])
    ])
    const union = unionRatingKeys(
      primaryItems.map((item) => item.ratingKey),
      mirrorItems.map((item) => item.ratingKey)
    )
    const title = primaryPlaylist?.title ?? mirrorPlaylist?.title ?? ''
    const primaryRatingKey = await syncSmartPlaylist(
      primary,
      primaryPlaylist?.ratingKey ?? null,
      title,
      union
    )
    const mirrorRatingKey = await syncSmartPlaylist(
      mirror,
      mirrorPlaylist?.ratingKey ?? null,
      title,
      union
    )
    if (!primaryPlaylist) createdOnPrimary++
    if (!mirrorPlaylist) createdOnMirror++
    patchRecord('playlistMirrors', primaryRatingKey, mirrorRatingKey)
  }

  return { playlistCount: titles.size, createdOnPrimary, createdOnMirror }
}

/** Stop mirroring: delete the twin on the mirror account, drop the mapping. */
export async function unmirrorPlaylist(serverId: string, sourceRatingKey: string): Promise<void> {
  const existing = getFromRecord('playlistMirrors', sourceRatingKey)
  deleteFromRecord('playlistMirrors', sourceRatingKey)
  if (existing) {
    try {
      const mirror = await resolveMirrorContext(serverId)
      await deletePlaylist(mirror, existing)
    } catch {
      // Twin already gone / mirror unreachable — the mapping is dropped
      // either way; a stale twin is harmless and user-deletable in Plexamp.
    }
  }
}
