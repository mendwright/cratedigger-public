import { describe, it, expect, vi } from 'vitest'
import type { AlbumMediaInfo, PlexAlbum } from '../../../shared/plex'
import { MediaInfoController, type MediaInfoDeps } from './media-info-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const flush = () => new Promise((r) => setTimeout(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const info = (codec: string): AlbumMediaInfo => ({ codec }) as unknown as AlbumMediaInfo

const album = (ratingKey: string, artist: string, title: string): PlexAlbum =>
  ({ ratingKey, artist, title }) as unknown as PlexAlbum

function makeController(opts: {
  serverId?: string | null
  allAlbums?: PlexAlbum[]
  getAlbumMediaInfo?: ReturnType<typeof vi.fn>
} = {}) {
  const getAlbumMediaInfo =
    opts.getAlbumMediaInfo ?? vi.fn(async ({ ratingKey }) => info(`flac-${ratingKey}`))
  const deps: MediaInfoDeps = {
    serverId: () => (opts.serverId === undefined ? 'srv1' : opts.serverId),
    getAllAlbums: () => opts.allAlbums ?? [],
    plex: { getAlbumMediaInfo } as unknown as PlexApi
  }
  return { c: new MediaInfoController(deps), getAlbumMediaInfo }
}

describe('MediaInfoController — request queue', () => {
  it('fetches and caches the info for a requested album', async () => {
    const { c, getAlbumMediaInfo } = makeController()
    c.request('rk1')
    await flush()
    expect(getAlbumMediaInfo).toHaveBeenCalledOnce()
    expect(getAlbumMediaInfo).toHaveBeenCalledWith({ serverId: 'srv1', ratingKey: 'rk1' })
    expect(c.byAlbum.rk1).toEqual(info('flac-rk1'))
    expect(c.infoFor('rk1')).toEqual(info('flac-rk1'))
  })

  it('coalesces duplicate requests — same key twice → one IPC call', async () => {
    const d = deferred<AlbumMediaInfo>()
    const getAlbumMediaInfo = vi.fn(() => d.promise)
    const { c } = makeController({ getAlbumMediaInfo })
    c.request('rk1')
    c.request('rk1') // still in flight — must coalesce
    d.resolve(info('flac'))
    await flush()
    expect(getAlbumMediaInfo).toHaveBeenCalledOnce()
    c.request('rk1') // already cached — no refetch
    await flush()
    expect(getAlbumMediaInfo).toHaveBeenCalledOnce()
  })

  it('respects the concurrency cap of 2 and drains as requests settle', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<AlbumMediaInfo>>>()
    const getAlbumMediaInfo = vi.fn(({ ratingKey }: { ratingKey: string }) => {
      const d = deferred<AlbumMediaInfo>()
      pending.set(ratingKey, d)
      return d.promise
    })
    const { c } = makeController({ getAlbumMediaInfo })
    c.request('rk1')
    c.request('rk2')
    c.request('rk3')
    c.request('rk4')
    // only the first two go out; rk3/rk4 wait in the queue
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(2)
    pending.get('rk1')!.resolve(info('a'))
    await flush()
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(3)
    pending.get('rk2')!.resolve(info('b'))
    pending.get('rk3')!.resolve(info('c'))
    await flush()
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(4)
    pending.get('rk4')!.resolve(info('d'))
    await flush()
    expect(Object.keys(c.byAlbum).sort()).toEqual(['rk1', 'rk2', 'rk3', 'rk4'])
  })

  it('a failed fetch is swallowed (album stays un-badged) and frees the slot', async () => {
    const d1 = deferred<AlbumMediaInfo>()
    const d2 = deferred<AlbumMediaInfo>()
    const d3 = deferred<AlbumMediaInfo>()
    const queue = [d1, d2, d3]
    const getAlbumMediaInfo = vi.fn(() => queue.shift()!.promise)
    const { c } = makeController({ getAlbumMediaInfo })
    c.request('rk1')
    c.request('rk2')
    c.request('rk3')
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(2)
    d1.reject(new Error('plex 500'))
    await flush()
    // failure released the slot — rk3 went out
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(3)
    expect(c.byAlbum.rk1).toBeUndefined()
    // a failed key may be re-requested later (it left the queued set)
    d2.resolve(info('b'))
    d3.resolve(info('c'))
    await flush()
    const d4 = deferred<AlbumMediaInfo>()
    queue.push(d4)
    c.request('rk1')
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(4)
    d4.resolve(info('a2'))
    await flush()
    expect(c.byAlbum.rk1).toEqual(info('a2'))
  })

  it('does nothing when there is no server (signed out)', async () => {
    const { c, getAlbumMediaInfo } = makeController({ serverId: null })
    c.request('rk1')
    await flush()
    expect(getAlbumMediaInfo).not.toHaveBeenCalled()
    expect(c.byAlbum).toEqual({})
  })
})

