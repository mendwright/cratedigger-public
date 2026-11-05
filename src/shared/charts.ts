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
}

/** "48 min" under an hour, "5.9 h" above, "31 h" once decimals stop mattering. */
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
