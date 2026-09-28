export type AcquisitionStatus =
  | 'enqueueing'
  | 'downloading'
  | 'downloaded'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'

export type AcquisitionFileStatus =
  | 'queued'
  | 'downloading'
  | 'downloaded'
  | 'imported'
  | 'skipped'
  | 'failed'

export interface AcquisitionExpectedFile {
  filename: string
  size: number
  durationSeconds: number | null
}

export interface AcquisitionFileOutcome extends AcquisitionExpectedFile {
  status: AcquisitionFileStatus
  error: string | null
  destination: string | null
}

/** Durable intent captured before slskd is called. */
export interface AcquisitionIntent {
  artist: string
  album: string
  folder: string
  releaseMbid: string | null
  expectedTrackCount: number | null
  files: AcquisitionExpectedFile[]
}

/** Persisted correlation record for one selected Soulseek album folder. */
export interface AcquisitionJob {
  id: string
  source: 'slskd'
  username: string
  artist: string
  album: string
  folder: string
  releaseMbid: string | null
  expectedTrackCount: number | null
  status: AcquisitionStatus
  files: AcquisitionFileOutcome[]
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Prevents one completed transfer from incrementing peer reputation twice. */
  peerSuccessRecordedAt?: string | null
  /** Prevents one terminally failed album from incrementing peer history twice. */
  peerFailureRecordedAt?: string | null
  /** Set once when the auto-importer first takes the job; prevents re-entry. */
  autoImportAt?: string | null
  /** Polls spent waiting for the downloaded folder to appear in the tagger inbox. */
  autoImportAttempts?: number
  /**
   * How the hands-free import ended. 'imported' = tagged + moved + Plex
   * refreshed with no human involved. 'needs-review' = downloaded fine but the
   * reconcile wasn't clean (or the tagger refused) — the folder waits in the
   * Inbox for the normal manual flow, with the reason in autoImportNote.
   * 'in-library' = the folder was gone from the Inbox but the album is already
   * in the Plex library — it was imported by hand before the automation got
   * to it, so there is nothing left to do.
   */
  autoImportOutcome?: 'imported' | 'needs-review' | 'in-library' | null
  autoImportNote?: string | null
}
