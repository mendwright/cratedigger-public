import { describe, expect, it } from 'vitest'
import { classicalParts, classicalSearchQueries, classicalTrackerQuery } from './classical-query'

describe('classicalParts', () => {
  it('splits performer, composer and work', () => {
    const p = classicalParts('Leif Ove Andsnes', 'Grieg: Lyric Pieces')!
    expect(p.performerKey).toBe('Andsnes')
    expect(p.composerKey).toBe('Grieg')
    expect(p.workWords).toEqual(['Lyric', 'Pieces'])
  })
  it('drops catalog numbers, keys and filler from the work', () => {
    expect(classicalParts('Murray Perahia', 'Schumann: Symphonic Etudes, Op. 13 & Papillions, Op. 2')!.workWords).toEqual([
      'Symphonic',
      'Etudes',
      'Papillions'
    ])
    expect(classicalParts('Paul Lewis', 'Schubert: The Late Piano Sonatas - Nos. 14 & 19-21')!.workWords).toEqual([
      'Late',
      'Piano',
      'Sonatas'
    ])
    expect(classicalParts('Alexandre Tharaud', 'Francois Couperin: Tic toc choc')!.composerKey).toBe('Couperin')
  })
  it('keeps ensembles whole', () => {
    expect(classicalParts('Quatuor Ébène', 'Schubert: String Quintet, Op. 163 & Lieder')!.performerKey).toBe('Quatuor Ébène')
    expect(classicalParts('The English Concert', 'Bach: Brandenburg Concertos; Orchestral Suites')!.performerKey).toBe('English Concert')
  })
  it('ignores albums that are not composer-prefixed classical', () => {
    expect(classicalParts('Erik Satie', 'Satie: Avant-dernières pensées')).toBeNull()
    expect(classicalParts('Neko Case', 'Hell-On')).toBeNull()
    expect(classicalParts('Phish', 'Live: 12/31/95')).toBeNull()
    expect(classicalParts('Big Thief', 'Two Hands')).toBeNull()
  })
})

describe('classicalSearchQueries', () => {
  it('goes from specific to broad, each short', () => {
    const p = classicalParts('Leif Ove Andsnes', 'Grieg: Lyric Pieces')!
    expect(classicalSearchQueries(p)).toEqual(['Andsnes Grieg Lyric Pieces', 'Andsnes Lyric Pieces', 'Grieg Lyric Pieces'])
    expect(classicalTrackerQuery(p)).toBe('Andsnes Grieg Lyric Pieces')
  })
})
