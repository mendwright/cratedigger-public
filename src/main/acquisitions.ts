import { randomUUID } from 'node:crypto'
import type { ApplyOrPreviewResult } from '../shared/tagger.js'
import type { AcquisitionExpectedFile, AcquisitionIntent, AcquisitionJob } from '../shared/acquisition.js'
import type { SlskdDownloads, SlskdEnqueueResult } from '../shared/slskd.js'
import type { SlskdPeerHistory, SlskdSuccessfulPeer } from '../shared/slskd.js'
import { getValue, setValue } from './store.js'

const MAX_JOBS = 200

function recordPeerSuccess(
  username: string,
  fileCount: number,
  averageSpeed: number,
  at: string,
  history: Record<string, SlskdPeerHistory>
): void {
  const previous = history[username]
  const previousAlbums = previous?.successfulAlbums ?? 0
  history[username] = {
    successfulAlbums: previousAlbums + 1,
    successfulFiles: (previous?.successfulFiles ?? 0) + fileCount,
    averageSpeed: averageSpeed > 0
      ? Math.round(((previous?.averageSpeed ?? 0) * previousAlbums + averageSpeed) / (previousAlbums + 1))
      : previous?.averageSpeed ?? 0,
    lastSuccessAt: at
  }
}

function recordPeerFailure(
  username: string,
  at: string,
  history: Record<string, SlskdPeerHistory>
): void {
  const previous = history[username]
  history[username] = {
    successfulAlbums: previous?.successfulAlbums ?? 0,
    failedAlbums: (previous?.failedAlbums ?? 0) + 1,
    successfulFiles: previous?.successfulFiles ?? 0,
    averageSpeed: previous?.averageSpeed ?? 0,
    lastSuccessAt: previous?.lastSuccessAt ?? ''
  }
}

/**
 * Fold older durable acquisition jobs into the uncapped peer ledger. Jobs
 * written before the ledger shipped have no marker, so this is an idempotent
 * one-time migration as well as the read path for the Uploaders screen.
 */
export function getSlskdPeerHistory(): Record<string, SlskdPeerHistory> {
  const history = getValue('slskdPeerHistory')
  const jobs = getValue('acquisitionJobs')
  let changed = false
  const migrated = jobs.map((job) => {
    const at = job.completedAt ?? job.updatedAt
    if (!job.peerSuccessRecordedAt && ['downloaded', 'completed', 'partial'].includes(job.status)) {
      recordPeerSuccess(job.username, job.files.length, 0, at, history)
      changed = true
      return { ...job, peerSuccessRecordedAt: at }
    }
    if (!job.peerFailureRecordedAt && job.status === 'failed') {
      recordPeerFailure(job.username, at, history)
      changed = true
      return { ...job, peerFailureRecordedAt: at }
    }
    return job
  })
  if (changed) {
    setValue('slskdPeerHistory', history)
    setValue('acquisitionJobs', migrated)
  }
  return history
}

export function listSuccessfulPeers(): SlskdSuccessfulPeer[] {
  return Object.entries(getSlskdPeerHistory())
    .map(([username, stats]) => ({ username, ...stats }))
    .filter((peer) => peer.successfulAlbums > 0)
    .sort((a, b) =>
      b.successfulAlbums - a.successfulAlbums ||
      b.lastSuccessAt.localeCompare(a.lastSuccessAt) ||
      a.username.localeCompare(b.username)
    )
}

function leaf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function relativeToFolder(filePath: string, folderPath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  const folderName = leaf(folderPath)
  const folderIndex = parts.lastIndexOf(folderName)
  return folderIndex >= 0 ? parts.slice(folderIndex + 1).join('/') : leaf(filePath)
}

function save(job: AcquisitionJob): AcquisitionJob {
  const jobs = getValue('acquisitionJobs').filter((j) => j.id !== job.id)
  setValue('acquisitionJobs', [job, ...jobs].slice(0, MAX_JOBS))
  return job
}

export function beginAcquisition(username: string, intent: AcquisitionIntent): AcquisitionJob {
  const now = new Date().toISOString()
  return save({
    id: randomUUID(),
    source: 'slskd',
    username,
    artist: intent.artist,
    album: intent.album,
    folder: intent.folder,
    releaseMbid: intent.releaseMbid,
    expectedTrackCount: intent.expectedTrackCount,
    status: 'enqueueing',
    files: intent.files.map((file) => ({
      ...file,
      status: 'queued',
      error: null,
      destination: null
    })),
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    peerSuccessRecordedAt: null,
    peerFailureRecordedAt: null
  })
}

