import { afterEach, describe, expect, it, vi } from 'vitest'

// slskd.ts reaches electron-store for the slskd URL/key, and imports
// musicbrainz.ts (which drags in the Electron-backed caches). Stub the lot —
// these tests exercise the pure scoring/parsing core and the fetch seam.
vi.mock('./store.js', () => ({
  getSlskdUrl: vi.fn(() => 'http://slskd.test:5030/'),
  getSlskdApiKey: vi.fn(() => 'test-key'),
  getAlbumMatch: vi.fn(() => null),
  getValue: vi.fn(() => ({}))
}))
vi.mock('./mb-cache.js', () => ({
  ALBUM_CREDITS_BUCKET: 'album-credits-v5',
  JsonCache: class {
    async get(): Promise<undefined> {
      return undefined
    }

    async set(): Promise<void> {}

    async delete(): Promise<void> {}
  }
}))
vi.mock('./credit-index.js', () => ({
  invalidateCreditIndex: vi.fn()
}))
vi.mock('./original-years.js', () => ({
  originalYears: {
    record: vi.fn(async () => {}),
    has: vi.fn(async () => false),
    overlay: vi.fn(async () => {})
  }
}))

import {
  _setFetchForTests,
  buildSearchQueries,
  browseAlbumsFromResponse,
  cleanStem,
  containment,
  groupCandidatesByAlbum,
  guessArtistAlbum,
  jaccard,
  qualityScore,
  rankResponses,
  similarity,
  slskdHealth,
  splitPath,
  tokens
} from './slskd.js'
import { getSlskdUrl } from './store.js'

afterEach(() => {
  _setFetchForTests((...args) => globalThis.fetch(...args))
  vi.mocked(getSlskdUrl).mockReturnValue('http://slskd.test:5030/')
})

describe('tokens', () => {
  it('lowercases, strips punctuation/symbols, drops single-char tokens', () => {
    expect(tokens('Açaí & The Band - Vol. 2!')).toEqual(['açaí', 'the', 'band', 'vol'])
  })

  it('handles unicode letters and numbers', () => {
    expect(tokens('Beleléu, leléu, eu (1980)')).toEqual(['beleléu', 'leléu', 'eu', '1980'])
  })
})

describe('jaccard / containment / similarity', () => {
  it('jaccard is intersection over union of unique tokens', () => {
    expect(jaccard(['a1', 'b1'], ['b1', 'c1'])).toBeCloseTo(1 / 3)
    expect(jaccard([], ['x1'])).toBe(0)
    expect(jaccard(['x1'], ['x1'])).toBe(1)
  })

  it('containment is the fraction of query tokens present in the target', () => {
    expect(containment(['aa', 'bb'], ['aa', 'bb', 'cc', 'dd'])).toBe(1)
    expect(containment(['aa', 'zz'], ['aa'])).toBe(0.5)
    expect(containment([], ['aa'])).toBe(0)
  })

  it('similarity takes the max, so a query fully contained in a long target still scores 1', () => {
    // Jaccard would be diluted by the extra target tokens; containment saves it.
    expect(similarity('Madvillainy', 'Madvillain Madvillainy 2004 FLAC 16bit')).toBe(1)
    expect(similarity('', 'whatever')).toBe(0)
  })
})

describe('buildSearchQueries', () => {
  it('falls back from "artist album" to album-only to artist-only', () => {
    expect(buildSearchQueries('The Beatles', 'Abbey Road')).toEqual([
      'The Beatles Abbey Road',
      'Abbey Road',
      'The Beatles'
    ])
  })

  it('emits a single query when only one field is present', () => {
    expect(buildSearchQueries('', 'Abbey Road')).toEqual(['Abbey Road'])
    expect(buildSearchQueries('The Beatles', '')).toEqual(['The Beatles'])
  })

  it('dedupes when artist and album would collide and trims whitespace', () => {
    expect(buildSearchQueries('  Justice  ', '  Justice  ')).toEqual([
      'Justice Justice',
      'Justice'
    ])
  })

  it('returns nothing to search on empty input', () => {
    expect(buildSearchQueries('', '')).toEqual([])
  })
})

