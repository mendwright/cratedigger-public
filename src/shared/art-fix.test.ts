import { describe, it, expect } from 'vitest'
import type { ArtFixCandidate } from './plex'
import { isAltEdition, rankCandidates } from './art-fix'

function cand(overrides: Partial<ArtFixCandidate>): ArtFixCandidate {
  return {
    source: 'deezer',
    url: 'u',
    thumbUrl: 't',
    width: null,
    height: null,
    short: null,
    label: null,
    posterRatingKey: null,
    altEdition: false,
    ...overrides
  }
}

describe('isAltEdition', () => {
  it('flags deluxe/expanded/remaster/anniversary etc.', () => {
    expect(isAltEdition('Kid A (Deluxe)')).toBe(true)
    expect(isAltEdition('OK Computer OKNOTOK 1997 2017')).toBe(false)
    expect(isAltEdition('Blue — Remastered')).toBe(true)
    expect(isAltEdition('The Wall (Expanded Edition)')).toBe(true)
    expect(isAltEdition('Abbey Road (Super Deluxe)')).toBe(true)
    expect(isAltEdition("Songs (Collector's Edition)")).toBe(true)
  })

  it('leaves plain titles unflagged', () => {
    expect(isAltEdition('Trap')).toBe(false)
    expect(isAltEdition('If You’re Feeling Sinister')).toBe(false)
    expect(isAltEdition(null)).toBe(false)
    expect(isAltEdition(undefined)).toBe(false)
  })
})

describe('rankCandidates', () => {
  it('orders by measured short side descending', () => {
    const out = rankCandidates([
      cand({ source: 'deezer', short: 1000 }),
      cand({ source: 'caa', short: 1400 }),
      cand({ source: 'itunes', short: 1200 })
    ])
    expect(out.map((c) => c.short)).toEqual([1400, 1200, 1000])
  })

  it('demotes alt-editions below plain editions regardless of size', () => {
    const out = rankCandidates([
      cand({ source: 'caa', short: 3000, altEdition: true }),
      cand({ source: 'deezer', short: 1000, altEdition: false })
    ])
    // The plain 1000px wins over the 3000px deluxe.
    expect(out.map((c) => [c.short, c.altEdition])).toEqual([
      [1000, false],
      [3000, true]
    ])
  })

  it('sorts unmeasured candidates last and is stable for ties', () => {
    const out = rankCandidates([
      cand({ source: 'deezer', short: null }),
      cand({ source: 'itunes', short: 1200 }),
      cand({ source: 'caa', short: null })
    ])
    expect(out.map((c) => c.source)).toEqual(['itunes', 'deezer', 'caa'])
  })
})
