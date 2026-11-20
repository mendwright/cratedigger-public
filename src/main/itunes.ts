import type { CoverCandidate } from '../shared/plex.js'
import { canonicalArtistKey } from '../shared/artist-aliases.js'
import { compactTitle } from '../shared/title-match.js'

// iTunes Search API — public, no key, no rate-limit guidance beyond
// "be reasonable". We use it as a cover-art source because Apple's catalog
// has high-quality artwork for nearly every commercial release.

interface ITunesResult {
  collectionId?: number
  collectionName?: string
  artistName?: string
  trackName?: string
  artworkUrl100?: string
  collectionType?: string
  wrapperType?: string
}

interface ITunesResponse {
  resultCount?: number
  results?: ITunesResult[]
}

const cache = new Map<string, CoverCandidate[]>()

function cacheKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}${title.trim().toLowerCase()}`
}

// iTunes returns artwork URLs like `…/100x100bb.jpg`. The path-segment is the
// requested size — swapping it gets us any size Apple has on file. 600x600
// covers the renderer's max cover-tile size; the picker thumb uses 200.
function resize(artworkUrl100: string, px: number): string {
  return artworkUrl100.replace(/\/\d+x\d+(bb)?\.(jpg|jpeg|png)$/i, `/${px}x${px}bb.jpg`)
}

// Song lookup for radio now-playing: what album is this song from, and what
// does its cover look like? Same trick the living-room kiosk uses — a keyless
// entity=song search. Cached forever per artist|title (radio repeats songs;
// the answer doesn't change).
const songCache = new Map<string, { album: string | null; art: string | null }>()

// iTunes' term search is fuzzy across every field — "The Cure Wendy Time"
// returned Wendy Moten's "As" as the top hit, and its art on the radio
// screen. A result only counts when its artist is the one we asked about
// (word-bounded containment so collab billings still pass).
function artistMatches(wanted: string, got: string | undefined): boolean {
  if (!got) return false
  const w = canonicalArtistKey(wanted)
  const g = canonicalArtistKey(got)
  if (!w || !g) return false
  return w === g || ` ${g} `.includes(` ${w} `) || ` ${w} `.includes(` ${g} `)
}

export async function searchITunesSongInfo(
  artist: string,
  title: string
): Promise<{ album: string | null; art: string | null }> {
  const a = artist.trim()
  const t = title.trim()
  if (!a || !t) return { album: null, art: null }
  const key = cacheKey(a, t)
  const cached = songCache.get(key)
  if (cached) return cached
  const term = encodeURIComponent(`${a} ${t}`)
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=10`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return { album: null, art: null }
    const json = (await res.json()) as ITunesResponse
    const byArtist = (json.results ?? []).filter((r) => artistMatches(a, r.artistName))
    const wantTitle = compactTitle(t)
    const r =
      byArtist.find((x) => x.trackName && compactTitle(x.trackName) === wantTitle) ?? byArtist[0]
    const info = {
      album: r?.collectionName ?? null,
      art: r?.artworkUrl100 ? resize(r.artworkUrl100, 600) : null
    }
    songCache.set(key, info)
    return info
  } catch {
    return { album: null, art: null }
  } finally {
    clearTimeout(timer)
  }
}

// `fullPx` sets the resolution of the returned `url`. The cover picker uses the
// 600px default; the Art Fixer asks for 1400 to beat Deezer's 1000px cap.
export async function searchITunesAlbumCovers(
  artist: string,
  title: string,
  fullPx = 600
): Promise<CoverCandidate[]> {
  const a = artist.trim()
  const t = title.trim()
  // Title is enough — a blank artist is the compilation/various-artists case,
  // where the album's "artist" is a useless track performer.
  if (!t) return []
  const key = `${cacheKey(a, t)}@${fullPx}`
  const cached = cache.get(key)
  if (cached) return cached

  const term = encodeURIComponent(`${a} ${t}`.trim())
  const url = `https://itunes.apple.com/search?term=${term}&entity=album&limit=25`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (!res.ok) return []
    const json = (await res.json()) as ITunesResponse
    const seen = new Set<string>()
    const out: CoverCandidate[] = []
    for (const r of json.results ?? []) {
      if (!r.artworkUrl100) continue
      // Dedupe by the 100px URL — Apple sometimes returns the same album
      // under multiple collection IDs (deluxe / regular / regional).
      if (seen.has(r.artworkUrl100)) continue
      seen.add(r.artworkUrl100)
      const full = resize(r.artworkUrl100, fullPx)
      const thumb = resize(r.artworkUrl100, 200)
      const label = [r.artistName, r.collectionName].filter(Boolean).join(' — ') || null
      out.push({ source: 'itunes', url: full, thumbUrl: thumb, label })
    }
    cache.set(key, out)
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
