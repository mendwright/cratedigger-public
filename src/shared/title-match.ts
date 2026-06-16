import type { CreditedWork, PlexAlbum } from './plex'
import { mbidFromGuid } from './guid'

/**
 * Normalize a title for matching: lowercase, strip parentheticals and
 * bracketed annotations (replaced with a single space), strip non-letter/
 * non-number characters (preserving whitespace as single spaces), collapse
 * runs of whitespace, trim.
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compact a title for matching: lowercase, strip parentheticals and
 * bracketed annotations (removed entirely), strip ALL non-letter/
 * non-number characters (removed entirely). No whitespace collapse needed
 * since non-letter/number chars are deleted.
 */
export function compactTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s*\[[^\]]*\]\s*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function pickFromBucket(bucket: PlexAlbum[], date: string | null): PlexAlbum | null {
  if (bucket.length === 0) return null
  if (date) {
    const year = parseInt(date.slice(0, 4), 10)
    if (Number.isFinite(year)) {
      const yearMatch = bucket.find((a) => a.year === year)
      if (yearMatch) return yearMatch
    }
  }
  return bucket[0]
}

/**
 * Match a set of CreditedWorks (from MusicBrainz) against the user's Plex
 * library. Returns two buckets:
 *   - inLibrary: works that matched a Plex album, with merged roles per album
 *   - notInLibrary: works that didn't match, deduplicated by compactTitle+year
 *
 * Matching cascade (per work):
 *   1. MBID exact — album guid contains the work's MBID
 *   2. normalizeTitle — exact match after stripping punctuation/parentheticals
 *   3. compactTitle — match after stripping everything non-alphanumeric
 *   Steps 2–3 break ties by year when the MB date is known.
 */
export function matchCreditedWorks(
  works: CreditedWork[],
  albums: PlexAlbum[]
): { inLibrary: { album: PlexAlbum; roles: string[] }[]; notInLibrary: CreditedWork[] } {
  // Build indexes over the Plex library.
  const byMbid = new Map<string, PlexAlbum>()
  const byTitle = new Map<string, PlexAlbum[]>()
  const byCompact = new Map<string, PlexAlbum[]>()

  for (const album of albums) {
    for (const g of album.guids) {
      const m = mbidFromGuid(g)
      if (m && !byMbid.has(m)) byMbid.set(m, album)
    }
    const tk = normalizeTitle(album.title)
    if (tk) {
      const bucket = byTitle.get(tk)
      if (bucket) bucket.push(album)
      else byTitle.set(tk, [album])
    }
    const ck = compactTitle(album.title)
    if (ck) {
      const bucket = byCompact.get(ck)
      if (bucket) bucket.push(album)
      else byCompact.set(ck, [album])
    }
  }

  const inLibraryMap = new Map<string, { album: PlexAlbum; roles: string[] }>()
  const notInLibrary: CreditedWork[] = []
  const seenNotInLibrary = new Set<string>()

  for (const w of works) {
    const match = findPlexMatch(w, byMbid, byTitle, byCompact)
    if (match) {
      const existing = inLibraryMap.get(match.ratingKey)
      if (existing) {
        for (const r of w.roles) {
          if (!existing.roles.includes(r)) existing.roles.push(r)
        }
      } else {
        inLibraryMap.set(match.ratingKey, { album: match, roles: [...w.roles] })
      }
    } else {
      const dedupeKey = `${compactTitle(w.title)}::${w.date ? w.date.slice(0, 4) : ''}`
      if (seenNotInLibrary.has(dedupeKey)) continue
      seenNotInLibrary.add(dedupeKey)
      notInLibrary.push(w)
    }
  }

  const inLibrary = [...inLibraryMap.values()].sort((a, b) => {
    const ay = a.album.year ?? 0
    const by = b.album.year ?? 0
    return by - ay
  })

  return { inLibrary, notInLibrary }
}

function findPlexMatch(
  w: CreditedWork,
  byMbid: Map<string, PlexAlbum>,
  byTitle: Map<string, PlexAlbum[]>,
  byCompact: Map<string, PlexAlbum[]>
): PlexAlbum | null {
  const byId = byMbid.get(w.mbid.toLowerCase())
  if (byId) return byId

  const tk = normalizeTitle(w.title)
  if (tk) {
    const hit = byTitle.get(tk)
    if (hit) {
      const pick = pickFromBucket(hit, w.date)
      if (pick) return pick
    }
  }

  const ck = compactTitle(w.title)
  if (ck) {
    const hit = byCompact.get(ck)
    if (hit) {
      const pick = pickFromBucket(hit, w.date)
      if (pick) return pick
    }
  }

  return null
}
