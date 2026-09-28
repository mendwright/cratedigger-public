import { describe, it, expect, vi } from 'vitest'
import type { LabelIndexProgress, PlexAlbum } from '../../../shared/plex'
import {
  LabelIndexController,
  albumToIndexItem,
  type LabelIndexDeps
} from './label-index-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

const flush = () => new Promise((r) => setTimeout(r))

const REL = 'c9b2f3a4-1111-2222-3333-444455556666'
const RG = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function album(opts: {
  ratingKey?: string
  artist?: string
  title?: string
  studio?: string | null
  guids?: string[]
}): PlexAlbum {
  return {
    ratingKey: opts.ratingKey ?? 'rk',
    artist: opts.artist ?? 'Artist',
    title: opts.title ?? 'Title',
    studio: opts.studio ?? null,
    guids: opts.guids ?? []
  } as unknown as PlexAlbum
}

const defaultProgress: LabelIndexProgress = {
  running: false,
  done: 0,
  total: 0,
  current: null,
  error: null
}

function makeController(
  opts: {
    albums?: PlexAlbum[]
    labels?: Record<string, string[]>
    backup?: Record<string, unknown>
    restored?: Record<string, string[]>
    plex?: Record<string, unknown>
  } = {}
) {
  let progressCb: ((p: LabelIndexProgress) => void) | null = null
  const plex = {
    listAlbumLabels: vi.fn(async () => opts.labels ?? {}),
    getAlbumLabelsBackup: vi.fn(async () => opts.backup ?? {}),
    restoreAlbumLabelsBackup: vi.fn(async () => opts.restored ?? {}),
    labelIndexProgress: vi.fn(async () => defaultProgress),
    startLabelIndex: vi.fn(
      async (_args: { items: ReturnType<typeof albumToIndexItem>[]; rebuild: boolean }) => undefined
    ),
    stopLabelIndex: vi.fn(async () => undefined),
    clearAlbumLabels: vi.fn(async () => undefined),
    onLabelIndexProgress: vi.fn((cb: (p: LabelIndexProgress) => void) => {
      progressCb = cb
      return () => {}
    }),
    ...opts.plex
  }
  const ensureAllAlbums = vi.fn(async () => opts.albums ?? [])
  const clearLabelFilters = vi.fn()
  const deps: LabelIndexDeps = {
    ensureAllAlbums,
    clearLabelFilters,
    plex: plex as unknown as PlexApi
  }
  return {
    c: new LabelIndexController(deps),
    plex,
    ensureAllAlbums,
    clearLabelFilters,
    emit: (p: LabelIndexProgress) => progressCb?.(p)
  }
}

describe('albumToIndexItem', () => {
  it('maps identity + studio and extracts release/release-group MBIDs', () => {
    const item = albumToIndexItem(
      album({
        ratingKey: 'rk1',
        artist: 'Boards of Canada',
        title: 'Geogaddi',
        studio: 'Warp',
        guids: [`mbid://release/${REL}`, `mbid://release-group/${RG}`]
      })
    )
    expect(item).toEqual({
      ratingKey: 'rk1',
      artist: 'Boards of Canada',
      title: 'Geogaddi',
      studio: 'Warp',
      releaseMbid: REL,
      releaseGroupMbid: RG
    })
  })

  it('leaves MBIDs null when the album carries no MB guids', () => {
    const item = albumToIndexItem(album({ guids: ['plex://album/123'] }))
    expect(item.releaseMbid).toBeNull()
    expect(item.releaseGroupMbid).toBeNull()
  })
})

describe('LabelIndexController', () => {
  it('loadLabels populates the map and refreshes the backup count', async () => {
    const { c, plex } = makeController({
      labels: { a: ['Verve'], b: ['Blue Note'] },
      backup: { a: 1, b: 1, c: 1 }
    })
    await c.loadLabels()
    expect(c.labels).toEqual({ a: ['Verve'], b: ['Blue Note'] })
    await flush() // loadBackup is fire-and-forget inside loadLabels
    expect(c.backupCount).toBe(3)
    expect(plex.getAlbumLabelsBackup).toHaveBeenCalled()
  })

  it('loadLabels keeps the existing map when the fetch fails', async () => {
    const { c } = makeController({
      plex: {
        listAlbumLabels: vi.fn(async () => {
          throw new Error('store unreadable')
        })
      }
    })
    c.labels = { existing: ['keep'] }
    await c.loadLabels()
    expect(c.labels).toEqual({ existing: ['keep'] })
  })

  it('restoreBackup swaps in the restored map', async () => {
    const { c } = makeController({ restored: { a: ['Verve'] } })
    await c.restoreBackup()
    expect(c.labels).toEqual({ a: ['Verve'] })
  })

  it('start indexes every album, forwarding the rebuild flag', async () => {
    const albums = [album({ ratingKey: 'a' }), album({ ratingKey: 'b' })]
    const { c, plex } = makeController({ albums })
    await c.start(true)
    expect(plex.startLabelIndex).toHaveBeenCalledWith({
      items: albums.map(albumToIndexItem),
      rebuild: true
    })
  })

  it('retryEmpty re-indexes only the albums that came back empty', async () => {
    const albums = [album({ ratingKey: 'a' }), album({ ratingKey: 'b' }), album({ ratingKey: 'c' })]
    const { c, plex } = makeController({ albums })
    c.labels = { a: ['Verve'], b: [], c: [] }
    await c.retryEmpty()
    expect(plex.startLabelIndex).toHaveBeenCalledOnce()
    const arg = plex.startLabelIndex.mock.calls[0][0]
    expect(arg.rebuild).toBe(true)
    expect(arg.items.map((i) => i.ratingKey).sort()).toEqual(['b', 'c'])
  })

  it('retryEmpty is a no-op when nothing is empty', async () => {
    const { c, plex } = makeController({ albums: [album({ ratingKey: 'a' })] })
    c.labels = { a: ['Verve'] }
    await c.retryEmpty()
    expect(plex.startLabelIndex).not.toHaveBeenCalled()
  })

  it('clear wipes the map, clears label filters, and hits the IPC', async () => {
    const { c, plex, clearLabelFilters } = makeController()
    c.labels = { a: ['Verve'] }
    await c.clear()
    expect(plex.clearAlbumLabels).toHaveBeenCalledOnce()
    expect(c.labels).toEqual({})
    expect(clearLabelFilters).toHaveBeenCalledOnce()
  })

  it('subscribe mirrors progress and reloads labels when a run completes', async () => {
    const { c, plex, emit } = makeController({ labels: { a: ['Verve'] } })
    c.subscribe()
    expect(plex.onLabelIndexProgress).toHaveBeenCalled()

    emit({ running: true, done: 5, total: 10, current: 'Pixies', error: null })
    expect(c.progress.done).toBe(5)
    expect(plex.listAlbumLabels).not.toHaveBeenCalled() // still running

    emit({ running: false, done: 10, total: 10, current: null, error: null })
    await flush()
    expect(plex.listAlbumLabels).toHaveBeenCalledOnce() // completed → reload
    expect(c.labels).toEqual({ a: ['Verve'] })
  })
})
