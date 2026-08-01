import type {
  ContinuationPick,
  ListenLaterEntry,
  PlayerContext,
  PlexAlbum,
  PlayQueueSnapshot,
  ServerContext
} from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { plexFetch } from './http.js'
import { getAlbumDetail, listArtistAlbums, listSimilarArtists } from './library.js'

let commandCounter = 0

function nextCommandId(): number {
  return ++commandCounter
}

interface PlayQueueCreated {
  playQueueID: number
  playQueueSelectedItemID?: number
}

async function createPlayQueue(
  server: ServerContext,
  libraryUri: string,
  startKey: string | undefined,
  continuous: boolean
): Promise<PlayQueueCreated> {
  const url = new URL(`${server.baseUrl}/playQueues`)
  url.searchParams.set('type', 'audio')
  url.searchParams.set('uri', libraryUri)
  if (startKey) url.searchParams.set('key', startKey)
  url.searchParams.set('shuffle', '0')
  url.searchParams.set('continuous', continuous ? '1' : '0')
  url.searchParams.set('repeat', '0')

  const res = await plexFetch(url, { method: 'POST', headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Play queue create failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { MediaContainer: PlayQueueCreated }
  return json.MediaContainer
}

function libraryUri(serverId: string, ratingKey: string): string {
  return `server://${serverId}/com.plexapp.plugins.library/library/metadata/${ratingKey}`
}

async function sendPlayMedia(
  server: ServerContext,
  player: PlayerContext,
  queue: PlayQueueCreated
): Promise<void> {
  const serverUrl = new URL(server.baseUrl)
  const port = serverUrl.port || (serverUrl.protocol === 'https:' ? '443' : '80')

  const url = new URL(`${player.baseUrl}/player/playback/playMedia`)
  url.searchParams.set('key', `/playQueues/${queue.playQueueID}`)
  url.searchParams.set('containerKey', `/playQueues/${queue.playQueueID}?own=1`)
  url.searchParams.set('offset', '0')
  url.searchParams.set('commandID', String(nextCommandId()))
  url.searchParams.set('machineIdentifier', server.id)
  url.searchParams.set('address', serverUrl.hostname)
  url.searchParams.set('port', port)
  url.searchParams.set('protocol', serverUrl.protocol.replace(':', ''))
  url.searchParams.set('token', server.token)
  if (queue.playQueueSelectedItemID) {
    url.searchParams.set('playQueueItemID', String(queue.playQueueSelectedItemID))
  }

  const res = await plexFetch(url, {
    headers: {
      ...plexHeaders(player.token),
      'X-Plex-Target-Client-Identifier': player.id
    }
  })
  if (!res.ok) {
    throw new Error(`Cast to ${player.name} failed: ${res.status} ${await res.text()}`)
  }
}

export async function playAlbumOnPlayer(
  server: ServerContext,
  player: PlayerContext,
  albumRatingKey: string,
  startTrackRatingKey: string | undefined,
  continuous: boolean
): Promise<number> {
  const startKey = startTrackRatingKey ? `/library/metadata/${startTrackRatingKey}` : undefined
  const queue = await createPlayQueue(
    server,
    libraryUri(server.id, albumRatingKey),
    startKey,
    continuous
  )
  await sendPlayMedia(server, player, queue)
  return queue.playQueueID
}

export async function playTrackOnPlayer(
  server: ServerContext,
  player: PlayerContext,
  trackRatingKey: string,
  continuous: boolean
): Promise<number> {
  const queue = await createPlayQueue(
    server,
    libraryUri(server.id, trackRatingKey),
    undefined,
    continuous
  )
  await sendPlayMedia(server, player, queue)
  return queue.playQueueID
}

// Local-player queue creation: same /playQueues POST as the cast variants but
// without the player-side `playMedia` companion call. The renderer drives the
// `<audio>` element itself, but we still use Plex's play queue as the source
// of truth for "what plays next" so queueUpdate / getPlayQueue work uniformly.
export async function createAlbumPlayQueue(
  server: ServerContext,
  albumRatingKey: string,
  startTrackRatingKey: string | undefined,
  continuous: boolean
): Promise<number> {
  const startKey = startTrackRatingKey ? `/library/metadata/${startTrackRatingKey}` : undefined
  const queue = await createPlayQueue(
    server,
    libraryUri(server.id, albumRatingKey),
    startKey,
    continuous
  )
  return queue.playQueueID
}

export async function createTrackPlayQueue(
  server: ServerContext,
  trackRatingKey: string,
  continuous: boolean
): Promise<number> {
  const queue = await createPlayQueue(
    server,
    libraryUri(server.id, trackRatingKey),
    undefined,
    continuous
  )
  return queue.playQueueID
}

// Playlists queue by id, not uri, and carry their own shuffle choice.
async function createPlaylistQueue(
  server: ServerContext,
  playlistRatingKey: string,
  shuffle: boolean
): Promise<PlayQueueCreated> {
  const url = new URL(`${server.baseUrl}/playQueues`)
  url.searchParams.set('type', 'audio')
  url.searchParams.set('playlistID', playlistRatingKey)
  url.searchParams.set('shuffle', shuffle ? '1' : '0')
  url.searchParams.set('continuous', '0')
  url.searchParams.set('repeat', '0')
  const res = await plexFetch(url, { method: 'POST', headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Playlist queue create failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { MediaContainer: PlayQueueCreated }
  return json.MediaContainer
}

export async function playPlaylistOnPlayer(
  server: ServerContext,
  player: PlayerContext,
  playlistRatingKey: string,
  shuffle: boolean
): Promise<number> {
  const queue = await createPlaylistQueue(server, playlistRatingKey, shuffle)
  await sendPlayMedia(server, player, queue)
  return queue.playQueueID
}

export async function createLocalPlaylistQueue(
  server: ServerContext,
  playlistRatingKey: string,
  shuffle: boolean
): Promise<number> {
  const queue = await createPlaylistQueue(server, playlistRatingKey, shuffle)
  return queue.playQueueID
}

export async function playMoodOnPlayer(
  server: ServerContext,
  player: PlayerContext,
  sectionKey: string,
  moodId: string
): Promise<number> {
  // Build a section-filter URI; Plex resolves it server-side into a queue of
  // every track tagged with the given mood. Same play-queue contract as
  // album/track casts — just a longer URI.
  const sectionPath = `/library/sections/${sectionKey}/all?type=10&track.mood=${encodeURIComponent(moodId)}`
  const moodUri = `server://${server.id}/com.plexapp.plugins.library${sectionPath}`
  const url = new URL(`${server.baseUrl}/playQueues`)
  url.searchParams.set('type', 'audio')
  url.searchParams.set('uri', moodUri)
  url.searchParams.set('shuffle', '1')
  url.searchParams.set('continuous', '0')
  url.searchParams.set('repeat', '0')
  const res = await plexFetch(url, { method: 'POST', headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Mood queue create failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { MediaContainer: PlayQueueCreated }
  await sendPlayMedia(server, player, json.MediaContainer)
  return json.MediaContainer.playQueueID
}

export async function addToPlayQueue(
  server: ServerContext,
  playQueueId: number,
  ratingKey: string,
  mode: 'next' | 'end'
): Promise<void> {
  const url = new URL(`${server.baseUrl}/playQueues/${playQueueId}`)
  url.searchParams.set('uri', libraryUri(server.id, ratingKey))
  url.searchParams.set('type', 'audio')
  url.searchParams.set('next', mode === 'next' ? '1' : '0')
  const res = await plexFetch(url, { method: 'PUT', headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Queue update failed: ${res.status} ${await res.text()}`)
}

// Reorder a single queue item to sit directly after another. Verified against
// python-plexapi's PlayQueue.moveItem — `after` names the playQueueItemID to
// land behind.
export async function moveQueueItem(
  server: ServerContext,
  playQueueId: number,
  playQueueItemId: number,
  afterItemId: number
): Promise<void> {
  const url = new URL(`${server.baseUrl}/playQueues/${playQueueId}/items/${playQueueItemId}/move`)
  url.searchParams.set('after', String(afterItemId))
  const res = await plexFetch(url, { method: 'PUT', headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Queue move failed: ${res.status} ${await res.text()}`)
}

// Insert an album/track directly after a specific queue item. Plex's PUT only
// supports "next" (after the playing item) and "end", so anything else is
// append + move-into-place: snapshot, append, diff for the new items, walk
// them in behind the anchor.
export async function insertIntoPlayQueueAfterItem(
  server: ServerContext,
  playQueueId: number,
  ratingKey: string,
  afterItemId: number
): Promise<void> {
  const before = await getPlayQueue(server, playQueueId)
  const beforeIds = new Set(before.items.map((it) => it.playQueueItemID))
  await addToPlayQueue(server, playQueueId, ratingKey, 'end')
  const after = await getPlayQueue(server, playQueueId)
  const newItems = after.items.filter((it) => !beforeIds.has(it.playQueueItemID))
  let anchor = afterItemId
  for (const it of newItems) {
    await moveQueueItem(server, playQueueId, it.playQueueItemID, anchor)
    anchor = it.playQueueItemID
  }
}

// Plexamp owns the play queue after playMedia (containerKey?own=1) and caches
// it locally, so server-side mutations to /playQueues/{id} don't reach the
// player unless we explicitly tell it to re-read the queue.
export async function refreshPlayQueueOnPlayer(
  player: PlayerContext,
  playQueueId: number
): Promise<void> {
  const url = new URL(`${player.baseUrl}/player/playback/refreshPlayQueue`)
  url.searchParams.set('playQueueID', String(playQueueId))
  url.searchParams.set('type', 'music')
  url.searchParams.set('commandID', String(nextCommandId()))
  const res = await plexFetch(url, {
    headers: {
      ...plexHeaders(player.token),
      'X-Plex-Target-Client-Identifier': player.id
    }
  })
  if (!res.ok) {
    throw new Error(`refreshPlayQueue failed: ${res.status} ${await res.text()}`)
  }
}

// Plexamp occasionally drops a refreshPlayQueue command (mid-transition, LAN
// blip). Retry with short backoff and report whether any attempt landed, so
// callers can surface a soft "may not have reached the speaker" warning
// instead of silently leaving the player on a stale queue.
export async function refreshPlayQueueReliable(
  player: PlayerContext,
  playQueueId: number
): Promise<boolean> {
  const delaysMs = [0, 250, 500, 750]
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    try {
      await refreshPlayQueueOnPlayer(player, playQueueId)
      return true
    } catch {
      // retry after the next backoff step
    }
  }
  return false
}

interface RawQueueItem {
  playQueueItemID: number
  ratingKey: string
  title?: string
  grandparentTitle?: string
  parentTitle?: string
  parentRatingKey?: string
  parentThumb?: string
  thumb?: string
  duration?: number
}

interface PlayQueueResponse {
  MediaContainer: {
    playQueueID: number
    playQueueSelectedItemID?: number
    Metadata?: RawQueueItem[]
  }
}

export async function getPlayQueue(
  server: ServerContext,
  playQueueId: number
): Promise<PlayQueueSnapshot> {
  // Without an explicit window, Plex returns ~30 items centered on the
  // selected track — additions past the window silently never show up.
  // Ask for the whole queue (history included); personal queues are small.
  const url = new URL(`${server.baseUrl}/playQueues/${playQueueId}`)
  url.searchParams.set('window', '1000')
  url.searchParams.set('includeBefore', '1')
  url.searchParams.set('includeAfter', '1')
  url.searchParams.set('X-Plex-Container-Start', '0')
  url.searchParams.set('X-Plex-Container-Size', '1000')
  const res = await plexFetch(url, {
    headers: plexHeaders(server.token)
  })
  if (!res.ok) throw new Error(`Queue fetch failed: ${res.status}`)
  const json = (await res.json()) as PlayQueueResponse
  const mc = json.MediaContainer
  return {
    playQueueID: mc.playQueueID,
    selectedItemID: mc.playQueueSelectedItemID ?? null,
    items: (mc.Metadata ?? []).map((m) => ({
      playQueueItemID: m.playQueueItemID,
      ratingKey: m.ratingKey,
      title: m.title ?? '',
      artist: m.grandparentTitle ?? '',
      album: m.parentTitle ?? '',
      albumRatingKey: m.parentRatingKey ?? null,
      thumb: m.parentThumb ?? m.thumb ?? null,
      duration: m.duration ?? 0
    }))
  }
}

export interface ContinuationOpts {
  currentAlbumRatingKey: string
  // Albums radio recently played or the user vetoed this session — never
  // re-picked while in the window.
  excludeAlbumRatingKeys?: string[]
  // The user's Listen Later shelf (insertion-ordered, oldest first). Passed
  // in by the IPC layer so this module stays store-free and testable.
  listenLater?: ListenLaterEntry[]
  // Random source for the weighted similar-album pick; tests seed this.
  rng?: () => number
}

// Weighted random choice — probability proportional to weightOf(item), with
// a small floor so zero-weight items stay reachable.
export function weightedPick<T>(
  items: T[],
  weightOf: (item: T) => number,
  rng: () => number = Math.random
): T | null {
  if (items.length === 0) return null
  const weights = items.map((it) => Math.max(0.5, weightOf(it)))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

// Choose the album radio mode plays next. Priority:
//   1. Listen Later — the user explicitly shelved it; oldest unplayed wins.
//   2. Similar-artist albums, scored: shared genre +3, within ±7 years +2,
//      +1 per Plex rating star — then a weighted-random pick among the
//      top-scored candidates. This used to return the top scorer outright,
//      which made radio a fixed function of the current album (the same
//      record always staged the same follow-up); the session exclusion ring
//      never survives a restart, so the rut came back every day.
//   3. Another record by the same artist (same scoring).
export async function pickContinuationAlbum(
  server: ServerContext,
  opts: ContinuationOpts
): Promise<ContinuationPick | null> {
  const excluded = new Set([opts.currentAlbumRatingKey, ...(opts.excludeAlbumRatingKeys ?? [])])

  for (const entry of (opts.listenLater ?? []).slice(0, 10)) {
    if (excluded.has(entry.ratingKey)) continue
    try {
      const detail = await getAlbumDetail(server, entry.ratingKey)
      if ((detail.album.viewCount ?? 0) > 0) continue // already listened through
      return {
        albumRatingKey: detail.album.ratingKey,
        title: detail.album.title,
        artist: detail.album.artist,
        source: 'listen-later'
      }
    } catch {
      continue // shelved album since deleted from the library
    }
  }

  let current
  try {
    current = await getAlbumDetail(server, opts.currentAlbumRatingKey)
  } catch {
    return null
  }
  const artistRatingKey = current.album.artistRatingKey
  if (!artistRatingKey) return null

  const currentGenres = new Set(current.genres.map((g) => g.toLowerCase()))
  const currentYear = current.album.year
  const score = (a: PlexAlbum): number => {
    let s = 0
    if (a.genres.some((g) => currentGenres.has(g.toLowerCase()))) s += 3
    if (currentYear && a.year && Math.abs(a.year - currentYear) <= 7) s += 2
    if (a.rating) s += a.rating / 2 // Plex rating is 0–10; one point per star
    return s
  }
  const best = (albums: PlexAlbum[]): PlexAlbum | null => {
    const eligible = albums.filter((a) => !excluded.has(a.ratingKey))
    if (eligible.length === 0) return null
    eligible.sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title))
    // Sample among the strongest candidates rather than crowning eligible[0].
    // Weight = score + 1 keeps the pick genre/era-biased while giving
    // near-peers a real shot.
    return weightedPick(eligible.slice(0, 8), (a) => score(a) + 1, opts.rng)
  }

  const similar = await listSimilarArtists(server, artistRatingKey)
  const candidates: PlexAlbum[] = []
  for (const sim of similar.slice(0, 6)) {
    try {
      candidates.push(...(await listArtistAlbums(server, sim.ratingKey)))
    } catch {
      // unreachable artist — skip
    }
  }
  const similarPick = best(candidates)
  if (similarPick) {
    return {
      albumRatingKey: similarPick.ratingKey,
      title: similarPick.title,
      artist: similarPick.artist,
      source: 'similar'
    }
  }

  try {
    const ownPick = best(await listArtistAlbums(server, artistRatingKey))
    if (ownPick) {
      return {
        albumRatingKey: ownPick.ratingKey,
        title: ownPick.title,
        artist: ownPick.artist,
        source: 'same-artist'
      }
    }
  } catch {
    // fall through
  }
  return null
}

// Plex's continuous=1 flag on /playQueues is supposed to auto-extend the queue
// with related tracks when it runs out, but on Plexamp targets this is
// notoriously unreliable — many setups silently stop at the end of the album
// instead. Roll our own: pick the next album (see pickContinuationAlbum) and
// append it. Plexamp advances into the new items after we refresh the queue.
export type ExtendResult =
  | { ok: true; album: ContinuationPick }
  | { ok: false; reason: string }

export async function extendQueueWithSimilarAlbum(
  server: ServerContext,
  player: PlayerContext,
  playQueueId: number,
  opts: ContinuationOpts
): Promise<ExtendResult> {
  const picked = await pickContinuationAlbum(server, opts)
  if (!picked) return { ok: false, reason: 'no eligible continuation album' }

  try {
    // PUT /playQueues/{id} with an album-level URI; Plex unfolds it into tracks
    // server-side. type=audio + next=0 appends to the end.
    await addToPlayQueue(server, playQueueId, picked.albumRatingKey, 'end')
    // Plexamp caches the queue locally after the initial playMedia; without
    // refreshPlayQueue it won't see the new items and will stop at what it
    // has. Retried — a stale player here means the record never plays.
    await refreshPlayQueueReliable(player, playQueueId)
  } catch (err) {
    return {
      ok: false,
      reason: `append failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  return { ok: true, album: picked }
}

export async function removeFromPlayQueue(
  server: ServerContext,
  playQueueId: number,
  playQueueItemId: number
): Promise<void> {
  const res = await plexFetch(
    `${server.baseUrl}/playQueues/${playQueueId}/items/${playQueueItemId}`,
    { method: 'DELETE', headers: plexHeaders(server.token) }
  )
  if (!res.ok) throw new Error(`Queue remove failed: ${res.status} ${await res.text()}`)
}
