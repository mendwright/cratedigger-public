import { describe, expect, it } from 'vitest'
import {
  extractWikipediaProse,
  isCuratedPlexSummary,
  isLastfmScrape,
  looksLikeArtistArticle,
  pickMoreCompleteBio,
  stripLastfmFooter
} from './bio-text'

// The exact shape Plex's agent writes into the summary field: plain text,
// footer intact, no HTML.
const PLEX_SCRAPE =
  'The Vermont artist brings vulnerability and wistfulness to a gorgeous third LP. ' +
  'Read more on Last.fm. User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.'

// The shape Last.fm's own API returns in wiki.content: footer with an anchor tag.
const API_SCRAPE =
  'A long review of the album with several sentences of real content. ' +
  '<a href="https://www.last.fm/music/Artist/Album">Read more on Last.fm</a>. ' +
  'User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.'

const CURATED =
  'Recorded over three weeks at Electric Lady, the album marked a turning point for the band.'

describe('isLastfmScrape', () => {
  it('detects the plain-text footer Plex agents write', () => {
    expect(isLastfmScrape(PLEX_SCRAPE)).toBe(true)
  })

  it('detects the anchored footer from the Last.fm API', () => {
    expect(isLastfmScrape(API_SCRAPE)).toBe(true)
  })

  it('detects the license line alone (truncated scrapes)', () => {
    expect(
      isLastfmScrape(
        'Some text. User-contributed text is available under the Creative Commons By-SA License.'
      )
    ).toBe(true)
  })

  it('passes curated text through', () => {
    expect(isLastfmScrape(CURATED)).toBe(false)
    expect(isLastfmScrape('')).toBe(false)
    expect(isLastfmScrape(null)).toBe(false)
    expect(isLastfmScrape(undefined)).toBe(false)
  })
})

describe('isCuratedPlexSummary', () => {
  it('true for real curated text', () => {
    expect(isCuratedPlexSummary(CURATED)).toBe(true)
  })

  it('false for empty / whitespace / null', () => {
    expect(isCuratedPlexSummary('')).toBe(false)
    expect(isCuratedPlexSummary('   ')).toBe(false)
    expect(isCuratedPlexSummary(null)).toBe(false)
    expect(isCuratedPlexSummary(undefined)).toBe(false)
  })

  it('false for Last.fm scrapes', () => {
    expect(isCuratedPlexSummary(PLEX_SCRAPE)).toBe(false)
  })
})

describe('stripLastfmFooter', () => {
  it('strips the plain-text footer', () => {
    expect(stripLastfmFooter(PLEX_SCRAPE)).toBe(
      'The Vermont artist brings vulnerability and wistfulness to a gorgeous third LP.'
    )
  })

  it('strips the anchored footer and residual HTML', () => {
    expect(stripLastfmFooter(API_SCRAPE)).toBe(
      'A long review of the album with several sentences of real content.'
    )
  })

  it('strips a license line that spans newlines', () => {
    const text = 'Real content.\n\nUser-contributed text is available under the\nCreative Commons By-SA License; additional terms may apply.'
    expect(stripLastfmFooter(text)).toBe('Real content.')
  })

  it('leaves curated text alone', () => {
    expect(stripLastfmFooter(CURATED)).toBe(CURATED)
  })
})

describe('pickMoreCompleteBio', () => {
  const longBio = {
    source: 'lastfm' as const,
    text: 'A much longer full wiki.content text that goes on for paragraphs about the record, the sessions, and the personnel involved in making it.',
    url: 'https://www.last.fm/music/Artist/Album'
  }

  it('prefers the fetched bio when it is at least as complete', () => {
    expect(pickMoreCompleteBio(longBio, PLEX_SCRAPE)).toBe(longBio)
  })

  it('falls back to the stripped Plex scrape when the fetch came up empty', () => {
    const picked = pickMoreCompleteBio(null, PLEX_SCRAPE)
    expect(picked).toEqual({
      source: 'lastfm',
      text: 'The Vermont artist brings vulnerability and wistfulness to a gorgeous third LP.',
      url: null
    })
  })

  it('keeps the stripped scrape but adopts the fetched url when the fetch was shorter', () => {
    const stub = { source: 'lastfm' as const, text: 'Short.', url: 'https://www.last.fm/x' }
    const picked = pickMoreCompleteBio(stub, PLEX_SCRAPE)
    expect(picked?.text).toBe(
      'The Vermont artist brings vulnerability and wistfulness to a gorgeous third LP.'
    )
    expect(picked?.url).toBe('https://www.last.fm/x')
  })

  it('returns the fetched bio untouched when the Plex summary is not a scrape', () => {
    expect(pickMoreCompleteBio(longBio, CURATED)).toBe(longBio)
    expect(pickMoreCompleteBio(longBio, null)).toBe(longBio)
  })

  it('returns null when there is nothing at all', () => {
    expect(pickMoreCompleteBio(null, null)).toBe(null)
    expect(pickMoreCompleteBio(null, CURATED)).toBe(null)
  })
})

