import type { PlaylistItem, PlexPlaylist, ServerContext } from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { plexFetch } from './http.js'

// Plex audio playlists. Manual playlists are the user's own Plex objects
// (visible in Plexamp / the shop Mac); Cratedigger's smart playlists are
// ALSO plain Plex playlists (smart=0), materialized from local rules by
// syncSmartPlaylist below — the server never sees the rules.

interface PlaylistMeta {
  ratingKey?: string | number
  title?: string
  smart?: boolean | number | string
  leafCount?: number
  duration?: number
  composite?: string
  playlistType?: string
}

interface PlaylistItemMeta {
  playlistItemID?: number
  ratingKey?: string | number
  title?: string
  grandparentTitle?: string
  parentTitle?: string
  parentRatingKey?: string | number
  thumb?: string
  parentThumb?: string
  duration?: number
}

function parsePlaylist(m: PlaylistMeta): PlexPlaylist {
  return {
    ratingKey: String(m.ratingKey ?? ''),
    title: m.title ?? '',
    smart: m.smart === true || m.smart === 1 || m.smart === '1',
    leafCount: m.leafCount ?? 0,
    durationMs: typeof m.duration === 'number' ? m.duration : null,
    thumb: m.composite ?? null
  }
}

async function plexJson<T>(server: ServerContext, url: URL, method = 'GET'): Promise<T> {
  const res = await plexFetch(url, { method, headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Plex ${method} ${url.pathname} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

async function plexSend(server: ServerContext, url: URL, method: string): Promise<void> {
  const res = await plexFetch(url, { method, headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Plex ${method} ${url.pathname} failed: ${res.status} ${await res.text()}`)
}

// Comma-joined metadata ids — Plex expands container ids (albums) into their
// tracks in playlist order, so an album-grain sync is a single call.
function metadataUri(server: ServerContext, ratingKeys: string[]): string {
  return `server://${server.id}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`
}

export async function listPlaylists(server: ServerContext): Promise<PlexPlaylist[]> {
  const url = new URL(`${server.baseUrl}/playlists`)
  url.searchParams.set('playlistType', 'audio')
  const json = await plexJson<{ MediaContainer: { Metadata?: PlaylistMeta[] } }>(server, url)
  return (json.MediaContainer.Metadata ?? [])
    .filter((m) => (m.playlistType ?? 'audio') === 'audio')
    .map(parsePlaylist)
}

export async function getPlaylistItems(
  server: ServerContext,
  playlistRatingKey: string
): Promise<PlaylistItem[]> {
  const url = new URL(`${server.baseUrl}/playlists/${playlistRatingKey}/items`)
  const json = await plexJson<{ MediaContainer: { Metadata?: PlaylistItemMeta[] } }>(server, url)
  return (json.MediaContainer.Metadata ?? []).map((m) => ({
    playlistItemID: m.playlistItemID ?? 0,
    ratingKey: String(m.ratingKey ?? ''),
    title: m.title ?? '',
    artist: m.grandparentTitle ?? '',
    album: m.parentTitle ?? '',
    albumRatingKey: m.parentRatingKey !== undefined ? String(m.parentRatingKey) : null,
    thumb: m.thumb ?? m.parentThumb ?? null,
    durationMs: typeof m.duration === 'number' ? m.duration : null
  }))
}

export async function createPlaylist(
  server: ServerContext,
  title: string,
  itemRatingKeys: string[]
): Promise<PlexPlaylist> {
  const url = new URL(`${server.baseUrl}/playlists`)
  url.searchParams.set('type', 'audio')
  url.searchParams.set('smart', '0')
  url.searchParams.set('title', title)
  url.searchParams.set('uri', metadataUri(server, itemRatingKeys))
  const json = await plexJson<{ MediaContainer: { Metadata?: PlaylistMeta[] } }>(server, url, 'POST')
  const meta = json.MediaContainer.Metadata?.[0]
  if (!meta) throw new Error('Plex returned no playlist metadata on create')
  return parsePlaylist(meta)
}

export async function deletePlaylist(server: ServerContext, ratingKey: string): Promise<void> {
  await plexSend(server, new URL(`${server.baseUrl}/playlists/${ratingKey}`), 'DELETE')
}

export async function renamePlaylist(
  server: ServerContext,
  ratingKey: string,
  title: string
): Promise<void> {
  const url = new URL(`${server.baseUrl}/playlists/${ratingKey}`)
  url.searchParams.set('title', title)
  await plexSend(server, url, 'PUT')
}

export async function addToPlaylist(
  server: ServerContext,
  ratingKey: string,
  itemRatingKeys: string[]
): Promise<void> {
  const url = new URL(`${server.baseUrl}/playlists/${ratingKey}/items`)
  url.searchParams.set('uri', metadataUri(server, itemRatingKeys))
  await plexSend(server, url, 'PUT')
}

export async function removePlaylistItem(
  server: ServerContext,
  ratingKey: string,
  playlistItemID: number
): Promise<void> {
  await plexSend(
    server,
    new URL(`${server.baseUrl}/playlists/${ratingKey}/items/${playlistItemID}`),
    'DELETE'
  )
}

// Move an item after another (null = to the front).
export async function movePlaylistItem(
  server: ServerContext,
  ratingKey: string,
  playlistItemID: number,
  afterItemID: number | null
): Promise<void> {
  const url = new URL(`${server.baseUrl}/playlists/${ratingKey}/items/${playlistItemID}/move`)
  if (afterItemID !== null) url.searchParams.set('after', String(afterItemID))
  await plexSend(server, url, 'PUT')
}

export async function clearPlaylist(server: ServerContext, ratingKey: string): Promise<void> {
  await plexSend(server, new URL(`${server.baseUrl}/playlists/${ratingKey}/items`), 'DELETE')
}

// Materialize a smart definition: replace the playlist's contents with the
// given albums' tracks (one clear + one add — Plex expands album ids).
// Reuses the existing Plex playlist when we have one (keeps its ratingKey so
// Plexamp pins/sidebar entries survive); recreates it if it was deleted out
// from under us. Returns the live ratingKey.
export async function syncSmartPlaylist(
  server: ServerContext,
  existingRatingKey: string | null,
  title: string,
  albumRatingKeys: string[]
): Promise<string> {
  if (existingRatingKey !== null) {
    try {
      await clearPlaylist(server, existingRatingKey)
      if (albumRatingKeys.length > 0) {
        await addToPlaylist(server, existingRatingKey, albumRatingKeys)
      }
      // Keep the Plex title in step with a renamed definition.
      await renamePlaylist(server, existingRatingKey, title)
      return existingRatingKey
    } catch {
      // Deleted in Plexamp / another client — fall through and recreate.
    }
  }
  const created = await createPlaylist(server, title, albumRatingKeys)
  return created.ratingKey
}
