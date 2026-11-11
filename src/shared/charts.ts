// Listening-charts types, shared across processes. Data originates from a
// Tautulli instance (Plex stats server) which — unlike Cratedigger's own
// non-owner Plex session — sees every user's play history. The main process
// aggregates Tautulli's per-play history into these shapes; the renderer just
// renders them.

export type ChartWindow = 'week' | 'month' | 'year' | 'all'
export type ChartDimension = 'artists' | 'albums' | 'tracks'

// A person who has music plays on the server. `userId` is Tautulli's/Plex's
// account id; `trackPlays` is their lifetime track-play count (for sorting the
// picker and hiding video-only watchers).
export interface ChartUser {
  userId: number
  name: string
  thumb: string | null
  trackPlays: number
}

// One ranked row in a chart. `ratingKey` is the Plex key for the item
// (grandparent for an artist, parent for an album, the track itself) so the UI
// can deep-link into Cratedigger's own album / entity views.
export interface ChartEntry {
  rank: number
  title: string
  subtitle: string | null // artist name for album/track rows; null for artists
  plays: number
  // Time actually listened, in seconds (Tautulli logs per-play duration, so a
  // skipped track barely counts). This is the ranking metric; plays is shown
  // as the secondary number. 0 on entries from a snapshot that predates it.
  seconds: number
  ratingKey: string | null
  thumb: string | null
  // Outside cover URL (Last.fm) for history entries that aren't in the Plex
  // library, so they still get a picture. Plex `thumb` wins when both exist.
  art?: string | null
  // Tracks retain their album name for cover matching when Plex keys are absent.
  album?: string | null
}

/** "48 min" under an hour, "5.9 h" above, "31 h" once decimals stop mattering. */
/**
 * Chart ranking. Artists and albums rank by time listened (play counts would
 * crown whoever has the shortest tracks); tracks rank by plays, since a track
 * is already one unit and a single 25-minute drone shouldn't outrank a song
 * played twenty times. The other measure breaks ties.
 */
export function compareChartRows(
  dimension: ChartDimension
): (a: { plays: number; seconds?: number | null }, b: { plays: number; seconds?: number | null }) => number {
  return dimension === 'tracks'
    ? (a, b) => b.plays - a.plays || (b.seconds ?? 0) - (a.seconds ?? 0)
    : (a, b) => (b.seconds ?? 0) - (a.seconds ?? 0) || b.plays - a.plays
}

/** "1 play" / "1,234 plays". */
export function formatPlays(plays: number): string {
  return `${plays.toLocaleString()} ${plays === 1 ? 'play' : 'plays'}`
}

export function formatListened(seconds: number): string {
  const h = seconds / 3600
  if (h < 1) return `${Math.max(1, Math.round(seconds / 60))} min`
  if (h < 10) return `${h.toFixed(1).replace(/\.0$/, '')} h`
  return `${Math.round(h)} h`
}

export interface ChartResult {
  dimension: ChartDimension
  window: ChartWindow
  userIds: number[]
  entries: ChartEntry[]
}

export interface TautulliConfig {
  url: string
  apiKey: string
}

export interface TautulliHealth {
  ok: boolean
  message?: string
}

/** Account/server-scoped local cache. Never exported to the public snapshot. */
export interface ChartsCachedView {
  result?: ChartResult | null
  users?: ChartUser[]
  history?: import('./listening-history').HistorySummary | null
  review?: import('./listening-history').HistoryReview | null
}
