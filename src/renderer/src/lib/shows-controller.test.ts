import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PlexAlbum, Venue } from '../../../shared/plex'
import {
  ShowsController,
  buildArtistIndex,
  isMarked,
  matchAgainstLibrary,
  orderShowRows,
  showsForArtist,
  type ShowsDeps
} from './shows-controller.svelte'

type PlexApi = Window['cratedigger']['plex']
type ShowsApi = Window['cratedigger']['shows']

function album(artist: string, ratingKey = artist, artistRatingKey: string | null = null): PlexAlbum {
  return { artist, ratingKey, artistRatingKey } as unknown as PlexAlbum
}

const venue = (id: string, name: string): Venue => ({ id, name }) as unknown as Venue

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const event = (id: string, artistName: string, date: string, supportArtists: string[] = []): any => ({
  id,
  artistName,
  supportArtists,
  date
})

describe('buildArtistIndex', () => {
  it('counts albums per artist (case/space-insensitive) and captures a ratingKey', () => {
    const idx = buildArtistIndex([
      album('Radiohead', 'a1', 'art-rh'),
      album('  radiohead ', 'a2', null),
      album('Boards of Canada', 'a3', 'art-boc')
    ])
    expect(idx.get('radiohead')).toEqual({ count: 2, ratingKey: 'art-rh' })
    expect(idx.get('boards of canada')).toEqual({ count: 1, ratingKey: 'art-boc' })
  })

  it('skips blank artist names and keeps the first non-null ratingKey', () => {
    const idx = buildArtistIndex([
      album('', 'a0', 'should-skip'),
      album('Aphex Twin', 'a1', null),
      album('Aphex Twin', 'a2', 'art-at')
    ])
    expect(idx.has('')).toBe(false)
    expect(idx.get('aphex twin')).toEqual({ count: 2, ratingKey: 'art-at' })
  })
})

describe('matchAgainstLibrary', () => {
  const index = buildArtistIndex([
    album('Radiohead', 'a1', 'art-rh'),
    album('Radiohead', 'a2'),
    album('The Smile', 's1', 'art-smile')
  ])
  const mbidByName = new Map([['radiohead', 'mbid-rh']])

  it('matches the headliner and returns count + ratingKey + mbid', () => {
    const r = matchAgainstLibrary('Radiohead', [], index, mbidByName)
    expect(r).toEqual({
      ownedAlbumCount: 2,
      matchedArtistName: 'Radiohead',
      plexArtistRatingKey: 'art-rh',
      plexArtistMbid: 'mbid-rh'
    })
  })

  it('sums support acts but reports the first match as the matched name', () => {
    const r = matchAgainstLibrary('Unknown Opener', ['The Smile', 'Radiohead'], index, mbidByName)
    expect(r.ownedAlbumCount).toBe(3) // The Smile (1) + Radiohead (2)
    expect(r.matchedArtistName).toBe('The Smile')
    expect(r.plexArtistRatingKey).toBe('art-smile')
    expect(r.plexArtistMbid).toBeNull() // not in mbidByName
  })

  it('matches across artist aliases and leading articles', () => {
    // Library filed under one billing, venue using another — the Uranium
    // Club case that motivated canonicalArtistKey.
    const aliasIndex = buildArtistIndex([
      album('Uranium Club', 'u1', 'art-uc'),
      album('The Smile', 's1', 'art-smile')
    ])
    const aliasMbids = new Map([['uranium club', 'mbid-uc']])
    const viaAlias = matchAgainstLibrary(
      'The Minneapolis Uranium Club',
      [],
      aliasIndex,
      aliasMbids
    )
    expect(viaAlias.ownedAlbumCount).toBe(1)
    expect(viaAlias.matchedArtistName).toBe('The Minneapolis Uranium Club')
    expect(viaAlias.plexArtistRatingKey).toBe('art-uc')
    expect(viaAlias.plexArtistMbid).toBe('mbid-uc')
    // Bare article difference also matches.
    const viaArticle = matchAgainstLibrary('Smile', ['The Smile'], aliasIndex, aliasMbids)
    expect(viaArticle.ownedAlbumCount).toBeGreaterThan(0)
  })

  it('returns zeros/nulls when nothing matches', () => {
    const r = matchAgainstLibrary('Nobody', ['Also Nobody'], index, mbidByName)
    expect(r).toEqual({
      ownedAlbumCount: 0,
      matchedArtistName: null,
      plexArtistRatingKey: null,
      plexArtistMbid: null
    })
  })
})

