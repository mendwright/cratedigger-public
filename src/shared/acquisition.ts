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
}