// Mirrors the real shape of action=query&prop=extracts&explaintext output —
// modeled on the Greg Mendez article that motivated stub-lead expansion.
const WIKI_FULL = `Greg Mendez is an American indie rock musician from Philadelphia, Pennsylvania.


== History ==
Mendez began making music in 2006, but put out his first full length album, Phone Records, in 2016. In 2023, Mendez released his latest self-titled album.


=== Early years ===
He grew up in Philadelphia.


== Discography ==
Phone Records (2016)
Greg Mendez (2023)


== References ==`

describe('extractWikipediaProse', () => {
  it('keeps the lead and prose sections, drops list-y ones', () => {
    const prose = extractWikipediaProse(WIKI_FULL)
    expect(prose).toContain('indie rock musician from Philadelphia')
    expect(prose).toContain('began making music in 2006')
    expect(prose).toContain('He grew up in Philadelphia.') // sub-section of History stays
    expect(prose).not.toContain('Phone Records (2016)') // Discography list dropped
    expect(prose).not.toContain('==') // no heading markup survives
    expect(prose).not.toContain('References')
  })

  it('keeps sub-section content only under an included parent', () => {
    const text = `Lead.

== Discography ==
Album (2020)

=== Singles ===
Single (2021)

== Career ==
Real prose here.`
    const prose = extractWikipediaProse(text)
    expect(prose).not.toContain('Single (2021)') // sub-section of excluded Discography
    expect(prose).toContain('Real prose here.')
  })

  it('caps at a sentence boundary', () => {
    const sentence = 'This is a sentence that fills space. '
    const long = sentence.repeat(40)
    const prose = extractWikipediaProse(long, 300)
    expect(prose.length).toBeLessThanOrEqual(300)
    expect(prose.endsWith('.')).toBe(true)
  })
})

describe('looksLikeArtistArticle', () => {
  const musicExtract =
    'Greg Mendez is an American indie rock musician from Philadelphia, Pennsylvania.'

  it('accepts an exact-title music article', () => {
    expect(
      looksLikeArtistArticle({
        title: 'Greg Mendez',
        extract: musicExtract,
        artistName: 'Greg Mendez'
      })
    ).toBe(true)
  })

  it('accepts a disambiguated title', () => {
    expect(
      looksLikeArtistArticle({
        title: 'Greg Mendez (musician)',
        extract: musicExtract,
        artistName: 'Greg Mendez'
      })
    ).toBe(true)
  })

  it('rejects a same-named non-music article', () => {
    expect(
      looksLikeArtistArticle({
        title: 'Greg Mendez',
        extract: 'Greg Mendez is a retired American baseball pitcher who played in the minor leagues.',
        artistName: 'Greg Mendez'
      })
    ).toBe(false)
  })

  it('rejects a wrong-title hit even if it is about music', () => {
    expect(
      looksLikeArtistArticle({
        title: 'List of trumpeters',
        extract: 'This is a list of notable trumpeters in music history.',
        artistName: 'Greg Mendez'
      })
    ).toBe(false)
  })

  it('normalizes diacritics and punctuation in the name match', () => {
    expect(
      looksLikeArtistArticle({
        title: 'Caetano Veloso',
        extract: 'Caetano Veloso is a Brazilian musician and singer-songwriter.',
        artistName: 'Caetano Veloso'
      })
    ).toBe(true)
  })
})