function makeController(
  opts: {
    albums?: PlexAlbum[]
    venues?: Venue[]
    fetchVenue?: (args: { venueId: string }) => Promise<unknown[]>
    listVenues?: () => Promise<Venue[]>
    artistsWithGuids?: { name: string; mbid: string | null }[]
    refreshAllAlbums?: () => Promise<PlexAlbum[]>
    notificationsEnabled?: boolean
    reportMatches?: (args: { matches: unknown[] }) => Promise<{ newMatches: unknown[] }>
    recentNotified?: string[]
    marks?: Record<string, { pinned: boolean; tickets: number; date: string }>
  } = {}
) {
  const refreshAllAlbums = vi.fn(opts.refreshAllAlbums ?? (async () => opts.albums ?? []))
  const shows = {
    listVenues: vi.fn(opts.listVenues ?? (async () => opts.venues ?? [])),
    fetchVenue: vi.fn(opts.fetchVenue ?? (async () => [])),
    reportMatches: vi.fn(opts.reportMatches ?? (async () => ({ newMatches: [] }))),
    listRecentNotified: vi.fn(async () => opts.recentNotified ?? []),
    listMarks: vi.fn(async () => opts.marks ?? {}),
    setMark: vi.fn(async () => undefined),
    onOpenFromNotification: vi.fn(() => () => {})
  }
  const plex = {
    listLibraryArtistsWithGuids: vi.fn(async () => opts.artistsWithGuids ?? [])
  }
  const deps: ShowsDeps = {
    refreshAllAlbums,
    session: () => ({ signedIn: true, user: {} as never, preferredServerId: 'srv-1' }),
    notificationsEnabled: () => opts.notificationsEnabled ?? true,
    plex: plex as unknown as PlexApi,
    shows: shows as unknown as ShowsApi
  }
  return { c: new ShowsController(deps), refreshAllAlbums, shows, plex }
}

describe('ShowsController.run', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('floats library matches to the top, then date-sorts within each group', async () => {
    const { c } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'The Fillmore')],
      fetchVenue: async () => [
        event('e1', 'Some Local Band', '2026-06-01'),
        event('e2', 'Radiohead', '2026-06-10'),
        event('e3', 'Another Band', '2026-05-20')
      ]
    })
    await c.run()
    expect(c.loading).toBe(false)
    expect(c.rows.map((r) => r.event.id)).toEqual(['e2', 'e3', 'e1'])
    expect(c.rows[0].ownedAlbumCount).toBe(1)
    expect(c.rows[0].matchedArtistName).toBe('Radiohead')
  })

  it('dedupes events by id across venues', async () => {
    const { c } = makeController({
      venues: [venue('v1', 'A'), venue('v2', 'B')],
      fetchVenue: async ({ venueId }) =>
        venueId === 'v1'
          ? [event('dup', 'Band', '2026-06-01'), event('e1', 'X', '2026-06-02')]
          : [event('dup', 'Band', '2026-06-01'), event('e2', 'Y', '2026-06-03')]
    })
    await c.run()
    expect(c.rows).toHaveLength(3)
    expect(c.rows.map((r) => r.event.id).sort()).toEqual(['dup', 'e1', 'e2'])
  })

  it('records genuine venue failures but filters out setup-noise', async () => {
    const { c } = makeController({
      venues: [venue('v1', 'Real Fail'), venue('v2', 'TM'), venue('v3', 'Webview')],
      fetchVenue: async ({ venueId }) => {
        if (venueId === 'v1') throw new Error('502 Bad Gateway')
        if (venueId === 'v2') throw new Error('Ticketmaster API key not set')
        if (venueId === 'v3') throw new Error('No adapter yet for Foo (webview)')
        return []
      }
    })
    await c.run()
    expect(c.venueErrors).toEqual([{ venueName: 'Real Fail', message: '502 Bad Gateway' }])
  })

  it('attaches the Plex MBID to matched rows when available', async () => {
    const { c } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'F')],
      fetchVenue: async () => [event('e1', 'Radiohead', '2026-06-01')],
      artistsWithGuids: [{ name: 'Radiohead', mbid: 'mbid-rh' }]
    })
    await c.run()
    expect(c.rows[0].plexArtistMbid).toBe('mbid-rh')
  })

  it('force-refreshes the library snapshot each run', async () => {
    const { c, refreshAllAlbums } = makeController({ venues: [] })
    await c.run()
    expect(refreshAllAlbums).toHaveBeenCalledOnce()
  })

  it('surfaces a top-level failure and clears loading', async () => {
    const { c } = makeController({
      listVenues: async () => {
        throw new Error('venue list unreachable')
      }
    })
    await c.run()
    expect(c.error).toBe('venue list unreachable')
    expect(c.loading).toBe(false)
  })

  it('a superseded run does not write its late rows', async () => {
    let refreshCall = 0
    let resolveFirst!: (v: PlexAlbum[]) => void
    const firstRefresh = new Promise<PlexAlbum[]>((r) => (resolveFirst = r))
    const refreshAllAlbums = () => {
      refreshCall++
      return refreshCall === 1 ? firstRefresh : Promise.resolve([])
    }
    const { c } = makeController({
      refreshAllAlbums,
      venues: [venue('v1', 'A')],
      fetchVenue: async () => [event('e1', 'Band', '2026-06-01')]
    })

    const p1 = c.run() // seq 1 — parks on the first refresh
    const p2 = c.run() // seq 2 — runs to completion
    await p2
    expect(c.rows.map((r) => r.event.id)).toEqual(['e1'])

    resolveFirst([]) // seq-1 run resumes, now stale
    await p1
    expect(c.rows.map((r) => r.event.id)).toEqual(['e1']) // unchanged
  })

  it('reports only library-matched rows to main, suppressing the banner', async () => {
    const { c, shows } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'The Fillmore')],
      fetchVenue: async () => [
        event('e1', 'Radiohead', '2026-06-10'),
        event('e2', 'Some Local Band', '2026-06-01')
      ],
      reportMatches: async () => ({ newMatches: [{ id: 'e1' }] })
    })
    await c.run()
    expect(shows.reportMatches).toHaveBeenCalledTimes(1)
    const reported = shows.reportMatches.mock.calls[0][0].matches
    expect(reported).toEqual([
      { id: 'e1', artistName: 'Radiohead', venueName: 'The Fillmore', date: '2026-06-10', ownedAlbumCount: 1 }
    ])
    // Visible run never raises the in-app banner — the screen already shows it.
    expect(c.newShowsBanner).toEqual([])
  })
})

