import { describe, it, expect } from 'vitest'
import { yearFromDate, applyOriginalYears, type HasAlbumYear } from './original-year'

describe('yearFromDate', () => {
  it('parses a full ISO date', () => {
    expect(yearFromDate('1984-06-04')).toBe(1984)
  })

  it('parses a bare year', () => {
    expect(yearFromDate('1984')).toBe(1984)
  })

  it('returns null for empty / nullish input', () => {
    expect(yearFromDate('')).toBeNull()
    expect(yearFromDate(null)).toBeNull()
    expect(yearFromDate(undefined)).toBeNull()
  })

  it('returns null for non-numeric or zero years', () => {
    expect(yearFromDate('????-01-01')).toBeNull()
    expect(yearFromDate('0000')).toBeNull()
  })
})

describe('applyOriginalYears', () => {
  const albums = (): HasAlbumYear[] => [
    { ratingKey: 'born-in-the-usa', year: 2005 },
    { ratingKey: 'nebraska', year: 1982 },
    { ratingKey: 'unmatched', year: 1999 }
  ]

  it('replaces the Plex edition year with the known original year', () => {
    const list = albums()
    applyOriginalYears(list, new Map([['born-in-the-usa', 1984]]))
    expect(list.find((a) => a.ratingKey === 'born-in-the-usa')?.year).toBe(1984)
  })

  it('leaves albums absent from the index untouched', () => {
    const list = albums()
    applyOriginalYears(list, new Map([['born-in-the-usa', 1984]]))
    expect(list.find((a) => a.ratingKey === 'nebraska')?.year).toBe(1982)
    expect(list.find((a) => a.ratingKey === 'unmatched')?.year).toBe(1999)
  })

  it('treats a recorded null as "no original date" and keeps the Plex year', () => {
    const list = albums()
    applyOriginalYears(list, new Map([['unmatched', null]]))
    expect(list.find((a) => a.ratingKey === 'unmatched')?.year).toBe(1999)
  })

  it('mutates in place and returns the same array', () => {
    const list = albums()
    const returned = applyOriginalYears(list, new Map([['nebraska', 1982]]))
    expect(returned).toBe(list)
  })
})
