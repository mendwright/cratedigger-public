import type { ArtistBio, Bio } from '../shared/plex.js'
import {
  extractWikipediaProse,
  isAmbiguousArtistBio,
  looksLikeArtistArticle,
  stripLastfmFooter
} from '../shared/bio-text.js'
import {
  getArtistUrlRelations,
  getReleaseGroupForRelease,
  getReleaseGroupUrlRelations
} from './musicbrainz.js'
import { getLastfmApiKey } from './store.js'
import { JsonCache } from './mb-cache.js'

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/'
const WIKI_USER_AGENT = 'cratedigger/0.4.0 (https://github.com/mendwright/cratedigger; contact via github)'

// ---------- Wikipedia ----------

interface WikiSummary {
  extract?: string
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } }
  originalimage?: { source?: string }
  thumbnail?: { source?: string }
}

function parseWikipediaUrl(
  url: string
): { lang: string; title: string } | null {
  try {
    const u = new URL(url)
    const m = /^([a-z]{2,3})\.wikipedia\.org$/i.exec(u.hostname)
    if (!m) return null
    const path = u.pathname.replace(/^\/wiki\//, '')
    if (!path) return null
    return { lang: m[1].toLowerCase(), title: decodeURIComponent(path) }
  } catch {
    return null
  }
}

async function fetchWikipediaSummary(
  lang: string,
  title: string
): Promise<{ extract: string; url: string | null; image: string | null } | null> {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'))
  const res = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}?redirect=true`,
    { headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' } }
  )
  if (!res.ok) return null
  const json = (await res.json()) as WikiSummary
  const extract = (json.extract ?? '').trim()
  if (!extract) return null
  return {
    extract,
    url: json.content_urls?.desktop?.page ?? null,
    image: json.originalimage?.source ?? json.thumbnail?.source ?? null
  }
}

function firstWikipediaRelation(
  rels: { type: string; url?: { resource: string } }[]
): { lang: string; title: string } | null {
  for (const rel of rels) {
    if (rel.type !== 'wikipedia' || !rel.url?.resource) continue
    const parsed = parseWikipediaUrl(rel.url.resource)
    if (parsed) return parsed
  }
  return null
}

function firstWikidataId(
  rels: { type: string; url?: { resource: string } }[]
): string | null {
  for (const rel of rels) {
    if (rel.type !== 'wikidata' || !rel.url?.resource) continue
    const m = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i.exec(rel.url.resource)
    if (m) return m[1]
  }
  return null
}

interface WikidataEntity {
  sitelinks?: Record<string, { site?: string; title?: string }>
}

async function resolveWikidataToWikipedia(
  qid: string,
  preferredLangs: string[] = ['en']
): Promise<{ lang: string; title: string } | null> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
      { headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      entities?: Record<string, WikidataEntity>
    }
    const entity = Object.values(json.entities ?? {})[0]
    const sitelinks = entity?.sitelinks ?? {}
    for (const lang of preferredLangs) {
      const key = `${lang}wiki`
      const link = sitelinks[key]
      if (link?.title) return { lang, title: link.title }
    }
    return null
  } catch {
    return null
  }
}

async function resolveWikipediaTarget(
  rels: { type: string; url?: { resource: string } }[]
): Promise<{ lang: string; title: string } | null> {
  const direct = firstWikipediaRelation(rels)
  if (direct) return direct
  const qid = firstWikidataId(rels)
  if (qid) return resolveWikidataToWikipedia(qid)
  return null
}

// Full plain-text article body — used to expand a stub lead with the prose
// sections (History, Career…) via extractWikipediaProse.
async function fetchWikipediaFullExtract(
  lang: string,
  title: string
): Promise<string | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(
    title
  )}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      query?: { pages?: Record<string, { extract?: string }> }
    }
    const page = Object.values(json.query?.pages ?? {})[0]
    const text = (page?.extract ?? '').trim()
    return text || null
  } catch {
    return null
  }
}

async function searchWikipediaByTitle(
  query: string
): Promise<{ lang: string; title: string } | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(
    query
  )}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      query?: { search?: Array<{ title: string }> }
    }
    const hit = json.query?.search?.[0]?.title
    if (!hit) return null
    return { lang: 'en', title: hit }
  } catch {
    return null
  }
}

// ---------- Last.fm ----------

interface LastfmImage {
  '#text'?: string
  size?: string
}

interface LastfmArtistInfoResponse {
  artist?: {
    name?: string
    url?: string
    image?: LastfmImage[]
    bio?: { summary?: string; content?: string }
    tags?: { tag?: Array<{ name?: string }> }
  }
}

interface LastfmAlbumInfoResponse {
  album?: {
    name?: string
    artist?: string
    url?: string
    image?: LastfmImage[]
    wiki?: { summary?: string; content?: string }
    // Last.fm collapses a one-element tag list into a bare object rather than
    // an array of one, so the union is the real wire shape, not defensiveness.
    tags?: { tag?: Array<{ name?: string }> | { name?: string } }
  }
}

function bestLastfmImage(images: LastfmImage[] | undefined): string | null {
  if (!images) return null
  const priority = ['mega', 'extralarge', 'large', 'medium', 'small']
  const byPriority: Record<string, string> = {}
  for (const img of images) {
    const size = (img.size ?? '').toLowerCase()
    const url = (img['#text'] ?? '').trim()
    if (!url) continue
    if (/\/2a96cbd8b46e442fc41c2b86b821562f\.(png|jpg)/i.test(url)) continue // default star placeholder
    if (size && !(size in byPriority)) byPriority[size] = url
  }
  for (const key of priority) {
    if (byPriority[key]) return byPriority[key]
  }
  const first = Object.values(byPriority)[0]
  return first ?? null
}

async function lastfmCall<T>(method: string, params: Record<string, string>): Promise<T | null> {
  const key = getLastfmApiKey()
  if (!key) return null
  const qs = new URLSearchParams({
    method,
    api_key: key,
    format: 'json',
    autocorrect: '1',
    ...params
  })
  try {
    const res = await fetch(`${LASTFM_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function getLastfmArtistInfo(opts: {
  mbid?: string
  name?: string
}): Promise<LastfmArtistInfoResponse['artist'] | null> {
  const params: Record<string, string> = {}
  if (opts.mbid) params.mbid = opts.mbid
  if (opts.name) params.artist = opts.name
  if (!params.mbid && !params.artist) return null
  const data = await lastfmCall<LastfmArtistInfoResponse>('artist.getInfo', params)
  return data?.artist ?? null
}

async function getLastfmAlbumInfo(opts: {
  mbid?: string
  artist?: string
  album?: string
}): Promise<LastfmAlbumInfoResponse['album'] | null> {
  const params: Record<string, string> = {}
  if (opts.mbid) params.mbid = opts.mbid
  if (opts.artist) params.artist = opts.artist
  if (opts.album) params.album = opts.album
  if (!params.mbid && !(params.artist && params.album)) return null
  const data = await lastfmCall<LastfmAlbumInfoResponse>('album.getInfo', params)
  return data?.album ?? null
}

// Album tags for the genre indexer. Last.fm is the fallback source when MB has
// no genres for a release — it covers a lot of what MB misses (hair metal,
// cool jazz, surf rock all came back for albums MB knew nothing about), but
// its tags are folksonomy and need filtering through MB's genre vocabulary
// before they can be trusted. That filtering lives in shared/genre-vocab.ts;
// this just hands back the raw list, ranked as Last.fm ranked it.
// Cached on disk so a full genre-index rebuild (which replays every album to
// pick up a new source) doesn't re-ask Last.fm for four thousand albums.
const lastfmAlbumTagsCache = new JsonCache<string[]>('lastfm-album-tags-v1')

export async function getLastfmAlbumTags(opts: {
  artist: string
  album: string
}): Promise<string[]> {
  if (!opts.artist.trim() || !opts.album.trim()) return []
  const key = `${opts.artist.toLowerCase().trim()}|${opts.album.toLowerCase().trim()}`
  const cached = await lastfmAlbumTagsCache.get(key)
  if (cached !== undefined && cached !== null) return cached
  const album = await getLastfmAlbumInfo({ artist: opts.artist, album: opts.album })
  const raw = album?.tags?.tag
  // Last.fm collapses a single-element list into a bare object.
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
  const out: string[] = []
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (name) out.push(name)
  }
  await lastfmAlbumTagsCache.set(key, out)
  return out
}

// ---------- Public API ----------

const albumBioCache = new JsonCache<Bio>('album-bios')
// v5: v1 entries were cached when a Last.fm one-liner blocked the Wikipedia
// fetch entirely; v2 entries predate stub-lead expansion (History/Career
// sections) and the guarded title search; v3/v4 may contain Last.fm's generic
// directory page for several same-named artists (v4's detector missed the
// "bands called X" phrasing); v5 entries lack `variants` (the per-source
// texts the artist page's bio tabs need). Bump so all refetch.
const artistBioCache = new JsonCache<ArtistBio>('artist-bios-v6')

// Cache key is stable across callers — input MBIDs differ depending on whether
// album credits have loaded yet (renderer's first call vs second), and across
// the warmer vs on-demand paths. Artist+title is the album-as-concept and is
// the same in every code path. Worst-case collision (two same-named albums by
// the same artist) shares one enriched bio — acceptable for a description.
function albumBioKey(opts: { artist: string; title: string }): string {
  return `${opts.artist.toLowerCase().trim()}|${opts.title.toLowerCase().trim()}`
}

export async function isAlbumBioCached(opts: {
  artist: string
  title: string
}): Promise<boolean> {
  return (await albumBioCache.get(albumBioKey(opts))) !== undefined
}

export async function getAlbumBio(opts: {
  releaseMbid: string | null
  releaseGroupMbid: string | null
  artist: string
  title: string
}): Promise<Bio | null> {
  const cacheKey = albumBioKey(opts)
  const hit = await albumBioCache.get(cacheKey)
  if (hit !== undefined) return hit

  let rgMbid = opts.releaseGroupMbid
  if (!rgMbid && opts.releaseMbid) {
    rgMbid = await getReleaseGroupForRelease(opts.releaseMbid)
  }

  // 1. Last.fm album.getInfo (preferred — richer, generous rate limit).
  const lfm = await getLastfmAlbumInfo({
    mbid: rgMbid ?? opts.releaseMbid ?? undefined,
    artist: opts.artist,
    album: opts.title
  })
  const lfmText = stripLastfmFooter(lfm?.wiki?.content || lfm?.wiki?.summary || '')
  if (lfmText) {
    const bio: Bio = { source: 'lastfm', text: lfmText, url: lfm?.url ?? null }
    await albumBioCache.set(cacheKey, bio)
    return bio
  }

  // 2. Wikipedia via MB release-group url-rels (direct or via wikidata).
  if (rgMbid) {
    const rels = await getReleaseGroupUrlRelations(rgMbid)
    const wiki = await resolveWikipediaTarget(rels)
    if (wiki) {
      const summary = await fetchWikipediaSummary(wiki.lang, wiki.title)
      if (summary) {
        const bio: Bio = {
          source: 'wikipedia',
          text: summary.extract,
          url: summary.url ?? `https://${wiki.lang}.wikipedia.org/wiki/${encodeURIComponent(
            wiki.title.replace(/ /g, '_')
          )}`
        }
        await albumBioCache.set(cacheKey, bio)
        return bio
      }
    }
  }

  await albumBioCache.set(cacheKey, null)
  return null
}

export async function getArtistBio(opts: {
  mbid: string
  name: string
}): Promise<ArtistBio | null> {
  const cacheKey = `${opts.mbid}|${opts.name}`
  const hit = await artistBioCache.get(cacheKey)
  if (hit !== undefined) return hit

  let image: ArtistBio['image'] = null
  let tags: string[] = []

  // 1. Last.fm — bio text + tags + image.
  const lfm = await getLastfmArtistInfo({ mbid: opts.mbid, name: opts.name })
  const rawLfmText = lfm ? stripLastfmFooter(lfm.bio?.content || lfm.bio?.summary || '') : ''
  const lfmText = isAmbiguousArtistBio(rawLfmText) ? '' : rawLfmText
  if (lfm) {
    const imgUrl = bestLastfmImage(lfm.image)
    if (imgUrl) image = { url: imgUrl, source: 'lastfm' }
    tags = (lfm.tags?.tag ?? [])
      .map((t) => (t.name ?? '').trim())
      .filter(Boolean)
      .slice(0, 8)
  }

  // 2. Wikipedia — always fetched, not just when Last.fm came up empty.
  // Last.fm artist bios are frequently one-liners ("Indie artist from
  // Philadelphia"), and any non-empty text used to block this entirely.
  // Longer text wins below; Wikipedia also fills a missing image.
  //
  // Article resolution: the MBID-anchored route (MB url-rels → wikidata) is
  // always trusted. The fuzzy title search runs when we'd otherwise show
  // nothing OR when Last.fm is a near-stub — but its hit must pass
  // looksLikeArtistArticle (name match + reads like a music article), so a
  // wrong-but-long article can't displace a correct one-liner.
  //
  // Stub-lead expansion: many artist articles have a one-line lead with the
  // real bio in `== History ==` / `== Career ==`. When the lead is short we
  // pull the full plain-text article and keep its prose sections.
  const LFM_STUB_MAX = 200
  const WIKI_LEAD_STUB_MAX = 300
  let wikiText = ''
  let wikiUrl: string | null = null
  const rels = await getArtistUrlRelations(opts.mbid)
  let wiki = await resolveWikipediaTarget(rels)
  let needsGuard = false
  if (!wiki && lfmText.length < LFM_STUB_MAX) {
    wiki = await searchWikipediaByTitle(`${opts.name} band`)
    needsGuard = true
  }
  if (wiki) {
    const summary = await fetchWikipediaSummary(wiki.lang, wiki.title)
    if (summary) {
      let text = summary.extract
      if (text.length < WIKI_LEAD_STUB_MAX) {
        const full = await fetchWikipediaFullExtract(wiki.lang, wiki.title)
        if (full) {
          const prose = extractWikipediaProse(full)
          if (prose.length > text.length) text = prose
        }
      }
      const accepted =
        !needsGuard ||
        looksLikeArtistArticle({
          title: wiki.title,
          extract: text,
          artistName: opts.name
        })
      if (accepted) {
        wikiText = text
        wikiUrl =
          summary.url ??
          `https://${wiki.lang}.wikipedia.org/wiki/${encodeURIComponent(
            wiki.title.replace(/ /g, '_')
          )}`
        if (!image && summary.image) image = { url: summary.image, source: 'wikipedia' }
      }
    }
  }

  const useWiki = wikiText.length > lfmText.length
  const text = useWiki ? wikiText : lfmText
  const source: 'wikipedia' | 'lastfm' = useWiki ? 'wikipedia' : 'lastfm'
  const url = useWiki ? wikiUrl : (lfm?.url ?? null)

  if (!text && !image && tags.length === 0) {
    await artistBioCache.set(cacheKey, null)
    return null
  }

  const variants: Bio[] = []
  if (lfmText) variants.push({ source: 'lastfm', text: lfmText, url: lfm?.url ?? null })
  if (wikiText) variants.push({ source: 'wikipedia', text: wikiText, url: wikiUrl })

  const bio: ArtistBio = {
    source,
    text,
    url,
    image,
    tags,
    variants
  }
  await artistBioCache.set(cacheKey, bio)
  return bio
}