describe('cleanStem', () => {
  it('strips extension, leading track numbers, and trailing junk', () => {
    expect(cleanStem('01. Accordion.flac')).toBe('Accordion')
    expect(cleanStem('07 - Raid [320].mp3')).toBe('Raid')
    expect(cleanStem('A1 - Fancy Clown.flac')).toBe('Fancy Clown')
    expect(cleanStem('Great Day (1999).mp3')).toBe('Great Day')
  })
})

describe('splitPath', () => {
  it('splits on both backslashes (soulseek) and forward slashes', () => {
    expect(splitPath('@@abc\\Music\\MF DOOM\\Madvillainy\\01 - The Illest Villains.flac')).toEqual([
      '@@abc',
      'Music',
      'MF DOOM',
      'Madvillainy',
      '01 - The Illest Villains.flac'
    ])
    expect(splitPath('music/Artist/Album/track.mp3')).toEqual([
      'music',
      'Artist',
      'Album',
      'track.mp3'
    ])
  })
})

describe('guessArtistAlbum', () => {
  it('Artist/Album/track layout: parent is artist, folder is album', () => {
    const g = guessArtistAlbum(['Music', 'MF DOOM', 'Madvillainy', '01 - track.flac'])
    expect(g).toEqual({ artist: 'MF DOOM', album: 'Madvillainy', folder: 'Madvillainy' })
  })

  it('"Artist - Album (year)" combined folder: splits on the dash, strips the year', () => {
    const g = guessArtistAlbum(['shares', 'Madvillain - Madvillainy (2004)', '01.flac'])
    expect(g).toEqual({
      artist: 'Madvillain',
      album: 'Madvillainy',
      folder: 'Madvillain - Madvillainy (2004)'
    })
  })

  it('keeps extra dashed segments in the album title', () => {
    const g = guessArtistAlbum(['x', 'Artist - Album - Deluxe', 't.mp3'])
    expect(g.artist).toBe('Artist')
    expect(g.album).toBe('Album - Deluxe')
  })

  it('bare folder with no parent: album only', () => {
    const g = guessArtistAlbum(['Madvillainy (2004)', '01.flac'])
    expect(g).toEqual({ artist: null, album: 'Madvillainy', folder: 'Madvillainy (2004)' })
  })
})

describe('browseAlbumsFromResponse', () => {
  it('turns a user share into alphabetized audio-bearing album folders', () => {
    const result = browseAlbumsFromResponse({
      directories: [
        {
          name: 'Music\\Miles Davis\\Kind of Blue',
          fileCount: 3,
          files: [
            { filename: '02 - Freddie Freeloader.flac', size: 20, length: 590 },
            { filename: 'cover.jpg', size: 1 },
            { filename: '01 - So What.flac', size: 10, length: 545 }
          ]
        },
        { name: 'Music\\Documents', fileCount: 1, files: [{ filename: 'notes.txt', size: 1 }] }
      ],
      lockedDirectories: []
    })
    expect(result).toMatchObject({ directoryCount: 2, fileCount: 4 })
    expect(result.albums).toHaveLength(1)
    expect(result.albums[0]).toMatchObject({
      name: 'Kind of Blue',
      guessedArtist: 'Miles Davis',
      guessedAlbum: 'Kind of Blue'
    })
    expect(result.albums[0].files.map((f) => f.filename)).toEqual([
      'Music\\Miles Davis\\Kind of Blue\\01 - So What.flac',
      'Music\\Miles Davis\\Kind of Blue\\02 - Freddie Freeloader.flac'
    ])
  })
})

