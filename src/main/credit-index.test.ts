import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlbumCredits } from '../shared/plex.js'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

import { app } from 'electron'
import { ALBUM_CREDITS_BUCKET, JsonCache } from './mb-cache.js'
import { getInLibraryAppearances, getLibraryCreditCounts, invalidateCreditIndex } from './credit-index.js'

function credits(): AlbumCredits {
  return {
    releaseMbid: 'release-1',
    originalDate: null,
    releaseLevel: [{ role: 'producer', person: { mbid: 'mbid-producer', name: 'Pat Producer' } }],
    byTrack: {
      '1': [{ role: 'instrument', instrument: 'guitar', person: { mbid: 'mbid-guitarist', name: 'Gia Guitar' } }]
    },
    trackArtists: {},
    members: [{ mbid: 'mbid-member', name: 'Mel Member' }]
  }
}

describe('getInLibraryAppearances', () => {
  beforeEach(async () => {
    const userData = await mkdtemp(join(tmpdir(), 'credit-index-'))
    vi.mocked(app.getPath).mockReturnValue(userData)
    // The index memoizes in module state; each test starts from a cold build.
    invalidateCreditIndex()
  })

  it('finds credits written through the album-credits JsonCache', async () => {
    // Write through JsonCache itself so the test pins the real on-disk layout
    // — if the index ever reads a different bucket than the cache writes
    // (as happened on the v5 bump), this fails.
    await new JsonCache<AlbumCredits>(ALBUM_CREDITS_BUCKET).set('4242', credits())

    expect(await getInLibraryAppearances('mbid-producer')).toEqual([
      { plexRatingKey: '4242', roles: [{ role: 'producer', instrument: null }] }
    ])
    expect(await getInLibraryAppearances('mbid-guitarist')).toEqual([
      { plexRatingKey: '4242', roles: [{ role: 'instrument', instrument: 'guitar' }] }
    ])
    expect(await getInLibraryAppearances('mbid-member')).toEqual([
      { plexRatingKey: '4242', roles: [{ role: 'member', instrument: null }] }
    ])
  })

  it('returns nothing for a person with no cached appearances', async () => {
    expect(await getInLibraryAppearances('mbid-nobody')).toEqual([])
  })

  it('picks up newly cached albums after invalidation', async () => {
    const cache = new JsonCache<AlbumCredits>(ALBUM_CREDITS_BUCKET)
    await cache.set('1', credits())
    expect(await getInLibraryAppearances('mbid-member')).toHaveLength(1)

    // Memoized: the second album stays invisible until the writer invalidates.
    await cache.set('2', credits())
    expect(await getInLibraryAppearances('mbid-member')).toHaveLength(1)
    invalidateCreditIndex()
    expect(await getInLibraryAppearances('mbid-member')).toHaveLength(2)
  })
})

describe('getLibraryCreditCounts', () => {
  beforeEach(async () => {
    const userData = await mkdtemp(join(tmpdir(), 'credit-counts-'))
    vi.mocked(app.getPath).mockReturnValue(userData)
    invalidateCreditIndex()
  })

  it('counts distinct library albums per person, leaving out the album in view', async () => {
    const cache = new JsonCache<AlbumCredits>(ALBUM_CREDITS_BUCKET)
    await cache.set('100', credits())
    await cache.set('200', credits())
    await cache.set('300', credits())

    expect(await getLibraryCreditCounts(['mbid-guitarist', 'mbid-nobody'], '100')).toEqual({
      'mbid-guitarist': 2,
      'mbid-nobody': 0
    })
    expect(await getLibraryCreditCounts(['mbid-producer'])).toEqual({ 'mbid-producer': 3 })
  })
})
