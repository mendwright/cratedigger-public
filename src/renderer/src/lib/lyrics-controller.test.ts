import { describe, it, expect, vi } from 'vitest'
import type { AlbumDetail, LyricsResult } from '../../../shared/plex'
import { LyricsController, type LyricsDeps } from './lyrics-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const lyricsResult = { plainText: 'la la la' } as unknown as LyricsResult

function makePlex(getLyrics?: ReturnType<typeof vi.fn>) {
  return { getLyrics: getLyrics ?? vi.fn(async () => lyricsResult) }
}

function makeController(opts: { currentAlbum?: string; plex?: ReturnType<typeof makePlex> } = {}) {
  const plex = opts.plex ?? makePlex()
  const deps: LyricsDeps = {
    currentAlbumRatingKey: () => opts.currentAlbum ?? 'album-1',
    plex: plex as unknown as PlexApi
  }
  return { c: new LyricsController(deps), plex }
}

const toggleArgs = (rk: string) => ({
  trackRatingKey: rk,
  artist: 'Artist',
  title: 'Track',
  album: 'Album',
  durationMs: 1000
})

function detail(ratingKey: string, trackKeys: string[]): AlbumDetail {
  return {
    album: { ratingKey, artist: 'Artist', title: 'Album' },
    tracks: trackKeys.map((rk) => ({ ratingKey: rk, title: `T-${rk}`, duration: 1000 })),
    genres: [],
    guids: []
  } as unknown as AlbumDetail
}

describe('LyricsController — toggle', () => {
  it('opens a panel, fetches, and caches the result', async () => {
    const { c, plex } = makeController()
    await c.toggle(toggleArgs('t1'))
    expect(c.openByTrack.t1).toBe(true)
    expect(plex.getLyrics).toHaveBeenCalledOnce()
    expect(c.byTrack.t1).toEqual(lyricsResult)
  })

  it('a second toggle closes the panel but keeps the cache, no refetch', async () => {
    const { c, plex } = makeController()
    await c.toggle(toggleArgs('t1')) // open + fetch
    await c.toggle(toggleArgs('t1')) // close
    expect(c.openByTrack.t1).toBeUndefined()
    expect(c.byTrack.t1).toEqual(lyricsResult)
    expect(plex.getLyrics).toHaveBeenCalledOnce()
  })

  it('reopening a cached track does not refetch', async () => {
    const { c, plex } = makeController()
    await c.toggle(toggleArgs('t1')) // open + fetch
    await c.toggle(toggleArgs('t1')) // close
    await c.toggle(toggleArgs('t1')) // reopen
    expect(c.openByTrack.t1).toBe(true)
    expect(plex.getLyrics).toHaveBeenCalledOnce()
  })

  it('caches an error and leaves the panel open to show it', async () => {
    const plex = makePlex(vi.fn(async () => {
      throw new Error('lyrics service down')
    }))
    const { c } = makeController({ plex })
    await c.toggle(toggleArgs('t1'))
    expect(c.byTrack.t1).toBe('error')
    expect(c.openByTrack.t1).toBe(true)
  })
})

describe('LyricsController — closeAll', () => {
  it('clears open panels but leaves the fetch cache intact', async () => {
    const { c } = makeController()
    await c.toggle(toggleArgs('t1'))
    await c.toggle(toggleArgs('t2'))
    c.closeAll()
    expect(c.openByTrack).toEqual({})
    expect(c.byTrack.t1).toEqual(lyricsResult)
    expect(c.byTrack.t2).toEqual(lyricsResult)
  })
})

describe('LyricsController — prefetchAlbum', () => {
  it('fetches every uncached track', async () => {
    const { c, plex } = makeController()
    await c.prefetchAlbum(detail('album-1', ['a', 'b', 'c']))
    expect(plex.getLyrics).toHaveBeenCalledTimes(3)
    expect(c.byTrack.a).toEqual(lyricsResult)
    expect(c.byTrack.c).toEqual(lyricsResult)
  })

  it('skips tracks already in the cache', async () => {
    const { c, plex } = makeController()
    c.byTrack = { a: lyricsResult }
    await c.prefetchAlbum(detail('album-1', ['a', 'b']))
    expect(plex.getLyrics).toHaveBeenCalledTimes(1) // only 'b'
  })

  it('bails between batches when the open album changes', async () => {
    const currentAlbumRatingKey = vi
      .fn()
      .mockReturnValueOnce('album-1') // batch 1 (a,b,c) — proceeds
      .mockReturnValue('other') // batch 2 (d) — bail
    const plex = makePlex()
    const c = new LyricsController({
      currentAlbumRatingKey,
      plex: plex as unknown as PlexApi
    })
    await c.prefetchAlbum(detail('album-1', ['a', 'b', 'c', 'd']))
    expect(plex.getLyrics).toHaveBeenCalledTimes(3)
    expect(c.byTrack.d).toBeUndefined()
  })
})
