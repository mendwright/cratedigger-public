import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingSingle } from '../shared/singles.js'
import type { InboxFolder } from '../shared/tagger.js'

const h = vi.hoisted(() => ({
  singles: [] as PendingSingle[],
  inbox: [] as InboxFolder[],
  transfers: [] as { username: string; filename: string; state: string; id: string }[],
  applyCalls: [] as Record<string, unknown>[],
  applyError: null as Error | null,
  removed: [] as { username: string; id: string }[],
  sent: [] as { channel: string; payload: unknown }[]
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) }
      }
    ]
  }
}))

vi.mock('./store.js', () => ({
  getValue: vi.fn(() => h.singles.map((s) => ({ ...s }))),
  setValue: vi.fn((_key: string, value: unknown) => {
    h.singles = value as PendingSingle[]
  }),
  getSlskdUrl: vi.fn(() => 'http://slskd:5030'),
  getTaggerUrl: vi.fn(() => 'http://tagger:9766')
}))

vi.mock('./tagger.js', () => ({
  listInbox: vi.fn(async () => h.inbox),
  applySingle: vi.fn(async (args: Record<string, unknown>) => {
    h.applyCalls.push(args)
    if (h.applyError) throw h.applyError
    return { ok: true, dst: '/music/singles/x.flac', plex: { ok: true } }
  })
}))

vi.mock('./slskd.js', () => ({
  listDownloads: vi.fn(async () => {
    const users = new Map<string, { username: string; directories: { directory: string; files: unknown[] }[] }>()
    for (const t of h.transfers) {
      const u = users.get(t.username) ?? { username: t.username, directories: [{ directory: 'd', files: [] }] }
      u.directories[0].files.push({ id: t.id, filename: t.filename, state: t.state, percent: 100 })
      users.set(t.username, u)
    }
    return { users: [...users.values()] }
  }),
  removeDownload: vi.fn(async (username: string, id: string) => {
    h.removed.push({ username, id })
  })
}))

import { sweepSingles, trackSingle, forgetSinglesFor } from './auto-singles.js'

function inboxFolder(folder: string, files: string[], trackId: string | null = null): InboxFolder {
  return {
    folder,
    path: `/inbox/${folder}`,
    file_count: files.length,
    files: files.map((name) => ({
      path: `/inbox/${folder}/${name}`,
      name,
      size: 1,
      ext: '.flac',
      read_error: null,
      duration_ms: null,
      tags: { musicbrainz_trackid: trackId } as InboxFolder['files'][number]['tags']
    }))
  }
}

const REMOTE = '@@music\\Tommy Tutone\\Singles\\867-5309 Jenny.flac'

beforeEach(() => {
  h.singles = []
  h.inbox = []
  h.transfers = []
  h.applyCalls = []
  h.applyError = null
  h.removed = []
  h.sent = []
})

describe('trackSingle', () => {
  it('registers a queued record and replaces a duplicate of the same live grab', () => {
    const args = { playlistId: 'url:x', artist: 'Tommy Tutone', title: '867-5309 / Jenny', username: 'bob', filename: REMOTE, size: 9 }
    trackSingle(args)
    trackSingle(args)
    expect(h.singles).toHaveLength(1)
    expect(h.singles[0]).toMatchObject({ status: 'queued', artist: 'Tommy Tutone', filename: REMOTE })
  })
})