describe('MediaInfoController — duplicates scan', () => {
  // two duplicate pairs → 4 scan targets
  const dupLibrary = [
    album('rk1', 'Artist A', 'Album One'),
    album('rk2', 'Artist A', 'Album One (Deluxe)'),
    album('rk3', 'Artist B', 'Other'),
    album('rk4', 'Artist B', 'Other [Remastered]'),
    album('rk5', 'Artist C', 'Unique') // not a duplicate — never scanned
  ]

  it('scans every uncached duplicate-group member with progress counts', async () => {
    const { c, getAlbumMediaInfo } = makeController({ allAlbums: dupLibrary })
    const done = c.runScanForDuplicates()
    expect(c.scan).toEqual({ running: true, total: 4, done: 0 })
    await done
    expect(c.scan).toEqual({ running: false, total: 4, done: 4 })
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(4)
    const scanned = getAlbumMediaInfo.mock.calls.map((a) => a[0].ratingKey).sort()
    expect(scanned).toEqual(['rk1', 'rk2', 'rk3', 'rk4'])
    expect(c.byAlbum.rk5).toBeUndefined()
  })

  it('skips already-cached albums when building targets', async () => {
    const { c, getAlbumMediaInfo } = makeController({ allAlbums: dupLibrary })
    c.byAlbum = { rk1: info('cached'), rk3: info('cached') }
    await c.runScanForDuplicates()
    expect(c.scan).toEqual({ running: false, total: 2, done: 2 })
    const scanned = getAlbumMediaInfo.mock.calls.map((a) => a[0].ratingKey).sort()
    expect(scanned).toEqual(['rk2', 'rk4'])
  })

  it('records an idle zero-scan when there is nothing to fetch', async () => {
    const { c, getAlbumMediaInfo } = makeController({ allAlbums: [album('rk5', 'C', 'Unique')] })
    await c.runScanForDuplicates()
    expect(c.scan).toEqual({ running: false, total: 0, done: 0 })
    expect(getAlbumMediaInfo).not.toHaveBeenCalled()
  })

  it('cancelScan() latches and stops the scan between fetches', async () => {
    const gates: ReturnType<typeof deferred<AlbumMediaInfo>>[] = []
    const getAlbumMediaInfo = vi.fn(() => {
      const d = deferred<AlbumMediaInfo>()
      gates.push(d)
      return d.promise
    })
    const { c } = makeController({ allAlbums: dupLibrary, getAlbumMediaInfo })
    const done = c.runScanForDuplicates()
    await flush()
    expect(gates.length).toBe(1) // sequential — one fetch at a time
    gates[0].resolve(info('a'))
    await flush()
    expect(gates.length).toBe(2)
    c.cancelScan()
    gates[1].resolve(info('b'))
    await done
    // stopped after the 2nd of 4 targets
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(2)
    expect(c.scan).toEqual({ running: false, total: 4, done: 2 })
  })

  it('a failing fetch is skipped but still counts toward progress', async () => {
    const getAlbumMediaInfo = vi.fn(async ({ ratingKey }: { ratingKey: string }) => {
      if (ratingKey === 'rk2') throw new Error('plex 500')
      return info(`flac-${ratingKey}`)
    })
    const { c } = makeController({ allAlbums: dupLibrary, getAlbumMediaInfo })
    await c.runScanForDuplicates()
    expect(c.scan).toEqual({ running: false, total: 4, done: 4 })
    expect(c.byAlbum.rk2).toBeUndefined()
    expect(c.byAlbum.rk1).toBeDefined()
  })

  it('re-running while a scan is in flight is a no-op', async () => {
    const gate = deferred<AlbumMediaInfo>()
    const getAlbumMediaInfo = vi.fn(() => gate.promise)
    const { c } = makeController({ allAlbums: dupLibrary, getAlbumMediaInfo })
    const first = c.runScanForDuplicates()
    await c.runScanForDuplicates() // running — must bail immediately
    expect(getAlbumMediaInfo).toHaveBeenCalledTimes(1)
    c.cancelScan()
    gate.resolve(info('a'))
    await first
  })

  it('resetScan() forgets prior progress so the next visit rescans', async () => {
    const { c } = makeController({ allAlbums: [] })
    await c.runScanForDuplicates()
    expect(c.scan).not.toBeNull()
    c.resetScan()
    expect(c.scan).toBeNull()
  })
})
