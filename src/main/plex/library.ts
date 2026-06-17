import type {
  AlbumDetail,
  AlbumFilters,
  AlbumMediaInfo,
  AlbumSortKey,
  PlexAlbum,
  PlexSection,
  PlexTrack,
  SearchResults,
  ServerContext
} from '../../shared/plex.js'
import { plexFetch } from './http.js'
import { extractMbidFromGuid } from '../../shared/guid.js'

interface MediaContainer<T> {
  MediaContainer: {
    size: number
    totalSize?: number
    Directory?: T[]
    Metadata?: T[]
  }
}

interface RawDirectory {
  key: string
  title: string
  type: string
  uuid: string
  scanner: string
  agent: string
}

interface RawGuid {
  id: string
}

interface RawAlbum {
  ratingKey: string
  title: string
  parentTitle?: string
  parentRatingKey?: string
  year?: number
  thumb?: string
  addedAt: number
  summary?: string
  Guid?: RawGuid[]
  Genre?: { tag: string }[]
  studio?: string
  rating?: number
  audienceRating?: number
  lastViewedAt?: number
  viewCount?: number
  leafCount?: number
}

interface RawTrack {
  ratingKey: string
  title: string
  index?: number
  parentIndex?: number
  duration?: number
  originalTitle?: string
  Media?: RawMedia[]
}

interface RawMedia {
  bitrate?: number
  audioCodec?: string
  audioChannels?: number
  container?: string
  Part?: { size?: number; file?: string; key?: string }[]
}


function headers(ctx: ServerContext, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Plex-Token': ctx.token,
    Accept: 'application/json',
    ...extra
  }
}

export async function listMusicSections(ctx: ServerContext): Promise<PlexSection[]> {
  const res = await plexFetch(`${ctx.baseUrl}/library/sections`, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Sections list failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawDirectory>
  const dirs = json.MediaContainer.Directory ?? []
  return dirs
    .filter((d) => d.type === 'artist')
    .map((d) => ({
      key: d.key,
      title: d.title,
      type: d.type,
      uuid: d.uuid,
      scanner: d.scanner,
      agent: d.agent
    }))
}

interface RawMoodDirectory {
  key: string
  title: string
  fastKey?: string
}

export async function listMoods(
  ctx: ServerContext,
  sectionKey: string
): Promise<{ key: string; title: string }[]> {
  const url = `${ctx.baseUrl}/library/sections/${sectionKey}/mood?type=10`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) return []
  const json = (await res.json()) as MediaContainer<RawMoodDirectory>
  const dirs = json.MediaContainer.Directory ?? []
  return dirs
    .map((d) => ({ key: d.key, title: d.title }))
    .filter((m) => m.title && m.title.trim().length > 0)
}

export interface AlbumPage {
  albums: PlexAlbum[]
  offset: number
  total: number
}