describe('sweepSingles', () => {
  const queue = (): void => {
    trackSingle({ playlistId: 'url:x', artist: 'Tommy Tutone', title: '867-5309 / Jenny', username: 'bob', filename: REMOTE, size: 9 })
  }

  it('files a finished transfer with the playlist tags, cleans up, and tells the renderer', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Succeeded', id: 't1' }]
    h.inbox = [inboxFolder('Singles', ['867-5309 Jenny.flac'], 'mbid-1')]
    await sweepSingles()
    expect(h.applyCalls).toEqual([
      {
        folderName: 'Singles',
        filename: '867-5309 Jenny.flac',
        artist: 'Tommy Tutone',
        title: '867-5309 / Jenny',
        recordingMbid: 'mbid-1'
      }
    ])
    expect(h.singles[0]).toMatchObject({ status: 'filed', note: null })
    expect(h.singles[0].filedAt).toBeTruthy()
    expect(h.removed).toEqual([{ username: 'bob', id: 't1' }])
    expect(h.sent).toEqual([
      { channel: 'singles:filed', payload: { playlistId: 'url:x', artist: 'Tommy Tutone', title: '867-5309 / Jenny' } }
    ])
  })

  it('leaves a still-downloading transfer alone', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'InProgress', id: 't1' }]
    await sweepSingles()
    expect(h.applyCalls).toEqual([])
    expect(h.singles[0].status).toBe('queued')
  })

  it('waits for the inbox, then gives up with a reason', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Succeeded', id: 't1' }]
    for (let i = 0; i < 7; i++) await sweepSingles()
    expect(h.singles[0].status).toBe('queued')
    expect(h.singles[0].inboxAttempts).toBe(7)
    await sweepSingles()
    expect(h.singles[0]).toMatchObject({ status: 'failed', note: expect.stringContaining('never appeared') })
    expect(h.sent).toEqual([])
  })

  it('keeps looking in the inbox after slskd forgets a transfer it already saw finish', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Succeeded', id: 't1' }]
    await sweepSingles() // not in inbox yet → attempt 1
    h.transfers = [] // slskd cleaned up
    h.inbox = [inboxFolder('Singles', ['867-5309 Jenny.flac'])]
    await sweepSingles()
    expect(h.singles[0].status).toBe('filed')
    expect(h.removed).toEqual([])
  })

  it('fails a dead transfer with slskd state as the reason', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Errored', id: 't1' }]
    await sweepSingles()
    expect(h.singles[0]).toMatchObject({ status: 'failed', note: 'Soulseek transfer Completed, Errored' })
  })

  it('abandons a queued grab nobody has heard from in three days', async () => {
    queue()
    h.singles[0].queuedAt = new Date(Date.now() - 4 * 24 * 3600_000).toISOString()
    await sweepSingles()
    expect(h.singles[0]).toMatchObject({ status: 'failed', note: 'transfer gone from slskd' })
  })

  it('retries a transient tagger failure, then settles', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Succeeded', id: 't1' }]
    h.inbox = [inboxFolder('Singles', ['867-5309 Jenny.flac'])]
    h.applyError = new Error('tagger 503')
    await sweepSingles()
    expect(h.singles[0].status).toBe('queued')
    h.applyError = new Error('no such file')
    await sweepSingles()
    expect(h.singles[0]).toMatchObject({ status: 'failed', note: 'no such file' })
  })

  it('prefers the folder named after the remote directory when two hold the same file name', async () => {
    queue()
    h.transfers = [{ username: 'bob', filename: REMOTE, state: 'Completed, Succeeded', id: 't1' }]
    h.inbox = [inboxFolder('Other Rip', ['867-5309 Jenny.flac']), inboxFolder('Singles', ['867-5309 Jenny.flac'])]
    await sweepSingles()
    expect(h.applyCalls[0]).toMatchObject({ folderName: 'Singles' })
  })
})

describe('forgetSinglesFor', () => {
  it('drops settled records for the playlist but keeps live ones', () => {
    trackSingle({ playlistId: 'p', artist: 'a', title: 't', username: 'u', filename: 'f1', size: 1 })
    trackSingle({ playlistId: 'p', artist: 'a', title: 't2', username: 'u', filename: 'f2', size: 1 })
    trackSingle({ playlistId: 'q', artist: 'a', title: 't3', username: 'u', filename: 'f3', size: 1 })
    h.singles[0].status = 'filed'
    forgetSinglesFor('p')
    expect(h.singles.map((s) => s.filename)).toEqual(['f2', 'f3'])
  })
})
