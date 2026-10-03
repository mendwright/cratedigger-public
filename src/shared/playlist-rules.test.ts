import { describe, it, expect } from 'vitest'
import { albumMatchesRules, rulesAreEmpty, selectAlbums } from './playlist-rules'
import type { PlexAlbum, SmartRules } from './plex'

function album(over: Partial<PlexAlbum>): PlexAlbum {
  return {
    ratingKey: 'rk',
    title: 'T',
    artist: 'A',
    artistRatingKey: null,
    year: null,
    thumb: null,
    addedAt: 0,
    rating: null,
    lastViewedAt: null,
    viewCount: null,
    guids: [],
    trackCount: null,
    studio: null,
    genres: [],
    ...over
  }
}

const rules = (over: Partial<SmartRules>): SmartRules => ({
  genres: [],
  labels: [],
  yearFrom: null,
  yearTo: null,
  ...over
})

const deps = (labels: Record<string, string[]> = {}) => ({
  labelsFor: (rk: string) => labels[rk] ?? [],
  yearFor: (a: PlexAlbum) => a.year
})

describe('albumMatchesRules', () => {
  it('genre clause is any-of and case-insensitive', () => {
    const a = album({ genres: ['Soul', 'Funk'] })
    expect(albumMatchesRules(a, rules({ genres: ['soul'] }), deps())).toBe(true)
    expect(albumMatchesRules(a, rules({ genres: ['Jazz', 'FUNK'] }), deps())).toBe(true)
    expect(albumMatchesRules(a, rules({ genres: ['Jazz'] }), deps())).toBe(false)
  })

  it('label clause reads the injected label index', () => {
    const a = album({ ratingKey: 'x' })
    const d = deps({ x: ['Stones Throw'] })
    expect(albumMatchesRules(a, rules({ labels: ['stones throw'] }), d)).toBe(true)
    expect(albumMatchesRules(a, rules({ labels: ['Numero Group'] }), d)).toBe(false)
  })

  it('year range uses the injected effective year and rejects unknown years', () => {
    expect(albumMatchesRules(album({ year: 1972 }), rules({ yearFrom: 1970, yearTo: 1979 }), deps())).toBe(true)
    expect(albumMatchesRules(album({ year: 1980 }), rules({ yearFrom: 1970, yearTo: 1979 }), deps())).toBe(false)
    expect(albumMatchesRules(album({ year: null }), rules({ yearFrom: 1970 }), deps())).toBe(false)
    expect(albumMatchesRules(album({ year: 1990 }), rules({ yearFrom: 1970 }), deps())).toBe(true)
  })

  it('clauses AND together; empty clauses are ignored', () => {
    const a = album({ ratingKey: 'x', genres: ['Soul'], year: 1972 })
    const d = deps({ x: ['Motown'] })
    expect(
      albumMatchesRules(a, rules({ genres: ['soul'], labels: ['motown'], yearFrom: 1970, yearTo: 1975 }), d)
    ).toBe(true)
    expect(
      albumMatchesRules(a, rules({ genres: ['soul'], labels: ['stax'] }), d)
    ).toBe(false)
  })
})

describe('rulesAreEmpty', () => {
  it('detects the match-everything definition', () => {
    expect(rulesAreEmpty(rules({}))).toBe(true)
    expect(rulesAreEmpty(rules({ genres: ['soul'] }))).toBe(false)
    expect(rulesAreEmpty(rules({ yearTo: 1979 }))).toBe(false)
  })
})

describe('selectAlbums', () => {
  const catalog = [
    album({ ratingKey: '1', artist: 'Zapp', year: 1980, genres: ['Funk'], addedAt: 30 }),
    album({ ratingKey: '2', artist: 'Al Green', year: 1972, genres: ['Soul'], addedAt: 10 }),
    album({ ratingKey: '3', artist: 'Curtis Mayfield', year: 1970, genres: ['Soul'], addedAt: 20 })
  ]

  it('orders by artist', () => {
    const out = selectAlbums(catalog, rules({}), 'artist', null, deps())
    expect(out.map((a) => a.ratingKey)).toEqual(['2', '3', '1'])
  })

  it('orders by year', () => {
    const out = selectAlbums(catalog, rules({}), 'year', null, deps())
    expect(out.map((a) => a.ratingKey)).toEqual(['3', '2', '1'])
  })

  it('orders by added (newest first)', () => {
    const out = selectAlbums(catalog, rules({}), 'added', null, deps())
    expect(out.map((a) => a.ratingKey)).toEqual(['1', '3', '2'])
  })

  it('applies the limit after ordering', () => {
    const out = selectAlbums(catalog, rules({ genres: ['soul'] }), 'year', 1, deps())
    expect(out.map((a) => a.ratingKey)).toEqual(['3'])
  })

  it('random order shuffles with the injected rng', () => {
    const out = selectAlbums(catalog, rules({}), 'random', null, { ...deps(), rng: () => 0 })
    expect(out).toHaveLength(3)
    // rng()=0 swaps each i with index 0 — deterministic permutation:
    // [1,2,3] → swap(2,0) → [3,2,1] → swap(1,0) → [2,3,1]
    expect(out.map((a) => a.ratingKey)).toEqual(['2', '3', '1'])
  })
})