export async function listAlbums(
  ctx: ServerContext,
  sectionKey: string,
  offset = 0,
  size = 200,
  sort: AlbumSortKey = 'addedAt',
  filters: AlbumFilters = {},
  seed?: string
): Promise<AlbumPage> {
  const sortParam =
    sort === 'random'
      ? `random:${seed ?? Date.now()}`
      : sort === 'negligence'
        ? SORT_PARAM.addedAt
        : (SORT_PARAM[sort] ?? SORT_PARAM.addedAt)
  const filterParams = buildFilterParams(filters)
  const url = `${ctx.baseUrl}/library/sections/${sectionKey}/all?type=9&includeMeta=0&includeGuids=1&sort=${encodeURIComponent(sortParam)}${filterParams}`
  const res = await plexFetch(url, {
    headers: headers(ctx, {
      'X-Plex-Container-Start': String(offset),
      'X-Plex-Container-Size': String(size)
    })
  })
  if (!res.ok) throw new Error(`Albums list failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawAlbum>
  const rows = json.MediaContainer.Metadata ?? []
  const total = json.MediaContainer.totalSize ?? json.MediaContainer.size
  return {
    offset,
    total,
    albums: rows.map(toAlbum)
  }
}

export async function listAllAlbums(
  ctx: ServerContext,
  sectionKey: string
): Promise<PlexAlbum[]> {
  const all: PlexAlbum[] = []
  const pageSize = 500
  let offset = 0
  for (;;) {
    const page = await listAlbums(ctx, sectionKey, offset, pageSize, 'addedAt')
    all.push(...page.albums)
    offset += page.albums.length
    if (page.albums.length < pageSize || offset >= page.total) break
  }
  return all
}

function toAlbum(a: RawAlbum): PlexAlbum {
  return {
    ratingKey: a.ratingKey,
    title: a.title,
    artist: a.parentTitle ?? 'Unknown artist',
    artistRatingKey: a.parentRatingKey ?? null,
    year: a.year ?? null,
    thumb: a.thumb ?? null,
    addedAt: a.addedAt,
    rating: a.rating ?? a.audienceRating ?? null,
    lastViewedAt: a.lastViewedAt ?? null,
    viewCount: typeof a.viewCount === 'number' ? a.viewCount : null,
    guids: (a.Guid ?? []).map((g) => g.id),
    trackCount: typeof a.leafCount === 'number' ? a.leafCount : null,
    studio: a.studio?.trim() || null,
    genres: (a.Genre ?? []).map((g) => g.tag).filter(Boolean)
  }
}

function buildFilterParams(filters: AlbumFilters): string {
  const parts: string[] = []
  if (filters.genres && filters.genres.length > 0) {
    parts.push(`genre=${encodeURIComponent(filters.genres.join(','))}`)
  }
  if (typeof filters.decade === 'number') {
    parts.push(`decade=${filters.decade}`)
  }
  if (typeof filters.year === 'number') {
    parts.push(`year=${filters.year}`)
  }
  if (filters.studio) {
    parts.push(`studio=${encodeURIComponent(filters.studio)}`)
  }
  if (filters.mood) {
    // Moods live at the track level in Plex; filter the album list by
    // "any track in this album has this mood."
    parts.push(`track.mood=${encodeURIComponent(filters.mood)}`)
  }
  return parts.length > 0 ? '&' + parts.join('&') : ''
}

// 'negligence' is computed client-side off the full library, so it has no
// server sort param — fetches fall back to addedAt at the API layer and the
// renderer overrides with its own sort once allAlbums has loaded.
const SORT_PARAM: Record<Exclude<AlbumSortKey, 'random' | 'negligence'>, string> = {
  addedAt: 'addedAt:desc',
  artist: 'artist.titleSort:asc,album.titleSort:asc',
  title: 'titleSort:asc',
  lastViewed: 'lastViewedAt:desc',
  rating: 'rating:desc,audienceRating:desc'
}

function toTrack(t: RawTrack): PlexTrack {
  return {
    ratingKey: t.ratingKey,
    title: t.title,
    index: t.index ?? null,
    parentIndex: t.parentIndex ?? null,
    duration: t.duration ?? null,
    originalTitle: t.originalTitle ?? null
  }
}

export async function getAlbumMediaInfo(
  ctx: ServerContext,
  ratingKey: string
): Promise<AlbumMediaInfo> {
  const url = `${ctx.baseUrl}/library/metadata/${ratingKey}/children?includeMedia=1`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Media info fetch failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawTrack>
  const tracks = json.MediaContainer.Metadata ?? []
  const bitrates: number[] = []
  const codecs = new Map<string, number>()
  let container: string | null = null
  let totalSize = 0
  let anySize = false
  let samplePath: string | null = null
  for (const t of tracks) {
    for (const m of t.Media ?? []) {
      if (typeof m.bitrate === 'number' && m.bitrate > 0) bitrates.push(m.bitrate)
      if (m.audioCodec) codecs.set(m.audioCodec, (codecs.get(m.audioCodec) ?? 0) + 1)
      if (!container && m.container) container = m.container
      for (const p of m.Part ?? []) {
        if (typeof p.size === 'number' && p.size > 0) {
          totalSize += p.size
          anySize = true
        }
        if (!samplePath && p.file) samplePath = p.file
      }
    }
  }
  const avg = bitrates.length > 0 ? Math.round(bitrates.reduce((s, b) => s + b, 0) / bitrates.length) : null
  const topCodec = [...codecs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return {
    ratingKey,
    trackCount: tracks.length,
    avgBitrate: avg,
    maxBitrate: bitrates.length > 0 ? Math.max(...bitrates) : null,
    minBitrate: bitrates.length > 0 ? Math.min(...bitrates) : null,
    totalSize: anySize ? totalSize : null,
    codec: topCodec,
    codecs: [...codecs.keys()],
    container,
    samplePath
  }
}

export async function mergePlexAlbums(
  ctx: ServerContext,
  destinationRatingKey: string,
  sourceRatingKeys: string[]
): Promise<void> {
  if (sourceRatingKeys.length === 0) return
  const ids = sourceRatingKeys.join(',')
  const url = `${ctx.baseUrl}/library/metadata/${destinationRatingKey}/merge?ids=${encodeURIComponent(ids)}`
  const res = await plexFetch(url, { method: 'PUT', headers: headers(ctx) })
  if (!res.ok) throw new Error(`Plex merge failed: ${res.status}`)
}

export async function refreshAlbumMetadata(
  ctx: ServerContext,
  ratingKey: string
): Promise<void> {
  const url = `${ctx.baseUrl}/library/metadata/${ratingKey}/refresh`
  const res = await plexFetch(url, { method: 'PUT', headers: headers(ctx) })
  if (!res.ok) throw new Error(`Plex metadata refresh failed: ${res.status}`)
}

// Resolve a track ratingKey to a direct-stream URL with the auth token baked
// in. Used by the local-player path to point an `<audio>` element straight at
// Plex — the server delivers the file bytes, the renderer just plays them.
export async function getTrackStreamUrl(
  ctx: ServerContext,
  ratingKey: string
): Promise<string> {
  const url = `${ctx.baseUrl}/library/metadata/${ratingKey}?includeMedia=1`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Track lookup failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawTrack>
  const t = json.MediaContainer.Metadata?.[0]
  const key = t?.Media?.[0]?.Part?.[0]?.key
  if (!key) throw new Error(`Track ${ratingKey} has no streamable part`)
  return `${ctx.baseUrl}${key}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
}

export async function getAlbumTrackFiles(
  ctx: ServerContext,
  ratingKey: string
): Promise<string[]> {
  const url = `${ctx.baseUrl}/library/metadata/${ratingKey}/children?includeMedia=1`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Track files fetch failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawTrack>
  const files: string[] = []
  for (const t of json.MediaContainer.Metadata ?? []) {
    for (const m of t.Media ?? []) {
      for (const p of m.Part ?? []) {
        if (p.file) files.push(p.file)
      }
    }
  }
  return files
}

export async function getAlbumDetail(ctx: ServerContext, ratingKey: string): Promise<AlbumDetail> {
  const [albumRes, tracksRes] = await Promise.all([
    plexFetch(`${ctx.baseUrl}/library/metadata/${ratingKey}`, { headers: headers(ctx) }),
    plexFetch(`${ctx.baseUrl}/library/metadata/${ratingKey}/children`, { headers: headers(ctx) })
  ])
  if (!albumRes.ok) throw new Error(`Album fetch failed: ${albumRes.status}`)
  if (!tracksRes.ok) throw new Error(`Tracklist fetch failed: ${tracksRes.status}`)

  const albumJson = (await albumRes.json()) as MediaContainer<RawAlbum>
  const tracksJson = (await tracksRes.json()) as MediaContainer<RawTrack>

  const raw = albumJson.MediaContainer.Metadata?.[0]
  if (!raw) throw new Error(`Album ${ratingKey} not found`)

  return {
    album: toAlbum(raw),
    summary: raw.summary ?? null,
    tracks: (tracksJson.MediaContainer.Metadata ?? []).map(toTrack),
    guids: (raw.Guid ?? []).map((g) => g.id),
    genres: (raw.Genre ?? []).map((g) => g.tag).filter(Boolean)
  }
}

interface RawArtist {
  ratingKey: string
  title: string
  thumb?: string
  summary?: string
}

export async function searchArtists(
  ctx: ServerContext,
  name: string
): Promise<{ ratingKey: string; title: string; thumb: string | null; summary: string | null }[]> {
  const sections = await listMusicSections(ctx)
  const results: ReturnType<typeof toArtist>[] = []
  for (const section of sections) {
    const url = `${ctx.baseUrl}/library/sections/${section.key}/all?type=8&title=${encodeURIComponent(name)}`
    const res = await plexFetch(url, { headers: headers(ctx) })
    if (!res.ok) continue
    const json = (await res.json()) as MediaContainer<RawArtist>
    for (const a of json.MediaContainer.Metadata ?? []) {
      results.push(toArtist(a))
    }
  }
  return results
}

function toArtist(a: RawArtist): {
  ratingKey: string
  title: string
  thumb: string | null
  summary: string | null
} {
  return {
    ratingKey: a.ratingKey,
    title: a.title,
    thumb: a.thumb ?? null,
    summary: a.summary ?? null
  }
}

export async function listArtistAlbums(
  ctx: ServerContext,
  artistRatingKey: string
): Promise<PlexAlbum[]> {
  const url = `${ctx.baseUrl}/library/metadata/${artistRatingKey}/children`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Artist albums fetch failed: ${res.status}`)
  const json = (await res.json()) as MediaContainer<RawAlbum>
  return (json.MediaContainer.Metadata ?? []).map(toAlbum)
}

interface RawSimilarArtist {
  ratingKey: string
  title: string
  thumb?: string
  Guid?: RawGuid[]
}

export async function listSimilarArtists(
  ctx: ServerContext,
  artistRatingKey: string
): Promise<{ ratingKey: string; title: string; thumb: string | null; mbid: string | null }[]> {
  const url = `${ctx.baseUrl}/library/metadata/${artistRatingKey}/similar?limit=20&includeGuids=1`
  try {
    const res = await plexFetch(url, { headers: headers(ctx) })
    if (!res.ok) return []
    const json = (await res.json()) as MediaContainer<RawSimilarArtist>
    const rows = json.MediaContainer.Metadata ?? []
    return rows.map((a) => ({
      ratingKey: a.ratingKey,
      title: a.title,
      thumb: a.thumb ?? null,
      mbid: extractArtistMbid(a.Guid ?? [])
    }))
  } catch {
    return []
  }
}

function extractArtistMbid(guids: RawGuid[]): string | null {
  for (const g of guids) {
    const parsed = extractMbidFromGuid(g.id)
    if (parsed && parsed.entity === 'artist') return parsed.mbid
  }
  return null
}

export interface LibraryArtist {
  ratingKey: string
  name: string
  mbid: string | null
}

interface RawArtistWithGuid extends RawArtist {
  Guid?: RawGuid[]
}

// Enumerate every artist in every music section. Used by the release-radar to
// pick which artists to query MusicBrainz for. includeGuids=1 surfaces the
// per-artist mbid:// values so we don't need a follow-up detail fetch per
// artist. Paginated 500 at a time, mirroring listAllAlbums.
export async function listAllArtistsWithGuids(
  ctx: ServerContext
): Promise<LibraryArtist[]> {
  const sections = await listMusicSections(ctx)
  const all: LibraryArtist[] = []
  for (const section of sections) {
    let offset = 0
    const pageSize = 500
    for (;;) {
      const url = `${ctx.baseUrl}/library/sections/${section.key}/all?type=8&includeGuids=1`
      const res = await plexFetch(url, {
        headers: headers(ctx, {
          'X-Plex-Container-Start': String(offset),
          'X-Plex-Container-Size': String(pageSize)
        })
      })
      if (!res.ok) break
      const json = (await res.json()) as MediaContainer<RawArtistWithGuid>
      const rows = json.MediaContainer.Metadata ?? []
      for (const a of rows) {
        all.push({
          ratingKey: a.ratingKey,
          name: a.title,
          mbid: extractArtistMbid(a.Guid ?? [])
        })
      }
      offset += rows.length
      const total = json.MediaContainer.totalSize ?? json.MediaContainer.size ?? offset
      if (rows.length < pageSize || offset >= total) break
    }
  }
  return all
}

interface RawSearchTrack {
  ratingKey: string
  title: string
  duration?: number
  grandparentTitle?: string
  parentTitle?: string
  parentRatingKey?: string
  parentThumb?: string
  thumb?: string
}

interface RawHub {
  type: string
  Metadata?: unknown[]
}

interface SearchResponse {
  MediaContainer: {
    Hub?: RawHub[]
  }
}

export async function searchLibrary(
  ctx: ServerContext,
  sectionKey: string,
  query: string
): Promise<SearchResults> {
  const url = `${ctx.baseUrl}/hubs/search?query=${encodeURIComponent(query)}&sectionId=${sectionKey}&limit=12&includeCollections=0`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  const json = (await res.json()) as SearchResponse
  const hubs = json.MediaContainer.Hub ?? []
  const pick = (type: string): unknown[] =>
    hubs.find((h) => h.type === type)?.Metadata ?? []

  const artists = (pick('artist') as RawArtist[]).map(toArtist)
  const albums = (pick('album') as RawAlbum[]).map(toAlbum)
  const tracks = (pick('track') as RawSearchTrack[]).map((t) => ({
    ratingKey: t.ratingKey,
    title: t.title,
    duration: t.duration ?? null,
    album: t.parentTitle ?? '',
    albumRatingKey: t.parentRatingKey ?? null,
    artist: t.grandparentTitle ?? '',
    thumb: t.parentThumb ?? t.thumb ?? null
  }))

  return { artists, albums, tracks }
}
