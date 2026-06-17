import { describe, it, expect } from 'vitest'
import type { CreditedWork, PlexAlbum } from './plex'
import { normalizeTitle, compactTitle, matchCreditedWorks } from './title-match'

function album(overrides: Partial<PlexAlbum> = {}): PlexAlbum {
  return {
    ratingKey: 'rk-1',
    title: 'Unknown Album',
    artist: 'Unknown Artist',
    thumb: null,
    year: null,
    addedAt: 0,
    rating: null,
    lastViewedAt: null,
    viewCount: null,
    guids: [],
    trackCount: null,
    studio: null,
    genres: [],
    artistRatingKey: null,
    ...overrides
  }
}

function work(overrides: Partial<CreditedWork> = {}): CreditedWork {
  return {
    kind: 'release',
    mbid: '00000000-0000-0000-0000-000000000001',
    title: 'Unknown Work',
    date: null,
    roles: ['performer'],
    ...overrides
  }
}

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Hello, World!')).toBe('hello world')
  })

  it('strips parentheticals', () => {
    expect(normalizeTitle('Song Title (Remastered)')).toBe('song title')
  })

  it('strips bracketed annotations', () => {
    expect(normalizeTitle('Song Title [Live]')).toBe('song title')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeTitle('Hello   World')).toBe('hello world')
  })

  it('preserves accents', () => {
    expect(normalizeTitle('Björk')).toBe('björk')
  })

  it('handles empty string', () => {
    expect(normalizeTitle('')).toBe('')
  })

  it('strips mixed punctuation and whitespace', () => {
    expect(normalizeTitle('  Hello - World!  ')).toBe('hello world')
  })
})

describe('compactTitle', () => {
  it('lowercases and strips everything non-alphanumeric', () => {
    expect(compactTitle('Hello, World!')).toBe('helloworld')
  })

  it('strips parentheticals entirely', () => {
    expect(compactTitle('Song Title (Remastered)')).toBe('songtitle')
  })

  it('strips bracketed annotations entirely', () => {
    expect(compactTitle('Song Title [Live]')).toBe('songtitle')
  })

  it('preserves accents but strips surrounding chars', () => {
    expect(compactTitle('Björk')).toBe('björk')
  })

  it('handles empty string', () => {
    expect(compactTitle('')).toBe('')
  })
})

