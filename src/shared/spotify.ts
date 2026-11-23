// Spotify import types — shared across IPC.

export interface SpotifyStatus {
  // Client ID pasted in settings (the user's own free Spotify dev app).
  configured: boolean
  // A refresh token is stored — API calls will work without re-auth.
  connected: boolean
}

export interface SpotifyPlaylistSummary {
  id: string
  name: string
  trackCount: number
  // Playlist owner display name — collaborative/followed lists show whose.
  owner: string
}

export interface SpotifyTrack {
  artist: string
  title: string
  album: string
  durationMs: number | null
  // Spotify "local files" — text metadata only, often odd; flagged so the
  // gap report can say why a match was unlikely.
  isLocal: boolean
}

// One unmatched track from an import — persisted so the gap report survives
// restarts and can be re-checked after acquisitions land.
export interface SpotifyGap {
  artist: string
  title: string
  album: string
  durationMs: number | null
}

// One source-position-preserving entry from an imported playlist. Plex can
// only store library tracks, so unmatched entries live here while matched
// entries point at the corresponding Plex track. Keeping both in one ordered
// list lets Cratedigger remain a faithful view of the source playlist.
export interface SpotifyImportEntry extends SpotifyGap {
  matchedRatingKey: string | null
}

export interface SpotifyImportReport {
  playlistId: string
  name: string
  // The Plex playlist the matched tracks were written into.
  plexRatingKey: string
  importedAt: number
  total: number
  matchedCount: number
  gaps: SpotifyGap[]
  // Optional for reports written before ordered import entries existed. A
  // re-import upgrades those reports; old ones retain the legacy gap section.
  entries?: SpotifyImportEntry[]
}
