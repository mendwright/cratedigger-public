import type { AcquisitionIntent, AcquisitionJob } from './acquisition'

export interface SlskdFile {
  filename: string
  size: number
  bitRate: number | null
  length: number | null
  extension: string
}

export interface SlskdAlbumCandidate {
  username: string
  hasFreeUploadSlot: boolean
  uploadSpeed: number
  queueLength: number
  folder: string
  guessedArtist: string | null
  guessedAlbum: string | null
  files: SlskdFile[]
  score: number
  avgMatchScore: number
  avgQualityScore: number
  formatSummary: string
  // Number of expected MB track titles this candidate covers (0 if no MB data).
  matchedTracks: number
  // Durable reputation from albums Cratedigger previously downloaded successfully.
  successfulAlbums: number
  historicalAverageSpeed: number
}

export interface SlskdPeerHistory {
  successfulAlbums: number
  successfulFiles: number
  averageSpeed: number
  lastSuccessAt: string
}

export interface SlskdSuccessfulPeer extends SlskdPeerHistory {
  username: string
}

/** One audio-bearing folder from a Soulseek user's shared library. */
export interface SlskdBrowseAlbum {
  folder: string
  name: string
  guessedArtist: string | null
  guessedAlbum: string | null
  files: SlskdFile[]
  formatSummary: string
}

export interface SlskdUserBrowse {
  username: string
  albums: SlskdBrowseAlbum[]
  directoryCount: number
  fileCount: number
}

export interface SlskdAlbumGroup {
  key: string
  displayArtist: string
  displayAlbum: string
  primary: SlskdAlbumCandidate
  alternates: SlskdAlbumCandidate[]
}

export interface SlskdReleaseHint {
  mbid: string
  title: string
  artistName: string
  date: string | null
  expectedTrackCount: number
}

export interface SlskdSearchResult {
  query: { artist: string; album: string }
  candidates: SlskdAlbumCandidate[]
  albums: SlskdAlbumGroup[]
  release: SlskdReleaseHint | null
  responseCount: number
  complete: boolean
  elapsedMs: number
}

export interface SlskdEnqueueRequest {
  username: string
  files: { filename: string; size: number }[]
  /** Present for album acquisitions started by Cratedigger's search UI. */
  intent?: AcquisitionIntent
}

export interface SlskdEnqueueResult {
  taskId?: string
  username: string
  accepted: number
  alreadyInProgress: number
  errors: { filename: string; error: string }[]
}

export interface SlskdHealth {
  ok: boolean
  url: string
  reachable: boolean
  version: string | null
  error: string | null
}

export interface SlskdDownloadFile {
  id: string
  filename: string
  state: string
  percent: number
  size: number
  bytesTransferred: number
  averageSpeed: number
  startedAt: string | null
  endedAt: string | null
}

export interface SlskdDownloadDir {
  directory: string
  files: SlskdDownloadFile[]
}

export interface SlskdDownloadUser {
  username: string
  directories: SlskdDownloadDir[]
  totalFiles: number
  inProgressFiles: number
  completedFiles: number
  erroredFiles: number
}

export interface SlskdDownloads {
  users: SlskdDownloadUser[]
  totals: {
    files: number
    inProgress: number
    completed: number
    errored: number
    queued: number
  }
  /** Cratedigger's durable album-level history, reconciled against these transfers. */
  acquisitions?: AcquisitionJob[]
}
