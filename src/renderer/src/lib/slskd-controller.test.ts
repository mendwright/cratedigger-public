import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  SlskdAlbumCandidate,
  SlskdDownloads,
  SlskdEnqueueResult,
  SlskdSearchResult
} from '../../../shared/slskd'
import {
  SlskdController,
  parseSlskdList,
  slskdCacheKey,
  type SlskdDeps
} from './slskd-controller.svelte'

type PlexApi = Window['cratedigger']['plex']
type SlskdApi = Window['cratedigger']['slskd']

const flush = () => new Promise((r) => setTimeout(r))

function makeDeferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function searchResult(artist = 'A', album = 'x'): SlskdSearchResult {
  return {
    query: { artist, album },
    candidates: [],
    albums: [],
    release: null,
    responseCount: 0,
    complete: true,
    elapsedMs: 1
  }
}

function candidate(username = 'bob', folder = 'Album'): SlskdAlbumCandidate {
  return {
    username,
    hasFreeUploadSlot: true,
    uploadSpeed: 1,
    queueLength: 0,
    folder,
    guessedArtist: null,
    guessedAlbum: null,
    files: [{ filename: 'a.flac', size: 1, bitRate: null, length: null, extension: 'flac' }],
    score: 1,
    avgMatchScore: 1,
    avgQualityScore: 1,
    formatSummary: 'FLAC',
    matchedTracks: 1,
    successfulAlbums: 0,
    failedAlbums: 0,
    historicalAverageSpeed: 0
  }
}

function downloadsWith(username: string, directory: string, fileIds: string[]): SlskdDownloads {
  return {
    users: [
      {
        username,
        directories: [
          {
            directory,
            files: fileIds.map((id) => ({
              id,
              filename: `${directory}/${id}.flac`,
              state: 'Completed',
              percent: 100,
              size: 1,
              bytesTransferred: 1,
              averageSpeed: 0,
              startedAt: null,
              endedAt: null
            }))
          }
        ],
        totalFiles: fileIds.length,
        inProgressFiles: 0,
        completedFiles: fileIds.length,
        erroredFiles: 0
      }
    ],
    totals: { files: fileIds.length, inProgress: 0, completed: fileIds.length, errored: 0, queued: 0 }
  }
}

const emptyDownloads: SlskdDownloads = {
  users: [],
  totals: { files: 0, inProgress: 0, completed: 0, errored: 0, queued: 0 }
}

function makeController(
  opts: {
    search?: ReturnType<typeof vi.fn>
    enqueue?: ReturnType<typeof vi.fn>
    slskd?: Record<string, unknown>
    plex?: Record<string, unknown>
  } = {}
) {
  const slskd = {
    getConfig: vi.fn(async () => ({ url: 'http://slskd', apiKey: 'k' })),
    setConfig: vi.fn(async () => undefined),
    health: vi.fn(async () => ({
      ok: true,
      url: 'http://slskd',
      reachable: true,
      version: '1.0',
      error: null
    })),
    listDownloads: vi.fn(async () => emptyDownloads),
    listSuccessfulPeers: vi.fn(async () => []),
    browseUser: vi.fn(async ({ username }: { username: string }) => ({
      username, albums: [], directoryCount: 0, fileCount: 0
    })),
    removeDownload: vi.fn(async () => undefined),
    retryDownload: vi.fn(async () => undefined),
    removeDownloadsBulk: vi.fn(async () => undefined),
    retryDownloadsBulk: vi.fn(async () => undefined),
    search: opts.search ?? vi.fn(async (a: { artist: string; album: string }) => searchResult(a.artist, a.album)),
    enqueue:
      opts.enqueue ??
      vi.fn(
        async (): Promise<SlskdEnqueueResult> => ({
          username: 'bob',
          accepted: 2,
          alreadyInProgress: 0,
          errors: []
        })
      ),
    ...opts.slskd
  }
  const plex = {
    searchReleaseCandidates: vi.fn(async () => []),
    ...opts.plex
  }
  const flashToast = vi.fn<(kind: 'ok' | 'err', text: string) => void>()
  const deps: SlskdDeps = {
    flashToast,
    slskd: slskd as unknown as SlskdApi,
    plex: plex as unknown as PlexApi
  }
  return { c: new SlskdController(deps), slskd, plex, flashToast }
}

