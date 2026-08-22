import { describe, it, expect } from 'vitest'
import { normalizeGenre, displayGenre, effectiveGenres } from './genre-text'

describe('normalizeGenre', () => {
  it('collapses the separators Plex and MB disagree about', () => {
    // The real split in the library: 68 albums under "Hip-Hop", 39 under
    // "Hip Hop", drawn as two crates before this.
    expect(normalizeGenre('Hip-Hop')).toBe(normalizeGenre('hip hop'))
    expect(normalizeGenre('Post_Rock')).toBe('post rock')
  })

  it('is case-insensitive and trims', () => {
    expect(normalizeGenre('  Shoegaze ')).toBe('shoegaze')
  })
})

describe('displayGenre', () => {
  it('title-cases MB lowercase', () => {
    expect(displayGenre('shoegaze')).toBe('Shoegaze')
    expect(displayGenre('nu disco')).toBe('Nu Disco')
  })

  it('keeps the separator the source chose', () => {
    expect(displayGenre('neo-psychedelia')).toBe('Neo-Psychedelia')
    expect(displayGenre('hip hop')).toBe('Hip Hop')
  })

  it('upper-cases acronyms', () => {
    expect(displayGenre('alternative r&b')).toBe('Alternative R&B')
    expect(displayGenre('edm')).toBe('EDM')
  })

  it('leaves already-cased Plex names alone', () => {
    expect(displayGenre('Psychedelic Rock')).toBe('Psychedelic Rock')
  })

  it('handles empty input', () => {
    expect(displayGenre('   ')).toBe('')
  })
})

describe('effectiveGenres', () => {
  it('prefers MusicBrainz when it has anything', () => {
    // Greet Death — Die In Love: Plex says "Rock", MB knows better.
    expect(effectiveGenres(['rock', 'shoegaze', 'slowcore'], ['Rock'])).toEqual([
      'Rock',
      'Shoegaze',
      'Slowcore'
    ])
  })

  it('falls back to Plex when MB has no genres', () => {
    // Ratt — Out of the Cellar: MB has nothing, Plex's tag is all we have.
    expect(effectiveGenres([], ['Metal & Hard Rock'])).toEqual(['Metal & Hard Rock'])
    expect(effectiveGenres(undefined, ['Surf Rock'])).toEqual(['Surf Rock'])
  })

  it('does not union the two sources', () => {
    // Union would keep Plex's spelling alive beside MB's and re-fragment the
    // rail, which is the thing the backfill exists to stop.
    expect(effectiveGenres(['hip hop'], ['Hip-Hop', 'Horrorcore'])).toEqual(['Hip Hop'])
  })

  it('dedupes within a source', () => {
    expect(effectiveGenres(['rock', 'Rock', 'rock '], [])).toEqual(['Rock'])
  })

  it('drops blanks', () => {
    expect(effectiveGenres(undefined, ['', '  ', 'Jazz'])).toEqual(['Jazz'])
  })

  it('returns nothing when neither source has anything', () => {
    expect(effectiveGenres([], [])).toEqual([])
  })
})
