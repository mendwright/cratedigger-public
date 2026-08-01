import { describe, it, expect } from 'vitest'
import type { PlexAlbum } from '../../../shared/plex'
import {
  roleRank,
  ROLE_RANK,
  groupAppearances,
  compareAlbums,
  filterDeepCuts,
  TWO_YEARS_SECS,
  type AppearanceRow,
  type CreditedAlbumEntry
} from './entity-view'

function album(opts: {
  ratingKey: string
  title?: string
  year?: number | null
  viewCount?: number | null
  lastViewedAt?: number | null
}): PlexAlbum {
  return {
    ratingKey: opts.ratingKey,
    title: opts.title ?? opts.ratingKey,
    artist: 'Artist',
    year: opts.year ?? null,
    viewCount: opts.viewCount ?? null,
    lastViewedAt: opts.lastViewedAt ?? null,
    guids: []
  } as unknown as PlexAlbum
}

describe('roleRank', () => {
  it('ranks by substring match against ROLE_RANK order', () => {
    expect(roleRank('Lead Vocals')).toBe(0)
    expect(roleRank('guitar')).toBeLessThan(roleRank('producer'))
  })

  it('unknown roles sort after every known one', () => {
    expect(roleRank('kazoo')).toBe(ROLE_RANK.length)
  })
})

describe('groupAppearances', () => {
  const a1 = album({ ratingKey: 'a1', year: 1972 })
  const a2 = album({ ratingKey: 'a2', year: 1969 })

  it('returns [] for null input', () => {
    expect(groupAppearances(null)).toEqual([])
  })

  it('groups by role::instrument, labels by instrument when present', () => {
    const rows: AppearanceRow[] = [
      { album: a1, roles: [{ role: 'instrument', instrument: 'guitar' }] },
      { album: a2, roles: [{ role: 'instrument', instrument: 'guitar' }] },
      { album: a1, roles: [{ role: 'producer', instrument: null }] }
    ]
    const groups = groupAppearances(rows)
    expect(groups.map((g) => g.label)).toEqual(['guitar', 'producer'])
    // year-sorted within the group: 1969 before 1972
    expect(groups[0].albums.map((a) => a.ratingKey)).toEqual(['a2', 'a1'])
  })

  it('dedupes the same album appearing twice in one group', () => {
    const rows: AppearanceRow[] = [
      { album: a1, roles: [{ role: 'vocals', instrument: null }] },
      { album: a1, roles: [{ role: 'vocals', instrument: null }] }
    ]
    const groups = groupAppearances(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].albums).toHaveLength(1)
  })

  it('orders groups by role rank, then label', () => {
    const rows: AppearanceRow[] = [
      { album: a1, roles: [{ role: 'producer', instrument: null }] },
      { album: a1, roles: [{ role: 'instrument', instrument: 'bass' }] },
      { album: a1, roles: [{ role: 'instrument', instrument: 'kazoo' }] }
    ]
    const labels = groupAppearances(rows).map((g) => g.label)
    expect(labels).toEqual(['bass', 'producer', 'kazoo'])
  })
})

describe('compareAlbums', () => {
  it('most-played: viewCount desc, lastViewedAt desc, then year asc', () => {
    const heavy = album({ ratingKey: 'h', viewCount: 30 })
    const light = album({ ratingKey: 'l', viewCount: 2 })
    expect(compareAlbums(heavy, light, 'most-played')).toBeLessThan(0)

    const recent = album({ ratingKey: 'r', viewCount: 5, lastViewedAt: 2000 })
    const stale = album({ ratingKey: 's', viewCount: 5, lastViewedAt: 1000 })
    expect(compareAlbums(recent, stale, 'most-played')).toBeLessThan(0)
  })

  it('release: year asc with missing years last, title tiebreak', () => {
    const early = album({ ratingKey: 'e', year: 1969 })
    const late = album({ ratingKey: 'l', year: 1980 })
    const unknown = album({ ratingKey: 'u', year: null })
    expect(compareAlbums(early, late, 'release')).toBeLessThan(0)
    expect(compareAlbums(unknown, late, 'release')).toBeGreaterThan(0)
    const a = album({ ratingKey: 'a', title: 'Abbey', year: 1969 })
    const b = album({ ratingKey: 'b', title: 'Let It', year: 1969 })
    expect(compareAlbums(a, b, 'release')).toBeLessThan(0)
  })

  it('release mode ignores play counts entirely', () => {
    const playedLate = album({ ratingKey: 'p', year: 1980, viewCount: 100 })
    const unplayedEarly = album({ ratingKey: 'u', year: 1969, viewCount: 0 })
    expect(compareAlbums(unplayedEarly, playedLate, 'release')).toBeLessThan(0)
  })
})

describe('filterDeepCuts', () => {
  const NOW = 1_800_000_000

  function entry(opts: Parameters<typeof album>[0]): CreditedAlbumEntry {
    return { album: album(opts), roles: ['guitar'] }
  }

  it('keeps never-played albums', () => {
    const cuts = filterDeepCuts([entry({ ratingKey: 'never', viewCount: 0 })], NOW)
    expect(cuts.map((e) => e.album.ratingKey)).toEqual(['never'])
  })

  it('keeps albums last played over two years ago, drops recent ones', () => {
    const old = entry({ ratingKey: 'old', viewCount: 3, lastViewedAt: NOW - TWO_YEARS_SECS - 1 })
    const recent = entry({ ratingKey: 'recent', viewCount: 3, lastViewedAt: NOW - 1000 })
    const cuts = filterDeepCuts([old, recent], NOW)
    expect(cuts.map((e) => e.album.ratingKey)).toEqual(['old'])
  })

  it('drops played albums with no lastViewedAt (can\'t prove staleness)', () => {
    const cuts = filterDeepCuts([entry({ ratingKey: 'x', viewCount: 3, lastViewedAt: null })], NOW)
    expect(cuts).toEqual([])
  })

  it('year-sorts and caps at 6', () => {
    const entries = [1979, 1971, 1975, 1969, 1981, 1973, 1977].map((y) =>
      entry({ ratingKey: `y${y}`, year: y, viewCount: 0 })
    )
    const cuts = filterDeepCuts(entries, NOW)
    expect(cuts).toHaveLength(6)
    expect(cuts.map((e) => e.album.year)).toEqual([1969, 1971, 1973, 1975, 1977, 1979])
  })
})
