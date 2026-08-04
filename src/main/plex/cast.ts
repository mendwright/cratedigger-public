import type {
  ContinuationPick,
  ListenLaterEntry,
  PlayerContext,
  PlexAlbum,
  PlayQueueSnapshot,
  RadioHistoryEntry,
  RadioSteer,
  ServerContext
} from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { plexFetch } from './http.js'
import {
  getAlbumDetail,
  listAllAlbums,
  listMusicSections,
  listSimilarArtists
} from './library.js'

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
  // Steering: drift (default) follows the vibe; label/genre/era lock the pool
  // to the current album's; surprise ignores affinity.
  steer?: RadioSteer
  // The MB label index (albumRatingKey → label names) from the store.
  albumLabels?: Record<string, string[]>
  // Persisted radio picks — long-term repeat exclusion + artist fatigue.
  history?: RadioHistoryEntry[]
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

// How long a radio-played album stays off the table, and how long an artist
// counts as "we just heard them" (scored down, not banned).
const RADIO_ALBUM_REPEAT_MS = 30 * 24 * 3600_000
const RADIO_ARTIST_FATIGUE_MS = 7 * 24 * 3600_000

// MusicBrainz files self-released albums under bracketed special-purpose
// labels ("[no label]") — never a real shared-label signal.
function realLabels(names: string[]): string[] {
  return names
    .map((n) => n.trim())
    .filter((n) => n && !(n.startsWith('[') && n.endsWith(']')))
}

export interface RadioCandidate {
  album: PlexAlbum
  origin: ContinuationPick['source']
}

export interface RadioChoiceArgs {
  currentAlbum: PlexAlbum
  currentGenres: string[]
  currentLabels: string[]
  candidates: RadioCandidate[]
  steer: RadioSteer
  albumLabels: Record<string, string[]>
  history: RadioHistoryEntry[]
  excludedAlbumKeys: Set<string>
  now: number
  rng?: () => number
}

// The pure heart of radio: filter, score, and sample the next album from an
// already-gathered candidate pool. Kept network-free so the scoring rules are
// unit-testable; pickContinuationAlbum does the gathering.
export function chooseRadioAlbum(args: RadioChoiceArgs): ContinuationPick | null {
  const currentGenres = new Set(args.currentGenres.map((g) => g.toLowerCase()))
  const currentLabels = new Set(realLabels(args.currentLabels).map((l) => l.toLowerCase()))
  const currentYear = args.currentAlbum.year
  // Lock steers degrade to drift when the current album lacks the signal —
  // a label lock on an unlabeled record would otherwise go silent.
  let steer = args.steer
  if (steer === 'label' && currentLabels.size === 0) steer = 'drift'
  if (steer === 'genre' && currentGenres.size === 0) steer = 'drift'
  if (steer === 'era' && !currentYear) steer = 'drift'

  const blockedAlbums = new Set<string>()
  const tiredArtists = new Set<string>()
  for (const h of args.history) {
    if (args.now - h.at < RADIO_ALBUM_REPEAT_MS) blockedAlbums.add(h.albumRatingKey)
    if (h.artistRatingKey && args.now - h.at < RADIO_ARTIST_FATIGUE_MS) {
      tiredArtists.add(h.artistRatingKey)
    }
  }

  const labelsOf = (a: PlexAlbum): string[] =>
    realLabels([...(args.albumLabels[a.ratingKey] ?? []), ...(a.studio ? [a.studio] : [])])
  const sharedLabel = (a: PlexAlbum): string | null =>
    labelsOf(a).find((l) => currentLabels.has(l.toLowerCase())) ?? null
  const sharedGenre = (a: PlexAlbum): string | null =>
    a.genres.find((g) => currentGenres.has(g.toLowerCase())) ?? null
  const eraClose = (a: PlexAlbum, window: number): boolean =>
    !!currentYear && !!a.year && Math.abs(a.year - currentYear) <= window
  const novelty = (a: PlexAlbum): number => {
    if (!a.viewCount) return 2
    if (a.lastViewedAt && args.now / 1000 - a.lastViewedAt > 365 * 24 * 3600) return 1.5
    return 0
  }

  // Dedupe by album, keeping the most specific origin (candidates arrive in
  // priority order: listen-later, label-mate, similar, same-artist, library).
  const seen = new Set<string>()
  const eligible: RadioCandidate[] = []
  for (const c of args.candidates) {
    const rk = c.album.ratingKey
    if (seen.has(rk)) continue
    seen.add(rk)
    if (rk === args.currentAlbum.ratingKey) continue
    if (args.excludedAlbumKeys.has(rk)) continue
    if (blockedAlbums.has(rk)) continue
    // Listen Later joins the pool only when it fits the vibe — a shelved
    // album from another world shouldn't hijack the night. Surprise mode has
    // no vibe to fit.
    if (
      c.origin === 'listen-later' &&
      steer !== 'surprise' &&
      !sharedGenre(c.album) &&
      !eraClose(c.album, 7)
    ) {
      continue
    }
    // Steer locks are hard filters.
    if (steer === 'label' && !sharedLabel(c.album)) continue
    if (steer === 'genre' && !sharedGenre(c.album)) continue
    if (steer === 'era' && !eraClose(c.album, 5)) continue
    eligible.push(c)
  }
  if (eligible.length === 0) return null

  const score = (c: RadioCandidate): number => {
    const a = c.album
    if (steer === 'surprise') {
      // Affinity is the point of the other steers; surprise wants fresh digs.
      return novelty(a) * 2 + (a.rating ? a.rating / 2 : 0)
    }
    let s = 0
    if (sharedGenre(a)) s += 3
    if (eraClose(a, 7)) s += 2
    if (sharedLabel(a)) s += 2
    if (c.origin === 'similar') s += 1.5
    if (c.origin === 'listen-later') s += 3
    if (a.rating) s += a.rating / 2 // Plex rating is 0–10; one point per star
    s += novelty(a)
    if (a.artistRatingKey && a.artistRatingKey === args.currentAlbum.artistRatingKey) s -= 2
    if (a.artistRatingKey && tiredArtists.has(a.artistRatingKey)) s -= 4
    return s
  }

  let winner: RadioCandidate | null
  if (steer === 'surprise') {
    // Sample the whole eligible pool — top-slicing would defeat the point.
    winner = weightedPick(eligible, score, args.rng)
  } else {
    eligible.sort((a, b) => score(b) - score(a) || a.album.title.localeCompare(b.album.title))
    // Sample among the strongest candidates rather than crowning eligible[0] —
    // a deterministic top pick makes radio a fixed function of the current
    // album and the same rut comes back every day.
    winner = weightedPick(eligible.slice(0, 12), (c) => score(c) + 1, args.rng)
  }
  if (!winner) return null

  const via =
    winner.origin === 'label-mate'
      ? sharedLabel(winner.album)
      : winner.origin === 'library'
        ? sharedGenre(winner.album) ?? (eraClose(winner.album, 7) ? 'same era' : null)
        : null
  return {
    albumRatingKey: winner.album.ratingKey,
    title: winner.album.title,
    artist: winner.album.artist,
    artistRatingKey: winner.album.artistRatingKey ?? null,
    source: steer === 'surprise' ? 'surprise' : winner.origin,
    via
  }
}

