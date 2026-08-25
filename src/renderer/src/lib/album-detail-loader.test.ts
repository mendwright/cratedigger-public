import { describe, it, expect, vi } from 'vitest'
import type {
  AlbumCredits,
  AlbumDetail,
  AlbumMediaInfo,
  Bio,
  PlexAlbum,
  SimilarArtist
} from '../../../shared/plex'
import { AlbumDetailLoader, type AlbumDetailLoaderDeps } from './album-detail-loader.svelte'
import { LruCache } from './lru'

type PlexApi = Window['cratedigger']['plex']
type TaggerApi = Window['cratedigger']['tagger']

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

// Minimal AlbumDetail — only the fields the rail logic reads.
function detail(opts: {
  ratingKey: string
  studio?: string | null
  artist?: string
  artistRatingKey?: string | null
  genres?: string[]
}): AlbumDetail {
  return {
    album: {
      ratingKey: opts.ratingKey,
      studio: opts.studio ?? null,
      artist: opts.artist ?? 'Open Artist',
      artistRatingKey: opts.artistRatingKey ?? null,
      genres: []
    },
    genres: opts.genres ?? [],
    guids: [],
    tracks: []
  } as unknown as AlbumDetail
}

function libAlbum(opts: {
  ratingKey: string
  studio?: string | null
  year?: number | null
  artist?: string
  artistRatingKey?: string | null
  genres?: string[]
}): PlexAlbum {
  return {
    ratingKey: opts.ratingKey,
    studio: opts.studio ?? null,
    year: opts.year ?? null,
    artist: opts.artist ?? 'Some Artist',
    artistRatingKey: opts.artistRatingKey ?? null,
    genres: opts.genres ?? []
  } as unknown as PlexAlbum
}

function makePlex() {
  return {
    listSimilarArtists: vi.fn(async () => [] as unknown[]),
    getArtistRelations: vi.fn(async () => [] as unknown[]),
    searchArtistByName: vi.fn(async () => null as string | null)
  }
}

function makeTagger() {
  return {
    getRelease: vi.fn(async () => ({ albumartist_ids: [] as string[] }))
  }
}

function makeLoader(
  opts: {
    albums?: PlexAlbum[]
    albumLabels?: Record<string, string[]>
    ensureAllAlbums?: () => Promise<PlexAlbum[]>
    plex?: ReturnType<typeof makePlex>
    tagger?: ReturnType<typeof makeTagger>
    signedIn?: boolean
    originalYearOverride?: (ratingKey: string) => number | null
    mediaInfoFor?: (ratingKey: string) => AlbumMediaInfo | null
  } = {}
) {
  const plex = opts.plex ?? makePlex()
  const tagger = opts.tagger ?? makeTagger()
  const ensureAllAlbums = vi.fn(opts.ensureAllAlbums ?? (async () => opts.albums ?? []))
  const albumLabels = vi.fn(() => opts.albumLabels ?? {})
  const deps: AlbumDetailLoaderDeps = {
    ensureAllAlbums,
    albumLabels,
    session: () =>
      opts.signedIn === false
        ? { signedIn: false }
        : { signedIn: true, user: {} as never, preferredServerId: 'srv-1' },
    plex: plex as unknown as PlexApi,
    tagger: tagger as unknown as TaggerApi,
    originalYearOverride: opts.originalYearOverride,
    mediaInfoFor: opts.mediaInfoFor
  }
  return { loader: new AlbumDetailLoader(deps), plex, tagger, ensureAllAlbums, albumLabels }
}

