import { describe, expect, it } from 'vitest'
import { canonicalArtistKey } from './artist-aliases'

describe('canonicalArtistKey', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(canonicalArtistKey('  Jeff   Rosenstock ')).toBe('jeff rosenstock')
  })

  it('strips a leading The / Thee so the article never decides a match', () => {
    expect(canonicalArtistKey('The Uranium Club')).toBe('uranium club')
    expect(canonicalArtistKey('Thee Oh Sees')).toBe('oh sees')
    expect(canonicalArtistKey('Oh Sees')).toBe('oh sees')
  })

  it('does not strip mid-name articles', () => {
    expect(canonicalArtistKey('Florence and The Machine')).toBe('florence and the machine')
  })

  it('resolves alias groups to one key, every direction', () => {
    const expected = canonicalArtistKey('Uranium Club')
    expect(canonicalArtistKey('Minneapolis Uranium Club')).toBe(expected)
    expect(canonicalArtistKey('The Minneapolis Uranium Club')).toBe(expected)
    expect(canonicalArtistKey('the uranium club')).toBe(expected)
  })

  it('folds & and "and" so the ampersand never decides a match', () => {
    const expected = canonicalArtistKey('Belle and Sebastian')
    expect(canonicalArtistKey('Belle & Sebastian')).toBe(expected)
    expect(canonicalArtistKey('Belle&Sebastian')).toBe(expected)
  })

  it('leaves unrelated names alone', () => {
    expect(canonicalArtistKey('Destroyer')).toBe('destroyer')
  })
})
