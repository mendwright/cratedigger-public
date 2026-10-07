import { describe, expect, it } from 'vitest'
import { sortAlbums } from './album-sort'

const album = (
  ratingKey: string,
  artist: string,
  title: string,
  year: number | null,
  extra: {
    addedAt?: number
    rating?: number | null
    lastViewedAt?: number | null
    releaseDate?: string | null
  } = {}
) => ({
  ratingKey,
  artist,
  title,
  year,
  addedAt: extra.addedAt ?? 0,
  rating: extra.rating ?? null,
  lastViewedAt: extra.lastViewedAt ?? null,
  releaseDate: extra.releaseDate ?? null
})

const keys = (xs: { ratingKey: string }[]): string[] => xs.map((x) => x.ratingKey)

describe('sortAlbums', () => {
  const crate = [
    album('clancy', 'Willie Clancy', 'The Pipering of Willie Clancy', 1980, { addedAt: 5 }),
    album('kip', 'Dr. Strangely Strange', 'Kip of the Serenes', 1969, { addedAt: 4 }),
    album('planxty', 'Planxty', 'Planxty', 1973, { addedAt: 3 }),
    album('wallopers', 'The Mary Wallopers', 'The Mary Wallopers', 2022, { addedAt: 2 }),
    album('undated', 'Anon', 'Field Recordings', null, { addedAt: 1 })
  ]

  it('release date newest-first, undated last', () => {
    expect(keys(sortAlbums(crate, 'releaseDate'))).toEqual([
      'wallopers',
      'clancy',
      'planxty',
      'kip',
      'undated'
    ])
  })

  it('release date oldest-first, undated still last', () => {
    expect(keys(sortAlbums(crate, 'releaseDateAsc'))).toEqual([
      'kip',
      'planxty',
      'clancy',
      'wallopers',
      'undated'
    ])
  })

  it('orders within a year by release day — a bare-year Jan 1 is not today', () => {
    const fresh = [
      album('gem', 'Julia Jacklin', 'The Gem', 2026, { releaseDate: '2026-09-25' }),
      // Plex had 2026-01-01 from a bare-year tag; MusicBrainz said Oct 2.
      album('bone', 'Greg Freeman', 'All Set The Bone', 2026, { releaseDate: '2026-10-02' }),
      album('drin', 'The Drin', 'I Lost My Way For Centuries', 2026, { releaseDate: '2026-01-01' }),
      album('yearonly', 'Anon', 'Year Only', 2026)
    ]
    expect(keys(sortAlbums(fresh, 'releaseDate'))).toEqual(['bone', 'gem', 'drin', 'yearonly'])
  })

  it('ignores a release date that disagrees with the (original) year', () => {
    // A 2005 reissue re-dated to 1984 must not sort by the reissue's day.
    const xs = [
      album('reissue', 'Bruce', 'Born in the U.S.A.', 1984, { releaseDate: '2005-03-01' }),
      album('later', 'Bruce', 'Tunnel of Love', 1987)
    ]
    expect(keys(sortAlbums(xs, 'releaseDate'))).toEqual(['later', 'reissue'])
  })

  it('artist ignores a leading "The"', () => {
    expect(keys(sortAlbums(crate, 'artist'))).toEqual([
      'undated',
      'kip',
      'wallopers',
      'planxty',
      'clancy'
    ])
  })

  it('random is stable for a seed and changes with it', () => {
    const a = keys(sortAlbums(crate, 'random', { seed: '1' }))
    expect(keys(sortAlbums(crate, 'random', { seed: '1' }))).toEqual(a)
    const others = ['2', '3', '4', '5'].map((s) => keys(sortAlbums(crate, 'random', { seed: s })))
    expect(others.some((o) => o.join() !== a.join())).toBe(true)
  })

  it('does not mutate the input', () => {
    const before = keys(crate)
    sortAlbums(crate, 'releaseDate')
    expect(keys(crate)).toEqual(before)
  })
})
