import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcquisitionJob } from '../shared/acquisition.js'
import type { ApplyOrPreviewResult, InboxFolder, PreviewResponse } from '../shared/tagger.js'

const h = vi.hoisted(() => ({
  jobs: [] as AcquisitionJob[],
  peers: {} as Record<string, unknown>,
  inbox: [] as InboxFolder[],
  applyResults: [] as ApplyOrPreviewResult[],
  applyCalls: [] as { folder: string; mbid: string; mode?: string; refresh_plex?: boolean }[],
  removedDownloads: [] as { username: string; id: string }[],
  deletedInboxFiles: [] as { name: string; paths: string[] }[],
  libraryAlbums: [] as { artist: string; title: string }[]
}))

vi.mock('./store.js', () => ({
  getValue: vi.fn((key: string) =>
    key === 'slskdPeerHistory'
      ? { ...h.peers }
      : h.jobs.map((job) => ({ ...job, files: job.files.map((f) => ({ ...f })) }))
  ),
  setValue: vi.fn((key: string, value: unknown) => {
    if (key === 'slskdPeerHistory') h.peers = value as typeof h.peers
    else h.jobs = value as AcquisitionJob[]
  }),
  getSlskdUrl: vi.fn(() => 'http://slskd:5030'),
  getTaggerUrl: vi.fn(() => 'http://tagger:9766')
}))

vi.mock('./library-snapshot.js', () => ({
  librarySnapshot: {
    findAlbum: vi.fn(async (artist: string, title: string) =>
      h.libraryAlbums.find((a) => a.artist === artist && a.title === title) ?? null
    )
  }
}))

vi.mock('./tagger.js', () => ({
  listInbox: vi.fn(async () => h.inbox),
  getInboxFolder: vi.fn(async (name: string) => {
    const f = h.inbox.find((x) => x.folder === name)
    if (!f) throw new Error('gone')
    const dropped = new Set(h.deletedInboxFiles.flatMap((d) => d.paths))
    const files = f.files.filter((x) => !dropped.has(x.path))
    return { ...f, files, file_count: files.length }
  }),
  deleteInboxFiles: vi.fn(async (name: string, paths: string[]) => {
    h.deletedInboxFiles.push({ name, paths })
    return { ok: true, deleted: paths, missing: [], errors: [] }
  }),
  applyRelease: vi.fn(async (req: (typeof h.applyCalls)[number]) => {
    h.applyCalls.push(req)
    const next = h.applyResults.shift()
    if (!next) throw new Error('no scripted apply result')
    return next
  })
}))

vi.mock('./slskd.js', () => ({
  listDownloads: vi.fn(async () => ({
    users: [
      {
        username: 'alice',
        directories: [
          { directory: '\\music\\Gimme Fiction', files: [{ id: 'f1' }, { id: 'f2' }] }
        ]
      }
    ],
    totals: { files: 2, inProgress: 0, completed: 2, errored: 0, queued: 0 }
  })),
  removeDownload: vi.fn(async (username: string, id: string) => {
    h.removedDownloads.push({ username, id })
  })
}))

import { eligibleForAutoImport, sweepAutoImports } from './auto-import.js'

function makeJob(over: Partial<AcquisitionJob> = {}): AcquisitionJob {
  return {
    id: 'job-1',
    source: 'slskd',
    username: 'alice',
    artist: 'Spoon',
    album: 'Gimme Fiction',
    folder: '\\music\\Gimme Fiction',
    releaseMbid: 'release-1',
    expectedTrackCount: 2,
    status: 'downloaded',
    files: [
      { filename: '\\music\\Gimme Fiction\\01.flac', size: 10, durationSeconds: 180, status: 'downloaded', error: null, destination: null },
      { filename: '\\music\\Gimme Fiction\\02.flac', size: 20, durationSeconds: 200, status: 'downloaded', error: null, destination: null }
    ],
    error: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    // Fresh by default: the folder-wait path only applies to a job that just
    // finished; tests for the stale path override this.
    updatedAt: new Date().toISOString(),
    completedAt: null,
    ...over
  }
}

function inboxFile(path: string) {
  const name = path.split('/').at(-1)!
  const dot = name.lastIndexOf('.')
  return {
    path,
    name,
    ext: dot >= 0 ? name.slice(dot) : '',
    size: 1,
    read_error: null,
    duration_ms: null,
    tags: {
      title: null, artist: null, albumartist: null, composer: null, album: null,
      tracknumber: null, discnumber: null, date: null,
      musicbrainz_albumid: null, musicbrainz_trackid: null
    }
  }
}

