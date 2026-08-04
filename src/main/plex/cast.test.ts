import { describe, it, expect, vi } from 'vitest'

// cast.ts pulls in headers.js/library.js, which reach electron + electron-store.
// weightedPick is pure — stub the chain to keep this a unit test.
vi.mock('./headers.js', () => ({ plexHeaders: () => ({}) }))
vi.mock('./http.js', () => ({ plexFetch: vi.fn() }))
vi.mock('./library.js', () => ({
  getAlbumDetail: vi.fn(),
  listAllAlbums: vi.fn(),
  listMusicSections: vi.fn(),
  listSimilarArtists: vi.fn()
}))

import { chooseRadioAlbum, weightedPick, type RadioCandidate } from './cast'
import type { PlexAlbum, RadioHistoryEntry, RadioSteer } from '../../shared/plex'

describe('weightedPick', () => {
  const items = [
    { id: 'a', w: 6 },
    { id: 'b', w: 3 },
    { id: 'c', w: 1 }
  ]
  const weightOf = (it: { w: number }): number => it.w

  it('returns null on empty input', () => {
    expect(weightedPick([], weightOf)).toBeNull()
  })

  it('picks the first item when rng lands at the start', () => {
    expect(weightedPick(items, weightOf, () => 0)?.id).toBe('a')
  })

  it('picks later items as rng moves through the cumulative weights', () => {
    // total = 10; r = 0.65 * 10 = 6.5 → past a (6), inside b (6..9)
    expect(weightedPick(items, weightOf, () => 0.65)?.id).toBe('b')
    // r = 9.5 → inside c (9..10)
    expect(weightedPick(items, weightOf, () => 0.95)?.id).toBe('c')
  })

  it('never strands zero-weight items (0.5 floor)', () => {
    const zeros = [
      { id: 'a', w: 4 },
      { id: 'b', w: 0 }
    ]
    // total = 4 + 0.5; r just past a's span lands on b
    expect(weightedPick(zeros, weightOf, () => 0.99)?.id).toBe('b')
  })

  it('single item always wins', () => {
    expect(weightedPick([items[2]], weightOf, () => 0.7)?.id).toBe('c')
  })

  it('roughly follows the weights over many draws', () => {
    // Deterministic LCG so the test can't flake.
    let seed = 42
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32
      return seed / 2 ** 32
    }
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 2000; i++) {
      counts[weightedPick(items, weightOf, rng)!.id]++
    }
    expect(counts.a).toBeGreaterThan(counts.b)
    expect(counts.b).toBeGreaterThan(counts.c)
    expect(counts.c).toBeGreaterThan(50) // the tail still gets picked
  })
})

