import { describe, it, expect, vi } from 'vitest'
import type { CoverCandidate, CoverOverride } from '../../../shared/plex'
import {
  CoverArtController,
  type CoverArtDeps,
  type CoverPickerState
} from './cover-art-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const flush = () => new Promise((r) => setTimeout(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const candidate = (url: string): CoverCandidate =>
  ({ source: 'itunes', url, thumbUrl: `${url}-thumb`, label: 'cover' }) as unknown as CoverCandidate

const override = (url: string): CoverOverride => ({
  source: 'caa',
  url,
  thumbUrl: `${url}-thumb`,
  setAt: 1
})

function pickerFor(plexRatingKey: string): CoverPickerState {
  return {
    plexRatingKey,
    artist: 'Artist',
    title: 'Title',
    mbReleaseMbid: null,
    query: { artist: 'Artist', title: 'Title' },
    candidates: [],
    loading: false,
    error: null,
    submitting: false
  }
}

function makePlex(over: Record<string, unknown> = {}) {
  return {
    listCoverOverrides: vi.fn(async () => ({}) as Record<string, CoverOverride>),
    searchCoverCandidates: vi.fn(async () => [] as CoverCandidate[]),
    setCoverOverride: vi.fn(async () => ({ ok: true as const, plexUpdated: false })),
    uploadLocalCover: vi.fn(async () => ({ canceled: true, override: null })),
    clearCoverOverride: vi.fn(async () => undefined),
    ...over
  }
}

function makeController(plex?: ReturnType<typeof makePlex>, serverId: () => string | null = () => 'srv-1') {
  const p = plex ?? makePlex()
  const flashToast = vi.fn()
  const deps: CoverArtDeps = { flashToast, serverId, plex: p as unknown as PlexApi }
  return { c: new CoverArtController(deps), plex: p, flashToast }
}

describe('CoverArtController — load', () => {
  it('hydrates the override map from the store', async () => {
    const plex = makePlex({ listCoverOverrides: vi.fn(async () => ({ rk1: override('u') })) })
    const { c } = makeController(plex)
    await c.load()
    expect(c.overrides.rk1).toMatchObject({ url: 'u' })
  })

  it('tolerates an empty/failing store and keeps the {} default', async () => {
    const plex = makePlex({
      listCoverOverrides: vi.fn(async () => {
        throw new Error('store empty on first run')
      })
    })
    const { c } = makeController(plex)
    await c.load()
    expect(c.overrides).toEqual({})
  })
})

describe('CoverArtController — picker open/close/query', () => {
  it('open() seeds the picker from artist/title and fires a search', () => {
    const { c, plex } = makeController()
    c.open('rk1', 'Artist', 'Title', 'mbid-1')
    expect(c.picker?.plexRatingKey).toBe('rk1')
    expect(c.picker?.query).toEqual({ artist: 'Artist', title: 'Title' })
    expect(c.picker?.loading).toBe(true)
    expect(plex.searchCoverCandidates).toHaveBeenCalledOnce()
  })

  it('close() clears the picker', () => {
    const { c } = makeController()
    c.open('rk1', 'Artist', 'Title', null)
    c.close()
    expect(c.picker).toBeNull()
  })

  it('setQuery() updates the query, and is a no-op with no picker open', () => {
    const { c } = makeController()
    c.setQuery('x', 'y') // no picker — must not throw
    expect(c.picker).toBeNull()
    c.open('rk1', 'Artist', 'Title', null)
    c.setQuery('new artist', 'new title')
    expect(c.picker?.query).toEqual({ artist: 'new artist', title: 'new title' })
  })
})

describe('CoverArtController — runSearch', () => {
  it('populates candidates and clears loading', async () => {
    const cands = [candidate('u1'), candidate('u2')]
    const plex = makePlex({ searchCoverCandidates: vi.fn(async () => cands) })
    const { c } = makeController(plex)
    c.open('rk1', 'Artist', 'Title', null)
    await flush()
    expect(c.picker?.candidates).toEqual(cands)
    expect(c.picker?.loading).toBe(false)
  })

  it('drops results when the picker switched albums mid-flight', async () => {
    const d = deferred<CoverCandidate[]>()
    const plex = makePlex({ searchCoverCandidates: vi.fn(() => d.promise) })
    const { c } = makeController(plex)
    c.picker = pickerFor('rk1')
    const p = c.runSearch()
    c.picker = { ...c.picker, plexRatingKey: 'rk2' } // user opened a different album
    d.resolve([candidate('stale')])
    await p
    expect(c.picker?.candidates).toEqual([]) // rk1 result discarded
  })

  it('surfaces a search error on the picker', async () => {
    const plex = makePlex({
      searchCoverCandidates: vi.fn(async () => {
        throw new Error('iTunes down')
      })
    })
    const { c } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.runSearch()
    expect(c.picker?.error).toBe('iTunes down')
    expect(c.picker?.loading).toBe(false)
  })
})

