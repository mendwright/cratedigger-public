import type { PlexAlbum, SmartOrder, SmartRules } from './plex.js'

// Smart-playlist matching, pure and process-agnostic. The renderer owns the
// data the rules read (album list, MB label index, effective original years)
// and injects it via {@link SmartMatchDeps}; this module just decides.

export interface SmartMatchDeps {
  // Canonical label names for an album (MB label index, alias-resolved).
  // Empty array = indexed with no labels; also treat as "no label".
  labelsFor: (ratingKey: string) => string[]
  // Effective original year: manual override > MB original date > Plex year.
  yearFor: (album: PlexAlbum) => number | null
  // Random source for order:'random'; injectable so tests are deterministic.
  rng?: () => number
}

const norm = (s: string): string => s.trim().toLowerCase()

export function albumMatchesRules(
  album: PlexAlbum,
  rules: SmartRules,
  deps: SmartMatchDeps
): boolean {
  if (rules.genres.length > 0) {
    const want = new Set(rules.genres.map(norm))
    if (!album.genres.some((g) => want.has(norm(g)))) return false
  }
  if (rules.labels.length > 0) {
    const want = new Set(rules.labels.map(norm))
    if (!deps.labelsFor(album.ratingKey).some((l) => want.has(norm(l)))) return false
  }
  if (rules.yearFrom !== null || rules.yearTo !== null) {
    const y = deps.yearFor(album)
    if (y === null) return false
    if (rules.yearFrom !== null && y < rules.yearFrom) return false
    if (rules.yearTo !== null && y > rules.yearTo) return false
  }
  return true
}

// True when every clause is empty — matching everything is never what the
// user meant, so callers refuse to sync an unconstrained definition.
export function rulesAreEmpty(rules: SmartRules): boolean {
  return (
    rules.genres.length === 0 &&
    rules.labels.length === 0 &&
    rules.yearFrom === null &&
    rules.yearTo === null
  )
}

// Matching albums in playlist order, capped at `limit` AFTER ordering so
// "50 newest additions" style definitions come out right.
export function selectAlbums(
  albums: PlexAlbum[],
  rules: SmartRules,
  order: SmartOrder,
  limit: number | null,
  deps: SmartMatchDeps
): PlexAlbum[] {
  const matched = albums.filter((a) => albumMatchesRules(a, rules, deps))
  const rng = deps.rng ?? Math.random
  switch (order) {
    case 'artist':
      matched.sort(
        (a, b) =>
          norm(a.artist).localeCompare(norm(b.artist)) ||
          (deps.yearFor(a) ?? 0) - (deps.yearFor(b) ?? 0)
      )
      break
    case 'year':
      matched.sort(
        (a, b) =>
          (deps.yearFor(a) ?? Infinity) - (deps.yearFor(b) ?? Infinity) ||
          norm(a.artist).localeCompare(norm(b.artist))
      )
      break
    case 'added':
      matched.sort((a, b) => b.addedAt - a.addedAt)
      break
    case 'random': {
      // Fisher–Yates with the injected rng.
      for (let i = matched.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[matched[i], matched[j]] = [matched[j], matched[i]]
      }
      break
    }
  }
  return limit !== null && limit > 0 ? matched.slice(0, limit) : matched
}
