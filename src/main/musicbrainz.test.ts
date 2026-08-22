import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PlexTrack } from '../shared/plex.js'

// musicbrainz.ts pulls in Electron-backed modules (electron-store, app paths).
// Stub the whole boundary: caches always miss, persistence is a no-op. The
// unit under test is the HTTP/retry layer and the MB-JSON shaping logic.
vi.mock('./store.js', () => ({
  getAlbumMatch: vi.fn(() => null)
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
vi.mock('./tagger.js', () => ({ identifyMusicFiles: vi.fn(async () => []) }))

import {
  _setFetchForTests,
  findLpForTrack,
  getAlbumCreditsCached,
  mbFetch,
  searchComposerByName,
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

describe('searchComposerByName', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })
  it('constrains surname guesses to Person and returns canonical identity', async () => {
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      expect(decodeURIComponent(String(input))).toContain('Beethoven AND type:person')
      return jsonResponse({ artists: [
        { id: 'band', name: 'Beethoven', type: 'Group', score: 100 },
        {
          id: '1f9df192-7495-4c22-bb85-e16f2613d91d',
          name: 'Ludwig van Beethoven',
          type: 'Person',
          score: 100,
          disambiguation: 'German composer'
        }
      ] })
    })
    _setFetchForTests(fetchStub)

    await expect(settle(searchComposerByName('Beethoven'))).resolves.toEqual({
      mbid: '1f9df192-7495-4c22-bb85-e16f2613d91d',
      name: 'Ludwig van Beethoven',
      type: 'Person',
      score: 100,
      disambiguation: 'German composer'
    })
  })
})

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

  it('broadens a zero-hit quoted compilation title into required title words', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ count: 0, releases: [] }))
      .mockResolvedValueOnce(jsonResponse({
        count: 1,
        releases: [{
          id: 'ab4e9fce-5f69-4590-93a6-f56d95c4837c',
          title: 'Holst: The Planets / Williams: Star Wars Suite',
          'track-count': 13
        }]
      }))
    _setFetchForTests(fetchStub)

    const out = await settle(
      searchReleaseCandidates('Zubin Mehta', 'Holst: The Planets / J. Williams: Star Wars')
    )

    expect(out).toHaveLength(1)
    expect(out[0].mbid).toBe('ab4e9fce-5f69-4590-93a6-f56d95c4837c')
    expect(fetchStub).toHaveBeenCalledTimes(2)
    const fallbackUrl = decodeURIComponent(String(fetchStub.mock.calls[1][0]))
    expect(fallbackUrl).toContain(
      'release:Holst AND release:Planets AND release:Williams AND release:Star AND release:Wars AND artist:"Zubin Mehta"'
    )
    expect(fallbackUrl).not.toContain('release:J')
  })

  it('normalizes a spelled-out number when broadening a classical title', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ count: 0, releases: [] }))
      .mockResolvedValueOnce(jsonResponse({
        releases: [{ id: 'bach-skeen', title: 'The 6 Cello Suites of J.S. Bach', 'track-count': 36 }]
      }))
    _setFetchForTests(fetchStub)

    const out = await settle(
      searchReleaseCandidates('William Skeen', 'The Six Cello Suites Of J.S. Bach')
    )

    expect(out[0]?.mbid).toBe('bach-skeen')
    const fallbackUrl = decodeURIComponent(String(fetchStub.mock.calls[1][0]))
    expect(fallbackUrl).toContain('release:6')
    expect(fallbackUrl).not.toContain('release:Six')
  })

  it('drops an over-specific artist constraint after both constrained searches fail', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ releases: [] }))
      .mockResolvedValueOnce(jsonResponse({ releases: [] }))
      .mockResolvedValueOnce(jsonResponse({
        releases: [{ id: 'hahn', title: 'Violin Concertos', 'track-count': 6 }]
      }))
    _setFetchForTests(fetchStub)

    const out = await settle(
      searchReleaseCandidates(
        'Schoenberg | Sibelius | Hilary Hahn | Swedish Radio Symphony Orchestra',
        'Violin Concertos'
      )
    )

    expect(out[0]?.mbid).toBe('hahn')
    expect(fetchStub).toHaveBeenCalledTimes(3)
    const fallbackUrl = decodeURIComponent(String(fetchStub.mock.calls[2][0]))
    expect(fallbackUrl).toContain('release:Violin AND release:Concertos')
    expect(fallbackUrl).not.toContain('artist:')
  })

  it('does not require a leading composer prefix inside the release title', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ releases: [] }))
      .mockResolvedValueOnce(jsonResponse({
        releases: [{
          id: 'oue-hdcd',
          title: 'Fanfare for the Common Man / Appalachian Spring / Symphony no. 3',
          'track-count': 6
        }]
      }))
    _setFetchForTests(fetchStub)

    const out = await settle(
      searchReleaseCandidates(
        'Aaron Copland',
        'Copland: Fanfare for the Common Man, Appalachian Spring & Symphony No. 3'
      )
    )

    expect(out[0]?.mbid).toBe('oue-hdcd')
    const exactUrl = decodeURIComponent(String(fetchStub.mock.calls[0][0]))
    const fallbackUrl = decodeURIComponent(String(fetchStub.mock.calls[1][0]))
    expect(exactUrl).toContain(
      'release:"Fanfare for the Common Man, Appalachian Spring & Symphony No. 3"'
    )
    expect(fallbackUrl).not.toContain('release:Copland')
    expect(fallbackUrl).toContain('artist:"Aaron Copland"')
  })
})

