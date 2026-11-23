// A song grabbed off Soulseek to fill a playlist gap, tracked from enqueue to
// its landing in the Singles bin. The playlist import's "queue all songs"
// registers one per enqueued file; main's auto-singles loop watches slskd for
// the transfer to finish, then files the lone track through the tagger's
// apply-single (album="Singles" per artist) and tells the renderer, which
// refills the playlist. Nothing here is an album job — AcquisitionJob stays
// for folders with a MusicBrainz release behind them.

export type PendingSingleStatus = 'queued' | 'filed' | 'failed'

export interface PendingSingle {
  id: string
  /** The import report this gap belongs to — what to refill once it lands. */
  playlistId: string
  /** The gap as the playlist named it; these become the file's tags, so the
   *  re-import matches on exactly the strings it searched for. */
  artist: string
  title: string
  username: string
  /** Remote path as slskd knows it (the transfer key). */
  filename: string
  size: number
  status: PendingSingleStatus
  note: string | null
  queuedAt: string
  updatedAt: string
  filedAt: string | null
  /** Sweeps spent waiting for the finished file to show up in the inbox. */
  inboxAttempts?: number
}

export interface SingleFiledEvent {
  playlistId: string
  artist: string
  title: string
}
