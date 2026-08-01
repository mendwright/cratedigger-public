import type { ArtFixCandidate } from './plex.js'

// Pure helpers for the Art Fixer's candidate handling — kept out of the main
// process so they're unit-testable without network/Electron.

// Words that mark a release as something other than the plain original edition.
// Jay prefers original/standard releases (CLAUDE.md feedback_bio / editions
// guardrail), so a match here is a yellow flag, not a disqualifier.
const ALT_EDITION = /\b(deluxe|expanded|remaster(ed)?|bonus|anniversary|special\s+edition|super\s+deluxe|collector'?s|reissue)\b/i

export function isAltEdition(title: string | null | undefined): boolean {
  return !!title && ALT_EDITION.test(title)
}

// Rank candidates "highest-res-correct first": by measured shorter side
// descending, but demote alt-editions below plain editions of comparable size
// so the standard release wins ties. Unmeasured candidates (short === null)
// sort last. Stable for equal keys (preserves source insertion order).
export function rankCandidates(cands: ArtFixCandidate[]): ArtFixCandidate[] {
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      // Plain editions outrank alt-editions outright.
      if (a.c.altEdition !== b.c.altEdition) return a.c.altEdition ? 1 : -1
      const as = a.c.short ?? -1
      const bs = b.c.short ?? -1
      if (as !== bs) return bs - as
      return a.i - b.i
    })
    .map((x) => x.c)
}
