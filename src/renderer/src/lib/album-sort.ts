import type { AlbumSortKey, PlexAlbum } from '../../../shared/plex'

// Client-side mirror of the server sorts in src/main/plex/library.ts. Any
// filter that runs over the full library (crate, label, year, playstate, …)
// bypasses the paginated server fetch, so the chosen sort has to be re-applied
// here — otherwise a crate lists in whatever order allAlbums happened to load.
//
// Release date sorts on `year` — in allAlbums already the effective *original*
// year (see applyOriginalYears), so a 2005 reissue of a 1969 record sorts as
// 1969 — refined by `releaseDate`, MusicBrainz's release day where known. That
// beats the server's originallyAvailableAt, which is "YYYY-01-01" for anything
// tagged with a bare year: an album out today sorted with January's records.

type SortableAlbum = Pick<
  PlexAlbum,
  'ratingKey' | 'title' | 'artist' | 'year' | 'addedAt' | 'rating' | 'lastViewedAt' | 'releaseDate'
>

// Release-date sort key: the day when we have one that agrees with the year,
// else the bare year. "2026" sorts below "2026-10-02", so an undated-within-
// the-year record files at the start of its year — where Plex put it anyway.
export function releaseSortKey(a: SortableAlbum): string | null {
  if (a.year == null) return null
  const y = String(a.year).padStart(4, '0')
  return a.releaseDate?.startsWith(y) ? a.releaseDate : y
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Plex's titleSort drops a leading article; match it so "The Pogues" files
// under P in both the server and client paths.
function sortName(s: string): string {
  return s.replace(/^(the|a|an)\s+/i, '')
}

// Deterministic per-(seed, album) hash so a random crate order holds still
// across re-renders and only changes when the user reshuffles.
function shuffleKey(seed: string, ratingKey: string): number {
  let h = 2166136261
  for (const ch of seed + ':' + ratingKey) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Negligence: rating × time-since-last-played, descending. Unrated albums
// never bubble up (-1 score sinks them). Never-played albums are scored off
// addedAt with a 5-year cap so a 20-year-old never-played album doesn't
// permanently lock the top of the list.
export function negligenceScore(album: SortableAlbum, nowSec: number): number {
  const rating = album.rating ?? 0
  if (rating <= 0) return -1
  if (album.lastViewedAt) {
    const days = Math.max(0, (nowSec - album.lastViewedAt) / 86400)
    return rating * days
  }
  const days = Math.max(0, (nowSec - album.addedAt) / 86400)
  return rating * Math.min(days, 1825)
}

const byArtistThenTitle = (a: SortableAlbum, b: SortableAlbum): number =>
  collator.compare(sortName(a.artist), sortName(b.artist)) ||
  collator.compare(sortName(a.title), sortName(b.title))

/** Returns a new array; never mutates `albums`. */
export function sortAlbums<T extends SortableAlbum>(
  albums: T[],
  key: AlbumSortKey,
  opts: { seed?: string | null; nowSec?: number } = {}
): T[] {
  const out = [...albums]
  switch (key) {
    case 'addedAt':
      return out.sort((a, b) => b.addedAt - a.addedAt)
    case 'releaseDate':
    case 'releaseDateAsc': {
      const dir = key === 'releaseDate' ? -1 : 1
      // Undated albums go last in both directions.
      const keys = new Map(out.map((a) => [a.ratingKey, releaseSortKey(a)]))
      return out.sort((a, b) => {
        const ka = keys.get(a.ratingKey) ?? null
        const kb = keys.get(b.ratingKey) ?? null
        if (ka == null || kb == null) {
          if (ka == null && kb == null) return byArtistThenTitle(a, b)
          return ka == null ? 1 : -1
        }
        return dir * (ka < kb ? -1 : ka > kb ? 1 : 0) || byArtistThenTitle(a, b)
      })
    }
    case 'artist':
      return out.sort(byArtistThenTitle)
    case 'title':
      return out.sort((a, b) => collator.compare(sortName(a.title), sortName(b.title)))
    case 'lastViewed':
      return out.sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
    case 'rating':
      return out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byArtistThenTitle(a, b))
    case 'negligence': {
      const now = opts.nowSec ?? Date.now() / 1000
      return out.sort((a, b) => negligenceScore(b, now) - negligenceScore(a, now))
    }
    case 'random': {
      const seed = opts.seed ?? '0'
      return out.sort((a, b) => shuffleKey(seed, a.ratingKey) - shuffleKey(seed, b.ratingKey))
    }
  }
}
