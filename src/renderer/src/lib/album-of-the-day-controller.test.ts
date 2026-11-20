import { describe, it, expect, vi } from 'vitest'
import type { PlexAlbum } from '../../../shared/plex'
import {
  AlbumOfTheDayController,
  seedIndex,
  type AlbumOfTheDayDeps
} from './album-of-the-day-controller.svelte'

/** Map-backed stand-in for localStorage behind the storage seam. */
function makeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  }
}

const album = (ratingKey: string): PlexAlbum => ({ ratingKey }) as unknown as PlexAlbum

function makeController(
  opts: {
    albums?: PlexAlbum[]
    section?: string | null
    storage?: ReturnType<typeof makeStorage>
  } = {}
) {
  const storage = opts.storage ?? makeStorage()
  const deps: AlbumOfTheDayDeps = {
    ensureAllAlbums: vi.fn(async () => opts.albums ?? []),
    activeSectionKey: () => opts.section ?? null,
    storage
  }
  return { c: new AlbumOfTheDayController(deps), storage }
}

const todayStr = () => new Date().toISOString().slice(0, 10)

describe('seedIndex', () => {
  it('is deterministic for the same seed + length', () => {
    expect(seedIndex('rock:2026-05-25', 500)).toBe(seedIndex('rock:2026-05-25', 500))
  })

  it('always lands within [0, len)', () => {
    for (const seed of ['a', 'rock:2026-05-25', 'default:1999-12-31', 'x'.repeat(40)]) {
      const i = seedIndex(seed, 7)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(7)
    }
  })
})

describe('AlbumOfTheDayController', () => {
  it('sets null for an empty library', async () => {
    const { c } = makeController({ albums: [] })
    await c.load()
    expect(c.album).toBeNull()
  })

  it('picks deterministically and memoises the choice through the storage seam', async () => {
    const albums = Array.from({ length: 5 }, (_, i) => album(`rk${i}`))
    const { c, storage } = makeController({ albums, section: 'rock' })
    await c.load()
    const expected = albums[seedIndex(`rock:${todayStr()}`, 5)]
    expect(c.album).toBe(expected)
    expect(storage.getItem(`jayamp:album-of-the-day:rock:${todayStr()}`)).toBe(
      expected.ratingKey
    )
  })

  it('returns the cached album when its ratingKey is still in the library', async () => {
    const albums = [album('a'), album('b'), album('c')]
    const storage = makeStorage()
    storage.setItem(`jayamp:album-of-the-day:default:${todayStr()}`, 'c')
    const { c } = makeController({ albums, storage })
    await c.load()
    expect(c.album?.ratingKey).toBe('c')
  })

  it('re-picks when the cached ratingKey is no longer in the library', async () => {
    const albums = [album('a'), album('b')]
    const storage = makeStorage()
    storage.setItem(`jayamp:album-of-the-day:default:${todayStr()}`, 'GONE')
    const { c } = makeController({ albums, storage })
    await c.load()
    expect(['a', 'b']).toContain(c.album?.ratingKey)
  })
})