describe('parseSlskdList', () => {
  it('parses strict "Artist - Album" lines, trims, and skips blanks', () => {
    const q = parseSlskdList('Spoon - Gimme Fiction\n\n  Pixies - Doolittle  \n')
    expect(q).toEqual([
      { artist: 'Spoon', album: 'Gimme Fiction', status: 'pending' },
      { artist: 'Pixies', album: 'Doolittle', status: 'pending' }
    ])
  })

  it('accepts en-dash and em-dash separators', () => {
    const q = parseSlskdList('Boards of Canada – Geogaddi\nAphex Twin — Drukqs')
    expect(q.map((x) => x.artist)).toEqual(['Boards of Canada', 'Aphex Twin'])
    expect(q.map((x) => x.album)).toEqual(['Geogaddi', 'Drukqs'])
  })

  it('falls back to the loose "Club- Infants" form (no left space)', () => {
    const q = parseSlskdList('Club- Infants')
    expect(q).toEqual([{ artist: 'Club', album: 'Infants', status: 'pending' }])
  })

  it('ignores hyphenated names with no space after the dash', () => {
    expect(parseSlskdList('Glenn-Copeland')).toEqual([])
  })

  it('keeps further dashes in the album title (lazy left side)', () => {
    const q = parseSlskdList('Artist - Foo - Bar')
    expect(q).toEqual([{ artist: 'Artist', album: 'Foo - Bar', status: 'pending' }])
  })
})

describe('slskdCacheKey', () => {
  it('lowercases and trims so case/space variants collide', () => {
    expect(slskdCacheKey('  Spoon ', 'Gimme Fiction')).toBe(slskdCacheKey('spoon', 'gimme fiction'))
  })

  it('keys distinct albums apart', () => {
    expect(slskdCacheKey('A', 'x')).not.toBe(slskdCacheKey('A', 'y'))
  })
})

