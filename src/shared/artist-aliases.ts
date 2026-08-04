// Canonical keys for cross-referencing venue billings against the library.
// Two layers:
//
//   1. Normalization — lowercase, collapsed whitespace, leading "The "/"Thee "
//      stripped. Venues bill "The Uranium Club" where the library says
//      "Uranium Club"; Thee Oh Sees / Oh Sees, etc. Both sides of a match go
//      through the same normalization, so the article never decides a match.
//   2. Alias groups — acts that gig under genuinely different names. Each
//      group lists every known billing (post-normalization form); all members
//      resolve to the same key. Grow this list as mismatches turn up.
const ALIAS_GROUPS: string[][] = [
  // Bills as both, MB has both forms; the user's library may have either.
  ['uranium club', 'minneapolis uranium club', 'the minneapolis uranium club']
]

const ALIAS_CANONICAL = new Map<string, string>()
for (const group of ALIAS_GROUPS) {
  for (const name of group) ALIAS_CANONICAL.set(normalize(name), normalize(group[0]))
}

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // "&" and "and" are interchangeable in billings — venues print
    // "Belle & Sebastian", the library/MB has "Belle and Sebastian". Fold
    // both to "and" so the ampersand never decides a match.
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .replace(/^thee?\s+/, '')
}

/** Canonical lookup key for an artist name — use for BOTH sides of any
 *  venue-billing ↔ library comparison. */
export function canonicalArtistKey(name: string): string {
  const key = normalize(name)
  return ALIAS_CANONICAL.get(key) ?? key
}
