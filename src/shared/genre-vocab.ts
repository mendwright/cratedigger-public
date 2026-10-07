import { normalizeGenre, compactGenre } from './genre-text.js'

// Deciding whether a Last.fm tag is a genre.
//
// Last.fm tags are folksonomy — anyone can write anything — so a raw album's
// top tags mix real genres with years ("2025"), decades ("80s"), record labels
// ("domino"), the artist's own name ("bill evans"), moods ("dark", "driving"),
// and personal list-keeping ("my gang 09", "seen live"). Dropped into the crate
// rail unfiltered they'd be worse than the Plex tags we're replacing.
//
// Rather than hand-maintain a blocklist of junk (unbounded, and it would have
// to grow forever), we check each tag against MusicBrainz's own genre
// vocabulary — ~2,200 curated genre names, fetched from /genre/all. A tag is a
// genre if MB says a genre by that name exists. That keeps the long tail we
// actually want ("isicathamiya", "neo-psychedelia") and drops everything else
// without us having to enumerate it.
//
// Matching is three tiers, mirroring how `title-match.ts` falls back for
// MB-to-Plex album matching:
//   1. strict  — separator- and case-insensitive ("Hip-Hop" = "hip hop")
//   2. compact — separators removed entirely ("synthpop" = "synth-pop")
//   3. alias   — the handful of Last.fm shorthands MB files under another name

/**
 * Last.fm shorthands that are real genres MB happens to file elsewhere.
 * Deliberately small: every entry is a judgement call, so it only holds tags
 * seen often enough in the library to be worth the call. `null` means "this is
 * a common tag but too vague to be a crate" — recorded here so it reads as a
 * decision rather than an oversight.
 */
export const LASTFM_GENRE_ALIASES: Record<string, string | null> = {
  rap: 'hip hop',
  'alt-country': 'alternative country',
  'hair metal': 'glam metal',
  'jazz piano': 'jazz',
  alternative: 'alternative rock',
  // Too broad to file a record under — every one of these lands on hundreds of
  // albums and tells you nothing about what's in the sleeve.
  indie: null,
  oldies: null,
  world: null,
  african: null,
  'south african': null
}

// The alias table re-keyed by strict form, built once at module load — the
// table above is written with whatever spelling reads naturally, which isn't
// always the normalised one ("alt-country" normalises to "alt country").
const ALIASES_BY_KEY = new Map<string, string | null>(
  Object.entries(LASTFM_GENRE_ALIASES).map(([k, v]) => [normalizeGenre(k), v])
)

/** A genre vocabulary keyed for both strict and compact lookup. */
export interface GenreVocabulary {
  strict: Map<string, string>
  compact: Map<string, string>
}

/** Build the lookup maps from MB's raw genre-name list. */
export function buildGenreVocabulary(names: string[]): GenreVocabulary {
  const strict = new Map<string, string>()
  const compact = new Map<string, string>()
  for (const name of names) {
    const clean = name.trim()
    if (!clean) continue
    const s = normalizeGenre(clean)
    const c = compactGenre(clean)
    if (s && !strict.has(s)) strict.set(s, clean)
    // First name wins on a compact collision so the result is stable across
    // runs regardless of what order MB paginated them in.
    if (c && !compact.has(c)) compact.set(c, clean)
  }
  return { strict, compact }
}

/**
 * Resolve one Last.fm tag to a canonical MB genre name, or null when the tag
 * isn't a genre. Returning MB's spelling (rather than Last.fm's) is what keeps
 * the whole index in one vocabulary.
 */
export function matchGenreTag(tag: string, vocab: GenreVocabulary): string | null {
  const raw = tag.trim()
  if (!raw) return null

  const strictKey = normalizeGenre(raw)
  const hit = vocab.strict.get(strictKey)
  if (hit) return hit

  const compactHit = vocab.compact.get(compactGenre(raw))
  if (compactHit) return compactHit

  // Aliases are looked up by strict key so "Alt-Country", "alt country" and
  // "alt-country" all find the one entry.
  if (ALIASES_BY_KEY.has(strictKey)) {
    const target = ALIASES_BY_KEY.get(strictKey) ?? null
    if (target === null) return null
    return vocab.strict.get(normalizeGenre(target)) ?? target
  }

  return null
}

/**
 * Filter a raw Last.fm tag list down to genres, in Last.fm's own order (they
 * arrive ranked by how many people applied them, so the first survivor is the
 * most-agreed genre). Deduped, since two tags can resolve to one MB genre —
 * "rap" and "hip hop" on the same album both land on "hip hop".
 */
export function genresFromTags(
  tags: string[],
  vocab: GenreVocabulary,
  limit = 6
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const match = matchGenreTag(tag, vocab)
    if (!match) continue
    const key = normalizeGenre(match)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(match)
    if (out.length >= limit) break
  }
  return out
}
