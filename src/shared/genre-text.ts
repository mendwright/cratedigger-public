// Genre naming, shared by main (the MB genre indexer) and renderer (the crate
// rail, the genre filter chips).
//
// Two sources disagree about spelling. Plex's agents write Title Case and are
// inconsistent about separators — the same library holds both "Hip-Hop" (68
// albums) and "Hip Hop" (39), which the crate rail then draws as two crates.
// MusicBrainz writes everything lowercase and is internally consistent.
//
// So: normalise for identity, title-case for display.

// Tokens that should stay upper-cased when we title-case a genre for display.
const ACRONYMS = new Set([
  'r&b',
  'edm',
  'idm',
  'ebm',
  'dj',
  'mc',
  'uk',
  'us',
  'nyc',
  'dnb',
  'psy',
  'ost'
])

/**
 * Identity key for a genre name. Case-insensitive, and treats a hyphen and a
 * space as the same separator so "Hip-Hop" and "hip hop" collapse to one
 * crate. Used for dedup and set lookups — never shown to the user.
 */
export function normalizeGenre(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Separator-blind identity key. MusicBrainz writes "synth-pop" where Last.fm
 * writes "synthpop"; both compact to the same thing. Mirrors the strict /
 * compact pair `title-match.ts` already uses for MB-to-Plex album matching.
 */
export function compactGenre(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * How a genre is shown in the rail and on chips. MusicBrainz stores genres
 * lowercase ("neo-psychedelia"), which looks like a bug next to Plex's Title
 * Case, so we title-case for display while keeping the separator the source
 * chose — "neo-psychedelia" stays hyphenated, "hip hop" stays spaced.
 */
export function displayGenre(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/(\s+)/)
    .map((word) => {
      if (/^\s+$/.test(word)) return word
      return word
        .split('-')
        .map((part) => {
          if (!part) return part
          if (ACRONYMS.has(part.toLowerCase())) return part.toUpperCase()
          return part.charAt(0).toUpperCase() + part.slice(1)
        })
        .join('-')
    })
    .join('')
}

/**
 * The genres an album is filed under.
 *
 * MusicBrainz wins outright when it has anything, rather than being unioned
 * with Plex's. A union would keep Plex's inconsistent spellings alive next to
 * MB's clean ones and re-fragment the rail — the whole point of the backfill
 * is that one album's genres all come from one vocabulary. Plex is the
 * fallback for the ~25% of albums MB has no genres for, and for anything with
 * no MBID at all.
 *
 * Returns display-cased names, deduped by {@link normalizeGenre}, source order
 * preserved.
 */
export function effectiveGenres(
  mbGenres: string[] | undefined,
  plexGenres: string[]
): string[] {
  const source = mbGenres && mbGenres.length > 0 ? mbGenres : plexGenres
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of source) {
    const name = raw.trim()
    if (!name) continue
    const key = normalizeGenre(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(displayGenre(name))
  }
  return out
}
