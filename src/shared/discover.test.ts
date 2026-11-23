import { describe, expect, it } from 'vitest'
import { pickReason, unseenHighlighted, type NewsStory } from './discover'

describe('pickReason', () => {
  it('names up to two seeds', () => {
    expect(pickReason({ like: ['A', 'B', 'C'], via: null })).toBe('like A, B')
  })
  it('falls back to via', () => {
    expect(pickReason({ like: [], via: 'Grouper' })).toBe('via Grouper')
  })
})

describe('unseenHighlighted', () => {
  const s = (artists: string[], firstSeen: number): NewsStory => ({
    id: String(firstSeen), source: 'x', title: 't', url: 'https://x', date: null, firstSeen,
    image: null, summary: '', tags: [], artists
  })
  it('counts only highlighted stories after the mark', () => {
    expect(unseenHighlighted([s(['A'], 5), s([], 9), s(['B'], 9)], 6)).toBe(1)
  })
})
