import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// musicbrainz.ts pulls in Electron-backed modules (electron-store, app paths).
// Stub the whole boundary: caches always miss, persistence is a no-op. The
// unit under test is the HTTP/retry layer and the MB-JSON shaping logic.
vi.mock('./store.js', () => ({
  getAlbumMatch: vi.fn(() => null)
}))
vi.mock('./mb-cache.js', () => ({
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
  getAlbumCreditsCached,
  mbFetch,
  searchReleaseCandidates
} from './musicbrainz.js'

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status })
}

/** Run a paced/backoff-laden promise to completion under fake timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined) // rejection observed by the caller via the returned promise
  await vi.runAllTimersAsync()
  return p
}

describe('mbFetch retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })

  it('retries a 503 and succeeds on the next attempt', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('<html><title>MusicBrainz is under maintenance</title></html>', 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    _setFetchForTests(fetchStub)

    const result = await settle(mbFetch<{ ok: boolean }>('/release/abc?fmt=json'))
    expect(result).toEqual({ ok: true })
    expect(fetchStub).toHaveBeenCalledTimes(2)
    // Same URL both times, MB base prefixed, UA header set.
    const [url, init] = fetchStub.mock.calls[0]
    expect(url).toBe('https://musicbrainz.org/ws/2/release/abc?fmt=json')
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/cratedigger/)
  })

  it('retries transient network errors (no status code) up to 3 attempts then throws', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
    _setFetchForTests(fetchStub)

    await expect(settle(mbFetch('/artist/x?fmt=json'))).rejects.toThrow('fetch failed')
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })

  it('fails fast on 4xx without retrying', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(textResponse('Not Found', 404))
    _setFetchForTests(fetchStub)

    await expect(settle(mbFetch('/release/nope?fmt=json'))).rejects.toThrow(
      'MusicBrainz 404: Not Found'
    )
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('summarizes HTML error bodies down to the <title> instead of dumping markup', async () => {
    const html = '<html><head><title>MusicBrainz is under maintenance</title></head><body><h1>503</h1>lots of markup</body></html>'
    // 4xx so it surfaces immediately (5xx HTML pages get the same summarizer).
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(textResponse(html, 400))
    _setFetchForTests(fetchStub)

    await expect(settle(mbFetch('/x'))).rejects.toThrow(
      'MusicBrainz 400: MusicBrainz is under maintenance'
    )
  })
})

describe('searchReleaseCandidates shaping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })

  it('maps MB search hits to candidates with artist join and media-derived track count', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        releases: [
          {
            id: 'rel-1',
            title: 'Beleléu, leléu, eu',
            status: 'Official',
            date: '1980',
            country: 'BR',
            'artist-credit': [{ name: 'Itamar Assumpção' }, { artist: { name: 'Banda Isca de Polícia' } }],
            media: [{ 'track-count': 13 }]
          },
          {
            id: 'rel-2',
            title: 'Beleléu (reissue)',
            'track-count': 14
          }
        ]
      })
    )
    _setFetchForTests(fetchStub)

    const out = await settle(searchReleaseCandidates('Itamar Assumpção', 'Beleléu'))
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      mbid: 'rel-1',
      title: 'Beleléu, leléu, eu',
      artistName: 'Itamar Assumpção, Banda Isca de Polícia',
      date: '1980',
      country: 'BR',
      status: 'Official',
      disambiguation: null,
      trackCount: 13
    })
    // Top-level track-count wins when media is absent.
    expect(out[1].trackCount).toBe(14)
    expect(out[1].date).toBeNull()
  })

  it('returns [] without any HTTP when both artist and title are blank', async () => {
    const fetchStub = vi.fn<typeof fetch>()
    _setFetchForTests(fetchStub)
    expect(await searchReleaseCandidates('  ', '')).toEqual([])
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

describe('getAlbumCreditsCached credit collection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })

  const RELEASE_MBID = '11111111-2222-3333-4444-555555555555'

  const cannedRelease = {
    id: RELEASE_MBID,
    title: 'Test Album',
    country: 'US',
    status: 'Official',
    'artist-credit': [{ artist: { id: 'artist-1', name: 'The Band' } }],
    'release-group': {
      id: 'rg-1',
      'first-release-date': '1984-06-01',
      'primary-type': 'Album'
    },
    relations: [
      { type: 'producer', artist: { id: 'p-1', name: 'Rick Rubin' } },
      { type: 'design', work: { id: 'w-x', title: 'irrelevant' } } // no artist → dropped
    ],
    media: [
      {
        position: 1,
        tracks: [
          {
            id: 't-1',
            position: 1,
            number: '1',
            'artist-credit': [{ artist: { id: 'artist-1', name: 'The Band' } }],
            recording: {
              id: 'rec-1',
              title: 'Opener',
              relations: [
                {
                  type: 'instrument',
                  attributes: ['guitar'],
                  artist: { id: 'g-1', name: 'Guitar Person' }
                },
                {
                  type: 'performance',
                  work: {
                    id: 'w-1',
                    title: 'Opener (work)',
                    relations: [{ type: 'composer', artist: { id: 'c-1', name: 'Composer Person' } }]
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  }

  const cannedArtistRels = {
    id: 'artist-1',
    relations: [
      {
        type: 'member of band',
        direction: 'backward',
        artist: { id: 'm-1', name: 'Member One' }
      },
      { type: 'collaboration', direction: 'backward', artist: { id: 'x-1', name: 'Not a member' } }
    ]
  }

  it('collects release-level, recording-level, and work-level credits plus band members', async () => {
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes(`/release/${RELEASE_MBID}`)) return jsonResponse(cannedRelease)
      if (url.includes('/artist/artist-1')) return jsonResponse(cannedArtistRels)
      throw new Error(`unexpected fetch: ${url}`)
    })
    _setFetchForTests(fetchStub)

    const credits = await settle(
      getAlbumCreditsCached(
        'plex-123',
        'The Band',
        'Test Album',
        1984,
        [`mbid://release/${RELEASE_MBID}`],
        ['plexTrack-1']
      )
    )

    expect(credits).not.toBeNull()
    expect(credits!.releaseMbid).toBe(RELEASE_MBID)
    expect(credits!.originalDate).toBe('1984-06-01')
    expect(credits!.primaryType).toBe('Album')
    expect(credits!.releaseLevel).toEqual([
      { role: 'producer', person: { mbid: 'p-1', name: 'Rick Rubin' } }
    ])
    expect(credits!.byTrack['plexTrack-1']).toEqual([
      {
        role: 'instrument',
        instrument: 'guitar',
        person: { mbid: 'g-1', name: 'Guitar Person' }
      },
      {
        role: 'composer',
        instrument: null,
        person: { mbid: 'c-1', name: 'Composer Person' }
      }
    ])
    expect(credits!.trackArtists['plexTrack-1']).toEqual([
      { mbid: 'artist-1', name: 'The Band' }
    ])
    expect(credits!.members).toEqual([{ mbid: 'm-1', name: 'Member One' }])
    // Plex guid carried a release MBID → no search request needed; one release
    // lookup + one artist-rels lookup.
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })
})