// The whole library, cached briefly — radio stages at album boundaries, so a
// fetch every ~10 minutes at most. Keyed by server so a server switch never
// serves stale albums.
let radioLibraryCache: { key: string; at: number; albums: PlexAlbum[] } | null = null
const RADIO_LIBRARY_TTL_MS = 10 * 60_000

async function allLibraryAlbums(server: ServerContext): Promise<PlexAlbum[]> {
  const key = server.baseUrl
  const now = Date.now()
  if (radioLibraryCache?.key === key && now - radioLibraryCache.at < RADIO_LIBRARY_TTL_MS) {
    return radioLibraryCache.albums
  }
  const sections = await listMusicSections(server)
  const albums: PlexAlbum[] = []
  for (const s of sections) {
    albums.push(...(await listAllAlbums(server, s.key)))
  }
  radioLibraryCache = { key, at: now, albums }
  return albums
}

// Choose the album radio plays next. Gathers one candidate pool from several
// sources — Listen Later (vibe-gated), label-mates via the MB label index,
// Plex's similar artists, the same artist, and the whole library as genre/era
// neighbors — then defers to chooseRadioAlbum for scoring and the pick.
export async function pickContinuationAlbum(
  server: ServerContext,
  opts: ContinuationOpts
): Promise<ContinuationPick | null> {
  const excluded = new Set(opts.excludeAlbumRatingKeys ?? [])

  let current
  try {
    current = await getAlbumDetail(server, opts.currentAlbumRatingKey)
  } catch {
    return null
  }

  let all: PlexAlbum[]
  try {
    all = await allLibraryAlbums(server)
  } catch {
    return null
  }
  const byKey = new Map(all.map((a) => [a.ratingKey, a]))

  const albumLabels = opts.albumLabels ?? {}
  const currentLabels = [
    ...(albumLabels[opts.currentAlbumRatingKey] ?? []),
    ...(current.album.studio ? [current.album.studio] : [])
  ]
  const currentLabelSet = new Set(realLabels(currentLabels).map((l) => l.toLowerCase()))

  let similarArtistKeys = new Set<string>()
  const artistRatingKey = current.album.artistRatingKey
  if (artistRatingKey) {
    try {
      const similar = await listSimilarArtists(server, artistRatingKey)
      similarArtistKeys = new Set(similar.map((s) => s.ratingKey))
    } catch {
      // similar-artist source just contributes nothing
    }
  }

  // Priority order matters: dedupe in chooseRadioAlbum keeps the first origin.
  const candidates: RadioCandidate[] = []
  for (const entry of (opts.listenLater ?? []).slice(0, 30)) {
    const a = byKey.get(entry.ratingKey)
    if (a && !a.viewCount) candidates.push({ album: a, origin: 'listen-later' })
  }
  if (currentLabelSet.size > 0) {
    for (const a of all) {
      const labels = realLabels([...(albumLabels[a.ratingKey] ?? []), ...(a.studio ? [a.studio] : [])])
      if (labels.some((l) => currentLabelSet.has(l.toLowerCase()))) {
        candidates.push({ album: a, origin: 'label-mate' })
      }
    }
  }
  for (const a of all) {
    if (a.artistRatingKey && similarArtistKeys.has(a.artistRatingKey)) {
      candidates.push({ album: a, origin: 'similar' })
    }
  }
  if (artistRatingKey) {
    for (const a of all) {
      if (a.artistRatingKey === artistRatingKey) candidates.push({ album: a, origin: 'same-artist' })
    }
  }
  for (const a of all) candidates.push({ album: a, origin: 'library' })

  return chooseRadioAlbum({
    currentAlbum: current.album,
    currentGenres: current.genres,
    currentLabels,
    candidates,
    steer: opts.steer ?? 'drift',
    albumLabels,
    history: opts.history ?? [],
    excludedAlbumKeys: excluded,
    now: Date.now(),
    rng: opts.rng
  })
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
