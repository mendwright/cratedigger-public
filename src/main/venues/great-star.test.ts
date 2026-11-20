import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGreatStarDate, parseGreatStarPage } from './great-star'
import { VENUES } from './registry'

const venue = VENUES.find((v) => v.id === 'greatstar')!
const html = readFileSync(join(__dirname, '__fixtures__/great-star-whats-playing.html'), 'utf8')

describe('parseGreatStarDate', () => {
  it('handles single dates, ranges and cross-month ranges', () => {
    expect(parseGreatStarDate('February 23, 2027')).toBe('2027-02-23')
    expect(parseGreatStarDate('January 7 - 9, 2027')).toBe('2027-01-07')
    expect(parseGreatStarDate('September 25 & 26, 2026')).toBe('2026-09-25')
    expect(parseGreatStarDate('April 30 - May 2, 2026')).toBe('2026-04-30')
    expect(parseGreatStarDate('December 2020')).toBeNull()
  })
})

describe('parseGreatStarPage', () => {
  const rows = parseGreatStarPage(html, venue)

  it('keeps only upcoming Music cards', () => {
    const names = rows.map((r) => r.artistName)
    expect(names).toContain('@')
    expect(names).not.toContain('Fan Service: A Nerdlesque Show')
    // past-events grid (event-list-card) is ignored
    expect(rows.every((r) => r.date >= '2026-11-01')).toBe(true)
  })

  it('strips the presenter and links the ticket page', () => {
    const at = rows.find((r) => r.artistName === '@')!
    expect(at.date).toBe('2027-02-23')
    expect(at.url).toBe('https://www.eventbrite.com/e/2004454539486?aff=oddtdtcreator')
    expect(at.id).toBe('greatstar:2027-02-23:@')
  })
})
