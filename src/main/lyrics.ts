import type { LyricsResult } from '../shared/plex.js'
import { JsonCache } from './mb-cache.js'
import { getGeniusLyrics } from './genius.js'
import { getBandcampLyrics } from './bandcamp.js'

// LRCLIB is a community-built open lyrics database. Free, no key, generous
// rate limits — we still cache aggressively so re-opening an album doesn't
// re-hit the API. Key is artist+title+duration so we don't collide live and
// studio versions of the same song.
//
// When LRCLIB has nothing (it's thin on underground/new hip-hop), we fall back
// to Genius — best-in-class for rap, but plain text only and requires scraping.
// See genius.ts and bandcamp.ts.
// Order: LRCLIB exact → LRCLIB fuzzy → Genius → Bandcamp.

interface LrcLibResponse {
  id?: number
  name?: string
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const cache = new JsonCache<LyricsResult>('lyrics')

// A lookup either answered cleanly (`ok: true`, value possibly null = a real
// miss) or hit a transport error / wasn't able to determine (`ok: false`). We
// only persist a *negative* result to cache when every source answered cleanly
// — otherwise a transient outage would poison a track with "no lyrics" forever.
type Lookup = { ok: boolean; value: LyricsResult | null }

// Bump this when the lookup pipeline changes in a way that should invalidate
// stale negatives. v2 = Genius fallback added; pre-v2 entries cached LRCLIB
// misses as null and would otherwise mask Genius hits. v3 = clears negatives
// cached during the v2 window when a transient Genius bot/challenge page was
// mistaken for a real "no lyrics". v4 = Bandcamp fallback added.
const CACHE_SCHEMA = 'v4'

function cacheKey(artist: string, title: string, album: string, durationSec: number | null): string {
  // SHA1 of a stable string would be more compact but the JsonCache already
  // hashes long keys; a delimited canonical form is fine and stays readable
  // when poking at userData/mb-cache/lyrics/.
  const dur = typeof durationSec === 'number' ? Math.round(durationSec) : '?'
  return `${CACHE_SCHEMA}|${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}|${album.trim().toLowerCase()}|${dur}`
}

export async function getTrackLyrics(args: {
  artist: string
  title: string
  album: string
  durationMs: number | null
}): Promise<LyricsResult | null> {
  const durationSec = args.durationMs != null ? Math.round(args.durationMs / 1000) : null
  const key = cacheKey(args.artist, args.title, args.album, durationSec)
  const cached = await cache.get(key)
  if (cached !== undefined) return cached

  const lrclib = await lrclibLookup(args, durationSec)
  // A hit with lyrics (or a confirmed instrumental) wins — don't waste a Genius
  // round-trip. Only fall through when LRCLIB had nothing useful.
  if (lrclib.value && (lrclib.value.instrumental || lrclib.value.plainLyrics)) {
    await cache.set(key, lrclib.value)
    return lrclib.value
  }

  const genius = await getGeniusLyrics({ artist: args.artist, title: args.title })
  if (genius.value) {
    await cache.set(key, genius.value)
    return genius.value
  }

  const bandcamp = await getBandcampLyrics({
    artist: args.artist,
    title: args.title,
    album: args.album
  })
  const result = bandcamp.value ?? lrclib.value ?? null

  // Cache positives always; cache a null only when every source answered
  // cleanly (a genuine "no lyrics anywhere"), never when one errored.
  if (result !== null || (lrclib.ok && genius.ok && bandcamp.ok)) {
    await cache.set(key, result)
  }
  return result
}

async function lrclibLookup(
  args: { artist: string; title: string; album: string },
  durationSec: number | null
): Promise<Lookup> {
  const params = new URLSearchParams({
    artist_name: args.artist,
    track_name: args.title,
    album_name: args.album
  })
  if (durationSec != null) params.set('duration', String(durationSec))

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (res.status === 404) {
      // LRCLIB's exact /get is strict about the album name, but its /search
      // will find the lyrics by artist+title.
      return { ok: true, value: await fuzzySearch(args.artist, args.title) }
    }
    if (!res.ok) return { ok: false, value: null }
    const json = (await res.json()) as LrcLibResponse
    return {
      ok: true,
      value: {
        plainLyrics: json.plainLyrics ?? null,
        syncedLyrics: json.syncedLyrics ?? null,
        instrumental: !!json.instrumental,
        source: 'lrclib',
        url: json.id ? `https://lrclib.net/lyrics/${json.id}` : null
      }
    }
  } catch {
    return { ok: false, value: null }
  } finally {
    clearTimeout(timer)
  }
}

async function fuzzySearch(artist: string, title: string): Promise<LyricsResult | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (!res.ok) return null
    const list = (await res.json()) as LrcLibResponse[]
    // /search ranks by relevance — the first hit with non-empty lyrics is
    // our best bet. If only instrumental records come back, take the first
    // instrumental hit so the UI can show "Instrumental" instead of
    // "No lyrics found."
    const best =
      list.find((r) => r.syncedLyrics || r.plainLyrics) ??
      list.find((r) => r.instrumental) ??
      null
    if (!best) return null
    return {
      plainLyrics: best.plainLyrics ?? null,
      syncedLyrics: best.syncedLyrics ?? null,
      instrumental: !!best.instrumental,
      source: 'lrclib',
      url: best.id ? `https://lrclib.net/lyrics/${best.id}` : null
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