describe('SlskdController — search queue', () => {
  it('parseList seeds the queue at index 0, resets progress, and searches the first item', async () => {
    const { c, slskd } = makeController()
    c.parseList('Spoon - Gimme Fiction\nPixies - Doolittle')
    expect(c.queue.map((q) => q.artist)).toEqual(['Spoon', 'Pixies'])
    expect(c.queueIndex).toBe(0)
    // searching item 0 also prefetches item 1 (window of 6), so both start
    expect(c.queueSearchProgress).toEqual({ started: 2, done: 0, failed: 0 })
    await flush()
    expect(slskd.search).toHaveBeenCalledWith(
      expect.objectContaining({ artist: 'Spoon', album: 'Gimme Fiction' })
    )
  })

  it('parseList with no parseable lines clears the queue and current', async () => {
    const { c } = makeController()
    c.parseList('not a list')
    expect(c.queue).toEqual([])
    expect(c.queueIndex).toBe(-1)
    expect(c.current).toBeNull()
  })

  it('dedups identical searches via the memo cache', async () => {
    const { c, slskd } = makeController()
    await c.runSearch('A', 'x')
    await c.runSearch('A', 'x')
    expect(slskd.search).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed search — the next visit retries', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error('slskd down'))
      .mockResolvedValueOnce(searchResult('A', 'x'))
    const { c } = makeController({ search })
    await c.runSearch('A', 'x')
    expect(c.current?.error).toBe('slskd down')
    await c.runSearch('A', 'x')
    expect(search).toHaveBeenCalledTimes(2)
    expect(c.current?.error).toBeNull()
  })

  it('a later search supersedes an earlier in-flight one (sequence guard)', async () => {
    const deferredA = makeDeferred<SlskdSearchResult>()
    const search = vi.fn((a: { artist: string }) =>
      a.artist === 'A' ? deferredA.promise : Promise.resolve(searchResult('B', 'y'))
    )
    const { c } = makeController({ search })
    const pA = c.runSearch('A', 'x')
    const pB = c.runSearch('B', 'y')
    await pB
    expect(c.current?.artist).toBe('B')
    deferredA.resolve(searchResult('A', 'x'))
    await pA
    expect(c.current?.artist).toBe('B') // stale result ignored
  })

  it('a preferred-release override searches under a distinct cache key', async () => {
    const { c, slskd } = makeController()
    await c.runSearch('A', 'x')
    await c.runSearch('A', 'x', 'mbid-123')
    expect(slskd.search).toHaveBeenCalledTimes(2)
    expect(slskd.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferredReleaseMbid: 'mbid-123' })
    )
  })

  it('prefetches the upcoming window when searching a queued item', async () => {
    const { c, slskd } = makeController()
    c.parseList(Array.from({ length: 8 }, (_, i) => `Artist${i} - Album${i}`).join('\n'))
    await flush()
    // window is 6 starting at index 0
    expect(slskd.search).toHaveBeenCalledTimes(6)
  })

  it('goToQueueItem moves the index and searches; out-of-range is ignored', async () => {
    const { c, slskd } = makeController()
    c.parseList(Array.from({ length: 10 }, (_, i) => `Artist${i} - Album${i}`).join('\n'))
    await flush()
    slskd.search.mockClear()
    c.goToQueueItem(8) // past the 6-item prefetch window, so not yet cached
    expect(c.queueIndex).toBe(8)
    await flush()
    expect(slskd.search).toHaveBeenCalledWith(expect.objectContaining({ artist: 'Artist8' }))
    c.goToQueueItem(99)
    expect(c.queueIndex).toBe(8) // unchanged
  })

  it('nextQueueItem advances and stops at the end', async () => {
    const { c } = makeController()
    c.parseList('A - 1\nB - 2')
    c.nextQueueItem()
    expect(c.queueIndex).toBe(1)
    c.nextQueueItem()
    expect(c.queueIndex).toBe(1) // clamped
  })

  it('markCurrentItem updates the current queue row status', () => {
    const { c } = makeController()
    c.parseList('A - 1\nB - 2')
    c.markCurrentItem('skipped')
    expect(c.queue[0].status).toBe('skipped')
  })

  it('clearQueue resets everything', () => {
    const { c } = makeController()
    c.parseList('A - 1')
    c.clearQueue()
    expect(c.queue).toEqual([])
    expect(c.queueIndex).toBe(-1)
    expect(c.current).toBeNull()
    expect(c.queueSearchProgress).toEqual({ started: 0, done: 0, failed: 0 })
  })
})

describe('SlskdController — downloads polling', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
  afterEach(() => vi.useRealTimers())

  it('polls immediately, then on the 2.5s interval, and stops on demand', async () => {
    const { c, slskd } = makeController()
    c.startDownloadsPolling()
    await flush()
    expect(slskd.listDownloads).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2500)
    await flush()
    expect(slskd.listDownloads).toHaveBeenCalledTimes(2)
    c.stopDownloadsPolling()
    vi.advanceTimersByTime(5000)
    await flush()
    expect(slskd.listDownloads).toHaveBeenCalledTimes(2)
  })

  it('guards against overlapping polls', async () => {
    const deferred = makeDeferred<SlskdDownloads>()
    const listDownloads = vi.fn(() => deferred.promise)
    const { c } = makeController({ slskd: { listDownloads } })
    void c.pollDownloads()
    void c.pollDownloads()
    expect(listDownloads).toHaveBeenCalledTimes(1)
    deferred.resolve(emptyDownloads)
    await flush()
  })

  it('pendingWithPeer counts queued + downloading files, ignoring finished ones', () => {
    const { c } = makeController()
    const dl = downloadsWith('bob', 'Album', ['f1', 'f2', 'f3', 'f4', 'f5'])
    // 5 total: 1 downloading, 1 completed, 1 errored → 2 still queued
    dl.users[0].inProgressFiles = 1
    dl.users[0].completedFiles = 1
    dl.users[0].erroredFiles = 1
    c.downloads = dl
    expect(c.pendingWithPeer('bob')).toEqual({ downloading: 1, queued: 2 })
    expect(c.pendingWithPeer('alice')).toEqual({ downloading: 0, queued: 0 })
  })

  it('pendingWithPeer is all-zero before the first poll lands', () => {
    const { c } = makeController()
    expect(c.pendingWithPeer('bob')).toEqual({ downloading: 0, queued: 0 })
  })
})

