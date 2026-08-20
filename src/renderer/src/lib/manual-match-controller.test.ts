import { describe, it, expect, vi } from 'vitest'
import type { MbReleaseCandidate } from '../../../shared/plex'
import {
  ManualMatchController,
  type ManualMatchDeps,
  type ManualMatchState
} from './manual-match-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const flush = () => new Promise((r) => setTimeout(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const candidate = (mbid: string): MbReleaseCandidate =>
  ({ mbid, title: 'Title', artistName: 'Artist' }) as unknown as MbReleaseCandidate

function matchFor(plexRatingKey: string): ManualMatchState {
  return {
    plexRatingKey,
    artist: 'Artist',
    title: 'Title',
    query: { artist: 'Artist', title: 'Title' },
    candidates: [],
    loading: false,
    error: null,
    submitting: false
  }
}

function makePlex(over: Record<string, unknown> = {}) {
  return {
    searchReleaseCandidates: vi.fn(async () => [] as MbReleaseCandidate[]),
    setAlbumMatch: vi.fn(async () => ({ ok: true })),
    clearAlbumMatch: vi.fn(async () => ({ ok: true })),
    ...over
  }
}

function makeController(plex?: ReturnType<typeof makePlex>) {
  const p = plex ?? makePlex()
  const flashToast = vi.fn()
  const onMatchChanged = vi.fn(async () => undefined)
  const deps: ManualMatchDeps = {
    flashToast,
    onMatchChanged,
    plex: p as unknown as PlexApi
  }
  return { c: new ManualMatchController(deps), plex: p, flashToast, onMatchChanged }
}

describe('ManualMatchController — open/close lifecycle', () => {
  it('open() seeds the modal from artist/title and fires a search', () => {
    const { c, plex } = makeController()
    c.open('rk1', 'Artist', 'Title')
    expect(c.current?.plexRatingKey).toBe('rk1')
    expect(c.current?.query).toEqual({ artist: 'Artist', title: 'Title' })
    expect(c.current?.loading).toBe(true)
    expect(c.current?.candidates).toEqual([])
    expect(plex.searchReleaseCandidates).toHaveBeenCalledOnce()
    expect(plex.searchReleaseCandidates).toHaveBeenCalledWith({ artist: 'Artist', title: 'Title' })
  })

  it('close() clears the modal state', () => {
    const { c } = makeController()
    c.open('rk1', 'Artist', 'Title')
    c.close()
    expect(c.current).toBeNull()
  })

  it('setQuery() updates the query, and is a no-op when closed', () => {
    const { c } = makeController()
    c.setQuery('x', 'y') // closed — must not throw
    expect(c.current).toBeNull()
    c.open('rk1', 'Artist', 'Title')
    c.setQuery('new artist', 'new title')
    expect(c.current?.query).toEqual({ artist: 'new artist', title: 'new title' })
  })
})

describe('ManualMatchController — runSearch', () => {
  it('populates candidates and clears loading on success', async () => {
    const cands = [candidate('mb1'), candidate('mb2')]
    const plex = makePlex({ searchReleaseCandidates: vi.fn(async () => cands) })
    const { c } = makeController(plex)
    c.open('rk1', 'Artist', 'Title')
    await flush()
    expect(c.current?.candidates).toEqual(cands)
    expect(c.current?.loading).toBe(false)
    expect(c.current?.error).toBeNull()
  })

  it('drops a stale response when the modal switched albums mid-flight', async () => {
    const d = deferred<MbReleaseCandidate[]>()
    const plex = makePlex({ searchReleaseCandidates: vi.fn(() => d.promise) })
    const { c } = makeController(plex)
    c.current = matchFor('rk1')
    const p = c.runSearch()
    c.current = { ...matchFor('rk2'), loading: true } // user opened a different album
    d.resolve([candidate('stale')])
    await p
    expect(c.current?.candidates).toEqual([]) // rk1 result discarded
    expect(c.current?.loading).toBe(true) // rk2's own search still owns the flag
  })

  it('surfaces a search error on the modal, scoped to the same album', async () => {
    const plex = makePlex({
      searchReleaseCandidates: vi.fn(async () => {
        throw new Error('MB down')
      })
    })
    const { c } = makeController(plex)
    c.current = matchFor('rk1')
    await c.runSearch()
    expect(c.current?.error).toBe('MB down')
    expect(c.current?.loading).toBe(false)
  })

  it('is a no-op when the modal is closed', async () => {
    const { c, plex } = makeController()
    await c.runSearch()
    expect(plex.searchReleaseCandidates).not.toHaveBeenCalled()
  })
})

describe('ManualMatchController — confirm', () => {
  it('persists the match, closes the modal, then invalidates credits', async () => {
    const { c, plex, onMatchChanged } = makeController()
    c.current = matchFor('rk1')
    await c.confirm('mb-release-1')
    expect(plex.setAlbumMatch).toHaveBeenCalledOnce()
    expect(plex.setAlbumMatch).toHaveBeenCalledWith({
      plexRatingKey: 'rk1',
      mbReleaseMbid: 'mb-release-1'
    })
    expect(c.current).toBeNull()
    expect(onMatchChanged).toHaveBeenCalledOnce()
    expect(onMatchChanged).toHaveBeenCalledWith('rk1')
  })

  it('keeps the modal open with an error when the save fails, and skips invalidation', async () => {
    const plex = makePlex({
      setAlbumMatch: vi.fn(async () => {
        throw new Error('save failed')
      })
    })
    const { c, onMatchChanged } = makeController(plex)
    c.current = matchFor('rk1')
    await c.confirm('mb-release-1')
    expect(c.current?.error).toBe('save failed')
    expect(c.current?.submitting).toBe(false)
    expect(onMatchChanged).not.toHaveBeenCalled()
  })

  it('is a no-op when the modal is closed', async () => {
    const { c, plex } = makeController()
    await c.confirm('mb-release-1')
    expect(plex.setAlbumMatch).not.toHaveBeenCalled()
  })
})

describe('ManualMatchController — clearMatch', () => {
  it('clears the pinned match via IPC and invalidates credits (no modal needed)', async () => {
    const { c, plex, onMatchChanged } = makeController()
    await c.clearMatch('rk1')
    expect(plex.clearAlbumMatch).toHaveBeenCalledOnce()
    expect(plex.clearAlbumMatch).toHaveBeenCalledWith({ plexRatingKey: 'rk1' })
    expect(onMatchChanged).toHaveBeenCalledOnce()
    expect(onMatchChanged).toHaveBeenCalledWith('rk1')
  })

  it('flashes a toast and skips invalidation on failure', async () => {
    const plex = makePlex({
      clearAlbumMatch: vi.fn(async () => {
        throw new Error('clear failed')
      })
    })
    const { c, flashToast, onMatchChanged } = makeController(plex)
    await c.clearMatch('rk1')
    expect(flashToast).toHaveBeenCalledWith('err', 'clear failed')
    expect(onMatchChanged).not.toHaveBeenCalled()
  })
})
