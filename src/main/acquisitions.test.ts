import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcquisitionJob } from '../shared/acquisition.js'

const h = vi.hoisted(() => ({
  jobs: [] as AcquisitionJob[],
  peers: {} as Record<string, {
    successfulAlbums: number
    failedAlbums?: number
    successfulFiles: number
    averageSpeed: number
    lastSuccessAt: string
  }>
}))

vi.mock('./store.js', () => ({
  getValue: vi.fn((key: string) => key === 'slskdPeerHistory'
    ? { ...h.peers }
    : h.jobs.map((job) => ({ ...job, files: job.files.map((f) => ({ ...f })) }))),
  setValue: vi.fn((key: string, value: AcquisitionJob[] | typeof h.peers) => {
    if (key === 'slskdPeerHistory') h.peers = value as typeof h.peers
    else h.jobs = value as AcquisitionJob[]
  })
}))

import {
  beginAcquisition,
  failEnqueue,
  filesToRetry,
  finishEnqueue,
  listSuccessfulPeers,
  markRetried,
  reconcileAcquisitions,
  recordImport
} from './acquisitions.js'

const intent = {
  artist: 'Spoon',
  album: 'Gimme Fiction',
  folder: '\\music\\Gimme Fiction',
  releaseMbid: 'release-1',
  expectedTrackCount: 2,
  files: [
    { filename: '\\music\\Gimme Fiction\\01.flac', size: 10, durationSeconds: 180 },
    { filename: '\\music\\Gimme Fiction\\02.flac', size: 20, durationSeconds: 200 }
  ]
}

beforeEach(() => {
  h.jobs = []
  h.peers = {}
})

