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
  ratingKey: string | null
  thumb: string | null
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
