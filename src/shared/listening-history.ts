// Long-run listening history: one person's plays merged from a Last.fm
// export (2005 →), the Plex/Tautulli log and, later, Spotify / Apple Music
// exports. The tagger holds it privately and serves it behind its API key
// (service/app/history.py); the main process fetches it for the signed-in
// Plex account and the renderer shows it as year charts + "your plays" on
// album and artist pages.

export interface HistoryYear {
  year: number
  plays: number
  seconds: number
}

export interface HistorySource {
  name: string
  plays: number
  first: number | null
  last: number | null
}

export interface HistorySummary {
  profile: string
  plays: number
  seconds: number
  first: number | null
  last: number | null
  years: HistoryYear[]
  sources: HistorySource[]
}

export interface HistoryItemStats {
  plays: number
  seconds: number
  first: number | null
  last: number | null
  years: { year: number; plays: number; seconds?: number }[]
}

/** Unix-seconds [start, end) for a calendar year in local time. */
export function yearBounds(year: number): { start: number; end: number } {
  return {
    start: Math.floor(new Date(year, 0, 1).getTime() / 1000),
    end: Math.floor(new Date(year + 1, 0, 1).getTime() / 1000)
  }
}

/** "Mar 2007" for a unix-seconds timestamp. */
export function monthYear(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export interface HistoryArtistStats {
  years: HistoryYear[]
  first: number | null
  plays: number
  seconds: number
}

export interface HistoryReview {
  plays: number
  seconds: number
  topArtist: import('./charts').ChartEntry | null
  topAlbum: import('./charts').ChartEntry | null
  topTrack: import('./charts').ChartEntry | null
  newArtistCount: number
  newArtists: import('./charts').ChartEntry[]
}
