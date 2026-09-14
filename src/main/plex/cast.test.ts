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

import {
  chooseRadioAlbum,
  isGenericLabel,
  normalizeGenreName,
  weightedPick,
  type RadioCandidate
} from './cast'
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
    genreCounts?: Record<string, number>
    labelCounts?: Record<string, number>
    librarySize?: number
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
      rng: over.rng ?? (() => 0),
      genreCounts: over.genreCounts,
      labelCounts: over.labelCounts,
      librarySize: over.librarySize
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

  it('will not replay an artist radio picked this week while anyone else is free', () => {
    // "It has chosen Ty Segall six times." A score penalty was not enough —
    // an artist with a deep shelf still out-drew everyone. Now they're set
    // aside outright while a fresh name is available.
    const tired = Array.from({ length: 6 }, (_, i) =>
      album({ ratingKey: `seg-${i}`, artist: 'Ty Segall', artistRatingKey: 'art-seg', genres: ['Garage Rock'] })
    )
    const fresh = album({
      ratingKey: 'fresh',
      artist: 'Thee Oh Sees',
      artistRatingKey: 'art-oh',
      genres: ['Garage Rock']
    })
    const candidates: RadioCandidate[] = [
      ...tired.map((a) => ({ album: a, origin: 'similar' as const })),
      { album: fresh, origin: 'similar' as const }
    ]
    const history = [{ albumRatingKey: 'seg-old', artistRatingKey: 'art-seg', at: NOW - 2 * DAY }]
    for (let i = 0; i < 50; i++) {
      expect(choose({ candidates, history, rng: () => Math.random() })?.albumRatingKey).toBe('fresh')
    }
  })

  it('lets a tired artist back in when the shelf offers nobody else', () => {
    const only = album({ ratingKey: 'only', artistRatingKey: 'art-seg', genres: ['Garage Rock'] })
    const pick = choose({
      candidates: [{ album: only, origin: 'similar' }],
      history: [{ albumRatingKey: 'other', artistRatingKey: 'art-seg', at: NOW - 2 * DAY }]
    })
    expect(pick?.albumRatingKey).toBe('only')
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

  it('drift never picks a zero-affinity library album, however well-rated (the RHCP guard)', () => {
    // The real incident: Arab Strap's Philophobia (mis-tagged Downtempo/
    // Electronic) → Blood Sugar Sex Magik, carried by a 10.0 critic rating
    // and being exactly 7 years away. No shared genre/label = no entry.
    const bssm = album({
      ratingKey: 'bssm',
      artistRatingKey: 'art-rhcp',
      genres: ['Rock'],
      year: 1965, // inside no window matters — affinity is the gate
      rating: 10
    })
    const codeine = album({
      ratingKey: 'codeine',
      artistRatingKey: 'art-codeine',
      genres: [],
      year: 1972
    })
    const pick = choose({
      candidates: [
        { album: bssm, origin: 'library' },
        { album: codeine, origin: 'similar' }
      ],
      rng: () => 0.99 // even the least-likely draw can't reach it
    })
    expect(pick?.albumRatingKey).toBe('codeine')
  })

  it('caps the critic rating at a tiebreak: era affinity beats a 10.0 score', () => {
    // Both share the genre; one is a decade-adjacent unknown, the other a
    // far-off canonical classic. Era (+2) must outweigh the capped rating (+1).
    const nearUnknown = album({ ratingKey: 'near', genres: ['Psych Rock'], year: 1974 })
    const farClassic = album({ ratingKey: 'classic', genres: ['Psych Rock'], year: 1991, rating: 10 })
    const pick = choose({
      candidates: [
        { album: farClassic, origin: 'library' },
        { album: nearUnknown, origin: 'library' }
      ],
      rng: () => 0 // deterministic: highest weight wins
    })
    expect(pick?.albumRatingKey).toBe('near')
  })


  it('will not follow a record on an umbrella genre alone (the Bark Psychosis guard)', () => {
    // The real incident: Queensrÿche's Operation: Mindcrime → Bark Psychosis'
    // Hex, on nothing but a shared "Rock" tag. 557 of 4,087 albums carry it;
    // sharing it says nothing.
    const wrong = album({
      ratingKey: 'hex',
      artistRatingKey: 'art-bark',
      genres: ['Rock'],
      year: 1994
    })
    const pick = choose({
      currentGenres: ['Rock', 'Heavy Metal'],
      candidates: [{ album: wrong, origin: 'library' }],
      genreCounts: { rock: 557, 'heavy metal': 34 },
      librarySize: 4087,
      rng: () => 0
    })
    expect(pick).toBeNull()
  })

  it('still follows a specific genre from the whole library', () => {
    const samba = album({ ratingKey: 'samba', artistRatingKey: 'art-cartola', genres: ['Samba'] })
    const pick = choose({
      currentGenres: ['Samba'],
      candidates: [{ album: samba, origin: 'library' }],
      genreCounts: { samba: 19 },
      librarySize: 4087
    })
    expect(pick?.albumRatingKey).toBe('samba')
    expect(pick?.via).toBe('Samba')
  })

  it('folds genre spellings together so a variant cannot dodge the breadth check', () => {
    expect(normalizeGenreName('Pop/Rock')).toBe(normalizeGenreName('Pop Rock'))
    expect(normalizeGenreName('Indie.1')).toBe('indie')
  })

  it('does not treat a shared major label as a reason to play a record', () => {
    // Bruce Cockburn and Suede are both on Columbia. That is a distribution
    // fact, not a thread worth pulling.
    const suede = album({ ratingKey: 'suede', artistRatingKey: 'art-suede', genres: ['Britpop'] })
    const pick = choose({
      currentGenres: ['Folk Rock'],
      currentLabels: ['Columbia'],
      albumLabels: { suede: ['Columbia Records'] },
      candidates: [{ album: suede, origin: 'label-mate' }],
      genreCounts: { britpop: 8, 'folk rock': 43 },
      librarySize: 4087
    })
    // Demoted to a library neighbor, which it cannot enter without a genre tie.
    expect(pick).toBeNull()
  })

  it('still follows an indie label', () => {
    const mate = album({ ratingKey: 'mate', artistRatingKey: 'art-molina', genres: [] })
    const pick = choose({
      currentLabels: ['Secretly Canadian'],
      albumLabels: { mate: ['Secretly Canadian'] },
      candidates: [{ album: mate, origin: 'label-mate' }],
      labelCounts: { 'secretly canadian': 30 },
      librarySize: 4087
    })
    expect(pick?.albumRatingKey).toBe('mate')
    expect(pick?.via).toBe('Secretly Canadian')
  })

  it('recognizes majors and reissue houses through their boilerplate suffixes', () => {
    expect(isGenericLabel('Warner Bros. Records')).toBe(true)
    expect(isGenericLabel('EMI Records USA')).toBe(true)
    expect(isGenericLabel('Capitol Records')).toBe(true)
    expect(isGenericLabel('Mobile Fidelity Sound Lab')).toBe(true)
    expect(isGenericLabel('Music On Vinyl')).toBe(true)
    expect(isGenericLabel('Sub Pop Records')).toBe(false)
    expect(isGenericLabel('Blue Note')).toBe(false)
    expect(isGenericLabel('Drag City')).toBe(false)
  })

  it('gives one artist one slot, however many albums they have on the shelf', () => {
    // Eight R.E.M. records used to fill the shortlist, so every draw after
    // Vic Chesnutt was R.E.M. The lone rival must stay reachable.
    const rem = Array.from({ length: 8 }, (_, i) =>
      album({ ratingKey: `rem-${i}`, artist: 'R.E.M.', artistRatingKey: 'art-rem', genres: ['Jangle Pop'] })
    )
    const rival = album({
      ratingKey: 'nastasia',
      artist: 'Nina Nastasia',
      artistRatingKey: 'art-nina',
      genres: ['Jangle Pop']
    })
    const candidates: RadioCandidate[] = [
      ...rem.map((a) => ({ album: a, origin: 'similar' as const })),
      { album: rival, origin: 'similar' as const }
    ]
    let rivalWins = 0
    for (let i = 0; i < 400; i++) {
      const rng = () => Math.random()
      if (choose({ candidates, rng })?.albumRatingKey === 'nastasia') rivalWins++
    }
    // Two artists, comparable scores — roughly a coin flip, never a rout.
    expect(rivalWins).toBeGreaterThan(120)
  })

  it('keeps the current artist out unless the library offers nothing else', () => {
    const sibling = album({ ratingKey: 'sibling', artistRatingKey: 'art-cur', genres: ['Psych Rock'] })
    const stranger = album({ ratingKey: 'stranger', artistRatingKey: 'art-other', genres: ['Psych Rock'] })
    expect(
      choose({
        candidates: [
          { album: sibling, origin: 'same-artist' },
          { album: stranger, origin: 'similar' }
        ]
      })?.albumRatingKey
    ).toBe('stranger')
    // ...but a lone artist with no neighbours still gets to keep playing.
    expect(
      choose({ candidates: [{ album: sibling, origin: 'same-artist' }] })?.albumRatingKey
    ).toBe('sibling')
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