describe('qualityScore', () => {
  const base = {
    bitRate: null,
    hasFreeUploadSlot: false,
    uploadSpeed: 0,
    queueLength: 0
  }

  it('prefers lossless over lossy formats', () => {
    const flac = qualityScore({ ...base, extension: 'flac' })
    const mp3 = qualityScore({ ...base, extension: 'mp3' })
    const unknown = qualityScore({ ...base, extension: 'xyz' })
    expect(flac).toBeGreaterThan(mp3)
    expect(mp3).toBeGreaterThan(unknown)
  })

  it('rewards high bitrate, penalizes low bitrate and long queues', () => {
    const mp3320 = qualityScore({ ...base, extension: 'mp3', bitRate: 320 })
    const mp3128 = qualityScore({ ...base, extension: 'mp3', bitRate: 96 })
    expect(mp3320).toBeGreaterThan(mp3128)
    const queued = qualityScore({ ...base, extension: 'flac', queueLength: 50 })
    expect(queued).toBeLessThan(qualityScore({ ...base, extension: 'flac' }))
  })
})

// --- rankResponses: the end-to-end scoring pipeline over canned responses ---

function resp(
  username: string,
  files: Array<{ filename: string; size?: number; bitRate?: number | null }>,
  extra: Partial<{ hasFreeUploadSlot: boolean; uploadSpeed: number; queueLength: number }> = {}
): {
  username: string
  hasFreeUploadSlot: boolean
  uploadSpeed: number
  queueLength: number
  files: Array<{ filename: string; size: number; bitRate?: number | null; length?: number | null }>
} {
  return {
    username,
    hasFreeUploadSlot: extra.hasFreeUploadSlot ?? true,
    uploadSpeed: extra.uploadSpeed ?? 500_000,
    queueLength: extra.queueLength ?? 0,
    files: files.map((f) => ({ size: f.size ?? 30_000_000, bitRate: f.bitRate ?? null, ...f }))
  }
}

const TRACKS = ['The Illest Villains', 'Accordion', 'Meat Grinder']

function folderFiles(folder: string, ext: string): Array<{ filename: string }> {
  return TRACKS.map((t, i) => ({
    filename: `${folder}\\${String(i + 1).padStart(2, '0')} - ${t}.${ext}`
  }))
}

