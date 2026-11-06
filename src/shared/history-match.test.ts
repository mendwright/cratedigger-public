import { describe, expect, it } from 'vitest'
import type { PlexAlbum } from './plex'
import { buildHistoryIndex, matchHistoryAlbum, matchHistoryArtist } from './history-match'

function album(ratingKey: string, artist: string, title: string, artistRatingKey: string): PlexAlbum {
  return { ratingKey, artist, title, artistRatingKey, thumb: `/t/${ratingKey}` } as PlexAlbum
}

const index = buildHistoryIndex([
  album('1', 'Chico Buarque', 'Construção', 'a1'),
  album('2', 'Jorge Ben Jor', 'A Tábua de Esmeralda', 'a2'),
  album('3', 'Milton Nascimento & Lô Borges', 'Clube da Esquina', 'a3'),
  album('4', 'Nina Nastasia', 'You Follow Me', 'a4'),
  album('5', 'Ben Folds', 'Rockin the Suburbs', 'a5'),
  album('6', 'Radiohead', 'OK Computer', 'a6')
])

describe('matchHistoryAlbum', () => {
  it('matches exactly', () => {
    expect(matchHistoryAlbum(index, 'Radiohead', 'OK Computer')?.ratingKey).toBe('6')
  })
  it('ignores accents', () => {
    expect(matchHistoryAlbum(index, 'Chico Buarque', 'Construcao')?.ratingKey).toBe('1')
  })
  it('matches a shorter or longer artist credit on the same title', () => {
    expect(matchHistoryAlbum(index, 'Jorge Ben', 'A Tábua De Esmeralda')?.ratingKey).toBe('2')
    expect(matchHistoryAlbum(index, 'Milton Nascimento', 'Clube Da Esquina')?.ratingKey).toBe('3')
    expect(matchHistoryAlbum(index, 'Nina Nastasia & Jim White', 'You Follow Me')?.ratingKey).toBe('4')
  })
  it('does not match a same-titled album by an unrelated artist', () => {
    expect(matchHistoryAlbum(index, 'Someone Else', 'OK Computer')).toBeNull()
  })
})

describe('matchHistoryArtist', () => {
  it('matches exactly and by whole-word prefix', () => {
    expect(matchHistoryArtist(index, 'Radiohead')).toBe('a6')
    expect(matchHistoryArtist(index, 'Jorge Ben')).toBe('a2')
    expect(matchHistoryArtist(index, 'Milton Nascimento')).toBe('a3')
  })
  it('never matches on a partial word or a lone first name', () => {
    expect(matchHistoryArtist(index, 'Radio')).toBeNull()
    expect(matchHistoryArtist(index, 'Ben')).toBeNull()
  })
})