describe('matchCreditedWorks', () => {
  it('MBID-exact match beats title-only match', () => {
    const albums = [
      album({ ratingKey: 'rk-a', title: 'Wrong Title', guids: ['mbid://release/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }),
      album({ ratingKey: 'rk-b', title: 'Right Title', guids: ['mbid://release/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'] })
    ]
    const works = [
      work({ mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Right Title', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-a')
  })

  it('matches by title when no guid MBID', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Abbey Road', guids: [] })
    ]
    const works = [
      work({ mbid: 'some-other-mbid', title: 'Abbey Road', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-1')
  })

  it('matches via normalizeTitle (punctuation differences)', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Hello, World!', guids: [] })
    ]
    const works = [
      work({ title: 'Hello World', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
  })

  it('matches via compactTitle when normalize differs (punctuation differences)', () => {
    // When Plex stores a title with spaces between letters (e.g. acronym) and
    // MB stores it run together, normalizeTitle won't match because it preserves
    // whitespace-delimited tokens, but compactTitle strips both punctuation and
    // whitespace entirely, collapsing them to the same string.
    //   Album: "A B C"  → normalize: "a b c"     compact: "abc"
    //   Work:  "A.B.C." → normalize: "a b c"     compact: "abc"
    // Both match via normalize here. But if the Work has extra parentheticals
    // that only compact can bridge:
    //   Album: "abc"     → normalize: "abc"       compact: "abc"
    //   Work:  "a b c"   → normalize: "a b c"     compact: "abc"
    //   normalizeTitle differs ("abc" vs "a b c"), compactTitle matches.
    const albums = [
      album({ ratingKey: 'rk-1', title: 'abc', guids: [] })
    ]
    const works = [
      work({ title: 'a b c', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-1')
  })

  it('uses year tiebreak when multiple albums share same normalized title', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Greatest Hits', year: 2005, guids: [] }),
      album({ ratingKey: 'rk-2', title: 'Greatest Hits', year: 1999, guids: [] })
    ]
    const works = [
      work({ title: 'Greatest Hits', date: '1999', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-2')
  })

  it('picks first album in bucket when no date on work', () => {
    const albums = [
      album({ ratingKey: 'rk-2', title: 'Greatest Hits', year: 2005, guids: [] }),
      album({ ratingKey: 'rk-1', title: 'Greatest Hits', year: 1999, guids: [] })
    ]
    const works = [
      work({ title: 'Greatest Hits', date: null, roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    // First match in the bucket (insertion order = array order)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-2')
  })

  it('merges roles across two works that match the same album', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Abbey Road', guids: [] })
    ]
    const works = [
      work({ mbid: 'w-1', title: 'Abbey Road', roles: ['guitar'] }),
      work({ mbid: 'w-2', title: 'Abbey Road', roles: ['bass'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].roles).toContain('guitar')
    expect(result.inLibrary[0].roles).toContain('bass')
  })

  it('deduplicates roles when same role appears in both works', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Abbey Road', guids: [] })
    ]
    const works = [
      work({ mbid: 'w-1', title: 'Abbey Road', roles: ['guitar'] }),
      work({ mbid: 'w-2', title: 'Abbey Road', roles: ['guitar'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
    expect(result.inLibrary[0].roles).toEqual(['guitar'])
  })

  it('puts unmatched works in notInLibrary', () => {
    const albums: PlexAlbum[] = []
    const works = [
      work({ title: 'Unknown Album', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(0)
    expect(result.notInLibrary).toHaveLength(1)
    expect(result.notInLibrary[0].title).toBe('Unknown Album')
  })

  it('deduplicates notInLibrary by compactTitle + year', () => {
    const albums: PlexAlbum[] = []
    const works = [
      work({ mbid: 'w-1', title: 'Same Album (Deluxe)', date: '2020', roles: ['performer'] }),
      work({ mbid: 'w-2', title: 'Same Album [Remastered]', date: '2020', roles: ['producer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.notInLibrary).toHaveLength(1)
  })

  it('does NOT deduplicate notInLibrary when years differ', () => {
    const albums: PlexAlbum[] = []
    const works = [
      work({ mbid: 'w-1', title: 'Same Album (Deluxe)', date: '2020', roles: ['performer'] }),
      work({ mbid: 'w-2', title: 'Same Album [Remastered]', date: '2021', roles: ['producer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.notInLibrary).toHaveLength(2)
  })

  it('sorts inLibrary by year descending', () => {
    const albums = [
      album({ ratingKey: 'rk-old', title: 'Old Album', year: 1990, guids: [] }),
      album({ ratingKey: 'rk-new', title: 'New Album', year: 2020, guids: [] })
    ]
    const works = [
      work({ title: 'Old Album', roles: ['performer'] }),
      work({ title: 'New Album', roles: ['producer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(2)
    expect(result.inLibrary[0].album.ratingKey).toBe('rk-new')
    expect(result.inLibrary[1].album.ratingKey).toBe('rk-old')
  })

  it('preserves accented characters in matching', () => {
    const albums = [
      album({ ratingKey: 'rk-1', title: 'Björk Album', guids: [] })
    ]
    const works = [
      work({ title: 'Björk Album', roles: ['performer'] })
    ]
    const result = matchCreditedWorks(works, albums)
    expect(result.inLibrary).toHaveLength(1)
  })

  it('empty works returns empty result', () => {
    const albums = [album({ ratingKey: 'rk-1', title: 'Some Album' })]
    const result = matchCreditedWorks([], albums)
    expect(result.inLibrary).toHaveLength(0)
    expect(result.notInLibrary).toHaveLength(0)
  })

  it('empty albums puts everything in notInLibrary', () => {
    const works = [
      work({ title: 'A', roles: ['x'] }),
      work({ title: 'B', roles: ['y'] })
    ]
    const result = matchCreditedWorks(works, [])
    expect(result.inLibrary).toHaveLength(0)
    expect(result.notInLibrary).toHaveLength(2)
  })
})
