import { describe, expect, it } from 'vitest'
import { sortAlbums } from './album-sort'

const album = (
  ratingKey: string,
  artist: string,
  title: string,
  year: number | null,
  extra: { addedAt?: number; rating?: number | null; lastViewedAt?: number | null } = {}
) => ({
  ratingKey,
  artist,
  title,
  year,
  addedAt: extra.addedAt ?? 0,
  rating: extra.rating ?? null,
  lastViewedAt: extra.lastViewedAt ?? null
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