describe('AlbumDetailLoader — label rail', () => {
  it('matches library albums sharing a label or studio, excludes self, sorts by year desc', async () => {
    const { loader } = makeLoader({
      albums: [
        libAlbum({ ratingKey: 'open', studio: 'Verve' }),
        libAlbum({ ratingKey: 'a', studio: 'Verve', year: 1999 }), // matches studio
        libAlbum({ ratingKey: 'b', year: 2005 }), // matches via indexed label
        libAlbum({ ratingKey: 'c', studio: 'Motown', year: 2001 }) // no shared label
      ],
      albumLabels: { open: ['Blue Note'], b: ['Blue Note'] }
    })
    loader.album = detail({ ratingKey: 'open', studio: 'Verve' })

    await loader.loadLabelRail()

    expect([...loader.labelRailNames].sort()).toEqual(['Blue Note', 'Verve'])
    expect(loader.labelRail?.map((x) => x.ratingKey)).toEqual(['b', 'a']) // 2005 before 1999
    expect(loader.labelRailLoading).toBe(false)
  })

  it('ignores MusicBrainz placeholder labels like [no label]', async () => {
    const { loader, ensureAllAlbums } = makeLoader({
      albums: [
        libAlbum({ ratingKey: 'open' }),
        libAlbum({ ratingKey: 'a', year: 2020 }) // also self-released
      ],
      albumLabels: { open: ['[no label]'], a: ['[no label]'] }
    })
    loader.album = detail({ ratingKey: 'open', studio: null })

    await loader.loadLabelRail()

    expect(loader.labelRailNames).toEqual([])
    expect(loader.labelRail).toEqual([])
    expect(ensureAllAlbums).not.toHaveBeenCalled()
  })

  it('with no labels or studio, sets an empty rail without touching the library', async () => {
    const { loader, ensureAllAlbums } = makeLoader({ albumLabels: {} })
    loader.album = detail({ ratingKey: 'open', studio: null })

    await loader.loadLabelRail()

    expect(loader.labelRail).toEqual([])
    expect(loader.labelRailNames).toEqual([])
    expect(loader.labelRailLoading).toBe(false)
    expect(ensureAllAlbums).not.toHaveBeenCalled()
  })

  it('caps the rail at 30 matches', async () => {
    const albums = Array.from({ length: 35 }, (_, i) =>
      libAlbum({ ratingKey: `m${i}`, studio: 'Verve', year: 2000 + i })
    )
    const { loader } = makeLoader({ albums })
    loader.album = detail({ ratingKey: 'open', studio: 'Verve' })

    await loader.loadLabelRail()

    expect(loader.labelRail).toHaveLength(30)
  })

  it('request guard: an album switch mid-flight discards the resolved matches', async () => {
    const d = deferred<PlexAlbum[]>()
    const { loader } = makeLoader({
      ensureAllAlbums: () => d.promise,
      albumLabels: { open: ['X'] }
    })
    loader.album = detail({ ratingKey: 'open', studio: 'X' })

    const p = loader.loadLabelRail()
    loader.album = detail({ ratingKey: 'other', studio: 'X' }) // user moved on
    d.resolve([libAlbum({ ratingKey: 'm', studio: 'X', year: 2000 })])
    await p

    expect(loader.labelRail).toBeNull() // never written for the stale album
  })
})

describe('AlbumDetailLoader — similar artists', () => {
  it('marks Plex similar artists in/out of library and fills their fields', async () => {
    const plex = makePlex()
    plex.listSimilarArtists.mockResolvedValue([
      { title: 'Band A', mbid: 'mb-a', ratingKey: 'ra' },
      { title: 'Band B', mbid: 'mb-b', ratingKey: 'rb' }
    ] as never)
    const { loader } = makeLoader({
      plex,
      albums: [libAlbum({ ratingKey: 'x1', artist: 'Band A', artistRatingKey: 'ra-lib' })]
    })
    loader.album = detail({ ratingKey: 'open', artist: 'Open', artistRatingKey: 'open-art' })

    await loader.loadSimilarArtists()

    const sim = loader.similarArtists!
    const a = sim.find((s) => s.name === 'Band A')!
    const b = sim.find((s) => s.name === 'Band B')!
    expect(a.inLibrary).toBe(true)
    expect(a.plexArtistRatingKey).toBe('ra-lib')
    expect(b.inLibrary).toBe(false)
    expect(loader.similarArtistsLoading).toBe(false)
  })

  it('adds MB collaborators but skips band members', async () => {
    const plex = makePlex()
    plex.searchArtistByName.mockResolvedValue('open-mbid')
    plex.getArtistRelations.mockResolvedValue([
      { artist: { mbid: 'collab-mb', name: 'Collaborator' }, type: 'collaboration' },
      { artist: { mbid: 'member-mb', name: 'Band Member' }, type: 'member of band' }
    ] as never)
    const { loader } = makeLoader({ plex })
    loader.album = detail({ ratingKey: 'open', artist: 'Open', artistRatingKey: 'open-art' })

    await loader.loadSimilarArtists()

    const names = loader.similarArtists!.map((s) => s.name)
    expect(names).toContain('Collaborator')
    expect(names).not.toContain('Band Member')
  })

  it('boosts an in-library candidate for shared genres', async () => {
    const plex = makePlex()
    plex.listSimilarArtists.mockResolvedValue([
      { title: 'Band A', mbid: 'mb-a', ratingKey: 'ra' }
    ] as never)
    const { loader } = makeLoader({
      plex,
      albums: [
        libAlbum({ ratingKey: 'x', artist: 'Band A', artistRatingKey: 'ra', genres: ['jazz', 'funk'] })
      ]
    })
    loader.album = detail({
      ratingKey: 'open',
      artist: 'Open',
      artistRatingKey: 'open-art',
      genres: ['jazz']
    })

    await loader.loadSimilarArtists()

    const a = loader.similarArtists!.find((s) => s.name === 'Band A')!
    expect(a.reasons).toContain('1 shared genre')
    expect(a.score).toBe(108) // 100 (Plex rank 0) + 8 (one genre overlap)
  })

  it('request guard: an album switch mid-flight discards similar artists', async () => {
    const d = deferred<PlexAlbum[]>()
    const { loader } = makeLoader({ ensureAllAlbums: () => d.promise })
    loader.album = detail({ ratingKey: 'open', artistRatingKey: 'a' })

    const p = loader.loadSimilarArtists()
    loader.album = detail({ ratingKey: 'other', artistRatingKey: 'b' })
    d.resolve([])
    await p

    expect(loader.similarArtists).toBeNull()
  })
})