describe('findLpForTrack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })

  const recordingHit = (releases: unknown[]): Response =>
    jsonResponse({ recordings: [{ id: 'rec-1', title: 'Night Terrors', score: 100, releases }] })

  it('skips singles and compilations, returning the earliest official LP', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      recordingHit([
        {
          id: 'rel-single',
          title: 'Night Terrors',
          status: 'Official',
          date: '2021-01-15',
          'release-group': { id: 'rg-s', 'primary-type': 'Single' }
        },
        {
          id: 'rel-comp',
          title: 'Now That Is Music 99',
          status: 'Official',
          date: '2021-06-01',
          'release-group': {
            id: 'rg-c',
            'primary-type': 'Album',
            'secondary-types': ['Compilation']
          }
        },
        {
          id: 'rel-lp-late',
          title: 'Thank You (deluxe)',
          status: 'Official',
          date: '2022-03-04',
          'release-group': { id: 'rg-a', 'primary-type': 'Album' }
        },
        {
          id: 'rel-lp',
          title: 'Thank You',
          status: 'Official',
          date: '2021-09-10',
          'release-group': { id: 'rg-a', 'primary-type': 'Album', 'secondary-types': [] }
        }
      ])
    )
    _setFetchForTests(fetchStub)

    const out = await settle(findLpForTrack('Diet Cig', 'Night Terrors', 'Night Terrors'))
    expect(out).toEqual({ album: 'Thank You', mbid: 'rel-lp' })
  })

  it('keeps the export album when it already is one of the LPs', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      recordingHit([
        {
          id: 'rel-early',
          title: 'Early Album',
          status: 'Official',
          date: '2015',
          'release-group': { id: 'rg-1', 'primary-type': 'Album' }
        },
        {
          id: 'rel-src',
          title: 'Saint Cloud',
          status: 'Official',
          date: '2020-03-27',
          'release-group': { id: 'rg-2', 'primary-type': 'Album' }
        }
      ])
    )
    _setFetchForTests(fetchStub)

    const out = await settle(findLpForTrack('Waxahatchee', 'Fire', 'Saint Cloud'))
    expect(out).toEqual({ album: 'Saint Cloud', mbid: 'rel-src' })
  })

  it('returns null when the track only ever appeared on singles', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      recordingHit([
        {
          id: 'rel-single',
          title: 'A Palé',
          status: 'Official',
          date: '2019',
          'release-group': { id: 'rg-s', 'primary-type': 'Single' }
        }
      ])
    )
    _setFetchForTests(fetchStub)

    const out = await settle(findLpForTrack('ROSALÍA', 'A Palé', 'A Palé'))
    expect(out).toBeNull()
  })

  it('queries MB with the primary artist and a feat-stripped title', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ recordings: [] }))
    _setFetchForTests(fetchStub)

    await settle(
      findLpForTrack('Whitney;Waxahatchee', 'Take Me Home, Country Roads (ft. Waxahatchee)', null)
    )
    const [url] = fetchStub.mock.calls[0]
    const decoded = decodeURIComponent(String(url))
    expect(decoded).toContain('recording:"Take Me Home, Country Roads"')
    expect(decoded).toContain('artist:"Whitney"')
    expect(decoded).not.toContain('Waxahatchee')
  })

  it('ignores low-score recordings', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        recordings: [
          {
            id: 'rec-weak',
            title: 'Something Else',
            score: 45,
            releases: [
              {
                id: 'rel-x',
                title: 'Wrong Album',
                status: 'Official',
                date: '2010',
                'release-group': { id: 'rg-x', 'primary-type': 'Album' }
              }
            ]
          }
        ]
      })
    )
    _setFetchForTests(fetchStub)

    expect(await settle(findLpForTrack('Someone', 'Some Song', null))).toBeNull()
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
      if (url.includes(`/release/${RELEASE_MBID}`)) {
        const includes = new URL(url).searchParams.get('inc')?.split(' ') ?? []
        expect(includes).toContain('work-rels')
        expect(includes).toContain('work-level-rels')
        return jsonResponse(cannedRelease)
      }
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
        [{
          ratingKey: 'plexTrack-1',
          title: 'Opener',
          index: 1,
          parentIndex: 1,
          duration: null,
          originalTitle: null,
          guids: []
        }]
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
    expect(credits!.classical).toMatchObject({
      source: 'reconciled',
      alignmentConfidence: 'strong',
      matchedTracks: 1,
      totalTracks: 1,
      alignment: {
        recordingGuid: 0,
        releaseTrackGuid: 0,
        discIndex: 1,
        titleDuration: 0,
        unmatched: 0
      },
      composers: [
        { person: { mbid: 'c-1', name: 'Composer Person' }, trackCount: 1 }
      ]
    })
    expect(credits!.classical?.byTrack['plexTrack-1']).toEqual({
      matchMethod: 'disc-index',
      releaseTrackMbid: 't-1',
      recordingMbid: 'rec-1',
      workMbid: 'w-1',
      workTitle: 'Opener (work)',
      parentWorkMbid: null,
      parentWorkTitle: null,
      composers: [{ mbid: 'c-1', name: 'Composer Person' }]
    })
    expect(credits!.members).toEqual([{ mbid: 'm-1', name: 'Member One' }])
    // Plex guid carried a release MBID → no search request needed; one release
    // lookup + one artist-rels lookup.
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('aligns a partial Plex disc to a multi-disc MB release by bare release-track GUID', async () => {
    const fixture = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../shared/__fixtures__/classical/${name}`, import.meta.url)),
          'utf8'
        )
      )
    const plex = fixture('schiff-bach-partitas-MATCHED.plex.json') as {
      album: { title: string; parentTitle: string; year: number; guids: string[] }
      tracks: PlexTrack[]
    }
    const release = fixture('schiff-bach-partitas-MATCHED.mb.json') as {
      id: string
      'artist-credit'?: Array<{ artist?: { id?: string } }>
    }
    const artistMbid = release['artist-credit']?.[0]?.artist?.id
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes(`/release/${release.id}`)) return jsonResponse(release)
      if (artistMbid && url.includes(`/artist/${artistMbid}`)) {
        return jsonResponse({ id: artistMbid, relations: [] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    _setFetchForTests(fetchStub)

    const credits = await settle(
      getAlbumCreditsCached(
        'fixture-schiff-partitas-cd1',
        plex.album.parentTitle,
        plex.album.title,
        plex.album.year,
        plex.album.guids,
        plex.tracks
      )
    )

    expect(credits?.classical).toMatchObject({
      source: 'exact',
      alignmentConfidence: 'exact',
      matchedTracks: 27,
      totalTracks: 27,
      alignment: {
        recordingGuid: 0,
        releaseTrackGuid: 27,
        discIndex: 0,
        titleDuration: 0,
        unmatched: 0
      },
      composers: [
        {
          person: {
            mbid: '24f1766e-9635-4d58-a4d4-9413f9f98a4c',
            name: 'Johann Sebastian Bach'
          },
          trackCount: 27
        }
      ]
    })
    expect(credits?.classical?.byTrack['68795']).toMatchObject({
      matchMethod: 'release-track-guid',
      releaseTrackMbid: '57b1f91f-9bfe-391f-b811-420acb88e760',
      recordingMbid: 'a7975b6a-6187-4c9c-988b-680f74561c16',
      parentWorkTitle: 'Partita no. 5 in G major, BWV 829'
    })
  })

  it('recovers a retitled unmatched box by composer token and exact disc signature', async () => {
    const plex = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../shared/__fixtures__/classical/le-sage-schumann.plex.json', import.meta.url)
        ),
        'utf8'
      )
    ) as {
      album: { title: string; parentTitle: string; year: number; guids: string[] }
      tracks: PlexTrack[]
    }
    const releaseId = 'b1e930ea-2038-4c73-8c2a-b965fe4dea22'
    const composer = {
      id: '3cd3882c-00f8-4362-a0c2-ad89ed248533',
      name: 'Robert Schumann',
      'sort-name': 'Schumann, Robert'
    }
    const tracksByDisc = new Map<number, PlexTrack[]>()
    for (const item of plex.tracks) {
      if (item.parentIndex == null) continue
      const list = tracksByDisc.get(item.parentIndex) ?? []
      list.push(item)
      tracksByDisc.set(item.parentIndex, list)
    }
    const media = [...tracksByDisc].map(([position, tracks]) => ({
      position,
      tracks: tracks.map((item) => ({
        id: `mb-track-${item.ratingKey}`,
        position: item.index,
        number: String(item.index),
        recording: {
          id: `recording-${item.ratingKey}`,
          title: `MusicBrainz title ${item.ratingKey}`,
          length: item.duration,
          relations: [{
            type: 'performance',
            work: {
              id: `work-${item.ratingKey}`,
              title: `Work ${item.ratingKey}`,
              relations: [{ type: 'composer', artist: composer }]
            }
          }]
        }
      }))
    }))
    const release = {
      id: releaseId,
      title: 'Schumann Project: The Complete Piano Music',
      'artist-credit': [{ artist: composer }],
      'release-group': { id: 'schumann-rg', 'first-release-date': '2012-10' },
      media
    }
    const searchCandidate = {
      id: releaseId,
      title: release.title,
      score: 100,
      date: '2012-10',
      media: media.map((medium) => ({ 'track-count': medium.tracks.length }))
    }
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/ws/2/release' && url.searchParams.get('query')?.includes(plex.album.title)) {
        return jsonResponse({ releases: [] })
      }
      if (url.pathname === '/ws/2/release') return jsonResponse({ releases: [searchCandidate] })
      if (url.pathname.endsWith(`/release/${releaseId}`)) return jsonResponse(release)
      if (url.pathname.endsWith(`/artist/${composer.id}`)) {
        return jsonResponse({ id: composer.id, relations: [] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    _setFetchForTests(fetchStub)

    const credits = await settle(
      getAlbumCreditsCached(
        'fixture-le-sage-retitled',
        plex.album.parentTitle,
        plex.album.title,
        plex.album.year,
        plex.album.guids,
        plex.tracks
      )
    )

    expect(credits?.releaseMbid).toBe(releaseId)
    expect(credits?.classical).toMatchObject({
      source: 'reconciled',
      alignmentConfidence: 'strong',
      matchedTracks: 331,
      totalTracks: 331,
      alignment: {
        recordingGuid: 0,
        releaseTrackGuid: 0,
        discIndex: 331,
        titleDuration: 0,
        unmatched: 0
      },
      composers: [{ person: { mbid: composer.id, name: composer.name }, trackCount: 331 }]
    })
  })

  it('does not trust disc coordinates when Plex and MB split the release differently', async () => {
    const releaseId = '22222222-3333-4444-5555-666666666666'
    const composer = { id: 'beethoven', name: 'Ludwig van Beethoven' }
    const mbTrack = (id: string, position: number) => ({
      id: `mb-${id}`,
      position,
      number: String(position),
      recording: {
        id: `recording-${id}`,
        title: `Unrelated MB title ${id}`,
        length: 60_000,
        relations: [{
          type: 'performance',
          work: {
            id: `work-${id}`,
            title: `Work ${id}`,
            relations: [{ type: 'composer', artist: composer }]
          }
        }]
      }
    })
    const release = {
      id: releaseId,
      title: 'Different disc layout',
      'artist-credit': [{ artist: composer }],
      media: [{ position: 1, tracks: [mbTrack('a', 1), mbTrack('b', 2)] }]
    }
    const plexTracks: PlexTrack[] = [
      {
        ratingKey: 'plex-a',
        title: 'Plex title A',
        index: 1,
        parentIndex: 1,
        duration: 60_000,
        originalTitle: null,
        guids: []
      },
      {
        ratingKey: 'plex-b',
        title: 'Plex title B',
        index: 1,
        parentIndex: 2,
        duration: 60_000,
        originalTitle: null,
        guids: []
      }
    ]
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes(`/release/${releaseId}`)) return jsonResponse(release)
      if (url.includes(`/artist/${composer.id}`)) {
        return jsonResponse({ id: composer.id, relations: [] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    _setFetchForTests(fetchStub)

    const credits = await settle(
      getAlbumCreditsCached(
        'fixture-mismatched-layout',
        'Performer',
        'Retitled album',
        null,
        [`mbid://release/${releaseId}`],
        plexTracks
      )
    )

    expect(credits?.classical).toMatchObject({
      source: 'none',
      alignmentConfidence: 'none',
      matchedTracks: 0,
      totalTracks: 2,
      alignment: {
        recordingGuid: 0,
        releaseTrackGuid: 0,
        discIndex: 0,
        titleDuration: 0,
        unmatched: 2
      },
      composers: []
    })
    expect(credits?.classical?.byTrack['plex-a']).toMatchObject({
      matchMethod: 'none',
      workMbid: null,
      composers: []
    })
  })
})