export function finishEnqueue(jobId: string, result: SlskdEnqueueResult): void {
  const job = getValue('acquisitionJobs').find((j) => j.id === jobId)
  if (!job) return
  const errors = new Map(result.errors.map((e) => [e.filename, e.error]))
  const files = job.files.map((file) => {
    const error = errors.get(file.filename) ?? null
    return { ...file, status: error ? 'failed' as const : 'queued' as const, error }
  })
  const accepted = files.filter((f) => f.status !== 'failed').length
  const now = new Date().toISOString()
  let peerFailureRecordedAt = job.peerFailureRecordedAt ?? null
  if (accepted === 0 && !peerFailureRecordedAt) {
    const history = getValue('slskdPeerHistory')
    recordPeerFailure(job.username, now, history)
    setValue('slskdPeerHistory', history)
    peerFailureRecordedAt = now
  }
  save({
    ...job,
    files,
    status: accepted > 0 ? 'downloading' : 'failed',
    error: result.errors.length ? `${result.errors.length} file(s) failed to enqueue` : null,
    updatedAt: now,
    completedAt: accepted > 0 ? null : now,
    peerFailureRecordedAt
  })
}

export function failEnqueue(jobId: string, error: string): void {
  const job = getValue('acquisitionJobs').find((j) => j.id === jobId)
  if (!job) return
  const now = new Date().toISOString()
  let peerFailureRecordedAt = job.peerFailureRecordedAt ?? null
  if (!peerFailureRecordedAt) {
    const history = getValue('slskdPeerHistory')
    recordPeerFailure(job.username, now, history)
    setValue('slskdPeerHistory', history)
    peerFailureRecordedAt = now
  }
  save({
    ...job,
    status: 'failed',
    files: job.files.map((f) => ({ ...f, status: 'failed', error })),
    error,
    updatedAt: now,
    completedAt: now,
    peerFailureRecordedAt
  })
}

/**
 * A job still "downloading" whose transfers have all left slskd's list — the
 * user cleared them, or slskd restarted and forgot — would otherwise sit at
 * downloading forever, since reconcile only moves files it can see. Once the
 * job is this old with nothing in flight, call the missing files failed so
 * the row resolves and the retry button applies.
 */
const VANISHED_TRANSFER_GRACE_MS = 10 * 60_000

export function reconcileAcquisitions(
  downloads: SlskdDownloads,
  now: number = Date.now()
): AcquisitionJob[] {
  const transfers = new Map<string, { state: string; percent: number; averageSpeed: number }>()
  for (const user of downloads.users) {
    for (const dir of user.directories) {
      for (const file of dir.files) transfers.set(`${user.username}\0${file.filename}`, file)
    }
  }

  const peerHistory = getValue('slskdPeerHistory')
  let peerHistoryChanged = false
  const jobs = getValue('acquisitionJobs').map((job) => {
    if (!['downloading', 'downloaded'].includes(job.status)) return job
    let changed = false
    const anyTransferPresent = job.files.some((f) => transfers.has(`${job.username}\0${f.filename}`))
    const vanished =
      job.status === 'downloading' &&
      !anyTransferPresent &&
      now - Date.parse(job.updatedAt) > VANISHED_TRANSFER_GRACE_MS
    const files = job.files.map((file) => {
      if (['failed', 'imported', 'skipped'].includes(file.status)) return file
      const transfer = transfers.get(`${job.username}\0${file.filename}`)
      if (!transfer) {
        if (vanished && file.status !== 'downloaded') {
          changed = true
          return { ...file, status: 'failed' as const, error: 'transfer gone from slskd' }
        }
        return file
      }
      const state = transfer.state.toLowerCase()
      const next = state.includes('succeeded')
        ? 'downloaded'
        : state.includes('errored') || state.includes('rejected') || state.includes('cancelled') || state.includes('timedout') || state.includes('aborted')
          ? 'failed'
          : transfer.percent > 0 ? 'downloading' : 'queued'
      if (next === file.status) return file
      changed = true
      return { ...file, status: next as typeof file.status, error: next === 'failed' ? transfer.state : null }
    })
    if (!changed) return job
    const viable = files.filter((f) => f.status !== 'failed')
    const allDownloaded = viable.length > 0 && viable.every((f) => f.status === 'downloaded')
    const allFailed = viable.length === 0
    const fullyDownloaded = files.length > 0 && files.every((f) => f.status === 'downloaded')
    const nowIso = new Date(now).toISOString()
    let peerSuccessRecordedAt = job.peerSuccessRecordedAt ?? null
    let peerFailureRecordedAt = job.peerFailureRecordedAt ?? null
    if (fullyDownloaded && !peerSuccessRecordedAt) {
      const speeds = job.files
        .map((f) => transfers.get(`${job.username}\0${f.filename}`)?.averageSpeed ?? 0)
        .filter((speed) => speed > 0)
      const averageSpeed = speeds.length > 0
        ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length
        : 0
      peerSuccessRecordedAt = nowIso
      recordPeerSuccess(job.username, files.length, averageSpeed, nowIso, peerHistory)
      peerHistoryChanged = true
    }
    if (allFailed && !peerFailureRecordedAt) {
      peerFailureRecordedAt = nowIso
      recordPeerFailure(job.username, nowIso, peerHistory)
      peerHistoryChanged = true
    }
    return {
      ...job,
      files,
      status: allFailed ? 'failed' as const : allDownloaded ? 'downloaded' as const : 'downloading' as const,
      updatedAt: nowIso,
      completedAt: allFailed ? nowIso : null,
      peerSuccessRecordedAt,
      peerFailureRecordedAt
    }
  })
  setValue('acquisitionJobs', jobs)
  if (peerHistoryChanged) setValue('slskdPeerHistory', peerHistory)
  return jobs
}