describe('CoverArtController — confirm', () => {
  it('persists the override, updates the map, and closes the picker', async () => {
    const { c, plex } = makeController()
    c.picker = pickerFor('rk1')
    await c.confirm(candidate('u1'))
    expect(plex.setCoverOverride).toHaveBeenCalledOnce()
    expect(c.overrides.rk1).toMatchObject({ url: 'u1', source: 'itunes' })
    expect(c.picker).toBeNull()
  })

  it('threads the active serverId through so Plex gets the poster too', async () => {
    const { c, plex } = makeController(undefined, () => 'srv-42')
    c.picker = pickerFor('rk1')
    await c.confirm(candidate('u1'))
    expect(plex.setCoverOverride).toHaveBeenCalledWith(
      expect.objectContaining({ plexRatingKey: 'rk1', serverId: 'srv-42' })
    )
  })

  it('warns when the local override saved but the Plex write failed', async () => {
    const plex = makePlex({
      setCoverOverride: vi.fn(async () => ({
        ok: true as const,
        plexUpdated: false,
        plexError: '401'
      }))
    })
    const { c, flashToast } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.confirm(candidate('u1'))
    // Local override still applied — the pick isn't lost.
    expect(c.overrides.rk1).toMatchObject({ url: 'u1' })
    expect(flashToast).toHaveBeenCalledWith('err', expect.stringContaining('401'))
  })

  it('confirms silently-ok toast when Plex accepted the poster', async () => {
    const plex = makePlex({
      setCoverOverride: vi.fn(async () => ({ ok: true as const, plexUpdated: true }))
    })
    const { c, flashToast } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.confirm(candidate('u1'))
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Plex'))
  })

  it('keeps the picker open with an error when the save fails', async () => {
    const plex = makePlex({
      setCoverOverride: vi.fn(async () => {
        throw new Error('save failed')
      })
    })
    const { c } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.confirm(candidate('u1'))
    expect(c.picker?.error).toBe('save failed')
    expect(c.picker?.submitting).toBe(false)
    expect(c.overrides.rk1).toBeUndefined()
  })
})

describe('CoverArtController — uploadLocal', () => {
  it('on cancel, clears submitting and keeps the picker open', async () => {
    const plex = makePlex({
      uploadLocalCover: vi.fn(async () => ({ canceled: true, override: null }))
    })
    const { c } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.uploadLocal()
    expect(c.picker).not.toBeNull()
    expect(c.picker?.submitting).toBe(false)
    expect(c.overrides.rk1).toBeUndefined()
  })

  it('on success, pins the override and closes the picker', async () => {
    const ov = override('file://pic')
    const plex = makePlex({
      uploadLocalCover: vi.fn(async () => ({ canceled: false, override: ov }))
    })
    const { c, plex: p } = makeController(plex, () => 'srv-9')
    c.picker = pickerFor('rk1')
    await c.uploadLocal()
    expect(c.overrides.rk1).toEqual(ov)
    expect(c.picker).toBeNull()
    expect(p.uploadLocalCover).toHaveBeenCalledWith({ plexRatingKey: 'rk1', serverId: 'srv-9' })
  })

  it('warns when the upload pinned locally but Plex rejected it', async () => {
    const ov = override('file://pic')
    const plex = makePlex({
      uploadLocalCover: vi.fn(async () => ({
        canceled: false,
        override: ov,
        plexUpdated: false,
        plexError: 'no owner token'
      }))
    })
    const { c, flashToast } = makeController(plex)
    c.picker = pickerFor('rk1')
    await c.uploadLocal()
    expect(c.overrides.rk1).toEqual(ov)
    expect(flashToast).toHaveBeenCalledWith('err', expect.stringContaining('no owner token'))
  })
})

describe('CoverArtController — clearForAlbum', () => {
  it('removes the override and closes a matching picker', async () => {
    const { c, plex } = makeController()
    c.overrides = { rk1: override('u') }
    c.picker = pickerFor('rk1')
    await c.clearForAlbum('rk1')
    expect(c.overrides.rk1).toBeUndefined()
    expect(c.picker).toBeNull()
    expect(plex.clearCoverOverride).toHaveBeenCalledOnce()
  })

  it('flashes a toast and leaves the override intact on failure', async () => {
    const plex = makePlex({
      clearCoverOverride: vi.fn(async () => {
        throw new Error('clear failed')
      })
    })
    const { c, flashToast } = makeController(plex)
    c.overrides = { rk1: override('u') }
    await c.clearForAlbum('rk1')
    expect(flashToast).toHaveBeenCalledWith('err', 'clear failed')
    expect(c.overrides.rk1).toBeDefined()
  })
})