describe('chooseRadioAlbum', () => {
  const NOW = 1_700_000_000_000
  const DAY = 24 * 3600_000

  function album(over: Partial<PlexAlbum> & { ratingKey: string }): PlexAlbum {
    return {
      title: over.ratingKey,
      artist: 'Artist',
      artistRatingKey: 'art-x',
      year: 2000,
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

  const current = album({
    ratingKey: 'cur',
    artistRatingKey: 'art-cur',
    genres: ['Psych Rock'],
    year: 1972
  })

  function choose(over: {
    candidates: RadioCandidate[]
    steer?: RadioSteer
    currentGenres?: string[]
    currentLabels?: string[]
    albumLabels?: Record<string, string[]>
    history?: RadioHistoryEntry[]
    excluded?: string[]
    rng?: () => number
  }): ReturnType<typeof chooseRadioAlbum> {
    return chooseRadioAlbum({
      currentAlbum: current,
      currentGenres: over.currentGenres ?? ['Psych Rock'],
      currentLabels: over.currentLabels ?? [],
      candidates: over.candidates,
      steer: over.steer ?? 'drift',
      albumLabels: over.albumLabels ?? {},
      history: over.history ?? [],
      excludedAlbumKeys: new Set(over.excluded ?? []),
      now: NOW,
      rng: over.rng ?? (() => 0)
    })
  }

  it('excludes the current album, session excludes, and recent history', () => {
    const pick = choose({
      candidates: [
        { album: current, origin: 'library' },
        { album: album({ ratingKey: 'vetoed', genres: ['Psych Rock'] }), origin: 'library' },
        { album: album({ ratingKey: 'recent', genres: ['Psych Rock'] }), origin: 'library' },
        { album: album({ ratingKey: 'ok', genres: ['Psych Rock'] }), origin: 'library' }
      ],
      excluded: ['vetoed'],
      history: [{ albumRatingKey: 'recent', artistRatingKey: null, at: NOW - 5 * DAY }]
    })
    expect(pick?.albumRatingKey).toBe('ok')
  })

  it('lets a history album back in after the repeat window passes', () => {
    const pick = choose({
      candidates: [
        { album: album({ ratingKey: 'old-pick', genres: ['Psych Rock'] }), origin: 'library' }
      ],
      history: [{ albumRatingKey: 'old-pick', artistRatingKey: null, at: NOW - 40 * DAY }]
    })
    expect(pick?.albumRatingKey).toBe('old-pick')
  })

  it('scores down artists radio picked in the last week', () => {
    const tired = album({
      ratingKey: 'tired',
      artistRatingKey: 'art-tired',
      genres: ['Psych Rock'],
      year: 1972
    })
    const fresh = album({
      ratingKey: 'fresh',
      artistRatingKey: 'art-fresh',
      genres: ['Psych Rock'],
      year: 1972
    })
    const pick = choose({
      candidates: [
        { album: tired, origin: 'library' },
        { album: fresh, origin: 'library' }
      ],
      history: [{ albumRatingKey: 'other', artistRatingKey: 'art-tired', at: NOW - 2 * DAY }],
      rng: () => 0 // top-weighted candidate wins
    })
    expect(pick?.albumRatingKey).toBe('fresh')
  })

  it('gates Listen Later on vibe fit: out-of-vibe shelved albums never surface', () => {
    const offVibe = album({ ratingKey: 'shelf', genres: ['Country'], year: 1955 })
    const pick = choose({
      candidates: [
        { album: offVibe, origin: 'listen-later' },
        { album: album({ ratingKey: 'fit', genres: ['Psych Rock'] }), origin: 'library' }
      ]
    })
    expect(pick?.albumRatingKey).toBe('fit')
  })

  it('boosts a Listen Later album that fits the vibe above plain neighbors', () => {
    const shelved = album({ ratingKey: 'shelf', genres: ['Psych Rock'], year: 1973 })
    const neighbor = album({ ratingKey: 'plain', genres: ['Psych Rock'], year: 1973 })
    const pick = choose({
      candidates: [
        { album: shelved, origin: 'listen-later' },
        { album: neighbor, origin: 'library' }
      ],
      rng: () => 0
    })
    expect(pick?.source).toBe('listen-later')
  })

  it('label steer keeps only label-mates and reports the label as via', () => {
    const mate = album({ ratingKey: 'mate', genres: [] })
    const other = album({ ratingKey: 'other', genres: ['Psych Rock'] })
    const pick = choose({
      steer: 'label',
      currentLabels: ['Soul Jazz Records'],
      albumLabels: { mate: ['Soul Jazz Records'] },
      candidates: [
        { album: other, origin: 'library' },
        { album: mate, origin: 'label-mate' }
      ]
    })
    expect(pick?.albumRatingKey).toBe('mate')
    expect(pick?.via).toBe('Soul Jazz Records')
  })

  it('label steer falls back to drift when the current album has only placeholder labels', () => {
    const pick = choose({
      steer: 'label',
      currentLabels: ['[no label]'],
      candidates: [
        { album: album({ ratingKey: 'a', genres: ['Psych Rock'] }), origin: 'library' }
      ]
    })
    expect(pick?.albumRatingKey).toBe('a')
  })

  it('era steer keeps the pool within five years', () => {
    const near = album({ ratingKey: 'near', year: 1974, genres: [] })
    const far = album({ ratingKey: 'far', year: 1990, genres: ['Psych Rock'] })
    const pick = choose({
      steer: 'era',
      candidates: [
        { album: far, origin: 'library' },
        { album: near, origin: 'library' }
      ]
    })
    expect(pick?.albumRatingKey).toBe('near')
  })

  it('surprise steer favors unplayed albums and reports the surprise source', () => {
    const played = album({ ratingKey: 'played', viewCount: 9, genres: ['Psych Rock'] })
    const unplayed = album({ ratingKey: 'unplayed', genres: ['Polka'] })
    const pick = choose({
      steer: 'surprise',
      candidates: [
        { album: played, origin: 'library' },
        { album: unplayed, origin: 'library' }
      ],
      // Weights: played = 0.5 (floor), unplayed = 4 (novelty 2 × 2).
      // r = 0.2 × 4.5 = 0.9 → past played's 0.5 span → unplayed.
      rng: () => 0.2
    })
    expect(pick?.source).toBe('surprise')
    expect(pick?.albumRatingKey).toBe('unplayed')
  })
})