describe('ShowsController.backgroundCheck', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('scans venues, reports matches, and raises the banner for new ones', async () => {
    const newMatch = {
      id: 'e1',
      artistName: 'Radiohead',
      venueName: 'The Fillmore',
      date: '2026-06-10',
      ownedAlbumCount: 1
    }
    const { c, shows } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'The Fillmore')],
      fetchVenue: async () => [
        event('e1', 'Radiohead', '2026-06-10'),
        event('e2', 'Some Local Band', '2026-06-01')
      ],
      reportMatches: async () => ({ newMatches: [newMatch] })
    })
    await c.backgroundCheck()
    expect(shows.reportMatches).toHaveBeenCalledTimes(1)
    expect(shows.reportMatches.mock.calls[0][0].matches).toEqual([newMatch])
    expect(c.newShowsBanner).toEqual([newMatch])
    // The background scan must not disturb the visible screen.
    expect(c.rows).toEqual([])
    expect(c.loading).toBe(false)
  })

  it('does nothing when notifications are disabled', async () => {
    const { c, shows, refreshAllAlbums } = makeController({
      notificationsEnabled: false,
      venues: [venue('v1', 'F')],
      fetchVenue: async () => [event('e1', 'Radiohead', '2026-06-10')]
    })
    await c.backgroundCheck()
    expect(refreshAllAlbums).not.toHaveBeenCalled()
    expect(shows.reportMatches).not.toHaveBeenCalled()
  })

  it('keeps the banner empty when main reports nothing new', async () => {
    const { c } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'F')],
      fetchVenue: async () => [event('e1', 'Radiohead', '2026-06-10')],
      reportMatches: async () => ({ newMatches: [] })
    })
    await c.backgroundCheck()
    expect(c.newShowsBanner).toEqual([])
  })

  it('refreshes the recent-new ids after reporting new matches', async () => {
    const { c, shows } = makeController({
      albums: [album('Greg Mendez', 'rk', 'art-gm')],
      venues: [venue('v1', 'Bottom of the Hill')],
      fetchVenue: async () => [event('e1', 'Greg Mendez', '2026-07-10')],
      reportMatches: async () => ({ newMatches: [{ id: 'e1' }] }),
      recentNotified: ['e1']
    })
    await c.backgroundCheck()
    expect(shows.listRecentNotified).toHaveBeenCalled()
    // queue a microtask flush — refreshRecentNew is fire-and-forget
    await Promise.resolve()
    expect(c.recentNewIds).toEqual(['e1'])
  })

  it('dismissBanner clears a raised banner', async () => {
    const { c } = makeController({
      albums: [album('Radiohead', 'rk', 'art-rh')],
      venues: [venue('v1', 'F')],
      fetchVenue: async () => [event('e1', 'Radiohead', '2026-06-10')],
      reportMatches: async () => ({ newMatches: [{ id: 'e1' }] })
    })
    await c.backgroundCheck()
    expect(c.newShowsBanner.length).toBe(1)
    c.dismissBanner()
    expect(c.newShowsBanner).toEqual([])
  })
})