describe('AlbumDetailLoader — rail resets', () => {
  it('resetRails() clears both rails', () => {
    const { loader } = makeLoader()
    loader.labelRail = [libAlbum({ ratingKey: 'x' })]
    loader.labelRailNames = ['L']
    loader.labelRailLoading = true
    loader.similarArtists = [{ name: 'x' } as unknown as SimilarArtist]
    loader.similarArtistsLoading = true

    loader.resetRails()

    expect(loader.labelRail).toBeNull()
    expect(loader.labelRailNames).toEqual([])
    expect(loader.labelRailLoading).toBe(false)
    expect(loader.similarArtists).toBeNull()
    expect(loader.similarArtistsLoading).toBe(false)
  })

  it('clear() drops the album and both rails', () => {
    const { loader } = makeLoader()
    loader.album = detail({ ratingKey: 'open' })
    loader.labelRail = [libAlbum({ ratingKey: 'x' })]
    loader.similarArtists = [{ name: 'x' } as unknown as SimilarArtist]

    loader.clear()

    expect(loader.album).toBeNull()
    expect(loader.labelRail).toBeNull()
    expect(loader.similarArtists).toBeNull()
  })
})

describe('AlbumDetailLoader — original year callback', () => {
  function creditsStub(originalDate: string | null) {
    return {
      releaseMbid: 'rel-1',
      originalDate,
      releaseLevel: [],
      byTrack: {},
      trackArtists: {},
      members: []
    }
  }

  // Seed with a non-empty summary so the cascade skips the bio fetch, and load
  // with includeBooklet:false — leaving credits as the only fetch in play.
  function seed(ratingKey: string, plexYear: number | null): AlbumDetail {
    return {
      album: {
        ratingKey,
        artist: 'Bruce Springsteen',
        title: 'Born in the U.S.A.',
        artistRatingKey: null,
        year: plexYear,
        studio: null,
        genres: []
      },
      summary: 'present so bio is skipped',
      genres: [],
      guids: [],
      tracks: []
    } as unknown as AlbumDetail
  }

  function makeCreditsLoader(originalDate: string | null) {
    const onOriginalYear = vi.fn()
    const plex = {
      ...makePlex(),
      getAlbumCredits: vi.fn(async () => creditsStub(originalDate))
    }
    const deps: AlbumDetailLoaderDeps = {
      ensureAllAlbums: async () => [],
      albumLabels: () => ({}),
      session: () => ({ signedIn: true, user: {} as never, preferredServerId: 'srv-1' }),
      plex: plex as unknown as PlexApi,
      tagger: makeTagger() as unknown as TaggerApi,
      onOriginalYear
    }
    return { loader: new AlbumDetailLoader(deps), onOriginalYear }
  }

  it('reports the release-group original year when credits resolve', async () => {
    const { loader, onOriginalYear } = makeCreditsLoader('1984-06-04')
    await loader.load('srv-1', 'born', { seed: seed('born', 2005), includeBooklet: false })
    await vi.waitFor(() => expect(onOriginalYear).toHaveBeenCalledWith('born', 1984))
  })

  it('reports null when MusicBrainz has no usable original date', async () => {
    const { loader, onOriginalYear } = makeCreditsLoader(null)
    await loader.load('srv-1', 'born', { seed: seed('born', 2005), includeBooklet: false })
    await vi.waitFor(() => expect(onOriginalYear).toHaveBeenCalledWith('born', null))
  })
})

