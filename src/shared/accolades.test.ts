import { describe, expect, it } from 'vitest'
import { AccoladeIndex, accoladeLabel, stickerText, type Accolade } from './accolades'

const pick = (over: Partial<Accolade>): Accolade => ({
  source: 'pitchfork',
  kind: 'best-new',
  artist: 'Gilla Band',
  title: 'Pugnello',
  date: '2026-09-25',
  ...over
})

describe('AccoladeIndex', () => {
  it('matches across case, punctuation, and edition parentheticals', () => {
    const idx = new AccoladeIndex([
      pick({ artist: 'Aphex Twin', title: 'Drukqs (25th Anniversary Edition)', kind: 'best-new-reissue' })
    ])
    expect(idx.lookup('aphex twin', 'Drukqs')).toHaveLength(1)
    expect(idx.lookup('Aphex Twin', 'drukqs [Deluxe]')).toHaveLength(1)
    expect(idx.lookup('Aphex Twin', 'Syro')).toHaveLength(0)
  })

  it('ranks Sacher over Stereogum over Pitchfork', () => {
    const idx = new AccoladeIndex([
      pick({}),
      pick({ source: 'stereogum', kind: 'aotw' }),
      pick({ source: 'sacher', kind: 'great' })
    ])
    expect(idx.lookup('Gilla Band', 'Pugnello').map((a) => a.source)).toEqual([
      'sacher',
      'stereogum',
      'pitchfork'
    ])
  })

  it('drops disabled sources', () => {
    const idx = new AccoladeIndex([pick({}), pick({ source: 'sacher', kind: 'great' })], ['sacher'])
    expect(idx.lookup('Gilla Band', 'Pugnello').map((a) => a.source)).toEqual(['sacher'])
  })

  it('ignores a leading "The" and a trailing EP', () => {
    const idx = new AccoladeIndex([pick({ artist: 'The Drin', title: 'Elephant EP' })])
    expect(idx.lookup('Drin', 'Elephant')).toHaveLength(1)
  })

  it('indexes both sides of a split', () => {
    const idx = new AccoladeIndex([pick({ artist: '300SkullsAndCounting / Jenny Sparks', title: 'THIS IS SPA TOWN!' })])
    expect(idx.lookup('Jenny Sparks', 'This Is Spa Town')).toHaveLength(1)
    expect(idx.lookup('300SkullsAndCounting', 'This Is Spa Town')).toHaveLength(1)
  })

  it('keeps punctuation-only artists matchable', () => {
    const idx = new AccoladeIndex([pick({ artist: '@', title: 'Autosmile' })])
    expect(idx.lookup('@', 'Autosmile')).toHaveLength(1)
    expect(idx.lookup('Other', 'Autosmile')).toHaveLength(0)
  })
})

describe('labels', () => {
  it('names each kind', () => {
    expect(stickerText(pick({}))).toBe('BNM')
    expect(accoladeLabel(pick({ score: 8.8 }))).toBe('Pitchfork Best New Music · 8.8')
    expect(stickerText(pick({ source: 'stereogum', kind: 'aotw' }))).toBe('AOTW')
  })
})