describe('rankResponses', () => {
  it('groups files per user+folder, ranks matching album first, filters junk', () => {
    const responses = [
      resp('goodflac', folderFiles('@@x\\Madvillain - Madvillainy (2004)', 'flac')),
      resp('mp3guy', folderFiles('@@y\\Madvillain - Madvillainy', 'mp3')),
      // Unrelated album from the same search — should be filtered or ranked last.
      resp('noise', [{ filename: '@@z\\Norah Jones - Feels Like Home\\01 - Sunrise.mp3' }]),
      // Non-audio files never make it in.
      resp('coverart', [{ filename: '@@w\\Madvillain - Madvillainy\\cover.jpg' }])
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS)

    const users = out.map((c) => c.username)
    expect(users).not.toContain('noise')
    expect(users).not.toContain('coverart')
    // Format preference: flac share outranks the mp3 share of the same album.
    expect(users[0]).toBe('goodflac')
    expect(users[1]).toBe('mp3guy')

    const top = out[0]
    expect(top.files).toHaveLength(3)
    expect(top.matchedTracks).toBe(3) // all expected MB titles covered
    expect(top.guessedArtist).toBe('Madvillain')
    expect(top.guessedAlbum).toBe('Madvillainy')
    expect(top.formatSummary).toContain('flac')
  })

  it('with expected titles, completeness beats quality: a full mp3 set outranks a partial flac set', () => {
    const responses = [
      resp('partialflac', folderFiles('@@a\\Madvillain - Madvillainy', 'flac').slice(0, 1)),
      resp('fullmp3', folderFiles('@@b\\Madvillain - Madvillainy', 'mp3'))
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS)
    expect(out[0].username).toBe('fullmp3')
    expect(out[0].matchedTracks).toBe(3)
    expect(out[1].matchedTracks).toBe(1)
  })

  it('ranks equally complete lossless sources by upload speed', () => {
    const responses = [
      resp('slow', folderFiles('@@a\\Madvillain - Madvillainy', 'flac'), { uploadSpeed: 500_000 }),
      resp('fast', folderFiles('@@b\\Madvillain - Madvillainy', 'flac'), { uploadSpeed: 5_000_000 })
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS)
    expect(out.map((c) => c.username)).toEqual(['fast', 'slow'])
  })

  it('keeps a complete source ahead of a faster partial source', () => {
    const responses = [
      resp('complete-slow', folderFiles('@@a\\Madvillain - Madvillainy', 'flac'), { uploadSpeed: 100_000 }),
      resp('partial-fast', folderFiles('@@b\\Madvillain - Madvillainy', 'flac').slice(0, 2), { uploadSpeed: 50_000_000 })
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS)
    expect(out.map((c) => c.username)).toEqual(['complete-slow', 'partial-fast'])
  })

  it('attaches persistent prior-success history without overriding speed', () => {
    const responses = [
      resp('trusted-slow', folderFiles('@@a\\Madvillain - Madvillainy', 'flac'), { uploadSpeed: 100_000 }),
      resp('new-fast', folderFiles('@@b\\Madvillain - Madvillainy', 'flac'), { uploadSpeed: 5_000_000 })
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS, {
      'trusted-slow': {
        successfulAlbums: 3,
        failedAlbums: 2,
        successfulFiles: 24,
        averageSpeed: 900_000,
        lastSuccessAt: '2026-08-01T12:00:00.000Z'
      }
    })
    expect(out[0].username).toBe('new-fast')
    expect(out[1]).toMatchObject({ username: 'trusted-slow', successfulAlbums: 3, failedAlbums: 2 })
  })

  it('matches sloppy folder/file naming via token overlap', () => {
    const responses = [
      resp('sloppy', [
        { filename: 'D:\\music\\madvillainy 2004 flac 16bit\\01 the illest villains [remaster].flac' },
        { filename: 'D:\\music\\madvillainy 2004 flac 16bit\\02 accordion.flac' }
      ])
    ]
    const out = rankResponses('Madvillain', 'Madvillainy', responses, TRACKS)
    expect(out).toHaveLength(1)
    expect(out[0].matchedTracks).toBe(2)
  })
})

describe('groupCandidatesByAlbum', () => {
  it('collapses same normalized artist+album into one group, primary = best score', () => {
    const out = rankResponses(
      'Madvillain',
      'Madvillainy',
      [
        resp('a', folderFiles('@@a\\Madvillain - Madvillainy (2004)', 'flac')),
        resp('b', folderFiles('@@b\\Madvillain - madvillainy', 'mp3'))
      ],
      TRACKS
    )
    const groups = groupCandidatesByAlbum(out)
    expect(groups).toHaveLength(1)
    expect(groups[0].primary.username).toBe('a')
    expect(groups[0].alternates.map((c) => c.username)).toEqual(['b'])
  })
})

describe('fetch seam (slskdHealth)', () => {
  it('reports an unconfigured client clearly without attempting a relative fetch', async () => {
    vi.mocked(getSlskdUrl).mockReturnValue('')
    const fetchStub = vi.fn<typeof fetch>()
    _setFetchForTests(fetchStub)

    const health = await slskdHealth()
    expect(health).toMatchObject({ ok: false, reachable: false, error: 'slskd is not configured' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('hits the configured base URL with the API key header and parses the version', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ version: { current: '0.24.1' } }), { status: 200 })
    )
    _setFetchForTests(fetchStub)

    const health = await slskdHealth()
    expect(health).toMatchObject({ ok: true, reachable: true, version: '0.24.1' })

    const [url, init] = fetchStub.mock.calls[0]
    expect(url).toBe('http://slskd.test:5030/api/v0/application') // trailing slash stripped
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('test-key')
  })

  it('reports unreachable on HTTP error instead of throwing', async () => {
    _setFetchForTests(vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 })))
    const health = await slskdHealth()
    expect(health.ok).toBe(false)
    expect(health.reachable).toBe(false)
    expect(health.error).toContain('500')
  })
})