describe('SlskdController — search again from downloads', () => {
  const job = {
    id: 'j1',
    source: 'slskd' as const,
    username: 'starbadger',
    artist: 'Massive Attack',
    album: 'Mezzanine',
    folder: 'Music\\Massive Attack\\Mezzanine (1998)',
    releaseMbid: 'mbid-123',
    expectedTrackCount: 11,
    status: 'failed' as const,
    files: [],
    error: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    completedAt: null
  }

  it('uses the matching acquisition job (artist, album, release override) and jumps to the search tab', async () => {
    const { c, slskd } = makeController()
    c.tab = 'downloads'
    c.downloads = { ...emptyDownloads, acquisitions: [job] }
    c.searchAgainForDirectory('starbadger', 'Music\\Massive Attack\\Mezzanine (1998)')
    expect(c.tab).toBe('search')
    await flush()
    expect(slskd.search).toHaveBeenCalledWith({
      artist: 'Massive Attack',
      album: 'Mezzanine',
      preferredReleaseMbid: 'mbid-123'
    })
  })

  it('busts the cached search so the network is asked fresh', async () => {
    const { c, slskd } = makeController()
    c.downloads = { ...emptyDownloads, acquisitions: [{ ...job, releaseMbid: null }] }
    await c.runSearch('Massive Attack', 'Mezzanine')
    expect(slskd.search).toHaveBeenCalledTimes(1)
    c.searchAgainForDirectory('starbadger', job.folder)
    await flush()
    expect(slskd.search).toHaveBeenCalledTimes(2)
  })

  it('falls back to guessing artist/album from the remote folder when no acquisition matches', async () => {
    const { c, slskd } = makeController()
    c.downloads = emptyDownloads
    c.searchAgainForDirectory('someone', 'Music\\Massive Attack\\Mezzanine (1998)')
    await flush()
    expect(slskd.search).toHaveBeenCalledWith({
      artist: 'Massive Attack',
      album: 'Mezzanine',
      preferredReleaseMbid: undefined
    })
  })
})

describe('SlskdController — enqueue', () => {
  it('marks the candidate enqueued and toasts on success', async () => {
    const { c, flashToast, slskd } = makeController()
    c.parseList('A - 1')
    await flush()
    await c.enqueueCandidate(candidate('bob', 'Album'))
    expect(c.current?.enqueueStatus['bob|Album']).toBe('ok')
    expect(c.queue[0].status).toBe('enqueued')
    expect(slskd.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({
        artist: 'A',
        album: '1',
        folder: 'Album',
        files: [expect.objectContaining({ filename: 'a.flac', durationSeconds: null })]
      })
    }))
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Queued 2 file(s)'))
  })

  it('surfaces a per-file failure and toasts an error', async () => {
    const enqueue = vi.fn(
      async (): Promise<SlskdEnqueueResult> => ({
        username: 'bob',
        accepted: 0,
        alreadyInProgress: 0,
        errors: [{ filename: 'a.flac', error: 'boom' }]
      })
    )
    const { c, flashToast } = makeController({ enqueue })
    await c.runSearch('A', 'x')
    await c.enqueueCandidate(candidate('bob', 'Album'))
    expect(c.current?.enqueueStatus['bob|Album']).toBe('err')
    expect(flashToast).toHaveBeenCalledWith('err', expect.stringContaining('failed'))
  })
})