describe('durable acquisitions', () => {
  it('captures the manifest before enqueue and records partial enqueue failures', () => {
    const job = beginAcquisition('alice', intent)
    expect(job.status).toBe('enqueueing')
    expect(job.files.map((f) => f.durationSeconds)).toEqual([180, 200])

    finishEnqueue(job.id, {
      username: 'alice', accepted: 1, alreadyInProgress: 0,
      errors: [{ filename: intent.files[1].filename, error: 'rejected' }]
    })
    expect(h.jobs[0].status).toBe('downloading')
    expect(h.jobs[0].files.map((f) => f.status)).toEqual(['queued', 'failed'])
  })

  it('survives process-shaped reloads and reconciles exact slskd filenames', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    const jobs = reconcileAcquisitions({
      users: [{
        username: 'alice', totalFiles: 2, inProgressFiles: 0, completedFiles: 2, erroredFiles: 0,
        directories: [{ directory: 'Gimme Fiction', files: intent.files.map((f, i) => ({
          id: String(i), filename: f.filename, state: 'Completed, Succeeded', percent: 100,
          size: f.size, bytesTransferred: f.size, averageSpeed: 0, startedAt: null, endedAt: null
        })) }]
      }],
      totals: { files: 2, inProgress: 0, completed: 2, errored: 0, queued: 0 }
    })
    expect(jobs[0].status).toBe('downloaded')
    expect(jobs[0].files.every((f) => f.status === 'downloaded')).toBe(true)
    expect(h.peers.alice).toMatchObject({ successfulAlbums: 1, successfulFiles: 2 })

    reconcileAcquisitions({
      users: [{
        username: 'alice', totalFiles: 2, inProgressFiles: 0, completedFiles: 2, erroredFiles: 0,
        directories: [{ directory: 'Gimme Fiction', files: intent.files.map((f, i) => ({
          id: String(i), filename: f.filename, state: 'Completed, Succeeded', percent: 100,
          size: f.size, bytesTransferred: f.size, averageSpeed: 250_000, startedAt: null, endedAt: null
        })) }]
      }],
      totals: { files: 2, inProgress: 0, completed: 2, errored: 0, queued: 0 }
    })
    expect(h.peers.alice.successfulAlbums).toBe(1)
  })

  it('records per-file imported and skipped outcomes and resolves partial status', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    recordImport('/inbox/Gimme Fiction', 'release-1', {
      ok: true,
      mode: 'commit',
      album: 'Gimme Fiction',
      albumartist: 'Spoon',
      moved: [{ src: '/inbox/Gimme Fiction/01.flac', dst: '/music/Spoon/Gimme Fiction/01.flac' }]
    })
    expect(h.jobs[0].status).toBe('partial')
    expect(h.jobs[0].files.map((f) => f.status)).toEqual(['imported', 'skipped'])
    expect(h.jobs[0].files[0].destination).toContain('/music/Spoon')
  })

  it('keeps a fully imported partial candidate partial against the manifest track count', () => {
    const partialIntent = { ...intent, expectedTrackCount: 3, files: [intent.files[0]] }
    const job = beginAcquisition('alice', partialIntent)
    finishEnqueue(job.id, { username: 'alice', accepted: 1, alreadyInProgress: 0, errors: [] })
    recordImport('/inbox/Gimme Fiction', 'release-1', {
      ok: true,
      mode: 'commit',
      album: 'Gimme Fiction',
      albumartist: 'Spoon',
      moved: [{ src: '/inbox/Gimme Fiction/01.flac', dst: '/music/Spoon/Gimme Fiction/01.flac' }]
    })
    expect(h.jobs[0]).toMatchObject({ status: 'partial', error: '2 expected track(s) were not imported' })
  })

  it('correlates duplicate basenames by their disc-relative paths', () => {
    const multiDisc = {
      ...intent,
      files: [
        { filename: '/remote/Gimme Fiction/CD1/01.flac', size: 10, durationSeconds: 180 },
        { filename: '/remote/Gimme Fiction/CD2/01.flac', size: 10, durationSeconds: 180 }
      ]
    }
    const job = beginAcquisition('alice', multiDisc)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    recordImport('/inbox/Gimme Fiction', 'release-1', {
      ok: true,
      mode: 'commit',
      album: 'Gimme Fiction',
      albumartist: 'Spoon',
      moved: [{ src: '/inbox/Gimme Fiction/CD2/01.flac', dst: '/music/Spoon/Gimme Fiction/CD2/01.flac' }]
    })
    expect(h.jobs[0].files.map((f) => [f.status, f.destination])).toEqual([
      ['skipped', null],
      ['imported', '/music/Spoon/Gimme Fiction/CD2/01.flac']
    ])
  })

  it('persists a terminal failure when enqueue throws', () => {
    const job = beginAcquisition('alice', intent)
    failEnqueue(job.id, 'slskd offline')
    expect(h.jobs[0]).toMatchObject({ status: 'failed', error: 'slskd offline' })
    expect(h.jobs[0].files.every((f) => f.status === 'failed')).toBe(true)
    expect(h.peers.alice).toMatchObject({ failedAlbums: 1 })
    expect(h.jobs[0].peerFailureRecordedAt).toBeTruthy()
    expect(listSuccessfulPeers()).toEqual([])
  })

  it('records a failed album only once when every transfer fails', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    const failedDownloads = {
      users: [{
        username: 'alice', totalFiles: 2, inProgressFiles: 0, completedFiles: 0, erroredFiles: 2,
        directories: [{ directory: 'Gimme Fiction', files: intent.files.map((f, i) => ({
          id: String(i), filename: f.filename, state: 'Completed, Errored', percent: 0,
          size: f.size, bytesTransferred: 0, averageSpeed: 0, startedAt: null, endedAt: null
        })) }]
      }],
      totals: { files: 2, inProgress: 0, completed: 0, errored: 2, queued: 0 }
    }
    reconcileAcquisitions(failedDownloads)
    reconcileAcquisitions(failedDownloads)
    expect(h.peers.alice).toMatchObject({ failedAlbums: 1 })
    expect(h.jobs[0].peerFailureRecordedAt).toBeTruthy()
  })

  it('backfills successful uploaders from older acquisition jobs only once', () => {
    const job = beginAcquisition('alice', intent)
    h.jobs[0] = { ...job, status: 'completed', completedAt: '2026-07-31T10:00:00.000Z' }
    expect(listSuccessfulPeers()).toEqual([
      expect.objectContaining({ username: 'alice', successfulAlbums: 1, successfulFiles: 2 })
    ])
    expect(listSuccessfulPeers()[0].successfulAlbums).toBe(1)
    expect(h.jobs[0].peerSuccessRecordedAt).toBe('2026-07-31T10:00:00.000Z')
  })

  it('treats slskd "Completed, Aborted" as a failed transfer', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    const jobs = reconcileAcquisitions({
      users: [{
        username: 'alice', totalFiles: 2, inProgressFiles: 0, completedFiles: 0, erroredFiles: 2,
        directories: [{ directory: 'Gimme Fiction', files: intent.files.map((f, i) => ({
          id: String(i), filename: f.filename, state: 'Completed, Aborted', percent: 0,
          size: f.size, bytesTransferred: 0, averageSpeed: 0, startedAt: null, endedAt: null
        })) }]
      }],
      totals: { files: 2, inProgress: 0, completed: 0, errored: 2, queued: 0 }
    })
    expect(jobs[0].status).toBe('failed')
    expect(jobs[0].files.every((f) => f.status === 'failed' && f.error === 'Completed, Aborted')).toBe(true)
  })

  it('fails a downloading job whose transfers have vanished from slskd, after a grace period', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    const empty = { users: [], totals: { files: 0, inProgress: 0, completed: 0, errored: 0, queued: 0 } }
    const t0 = Date.parse(h.jobs[0].updatedAt)

    // inside the grace window: nothing changes (enqueue lag, slskd catching up)
    expect(reconcileAcquisitions(empty, t0 + 60_000)[0].status).toBe('downloading')

    const jobs = reconcileAcquisitions(empty, t0 + 11 * 60_000)
    expect(jobs[0].status).toBe('failed')
    expect(jobs[0].files.every((f) => f.status === 'failed' && f.error === 'transfer gone from slskd')).toBe(true)
  })

  it('a job-level retry re-asks for the missing files only and clears the auto-import verdict', () => {
    const job = beginAcquisition('alice', intent)
    finishEnqueue(job.id, { username: 'alice', accepted: 2, alreadyInProgress: 0, errors: [] })
    reconcileAcquisitions({
      users: [{
        username: 'alice', totalFiles: 2, inProgressFiles: 0, completedFiles: 1, erroredFiles: 1,
        directories: [{ directory: 'Gimme Fiction', files: [
          { id: '0', filename: intent.files[0].filename, state: 'Completed, Succeeded', percent: 100,
            size: 10, bytesTransferred: 10, averageSpeed: 0, startedAt: null, endedAt: null },
          { id: '1', filename: intent.files[1].filename, state: 'Completed, Errored', percent: 0,
            size: 20, bytesTransferred: 0, averageSpeed: 0, startedAt: null, endedAt: null }
        ] }]
      }],
      totals: { files: 2, inProgress: 0, completed: 1, errored: 1, queued: 0 }
    })
    h.jobs = h.jobs.map((j) => ({ ...j, autoImportAt: 'x', autoImportOutcome: 'needs-review', autoImportNote: 'n' }))
    expect(filesToRetry(h.jobs[0]).map((f) => f.filename)).toEqual([intent.files[1].filename])

    const updated = markRetried(job.id, { username: 'alice', accepted: 1, alreadyInProgress: 0, errors: [] })!
    expect(updated.status).toBe('downloading')
    expect(updated.files.map((f) => f.status)).toEqual(['downloaded', 'queued'])
    expect(updated.autoImportAt).toBeNull()
    expect(updated.autoImportOutcome).toBeNull()
    expect(updated.error).toBeNull()

    // slskd refusing the retry leaves the file failed with the new reason
    const refused = markRetried(job.id, {
      username: 'alice', accepted: 0, alreadyInProgress: 0,
      errors: [{ filename: intent.files[1].filename, error: 'peer offline' }]
    })!
    expect(refused.files[1]).toMatchObject({ status: 'failed', error: 'peer offline' })
  })
})