describe('AlbumDetailLoader — detail LRU (stale-while-revalidate)', () => {
  // Curated summary skips the bio fetch; includeBooklet:false skips the
  // booklet; getAlbumCredits stubbed — getAlbumDetail is the only fetch that
  // matters here.
  function payload(ratingKey: string, title: string): AlbumDetail {
    return {
      album: {
        ratingKey,
        artist: 'Artist',
        title,
        artistRatingKey: null,
        year: 2000,
        studio: null,
        genres: []
      },
      summary: 'present so bio is skipped',
      genres: [],
      guids: [],
      tracks: []
    } as unknown as AlbumDetail
  }

  function makeSwrLoader(cache = new LruCache<string, AlbumDetail>(24)) {
    const getAlbumDetail = vi.fn(async ({ ratingKey }: { ratingKey: string }) =>
      payload(ratingKey, `fresh ${ratingKey}`)
    )
    const plex = {
      ...makePlex(),
      getAlbumDetail,
      getAlbumCredits: vi.fn(async () => null)
    }
    const deps: AlbumDetailLoaderDeps = {
      ensureAllAlbums: async () => [],
      albumLabels: () => ({}),
      session: () => ({ signedIn: true, user: {} as never, preferredServerId: 'srv-1' }),
      plex: plex as unknown as PlexApi,
      tagger: makeTagger() as unknown as TaggerApi,
      detailCache: cache
    }
    return { loader: new AlbumDetailLoader(deps), getAlbumDetail, cache }
  }

  it('a cold load stores the fetched detail in the shared LRU', async () => {
    const { loader, getAlbumDetail, cache } = makeSwrLoader()
    await loader.load('srv-1', 'rk1', { includeBooklet: false })
    expect(getAlbumDetail).toHaveBeenCalledTimes(1)
    expect(loader.album?.album.title).toBe('fresh rk1')
    expect(cache.peek('rk1')?.album.title).toBe('fresh rk1')
  })

  it('back-nav cache hit renders synchronously, then revalidates in the background', async () => {
    const { loader, getAlbumDetail } = makeSwrLoader()
    await loader.load('srv-1', 'rk1', { includeBooklet: false })
    await loader.load('srv-1', 'rk2', { includeBooklet: false })

    const p = loader.load('srv-1', 'rk1', { includeBooklet: false })
    // Rendered from cache before any fetch could possibly resolve.
    expect(loader.album?.album.ratingKey).toBe('rk1')
    expect(loader.albumLoading).toBe(false)
    await p
    // Two cold loads + one background revalidate.
    await vi.waitFor(() => expect(getAlbumDetail).toHaveBeenCalledTimes(3))
  })

  it('a revalidate that finds changed data updates state and the cache in place', async () => {
    const cache = new LruCache<string, AlbumDetail>(24)
    cache.set('rk1', payload('rk1', 'stale title'))
    const { loader } = makeSwrLoader(cache)

    void loader.load('srv-1', 'rk1', { includeBooklet: false })
    expect(loader.album?.album.title).toBe('stale title') // instant render
    await vi.waitFor(() => expect(loader.album?.album.title).toBe('fresh rk1'))
    expect(cache.peek('rk1')?.album.title).toBe('fresh rk1')
  })

  it('an identical revalidate answer leaves the rendered album untouched', async () => {
    const cache = new LruCache<string, AlbumDetail>(24)
    cache.set('rk1', payload('rk1', 'fresh rk1')) // already what the server will say
    const { loader, getAlbumDetail } = makeSwrLoader(cache)

    void loader.load('srv-1', 'rk1', { includeBooklet: false })
    const rendered = loader.album
    await vi.waitFor(() => expect(getAlbumDetail).toHaveBeenCalledTimes(1))
    expect(loader.album).toBe(rendered) // no pointless reassignment
  })

  it('generation guard: a stale revalidate cannot clobber the album the user switched to', async () => {
    const cache = new LruCache<string, AlbumDetail>(24)
    cache.set('rk1', payload('rk1', 'stale title'))
    const { loader, getAlbumDetail } = makeSwrLoader(cache)
    const slow = deferred<AlbumDetail>()
    getAlbumDetail.mockImplementation(async ({ ratingKey }: { ratingKey: string }) =>
      ratingKey === 'rk1' ? slow.promise : payload(ratingKey, `fresh ${ratingKey}`)
    )

    void loader.load('srv-1', 'rk1', { includeBooklet: false }) // hit; revalidate pending
    await loader.load('srv-1', 'rk2', { includeBooklet: false }) // user moved on
    slow.resolve(payload('rk1', 'fresh rk1'))
    await vi.waitFor(() => expect(cache.peek('rk1')?.album.title).toBe('fresh rk1'))

    // The fresh answer still landed in the cache, but not in the view.
    expect(loader.album?.album.ratingKey).toBe('rk2')
  })

  it('evicts the least-recently-visited album once the LRU is over capacity', async () => {
    const cache = new LruCache<string, AlbumDetail>(2)
    const { loader, cache: c } = makeSwrLoader(cache)
    await loader.load('srv-1', 'rk1', { includeBooklet: false })
    await loader.load('srv-1', 'rk2', { includeBooklet: false })
    await loader.load('srv-1', 'rk3', { includeBooklet: false })
    expect(c.peek('rk1')).toBeUndefined()
    expect(c.peek('rk2')).toBeDefined()
    expect(c.peek('rk3')).toBeDefined()
  })
})

