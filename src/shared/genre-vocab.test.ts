import { describe, it, expect } from 'vitest'
import { buildGenreVocabulary, matchGenreTag, genresFromTags } from './genre-vocab'

// A slice of MB's real /genre/all vocabulary, including the spellings that
// make the compact and alias tiers necessary.
const vocab = buildGenreVocabulary([
  'rock',
  'hip hop',
  'shoegaze',
  'slowcore',
  'synth-pop',
  'alternative country',
  'alternative rock',
  'glam metal',
  'hard rock',
  'heavy metal',
  'jazz',
  'cool jazz',
  'surf rock',
  'pop rock',
  'post-rock',
  'reggae',
  'rocksteady',
  'isicathamiya',
  'neo-psychedelia'
])

describe('matchGenreTag', () => {
  it('matches straight through', () => {
    expect(matchGenreTag('shoegaze', vocab)).toBe('shoegaze')
  })

  it('is case- and separator-insensitive', () => {
    expect(matchGenreTag('Hip-Hop', vocab)).toBe('hip hop')
    expect(matchGenreTag('Post Rock', vocab)).toBe('post-rock')
  })

  it('falls back to a compact match', () => {
    // Last.fm writes "synthpop", MB writes "synth-pop".
    expect(matchGenreTag('synthpop', vocab)).toBe('synth-pop')
  })

  it('resolves the curated aliases to MB spelling', () => {
    expect(matchGenreTag('rap', vocab)).toBe('hip hop')
    expect(matchGenreTag('alt-country', vocab)).toBe('alternative country')
    expect(matchGenreTag('hair metal', vocab)).toBe('glam metal')
  })

  it('drops tags aliased to null as too broad', () => {
    expect(matchGenreTag('indie', vocab)).toBeNull()
    expect(matchGenreTag('oldies', vocab)).toBeNull()
  })

  it('drops the junk Last.fm actually returns', () => {
    // Every one of these came back in the top tags of a real album.
    for (const junk of [
      '2025',
      '1999',
      '80s',
      '90s',
      'domino', // record label
      'bill evans', // the artist's own name
      'my gang 09', // someone's personal list
      'seen live',
      'dark',
      'swag',
      'driving',
      'american artist',
      'jamaica',
      'piano'
    ]) {
      expect(matchGenreTag(junk, vocab), junk).toBeNull()
    }
  })

  it('handles blanks', () => {
    expect(matchGenreTag('   ', vocab)).toBeNull()
  })
})

describe('genresFromTags', () => {
  it('keeps Last.fm order and drops non-genres', () => {
    // Ratt — Out of the Cellar, verbatim from Last.fm. MB had no genres at all
    // for this release, which is the whole reason the fallback exists.
    expect(
      genresFromTags(['hard rock', 'glam metal', 'hair metal', '80s', 'heavy metal'], vocab)
    ).toEqual(['hard rock', 'glam metal', 'heavy metal'])
  })

  it('dedupes tags that resolve to the same genre', () => {
    // Tyler, The Creator — Bastard: "rap", "hip hop" and "hip-hop" all land on
    // one genre, and should produce one crate, not three.
    expect(genresFromTags(['rap', 'hip hop', 'hip-hop', 'dark', 'swag'], vocab)).toEqual([
      'hip hop'
    ])
  })

  it('respects the limit', () => {
    expect(genresFromTags(['rock', 'jazz', 'reggae', 'shoegaze'], vocab, 2)).toEqual([
      'rock',
      'jazz'
    ])
  })

  it('returns nothing when no tag is a genre', () => {
    expect(genresFromTags(['2014', 'seen live', 'my gang 09'], vocab)).toEqual([])
  })
})
