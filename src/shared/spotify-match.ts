import type { SearchTrack } from './plex'
import type { SpotifyTrack } from './spotify'
import { compactTitle, normalizeTitle, stripEditionSuffix } from './title-match'

// Match one Spotify track against Plex search results. Pure — the caller
// runs the Plex search and hands over the candidates.
//
// Scoring, not a cascade: Spotify and Plex disagree constantly on
// punctuation, feat.-credits, and remaster suffixes, so we score every
// candidate and take the best above a floor.
//   title  normalize-equal +4, compact-equal +3 (else reject)
//   artist normalize-equal +3, compact-equal +2, one-contains-the-other +1
//          (Spotify joins multi-artist credits with ", " — containment
//          catches "Vince Staples" inside "Vince Staples, Kilo Kish")
//   duration within 3s +2, within 10s +1, >30s apart −2
//   album  normalize-equal +1 (tiebreak only — compilations relocate tracks)
// Floor: title must match at one of the two strengths AND artist must score
// ≥1 — a same-titled song by an unrelated artist never wins.

export interface SpotifyMatchResult {
  track: SearchTrack
  score: number
}

function artistScore(spotifyArtist: string, plexArtist: string): number {
  const sn = normalizeTitle(spotifyArtist)
  const pn = normalizeTitle(plexArtist)
  if (!sn || !pn) return 0
  if (sn === pn) return 3
  const sc = compactTitle(spotifyArtist)
  const pc = compactTitle(plexArtist)
  if (sc === pc) return 2
  if (sn.includes(pn) || pn.includes(sn)) return 1
  return 0
}

export function scoreCandidate(spotify: SpotifyTrack, candidate: SearchTrack): number | null {
  // Dash-suffix qualifiers ("… - Remastered 2003") are stripped from BOTH
  // sides before comparing — normalizeTitle only handles parentheticals, so
  // without this a remaster-suffixed Spotify title can never equal the plain
  // Plex track title and the track reads as a false gap.
  const st = stripEditionSuffix(spotify.title)
  const ct = stripEditionSuffix(candidate.title)
  const stn = normalizeTitle(st)
  const ctn = normalizeTitle(ct)
  let score = 0
  if (stn && stn === ctn) {
    score += 4
  } else if (compactTitle(st) === compactTitle(ct) && compactTitle(st)) {
    score += 3
  } else {
    return null
  }

  const a = artistScore(spotify.artist, candidate.artist)
  if (a === 0) return null
  score += a

  if (spotify.durationMs !== null && candidate.duration !== null) {
    const gap = Math.abs(spotify.durationMs - candidate.duration)
    if (gap <= 3000) score += 2
    else if (gap <= 10000) score += 1
    else if (gap > 30000) score -= 2
  }

  if (normalizeTitle(spotify.album) && normalizeTitle(spotify.album) === normalizeTitle(candidate.album)) {
    score += 1
  }

  return score
}

/** Best candidate above the floor, or null (a gap). */
export function bestPlexMatch(
  spotify: SpotifyTrack,
  candidates: SearchTrack[]
): SpotifyMatchResult | null {
  let best: SpotifyMatchResult | null = null
  for (const c of candidates) {
    const score = scoreCandidate(spotify, c)
    if (score === null) continue
    if (!best || score > best.score) best = { track: c, score }
  }
  return best
}

// The Plex search query for a Spotify track. Title-only: Plex's /hubs/search
// matches track titles well but over-filters when the artist string is
// glued on, and the scorer rejects wrong-artist candidates anyway.
// Parentheticals and " - Remastered"-style dash suffixes are stripped —
// they are the top cause of zero-hit searches.
export function plexQueryFor(spotify: SpotifyTrack): string {
  return normalizeTitle(stripEditionSuffix(spotify.title)) || spotify.title
}