describe('AlbumDetailLoader — shared view-model getters', () => {
  // The album-detail and now-playing screens both read these instead of
  // re-deriving; the override case is the drift bug that motivated centralizing.
  function withAlbum(summary: string | null | undefined): AlbumDetail {
    return { ...detail({ ratingKey: 'a1' }), summary } as unknown as AlbumDetail
  }
  const credits = (originalDate: string | null): AlbumCredits =>
    ({ originalDate }) as unknown as AlbumCredits

  it('effectiveOriginalYear prefers a manual override over the MB credits date', () => {
    const { loader } = makeLoader({ originalYearOverride: (rk) => (rk === 'a1' ? 1984 : null) })
    loader.album = withAlbum('curated')
    loader.credits = credits('2005-03-01')
    expect(loader.effectiveOriginalYear).toBe(1984)
  })

  it('effectiveOriginalYear falls back to the MB credits date when no override', () => {
    const { loader } = makeLoader({ originalYearOverride: () => null })
    loader.album = withAlbum('curated')
    loader.credits = credits('1971-11-12')
    expect(loader.effectiveOriginalYear).toBe(1971)
  })

  it('effectiveOriginalYear is null with neither override nor credits date', () => {
    const { loader } = makeLoader()
    loader.album = withAlbum('curated')
    expect(loader.effectiveOriginalYear).toBeNull()
  })

  it('suppresses the fetched bio when Plex has a curated summary', () => {
    const { loader } = makeLoader()
    loader.album = withAlbum('A genuinely curated, label-written description.')
    loader.bio = { text: 'fetched', source: 'wikipedia', url: null } as unknown as Bio
    loader.bioLoading = true
    expect(loader.hasPlexSummary).toBe(true)
    expect(loader.effectiveBio).toBeNull()
    expect(loader.effectiveBioLoading).toBe(false)
  })

  it('shows the fetched bio when Plex summary is empty', () => {
    const { loader } = makeLoader()
    loader.album = withAlbum('')
    loader.bio = { text: 'fetched', source: 'wikipedia', url: null } as unknown as Bio
    loader.bioLoading = true
    expect(loader.hasPlexSummary).toBe(false)
    expect(loader.effectiveBio?.text).toBe('fetched')
    expect(loader.effectiveBioLoading).toBe(true)
  })

  it('effectiveMediaInfo reads the injected accessor by ratingKey', () => {
    const info = { container: 'flac' } as unknown as AlbumMediaInfo
    const { loader } = makeLoader({ mediaInfoFor: (rk) => (rk === 'a1' ? info : null) })
    loader.album = withAlbum('curated')
    expect(loader.effectiveMediaInfo).toBe(info)
  })

  it('getters return null/false with no album loaded', () => {
    const { loader } = makeLoader({
      originalYearOverride: () => 1984,
      mediaInfoFor: () => ({}) as AlbumMediaInfo
    })
    expect(loader.effectiveOriginalYear).toBeNull()
    expect(loader.effectiveMediaInfo).toBeNull()
    expect(loader.hasPlexSummary).toBe(false)
    expect(loader.effectiveBio).toBeNull()
  })
})