export function recordImport(
  folderPath: string,
  releaseMbid: string,
  result: ApplyOrPreviewResult
): void {
  if (!result.ok || result.mode === 'preview') return
  const job = getValue('acquisitionJobs').find(
    (j) => leaf(j.folder) === leaf(folderPath) && (!j.releaseMbid || j.releaseMbid === releaseMbid)
  )
  if (!job) return
  const moved = new Map(
    (result.moved ?? result.moves ?? []).map((m) => [relativeToFolder(m.src, folderPath), m.dst])
  )
  const files = job.files.map((file) => {
    if (file.status === 'failed') return file
    const destination = moved.get(relativeToFolder(file.filename, job.folder)) ?? null
    return destination
      ? { ...file, status: 'imported' as const, destination, error: null }
      : { ...file, status: 'skipped' as const, destination: null }
  })
  const imported = files.filter((f) => f.status === 'imported').length
  const expected = job.expectedTrackCount ?? files.length
  const missing = Math.max(0, expected - imported)
  const complete = imported === files.length && imported >= expected
  const now = new Date().toISOString()
  let peerSuccessRecordedAt = job.peerSuccessRecordedAt ?? null
  if (imported > 0 && !peerSuccessRecordedAt) {
    const peerHistory = getValue('slskdPeerHistory')
    recordPeerSuccess(job.username, files.length, 0, now, peerHistory)
    setValue('slskdPeerHistory', peerHistory)
    peerSuccessRecordedAt = now
  }
  save({
    ...job,
    files,
    status: complete ? 'completed' : imported > 0 ? 'partial' : 'failed',
    error: complete ? null : `${missing || files.length - imported} expected track(s) were not imported`,
    updatedAt: now,
    completedAt: now,
    peerSuccessRecordedAt
  })
}

/** Files of a job that never landed: failed outright, or still queued after
 *  slskd forgot them. What a job-level retry re-asks the peer for. */
export function filesToRetry(job: AcquisitionJob): AcquisitionExpectedFile[] {
  return job.files
    .filter((f) => f.status === 'failed' || f.status === 'queued' || f.status === 'downloading')
    .map(({ filename, size, durationSeconds }) => ({ filename, size, durationSeconds }))
}

/**
 * After re-enqueueing a job's missing files with the same peer: the ones slskd
 * accepted go back to queued, the ones it refused stay failed with the new
 * reason, and the job is downloading again with any previous auto-import
 * verdict cleared so a clean landing gets imported hands-free.
 */
export function markRetried(jobId: string, result: SlskdEnqueueResult): AcquisitionJob | null {
  const job = getValue('acquisitionJobs').find((j) => j.id === jobId)
  if (!job) return null
  const retried = new Set(filesToRetry(job).map((f) => f.filename))
  const errors = new Map(result.errors.map((e) => [e.filename, e.error]))
  const files = job.files.map((file) => {
    if (!retried.has(file.filename)) return file
    const error = errors.get(file.filename)
    return error
      ? { ...file, status: 'failed' as const, error }
      : { ...file, status: 'queued' as const, error: null }
  })
  const accepted = files.filter((f) => f.status === 'queued').length
  const now = new Date().toISOString()
  return save({
    ...job,
    files,
    status: accepted > 0 ? 'downloading' : job.status === 'failed' ? 'failed' : job.status,
    error: result.errors.length ? `${result.errors.length} file(s) failed to enqueue` : null,
    updatedAt: now,
    completedAt: accepted > 0 ? null : job.completedAt,
    autoImportAt: null,
    autoImportOutcome: null,
    autoImportNote: null,
    autoImportAttempts: 0
  })
}
