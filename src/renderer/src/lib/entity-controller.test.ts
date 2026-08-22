import { describe, it, expect, vi } from 'vitest'
import type { PlexAlbum } from '../../../shared/plex'
import { EntityController, type EntityDeps } from './entity-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const flush = () => new Promise((r) => setTimeout(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function album(ratingKey: string, year: number | null): PlexAlbum {
  // artist / title / guids so the fixture survives the library indexing in
  // matchCreditedWorks and missingFromLibrary.
  return {
    ratingKey,
    year,
    artist: 'Some Artist',
    title: `Album ${ratingKey}`,
    guids: []
  } as unknown as PlexAlbum
}

/** Plex IPC stub — vi.fn per artist endpoint, with benign defaults. */
function makePlex() {
  return {
    getArtistBio: vi.fn(async () => ({ summary: 'a bio' })),
    browseArtist: vi.fn(async () => ({ albums: [] })),
    getArtistInfo: vi.fn(async () => ({ mbid: 'm', name: 'n', disambiguation: null, type: null, origin: null })),
    getArtistCreditedWorks: vi.fn(async () => []),
    getInLibraryAppearances: vi.fn(async () => []),
    getArtistDiscography: vi.fn(async () => [])
  }
}

function makeController(opts: { albums?: PlexAlbum[]; plex?: ReturnType<typeof makePlex> } = {}) {
  const plex = opts.plex ?? makePlex()
  const ensureAllAlbums = vi.fn(async () => opts.albums ?? [])
  const deps: EntityDeps = {
    session: () => ({ signedIn: true, user: {} as never, preferredServerId: 'srv-1' }),
    ensureAllAlbums,
    plex: plex as unknown as PlexApi
  }
  return { c: new EntityController(deps), plex, ensureAllAlbums }
}

describe('EntityController', () => {
  it('sets the header skeleton + loading flags synchronously on load', () => {
    const { c } = makeController()
    c.load('mbid-A', 'Artist A')
    expect(c.mbid).toBe('mbid-A')
    expect(c.entity).toEqual({ browse: null, info: null, name: 'Artist A' })
    expect(c.loading).toBe(true)
    expect(c.creditedLoading).toBe(true)
    expect(c.bioLoading).toBe(true)
  })

  it('fills in the header and clears loading once fetches resolve', async () => {
    const { c } = makeController()
    c.load('mbid-A', 'Artist A')
    await flush()
    expect(c.entity?.browse).toEqual({ albums: [] })
    expect(c.entity?.info).toMatchObject({ mbid: 'm' })
    expect(c.bio).toEqual({ summary: 'a bio' })
    expect(c.loading).toBe(false)
    expect(c.bioLoading).toBe(false)
    expect(c.creditedLoading).toBe(false)
  })

  it('request guard: a stale browse result for a previous artist is dropped', async () => {
    const plex = makePlex()
    const first = deferred<{ albums: unknown[] }>()
    const second = deferred<{ albums: unknown[] }>()
    plex.browseArtist.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never)
    const { c } = makeController({ plex })

    c.load('A', 'Artist A')
    c.load('B', 'Artist B') // now the active artist
    expect(c.mbid).toBe('B')

    second.resolve({ albums: ['B-album'] })
    first.resolve({ albums: ['A-album'] }) // stale — must not land
    await flush()

    expect(c.entity?.name).toBe('Artist B')
    expect(c.entity?.browse).toEqual({ albums: ['B-album'] })
  })

  it('appearances: drops albums no longer in the library and sorts by year', async () => {
    const plex = makePlex()
    plex.getInLibraryAppearances.mockResolvedValue([
      { plexRatingKey: 'rk-late', roles: ['guitar'] },
      { plexRatingKey: 'rk-gone', roles: ['bass'] }, // not in library → dropped
      { plexRatingKey: 'rk-early', roles: ['drums'] }
    ] as never)
    const { c } = makeController({
      plex,
      albums: [album('rk-late', 2010), album('rk-early', 1990)]
    })

    c.load('A', 'Artist A')
    await flush()

    expect(c.appearances?.map((r) => r.album.ratingKey)).toEqual(['rk-early', 'rk-late'])
    expect(c.appearances).toHaveLength(2) // rk-gone dropped
  })

  it('credited: stores the matched works and clears its loading flag', async () => {
    const { c } = makeController()
    c.load('A', 'Artist A')
    await flush()
    expect(c.credited).not.toBeNull()
    expect(c.creditedError).toBeNull()
    expect(c.creditedLoading).toBe(false)
  })

  it('surfaces a credited-works error', async () => {
    const plex = makePlex()
    plex.getArtistCreditedWorks.mockRejectedValue(new Error('MB 503'))
    const { c } = makeController({ plex })
    c.load('A', 'Artist A')
    await flush()
    expect(c.creditedError).toBe('MB 503')
    expect(c.creditedLoading).toBe(false)
  })

  it('clear() resets the page but deliberately leaves appearances', async () => {
    const plex = makePlex()
    plex.getInLibraryAppearances.mockResolvedValue([{ plexRatingKey: 'rk1', roles: ['x'] }] as never)
    const { c } = makeController({ plex, albums: [album('rk1', 2000)] })
    c.load('A', 'Artist A')
    await flush()
    expect(c.appearances).toHaveLength(1)

    c.clear()
    expect(c.entity).toBeNull()
    expect(c.mbid).toBeNull()
    expect(c.bio).toBeNull()
    expect(c.credited).toBeNull()
    expect(c.appearances).toHaveLength(1) // intentionally untouched (matches original)
  })

  it('does not load without a signed-in session', () => {
    const plex = makePlex()
    const deps: EntityDeps = {
      session: () => ({ signedIn: false }),
      ensureAllAlbums: vi.fn(async () => []),
      plex: plex as unknown as PlexApi
    }
    const c = new EntityController(deps)
    c.load('A', 'Artist A')
    expect(c.entity).toBeNull()
    expect(plex.browseArtist).not.toHaveBeenCalled()
  })
})

