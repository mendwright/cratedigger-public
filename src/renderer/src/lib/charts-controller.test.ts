import { describe, it, expect, vi } from 'vitest'
import { ChartsController } from './charts-controller.svelte'
import { yearBounds, type HistorySummary } from '../../../shared/listening-history'
import type { ChartEntry, ChartResult } from '../../../shared/charts'

const entry: ChartEntry = { rank: 1, title: 'Artist', subtitle: null, plays: 12, seconds: 3600, ratingKey: '10', thumb: null }
const summary: HistorySummary = { profile: 'test', plays: 12, seconds: 3600, first: 1, last: 2, years: [], sources: [] }
const result: ChartResult = { dimension: 'artists', window: 'month', userIds: [1], entries: [entry] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup() {
  const api = {
    getConfig: vi.fn(async () => ({ url: '', apiKey: '' })),
    users: vi.fn(async () => [{ userId: 1, name: 'One', thumb: null, trackPlays: 12 }]),
    top: vi.fn(async () => result), cacheRead: vi.fn(async (_key: string) => null as { result?: ChartResult; users?: []; history?: HistorySummary } | null),
    cacheWrite: vi.fn(async () => {}), art: vi.fn(async () => []), setConfig: vi.fn()
  }
  const history = {
    summary: vi.fn(async () => summary as HistorySummary | null), top: vi.fn(async (_args: unknown) => [entry] as ChartEntry[] | null),
    review: vi.fn(async () => null), artist: vi.fn(async () => null), item: vi.fn()
  }
  const c = new ChartsController({ api: api as unknown as Window['cratedigger']['charts'], history })
  return { c, api, history }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('ChartsController', () => {
  it('defaults to personal history, requests 200 and uses local calendar year bounds', async () => {
    const { c, history, api } = setup()
    await c.activate()
    expect(c.tab).toBe('you')
    expect(api.top).not.toHaveBeenCalled()
    expect(history.top).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 200 }))
    c.setYear(2018); await settle()
    expect(history.top).toHaveBeenLastCalledWith(expect.objectContaining(yearBounds(2018)))
    expect(history.review).toHaveBeenCalledWith(yearBounds(2018))
  })
  it('has only household charts when personal history is unavailable', async () => {
    const { c, history, api } = setup(); history.summary.mockResolvedValue(null)
    await c.activate()
    expect(c.tab).toBe('household')
    expect(api.top).toHaveBeenCalledWith({ userIds: [1], window: 'month', dimension: 'artists', limit: 200 })
    c.setTab('you'); expect(c.tab).toBe('household')
  })
  it('shows the disk chart while the network is still pending, and retains it on failure', async () => {
    const { c, api, history } = setup()
    api.cacheRead.mockImplementation(async key => key === 'bootstrap' ? { users: [], history: summary } : { result })
    const waiting = deferred<HistorySummary | null>()
    history.summary.mockReturnValue(waiting.promise)
    const activation = c.activate(); await settle()
    expect(c.result?.entries[0].title).toBe('Artist')
    expect(c.loading).toBe(false)
    history.top.mockResolvedValue(null); waiting.resolve(summary); await activation
    expect(c.result?.entries).toHaveLength(1)
    expect(c.error).toContain('not reachable')
  })
  it('drops an older chart response after a new dimension has been selected', async () => {
    const { c, history } = setup(); await c.activate()
    const old = deferred<ChartEntry[] | null>()
    history.top.mockReturnValueOnce(old.promise)
    c.setYear(2018); await settle()
    c.setDimension('albums'); await settle()
    old.resolve([{ ...entry, title: 'Stale artist' }]); await settle()
    expect(c.result?.dimension).toBe('albums')
    expect(c.result?.entries[0].title).toBe('Artist')
  })
  it('clears account data and discards in-flight work when the session changes', async () => {
    const { c, history } = setup()
    const wait = deferred<HistorySummary | null>(); history.summary.mockReturnValue(wait.promise)
    const activation = c.activate(); await settle(); c.reset(); wait.resolve(summary); await activation
    expect(c.history).toBeNull(); expect(c.result).toBeNull(); expect(c.ready).toBe(false)
  })
  it('does not re-fetch household users when reopening an already warmed personal chart', async () => {
    const { c, api } = setup(); await c.activate(); await c.activate()
    expect(api.users).toHaveBeenCalledTimes(1)
  })
  it('does not restore another account\'s pending disk chart after reset', async () => {
    const { c, api } = setup(); await c.activate()
    const disk = deferred<{ result: ChartResult } | null>()
    api.cacheRead.mockReturnValue(disk.promise)
    c.setDimension('albums'); await settle(); c.reset()
    disk.resolve({ result: { ...result, dimension: 'albums' } }); await settle()
    expect(c.result).toBeNull()
  })
  it('fetches 500 personal albums and preserves original ranks when filtering missing records', async () => {
    const { c, history } = setup()
    history.top.mockResolvedValue([entry, { ...entry, rank: 8, title: 'Missing', ratingKey: null }, { ...entry, rank: 40, title: 'Also missing', ratingKey: null }])
    await c.activate(); c.setDimension('albums'); await settle()
    c.toggleNotInLibrary(); await settle()
    expect(history.top).toHaveBeenLastCalledWith(expect.objectContaining({ dimension: 'albums', limit: 500 }))
    expect(c.entries.map(e => [e.rank, e.title])).toEqual([[8, 'Missing'], [40, 'Also missing']])
    expect(c.result?.entries).toHaveLength(3)
    c.setWindow('week'); await settle()
    expect(history.top).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 500 }))
    c.toggleNotInLibrary(); await settle()
    expect(c.entries).toHaveLength(3)
    expect(history.top).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 200 }))
  })
  it('fetches 500 household albums and suspends the filter for other dimensions', async () => {
    const { c, api, history } = setup(); history.summary.mockResolvedValue(null)
    api.top.mockResolvedValue({ ...result, dimension: 'albums', entries: [{ ...entry, rank: 12, ratingKey: null }, entry] })
    await c.activate(); c.setDimension('albums'); await settle(); c.toggleNotInLibrary(); await settle()
    expect(api.top).toHaveBeenLastCalledWith(expect.objectContaining({ dimension: 'albums', limit: 500 }))
    expect(c.entries.map(e => e.rank)).toEqual([12])
    c.setDimension('tracks'); await settle()
    expect(c.notInLibraryActive).toBe(false)
    expect(api.top).toHaveBeenLastCalledWith(expect.objectContaining({ dimension: 'tracks', limit: 200 }))
    c.reset(); expect(c.notInLibrary).toBe(false)
  })
  it('does not enable the missing-library filter in public builds', async () => {
    vi.stubGlobal('__PUBLIC_BUILD__', true); vi.resetModules()
    try {
      const { ChartsController: PublicController } = await import('./charts-controller.svelte')
      const { api } = setup()
      const c = new PublicController({ api: api as unknown as Window['cratedigger']['charts'], history: null })
      await c.activate(); c.setDimension('albums'); await settle(); c.toggleNotInLibrary(); await settle()
      expect(c.notInLibraryActive).toBe(false)
      expect(c.notInLibrary).toBe(false)
      expect(api.top).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 200 }))
    } finally { vi.unstubAllGlobals(); vi.resetModules() }
  })
  it('filters artist drill-in requests by the current window and ignores a closed panel', async () => {
    const { c, history } = setup(); await c.activate(); c.setYear(2018); await settle()
    const old = deferred<ChartEntry[] | null>(); history.top.mockReturnValue(old.promise)
    const drill = c.openArtist(entry); await settle()
    expect(history.top).toHaveBeenCalledWith({ artist: 'Artist', ...yearBounds(2018), dimension: 'albums', limit: 12 })
    c.closeArtist(); old.resolve([entry]); await drill
    expect(c.artist).toBeNull(); expect(c.artistAlbums).toEqual([])
  })
  it('scopes an open drill-in to a year in place, leaving the chart alone', async () => {
    const { c, history } = setup(); await c.activate(); await settle()
    await c.openArtist(entry)
    const chartCalls = history.top.mock.calls.length
    await c.setArtistYear(2012)
    expect(c.artist).toEqual(entry)
    expect(c.year).toBeNull()
    expect(c.artistYear).toBe(2012)
    expect(history.top).toHaveBeenCalledWith({ artist: 'Artist', ...yearBounds(2012), dimension: 'albums', limit: 12 })
    expect(history.top.mock.calls.length).toBe(chartCalls + 2) // drill-in only, no chart reload
    await c.setArtistYear(2012) // same year again = back to the window
    expect(c.artistYear).toBeNull()
  })
})
