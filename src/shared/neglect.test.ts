import { describe, expect, it } from 'vitest'
import type { PlexAlbum } from './plex'
import { buildAlbumListens, favoriteScore, isNeglectedFavorite, isNeglectedGem } from './neglect'

const YEAR = 365.25 * 86400
const NOW = 2_000_000_000

function album(ratingKey: string, artist: string, title: string): PlexAlbum {
  return { ratingKey, artist, title } as PlexAlbum
}

describe('buildAlbumListens', () => {
  const lib = [album('1', 'Radiohead', 'OK Computer'), album('2', 'Geese', 'Getting Killed')]

  it('uses a live rating key, else matches by name, and merges rows', () => {
    const map = buildAlbumListens(
      [
        { a: 'Geese', b: 'Getting Killed', n: 2, s: 500, last: 100, key: '2' },
        { a: 'radiohead', b: 'OK Computer', n: 10, s: 3000, last: 50, key: null },
        // An edition under another spelling lands on the same album.
        { a: 'Radiohead', b: 'OK Computer', n: 1, s: 200, last: 70, key: '999' },
        { a: 'Nobody', b: 'Not Here', n: 5, s: 900, last: 10, key: null }
      ],
      lib
    )
    expect(map['2']).toEqual({ plays: 2, seconds: 500, last: 100 })
    expect(map['1']).toEqual({ plays: 11, seconds: 3200, last: 70 })
    expect(Object.keys(map).sort()).toEqual(['1', '2'])
  })
})

describe('neglected favorites', () => {
  it('needs an hour and a one-year gap', () => {
    expect(isNeglectedFavorite(undefined, NOW)).toBe(false)
    expect(isNeglectedFavorite({ plays: 3, seconds: 3000, last: NOW - 10 * YEAR }, NOW)).toBe(false)
    expect(isNeglectedFavorite({ plays: 30, seconds: 36000, last: NOW - 0.5 * YEAR }, NOW)).toBe(false)
    expect(isNeglectedFavorite({ plays: 5, seconds: 3600, last: NOW - 1.5 * YEAR }, NOW)).toBe(true)
  })

  it('ranks hours × years gone', () => {
    const lovedLongAgo = favoriteScore({ plays: 0, seconds: 20 * 3600, last: NOW - 10 * YEAR }, NOW)
    const lovedRecently = favoriteScore({ plays: 0, seconds: 20 * 3600, last: NOW - 3 * YEAR }, NOW)
    const brushedLongAgo = favoriteScore({ plays: 0, seconds: 3 * 3600, last: NOW - 10 * YEAR }, NOW)
    expect(lovedLongAgo).toBeCloseTo(200)
    expect(lovedLongAgo).toBeGreaterThan(lovedRecently)
    expect(lovedRecently).toBeGreaterThan(brushedLongAgo)
  })
})

describe('neglected gems', () => {
  it('Plex rates it highly and the history barely touched it', () => {
    expect(isNeglectedGem(9, undefined)).toBe(true)
    expect(isNeglectedGem(9, { plays: 2, seconds: 1800, last: NOW })).toBe(true)
    expect(isNeglectedGem(9, { plays: 20, seconds: 20000, last: 0 })).toBe(false)
    expect(isNeglectedGem(6, undefined)).toBe(false)
    expect(isNeglectedGem(null, undefined)).toBe(false)
  })
})
