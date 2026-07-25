import type { CoverCandidate } from '../shared/plex.js'

// iTunes Search API — public, no key, no rate-limit guidance beyond
// "be reasonable". We use it as a cover-art source because Apple's catalog
// has high-quality artwork for nearly every commercial release.

interface ITunesResult {
  collectionId?: number
  collectionName?: string
  artistName?: string
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