describe('SlskdController — successful uploader browsing', () => {
  it('opens any username in the shared uploader browser', async () => {
    const { c, slskd } = makeController()
    c.openPeer('MrWhatNot')
    expect(c.tab).toBe('uploaders')
    await flush()
    expect(slskd.browseUser).toHaveBeenCalledWith({ username: 'MrWhatNot' })
  })

  it('loads a known uploader and queues a browsed album with a durable intent', async () => {
    const album = {
      folder: 'Music\\Miles Davis\\Kind of Blue',
      name: 'Kind of Blue',
      guessedArtist: 'Miles Davis',
      guessedAlbum: 'Kind of Blue',
      formatSummary: '2 · flac',
      files: [
        { filename: 'Music\\Miles Davis\\Kind of Blue\\01.flac', size: 10, bitRate: null, length: 500, extension: 'flac' },
        { filename: 'Music\\Miles Davis\\Kind of Blue\\02.flac', size: 20, bitRate: null, length: 600, extension: 'flac' }
      ]
    }
    const browseUser = vi.fn(async () => ({
      username: 'alice', albums: [album], directoryCount: 1, fileCount: 2
    }))
    const { c, slskd } = makeController({ slskd: { browseUser } })
    await c.browsePeer('alice')
    expect(c.peerBrowse?.result?.albums).toHaveLength(1)
    await c.enqueueBrowseAlbum(album)
    expect(slskd.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      username: 'alice',
      intent: expect.objectContaining({
        artist: 'Miles Davis', album: 'Kind of Blue', expectedTrackCount: 2
      })
    }))
    expect(c.peerBrowse?.enqueueStatus[album.folder]).toBe('ok')
  })
})

describe('SlskdController — config / health / cleanup', () => {
  it('does not poll downloads while slskd is unconfigured', async () => {
    const { c, slskd } = makeController({
      slskd: { getConfig: vi.fn(async () => ({ url: '', apiKey: '' })) }
    })
    await c.activate()
    await flush()
    expect(slskd.listDownloads).not.toHaveBeenCalled()
  })

  it('starts download polling after the first valid config is saved', async () => {
    const { c, slskd } = makeController({
      slskd: { getConfig: vi.fn(async () => ({ url: '', apiKey: '' })) }
    })
    await c.activate()
    await c.saveConfig('http://slskd', 'key')
    await flush()
    expect(slskd.listDownloads).toHaveBeenCalledTimes(1)
    c.stopDownloadsPolling()
  })

  it('saveConfig persists, stores the config, and refreshes health', async () => {
    const { c, slskd } = makeController()
    await c.saveConfig('http://new', 'key2')
    expect(slskd.setConfig).toHaveBeenCalledWith({ url: 'http://new', apiKey: 'key2' })
    expect(c.config).toEqual({ url: 'http://new', apiKey: 'key2' })
    await flush()
    expect(slskd.health).toHaveBeenCalled()
  })

  it('refreshHealth records an unreachable server when the call throws', async () => {
    const { c } = makeController({
      slskd: {
        health: vi.fn(async () => {
          throw new Error('ECONNREFUSED')
        })
      }
    })
    c.config = { url: 'http://slskd', apiKey: 'k' }
    await c.refreshHealth()
    expect(c.health).toMatchObject({ ok: false, reachable: false, error: 'ECONNREFUSED' })
  })

  it('ensureConfigLoaded only fetches once', async () => {
    const { c, slskd } = makeController()
    await c.ensureConfigLoaded()
    await c.ensureConfigLoaded()
    expect(slskd.getConfig).toHaveBeenCalledTimes(1)
  })

  it('removeDownloadsByFolder bulk-removes the slskd dir whose leaf matches', async () => {
    const { c, slskd } = makeController({
      slskd: { listDownloads: vi.fn(async () => downloadsWith('bob', '/dl/Gimme Fiction', ['1', '2'])) }
    })
    await c.removeDownloadsByFolder('Gimme Fiction')
    expect(slskd.removeDownloadsBulk).toHaveBeenCalledWith({ username: 'bob', ids: ['1', '2'] })
  })

  it('removeDownloadsByFolder does nothing when no leaf matches', async () => {
    const { c, slskd } = makeController({
      slskd: { listDownloads: vi.fn(async () => downloadsWith('bob', '/dl/Something Else', ['1'])) }
    })
    await c.removeDownloadsByFolder('Gimme Fiction')
    expect(slskd.removeDownloadsBulk).not.toHaveBeenCalled()
  })
})

describe('SlskdController — tab / filter toggles', () => {
  it('setTab switches the active tab', () => {
    const { c } = makeController()
    c.setTab('downloads')
    expect(c.tab).toBe('downloads')
  })

  it('setDownloadsFilter toggles back to "all" when re-selected', () => {
    const { c } = makeController()
    c.setDownloadsFilter('errored')
    expect(c.downloadsFilter).toBe('errored')
    c.setDownloadsFilter('errored')
    expect(c.downloadsFilter).toBe('all')
  })
})
