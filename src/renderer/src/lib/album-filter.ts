import type { PlexAlbum, PlaystateFilter } from '../../../shared/plex'

export interface ActiveFilters {
  genreInclude: Set<string>
  genreExclude: Set<string>
  decade: number | null
  year: number | null
  labelInclude: Set<string>
  labelExclude: Set<string>
  playstate: PlaystateFilter
  // Cutoff timestamp (Unix seconds) for stale-* buckets. null when the
  // playstate filter doesn't need it (`all` / `unplayed`).
  playstateCutoffSec: number | null
}

export function playstateCutoffFor(state: PlaystateFilter): number | null {
  if (state === 'stale-6m') return Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 182
  if (state === 'stale-1y') return Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365
  if (state === 'stale-2y') return Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 730
  return null
}

export function albumMatchesFilters(
  album: PlexAlbum,
  filters: ActiveFilters,
  labelsForAlbum: string[],
  // Optional alias resolver. Identity by default — when the user has merged
  // labels in the filter UI, `filters.labelInclude/Exclude` hold canonical
  // names, so we have to canonicalize the album's raw labels here for the
  // set lookup to match.
  canonicalLabel: (name: string) => string = (n) => n
): boolean {
  if (filters.genreInclude.size > 0) {
    let hit = false
    for (const g of album.genres) {
      if (filters.genreInclude.has(g)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  if (filters.genreExclude.size > 0) {
    for (const g of album.genres) {
      if (filters.genreExclude.has(g)) return false
    }
  }
  if (filters.year != null) {
    if (album.year !== filters.year) return false
  } else if (filters.decade != null) {
    if (album.year == null) return false
    if (Math.floor(album.year / 10) * 10 !== filters.decade) return false
  }
  if (filters.labelInclude.size > 0) {
    if (labelsForAlbum.length === 0) return false
    let hit = false
    for (const name of labelsForAlbum) {
      if (filters.labelInclude.has(canonicalLabel(name))) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  if (filters.labelExclude.size > 0) {
    for (const name of labelsForAlbum) {
      if (filters.labelExclude.has(canonicalLabel(name))) return false
    }
  }
  if (filters.playstate === 'unplayed') {
    if (album.lastViewedAt) return false
  } else if (filters.playstateCutoffSec !== null) {
    if (!album.lastViewedAt) return false
    if (album.lastViewedAt >= filters.playstateCutoffSec) return false
  }
  return true
}