const inboxFolder: InboxFolder = {
  folder: 'Gimme Fiction',
  path: '/inbox/Gimme Fiction',
  file_count: 2,
  files: []
}

function cleanPreview(over: Partial<PreviewResponse> = {}): PreviewResponse {
  return {
    ok: true,
    mode: 'preview',
    album: 'Gimme Fiction',
    albumartist: 'Spoon',
    release_mbid: 'release-1',
    total_tracks: 2,
    file_count: 2,
    rows: [],
    clean: true,
    warnings: [],
    ...over
  }
}

async function sweepAndSettle(): Promise<void> {
  sweepAutoImports()
  // the sweep body is fire-and-forget; drain the microtask/mocked-promise chain
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  h.jobs = []
  h.peers = {}
  h.inbox = []
  h.applyResults = []
  h.applyCalls = []
  h.removedDownloads = []
  h.deletedInboxFiles = []
  h.libraryAlbums = []
})

describe('eligibleForAutoImport', () => {
  it('accepts a fully-downloaded job with a known release and track count', () => {
    expect(eligibleForAutoImport(makeJob())).toBe(true)
  })

  it('rejects jobs missing the pieces that make an import obvious', () => {
    expect(eligibleForAutoImport(makeJob({ status: 'downloading' }))).toBe(false)
    expect(eligibleForAutoImport(makeJob({ releaseMbid: null }))).toBe(false)
    expect(eligibleForAutoImport(makeJob({ expectedTrackCount: null }))).toBe(false)
    expect(eligibleForAutoImport(makeJob({ files: [] }))).toBe(false)
    expect(eligibleForAutoImport(makeJob({ autoImportAt: '2026-09-13T00:00:00.000Z' }))).toBe(false)
  })

  it('rejects a job with any failed file even when status is downloaded', () => {
    const job = makeJob()
    job.files[1] = { ...job.files[1], status: 'failed', error: 'timed out' }
    expect(eligibleForAutoImport(job)).toBe(false)
  })
})

