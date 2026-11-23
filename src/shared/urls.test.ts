import { expect, it } from 'vitest'
import { redSearchUrl } from './urls'

it('uses concise performer/composer/work searches for classical RED links', () => {
  const url = new URL(redSearchUrl('Leif Ove Andsnes', 'Grieg: Lyric Pieces, Op. 12 & Op. 43'))
  expect(url.origin + url.pathname).toBe('https://redacted.sh/torrents.php')
  expect(url.searchParams.get('searchstr')).toBe('Andsnes Grieg Lyric Pieces')
})
it('keeps normal artist/album searches and primary-artist handling', () => {
  expect(new URL(redSearchUrl('Whitney;Waxahatchee', 'Candid')).searchParams.get('searchstr')).toBe('Whitney Candid')
  expect(new URL(redSearchUrl('Björk', 'Homogenic')).searchParams.get('searchstr')).toBe('Björk Homogenic')
})