describe('ShowsController.hasUnseenNewShows', () => {
  it('is false with no recent announcements', () => {
    const { c } = makeController()
    expect(c.hasUnseenNewShows()).toBe(false)
  })

  it('is true when a recently-announced show is missing from the visible rows', async () => {
    const { c } = makeController({ recentNotified: ['e-new'] })
    await c.refreshRecentNew()
    expect(c.rows).toEqual([]) // stale/empty list predates the announcement
    expect(c.hasUnseenNewShows()).toBe(true)
  })

  it('is false once the announced show is in the rows', async () => {
    const { c } = makeController({
      albums: [album('Greg Mendez', 'rk', 'art-gm')],
      venues: [venue('v1', 'Bottom of the Hill')],
      fetchVenue: async () => [event('e-new', 'Greg Mendez', '2026-07-10')],
      recentNotified: ['e-new']
    })
    await c.refreshRecentNew()
    await c.run()
    expect(c.hasUnseenNewShows()).toBe(false)
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowOf = (id: string, artist: string, date: string, owned = 0): any => ({
  event: { id, artistName: artist, supportArtists: [], date, url: '' },
  venue: venue('v1', 'The Fillmore'),
  ownedAlbumCount: owned,
  matchedArtistName: owned > 0 ? artist : null,
  plexArtistRatingKey: null,
  plexArtistMbid: null
})

describe('orderShowRows', () => {
  it('floats marked rows above owned matches, each group date-sorted', () => {
    const rows = [
      rowOf('owned-early', 'Radiohead', '2026-06-01', 2),
      rowOf('plain', 'Some Band', '2026-05-20'),
      rowOf('pinned-late', 'Destroyer', '2026-07-05'),
      rowOf('ticketed', 'Jane Remover', '2026-06-15')
    ]
    const marks = {
      'pinned-late': { pinned: true, tickets: 0, date: '2026-07-05' },
      ticketed: { pinned: false, tickets: 2, date: '2026-06-15' }
    }
    expect(orderShowRows(rows, marks).map((r) => r.event.id)).toEqual([
      'ticketed', // marked, earlier date
      'pinned-late', // marked, later date
      'owned-early', // owned
      'plain'
    ])
  })

  it('sorts the marked block purely by date — owned albums are no tiebreak there', () => {
    const rows = [
      rowOf('pinned-owned-late', 'Deer Tick', '2026-12-07', 7),
      rowOf('pinned-unowned-early', 'Twisted Teens', '2026-09-02'),
      rowOf('pinned-owned-early', 'Greg Mendez', '2026-08-12', 2)
    ]
    const marks = {
      'pinned-owned-late': { pinned: true, tickets: 0, date: '2026-12-07' },
      'pinned-unowned-early': { pinned: true, tickets: 2, date: '2026-09-02' },
      'pinned-owned-early': { pinned: true, tickets: 0, date: '2026-08-12' }
    }
    expect(orderShowRows(rows, marks).map((r) => r.event.id)).toEqual([
      'pinned-owned-early',
      'pinned-unowned-early',
      'pinned-owned-late'
    ])
  })

  it('ignores bare marks (unpinned, zero tickets)', () => {
    const rows = [rowOf('a', 'A', '2026-06-02'), rowOf('b', 'B', '2026-06-01')]
    const marks = { a: { pinned: false, tickets: 0, date: '2026-06-02' } }
    expect(orderShowRows(rows, marks).map((r) => r.event.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const rows = [rowOf('a', 'A', '2026-06-02'), rowOf('b', 'B', '2026-06-01')]
    const snapshot = rows.map((r) => r.event.id)
    orderShowRows(rows, {})
    expect(rows.map((r) => r.event.id)).toEqual(snapshot)
  })
})

describe('showsForArtist', () => {
  // rowOf can't carry support acts (always []), so build rows inline here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supRow = (id: string, headliner: string, date: string, supports: string[]): any => ({
    event: { id, artistName: headliner, supportArtists: supports, date, url: '' },
    venue: venue('v1', 'The Fillmore'),
    ownedAlbumCount: 0,
    matchedArtistName: null,
    plexArtistRatingKey: null,
    plexArtistMbid: null
  })

  it('matches the headliner (alias/ampersand-insensitive) and sorts soonest first', () => {
    const rows = [
      rowOf('late', 'Belle and Sebastian', '2026-08-01'),
      rowOf('other', 'Radiohead', '2026-06-10'),
      rowOf('soon', 'Belle & Sebastian', '2026-06-20')
    ]
    expect(showsForArtist(rows, 'Belle & Sebastian', '2026-06-01').map((r) => r.event.id)).toEqual([
      'soon',
      'late'
    ])
  })

  it('matches when the artist is a support act', () => {
    const rows = [supRow('s', 'Headliner Band', '2026-07-01', ['Opener', 'Cameron Winter'])]
    expect(showsForArtist(rows, 'Cameron Winter', '2026-06-01').map((r) => r.event.id)).toEqual(['s'])
  })

  it('drops shows before today and handles empty/blank artists', () => {
    const rows = [
      rowOf('past', 'Radiohead', '2026-05-30'),
      rowOf('today', 'Radiohead', '2026-06-01'),
      rowOf('future', 'Radiohead', '2026-06-15')
    ]
    expect(showsForArtist(rows, 'Radiohead', '2026-06-01').map((r) => r.event.id)).toEqual([
      'today',
      'future'
    ])
    expect(showsForArtist(rows, '', '2026-06-01')).toEqual([])
    expect(showsForArtist(rows, null, '2026-06-01')).toEqual([])
  })
})

describe('isMarked', () => {
  it('true for pinned or ticketed, false for bare/absent', () => {
    expect(isMarked({ pinned: true, tickets: 0, date: '2026-06-01' })).toBe(true)
    expect(isMarked({ pinned: false, tickets: 1, date: '2026-06-01' })).toBe(true)
    expect(isMarked({ pinned: false, tickets: 0, date: '2026-06-01' })).toBe(false)
    expect(isMarked(undefined)).toBe(false)
  })
})

describe('show marks', () => {
  it('loadMarks mirrors the persisted map', async () => {
    const { c } = makeController({
      marks: { 'v1:2026-06-15:Jane Remover': { pinned: true, tickets: 2, date: '2026-06-15' } }
    })
    await c.loadMarks()
    expect(c.marks['v1:2026-06-15:Jane Remover']).toEqual({
      pinned: true,
      tickets: 2,
      date: '2026-06-15'
    })
  })

  it('togglePin sets and clears the pin, persisting through IPC', async () => {
    const { c, shows } = makeController()
    const row = rowOf('e1', 'Destroyer', '2026-07-05')
    c.togglePin(row)
    expect(c.marks.e1).toEqual({ pinned: true, tickets: 0, date: '2026-07-05' })
    expect(shows.setMark).toHaveBeenCalledWith({
      id: 'e1',
      mark: { pinned: true, tickets: 0, date: '2026-07-05' }
    })
    c.togglePin(row)
    // Unpinned with no tickets → mark deleted locally, deletion persisted.
    expect(c.marks.e1).toBeUndefined()
    expect(shows.setMark).toHaveBeenLastCalledWith({
      id: 'e1',
      mark: { pinned: false, tickets: 0, date: '2026-07-05' }
    })
  })

  it('adjustTickets steps the count, clamps at 0, and keeps an existing pin', () => {
    const { c } = makeController()
    const row = rowOf('e1', 'Jane Remover', '2026-06-15')
    c.togglePin(row)
    c.adjustTickets(row, 1)
    c.adjustTickets(row, 1)
    expect(c.marks.e1).toEqual({ pinned: true, tickets: 2, date: '2026-06-15' })
    c.adjustTickets(row, -1)
    c.adjustTickets(row, -1)
    c.adjustTickets(row, -1) // clamp — can't go negative
    expect(c.marks.e1).toEqual({ pinned: true, tickets: 0, date: '2026-06-15' })
  })

  it('zeroing tickets on an unpinned row removes the mark entirely', () => {
    const { c } = makeController()
    const row = rowOf('e1', 'Metric', '2026-06-21')
    c.adjustTickets(row, 1)
    expect(isMarked(c.marks.e1)).toBe(true)
    c.adjustTickets(row, -1)
    expect(c.marks.e1).toBeUndefined()
  })
})

describe('venue filter', () => {
  it('toggles venue ids in and out; clear empties', () => {
    const { c } = makeController()
    expect(c.venueFilter).toEqual([])
    c.toggleVenueFilter('storkclub')
    c.toggleVenueFilter('chapel')
    expect(c.venueFilter).toEqual(['storkclub', 'chapel'])
    c.toggleVenueFilter('storkclub')
    expect(c.venueFilter).toEqual(['chapel'])
    c.clearVenueFilter()
    expect(c.venueFilter).toEqual([])
  })
})