describe('sweepAutoImports', () => {
  it('previews then commits a clean reconcile and records the import', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    h.applyResults = [
      cleanPreview(),
      {
        ok: true,
        mode: 'commit',
        album: 'Gimme Fiction',
        albumartist: 'Spoon',
        moved: [
          { src: '/inbox/Gimme Fiction/01.flac', dst: '/music/Spoon/Gimme Fiction/01.flac' },
          { src: '/inbox/Gimme Fiction/02.flac', dst: '/music/Spoon/Gimme Fiction/02.flac' }
        ],
        plex: { ok: true }
      }
    ]
    await sweepAndSettle()

    expect(h.applyCalls).toEqual([
      { folder: '/inbox/Gimme Fiction', mbid: 'release-1', mode: 'preview', refresh_plex: false },
      { folder: '/inbox/Gimme Fiction', mbid: 'release-1', mode: 'commit', refresh_plex: true }
    ])
    const job = h.jobs[0]
    expect(job.status).toBe('completed')
    expect(job.autoImportOutcome).toBe('imported')
    expect(job.files.every((f) => f.status === 'imported')).toBe(true)
    expect(h.removedDownloads).toEqual([
      { username: 'alice', id: 'f1' },
      { username: 'alice', id: 'f2' }
    ])
  })

  it('leaves a dirty reconcile for manual review without committing', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    h.applyResults = [cleanPreview({ clean: false })]
    await sweepAndSettle()

    expect(h.applyCalls).toHaveLength(1)
    const job = h.jobs[0]
    expect(job.status).toBe('downloaded')
    expect(job.autoImportOutcome).toBe('needs-review')
    expect(job.autoImportAt).toBeTruthy()
  })

  it('flags a count mismatch instead of committing', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    h.applyResults = [cleanPreview({ file_count: 3 })]
    await sweepAndSettle()

    expect(h.applyCalls).toHaveLength(1)
    expect(h.jobs[0].autoImportOutcome).toBe('needs-review')
    expect(h.jobs[0].autoImportNote).toContain('3 files for a 2-track release')
  })

  it('waits for the inbox folder to appear, then gives up to manual', async () => {
    h.jobs = [makeJob()]
    h.inbox = [] // never appears
    for (let i = 0; i < 24; i++) await sweepAndSettle()

    const job = h.jobs[0]
    expect(job.status).toBe('downloaded')
    expect(job.autoImportOutcome).toBe('needs-review')
    expect(job.autoImportNote).toContain('never appeared')
    expect(h.applyCalls).toHaveLength(0)

    // and once given up, a later sweep must not pick it back up
    h.inbox = [inboxFolder]
    await sweepAndSettle()
    expect(h.applyCalls).toHaveLength(0)
  })

  it('resolves a stale job whose folder is gone as already-in-library when Plex has it', async () => {
    h.jobs = [makeJob({ updatedAt: '2026-09-01T00:00:00.000Z' })]
    h.inbox = []
    h.libraryAlbums = [{ artist: 'Spoon', title: 'Gimme Fiction' }]
    await sweepAndSettle()

    const job = h.jobs[0]
    expect(job.status).toBe('completed')
    expect(job.autoImportOutcome).toBe('in-library')
    expect(job.autoImportAttempts).toBe(1) // no 24-poll wait for a stale job
    expect(h.applyCalls).toHaveLength(0)
  })

  it('sends a stale job whose folder is gone and album is absent to review on first look', async () => {
    h.jobs = [makeJob({ updatedAt: '2026-09-01T00:00:00.000Z' })]
    h.inbox = []
    await sweepAndSettle()

    const job = h.jobs[0]
    expect(job.status).toBe('downloaded')
    expect(job.autoImportOutcome).toBe('needs-review')
    expect(job.autoImportNote).toContain('never appeared')
    expect(job.autoImportAttempts).toBe(1)
  })

  it('drops name-level duplicates before the preview and notes it on the job', async () => {
    h.jobs = [makeJob()]
    h.inbox = [
      {
        ...inboxFolder,
        file_count: 4,
        files: [
          inboxFile('/inbox/Gimme Fiction/01.flac'),
          inboxFile('/inbox/Gimme Fiction/01_639249152667847103.flac'),
          inboxFile('/inbox/Gimme Fiction/02.flac'),
          inboxFile('/inbox/Gimme Fiction/02.opus')
        ]
      }
    ]
    h.applyResults = [
      cleanPreview(),
      { ok: true, mode: 'commit', album: 'Gimme Fiction', albumartist: 'Spoon', moved: [], plex: { ok: true } }
    ]
    await sweepAndSettle()

    expect(h.deletedInboxFiles).toEqual([
      {
        name: 'Gimme Fiction',
        paths: ['/inbox/Gimme Fiction/01_639249152667847103.flac', '/inbox/Gimme Fiction/02.opus']
      }
    ])
    expect(h.applyCalls.map((c) => c.mode)).toEqual(['preview', 'commit'])
    const job = h.jobs[0]
    expect(job.autoImportOutcome).toBe('imported')
    expect(job.autoImportNote).toBe('dropped 1 slskd re-download copy, 1 lesser-encoding twin')
  })

  it('does not take a job twice across overlapping sweeps', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    h.applyResults = [
      cleanPreview(),
      { ok: true, mode: 'commit', album: 'Gimme Fiction', albumartist: 'Spoon', moved: [], plex: { ok: true } }
    ]
    sweepAutoImports()
    sweepAutoImports()
    await sweepAndSettle()

    expect(h.applyCalls.filter((c) => c.mode === 'preview')).toHaveLength(1)
  })

  it('marks needs-review when the tagger throws a non-transient error', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    h.applyResults = [] // applyRelease mock throws when the script runs dry
    await sweepAndSettle()

    const job = h.jobs[0]
    expect(job.status).toBe('downloaded')
    expect(job.autoImportOutcome).toBe('needs-review')
    expect(job.autoImportNote).toContain('no scripted apply result')
  })

  it('re-queues the job on transient failures, then gives up after the retry cap', async () => {
    h.jobs = [makeJob()]
    h.inbox = [inboxFolder]
    const transient = async (): Promise<never> => {
      throw new Error('tagger /apply: 503 The MusicBrainz web server is currently busy')
    }
    const { applyRelease } = await import('./tagger.js')
    vi.mocked(applyRelease).mockImplementation(transient)

    await sweepAndSettle()
    let job = h.jobs[0]
    expect(job.status).toBe('downloaded')
    expect(job.autoImportOutcome).toBeFalsy()
    expect(job.autoImportAt).toBeNull()
    expect(job.autoImportAttempts).toBe(1)

    for (let i = 0; i < 5; i++) await sweepAndSettle()
    job = h.jobs[0]
    expect(job.autoImportOutcome).toBe('needs-review')
    expect(job.autoImportNote).toContain('503')
  })
})
