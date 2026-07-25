import { randomUUID } from 'node:crypto'
import type { ApplyOrPreviewResult } from '../shared/tagger.js'
import type { AcquisitionIntent, AcquisitionJob } from '../shared/acquisition.js'
import type { SlskdDownloads, SlskdEnqueueResult } from '../shared/slskd.js'
import { getValue, setValue } from './store.js'

const MAX_JOBS = 200

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
    completedAt: null
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
  save({
    ...job,
    files,
    status: accepted > 0 ? 'downloading' : 'failed',
    error: result.errors.length ? `${result.errors.length} file(s) failed to enqueue` : null,
    updatedAt: new Date().toISOString(),
    completedAt: accepted > 0 ? null : new Date().toISOString()
  })
}

export function failEnqueue(jobId: string, error: string): void {
  const job = getValue('acquisitionJobs').find((j) => j.id === jobId)
  if (!job) return
  const now = new Date().toISOString()
  save({
    ...job,
    status: 'failed',
    files: job.files.map((f) => ({ ...f, status: 'failed', error })),
    error,
    updatedAt: now,
    completedAt: now
  })
}

export function reconcileAcquisitions(downloads: SlskdDownloads): AcquisitionJob[] {
  const transfers = new Map<string, { state: string; percent: number }>()
  for (const user of downloads.users) {
    for (const dir of user.directories) {
      for (const file of dir.files) transfers.set(`${user.username}\0${file.filename}`, file)
    }
  }

  const jobs = getValue('acquisitionJobs').map((job) => {
    if (!['downloading', 'downloaded'].includes(job.status)) return job
    let changed = false
    const files = job.files.map((file) => {
      if (['failed', 'imported', 'skipped'].includes(file.status)) return file
      const transfer = transfers.get(`${job.username}\0${file.filename}`)
      if (!transfer) return file
      const state = transfer.state.toLowerCase()
      const next = state.includes('succeeded')
        ? 'downloaded'
        : state.includes('errored') || state.includes('rejected') || state.includes('cancelled') || state.includes('timedout')
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
    return {
      ...job,
      files,
      status: allFailed ? 'failed' as const : allDownloaded ? 'downloaded' as const : 'downloading' as const,
      updatedAt: new Date().toISOString(),
      completedAt: allFailed ? new Date().toISOString() : null
    }
  })
  setValue('acquisitionJobs', jobs)
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
  save({
    ...job,
    files,
    status: complete ? 'completed' : imported > 0 ? 'partial' : 'failed',
    error: complete ? null : `${missing || files.length - imported} expected track(s) were not imported`,
    updatedAt: now,
    completedAt: now
  })
}