describe('EntityController — entity LRU (stale-while-revalidate)', () => {
  it('back-nav cache hit hydrates every section synchronously, then revalidates', async () => {
    const plex = makePlex()
    plex.getInLibraryAppearances.mockResolvedValue([{ plexRatingKey: 'rk1', roles: ['x'] }] as never)
    const { c } = makeController({ plex, albums: [album('rk1', 2000)] })
    c.load('A', 'Artist A')
    await flush()
    c.load('B', 'Artist B')
    await flush()

    c.load('A', 'Artist A')
    // Everything is on screen before any fetch resolves — no spinners.
    expect(c.entity?.browse).toEqual({ albums: [] })
    expect(c.bio).toEqual({ summary: 'a bio' })
    expect(c.credited).not.toBeNull()
    expect(c.appearances).toHaveLength(1)
    expect(c.missing).not.toBeNull()
    expect(c.loading).toBe(false)
    expect(c.bioLoading).toBe(false)
    expect(c.creditedLoading).toBe(false)
    expect(c.missingLoading).toBe(false)
    // The background refresh still fired: two cold loads + one revalidate.
    expect(plex.browseArtist).toHaveBeenCalledTimes(3)
  })

  it('a cache miss keeps the cold path: skeleton + loading flags', async () => {
    const { c } = makeController()
    c.load('A', 'Artist A')
    await flush()
    c.load('C', 'Artist C') // never visited
    expect(c.entity).toEqual({ browse: null, info: null, name: 'Artist C' })
    expect(c.loading).toBe(true)
    expect(c.bioLoading).toBe(true)
    expect(c.creditedLoading).toBe(true)
    expect(c.missingLoading).toBe(true)
  })

  it('revalidation replaces cached data in place when the answer changed', async () => {
    const plex = makePlex()
    const { c } = makeController({ plex })
    c.load('A', 'Artist A')
    await flush()
    c.load('B', 'Artist B')
    await flush()

    plex.getArtistBio.mockResolvedValue({ summary: 'rewritten' } as never)
    c.load('A', 'Artist A')
    expect(c.bio).toEqual({ summary: 'a bio' }) // stale render first
    await flush()
    expect(c.bio).toEqual({ summary: 'rewritten' }) // refreshed in place
  })

  it('mbid guard: a slow revalidate for a previous artist cannot clobber the newer one', async () => {
    const plex = makePlex()
    const { c } = makeController({ plex })
    c.load('A', 'Artist A')
    await flush()
    c.load('B', 'Artist B')
    await flush()

    const slow = deferred<{ albums: unknown[] }>()
    plex.browseArtist.mockImplementation((({ mbid }: { mbid: string }) =>
      mbid === 'A' ? slow.promise : Promise.resolve({ albums: [] })) as never)
    c.load('A', 'Artist A') // hit; revalidate pending
    c.load('B', 'Artist B') // user bounced back again
    slow.resolve({ albums: ['stale-A-album'] })
    await flush()

    expect(c.mbid).toBe('B')
    expect(c.entity?.name).toBe('Artist B')
    expect(c.entity?.browse).toEqual({ albums: [] })
  })

  it('evicts the least-recently-visited artist beyond the LRU cap', async () => {
    const { c } = makeController()
    for (let i = 1; i <= 9; i++) {
      c.load(`M${i}`, `Artist ${i}`)
      await flush()
    }
    c.load('M1', 'Artist 1') // cap is 8 — M1 was evicted, so this is a cold load
    expect(c.bio).toBeNull()
    expect(c.bioLoading).toBe(true)
    expect(c.loading).toBe(true)
  })

  it('clear() keeps the cache — reopening the artist still hydrates instantly', async () => {
    const { c } = makeController()
    c.load('A', 'Artist A')
    await flush()
    c.clear()
    c.load('A', 'Artist A')
    expect(c.bio).toEqual({ summary: 'a bio' })
    expect(c.bioLoading).toBe(false)
  })

  it('invalidateCache() drops every cached bundle', async () => {
    const { c } = makeController()
    c.load('A', 'Artist A')
    await flush()
    c.invalidateCache()
    c.load('A', 'Artist A')
    expect(c.bio).toBeNull()
    expect(c.bioLoading).toBe(true)
  })
})
