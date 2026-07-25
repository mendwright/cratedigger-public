import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcquisitionJob } from '../shared/acquisition.js'

const h = vi.hoisted(() => ({ jobs: [] as AcquisitionJob[] }))

vi.mock('./store.js', () => ({
  getValue: vi.fn(() => h.jobs.map((job) => ({ ...job, files: job.files.map((f) => ({ ...f })) }))),
  setValue: vi.fn((_key: string, jobs: AcquisitionJob[]) => { h.jobs = jobs })
}))

import {
  beginAcquisition,
  failEnqueue,
  finishEnqueue,
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

beforeEach(() => { h.jobs = [] })

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
  })
})
