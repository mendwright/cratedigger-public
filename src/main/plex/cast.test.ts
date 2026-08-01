import { describe, it, expect, vi } from 'vitest'

// cast.ts pulls in headers.js/library.js, which reach electron + electron-store.
// weightedPick is pure — stub the chain to keep this a unit test.
vi.mock('./headers.js', () => ({ plexHeaders: () => ({}) }))
vi.mock('./http.js', () => ({ plexFetch: vi.fn() }))
vi.mock('./library.js', () => ({
  getAlbumDetail: vi.fn(),
  listArtistAlbums: vi.fn(),
  listSimilarArtists: vi.fn()
}))

import { weightedPick } from './cast'

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
