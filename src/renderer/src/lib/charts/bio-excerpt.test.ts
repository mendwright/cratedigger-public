import { expect, it } from 'vitest'
import { cleanChartBio } from './bio-excerpt'

it('removes the Peggy Lee/Goodman trailing See also URL', () => {
  expect(cleanChartBio('Peggy Lee sang with Benny Goodman. See also http://www.last.fm/music/Peggy+Lee')).toBe('Peggy Lee sang with Benny Goodman.')
})
it('removes bare links and Last.fm footers while retaining prose', () => {
  expect(cleanChartBio('A jazz singer. https://example.org/bio')).toBe('A jazz singer.')
  expect(cleanChartBio('A jazz singer. See also: https://one.test/ http://two.test/')).toBe('A jazz singer.')
  expect(cleanChartBio('A jazz singer. Read more on Last.fm')).toBe('A jazz singer.')
  expect(cleanChartBio('See also her later recordings.')).toBe('See also her later recordings.')
})
