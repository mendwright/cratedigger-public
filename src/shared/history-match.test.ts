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
  album('6', 'Radiohead', 'OK Computer', 'a6'),
  album('7', 'Johann Sebastian Bach - Glenn Gould', 'The Goldberg Variations', 'a7'),
  album('8', 'Songs: Ohia', 'The Magnolia Electric Co.', 'a8'),
  album('9', 'Ludwig van Beethoven', 'Beethoven: The Piano Sonatas (András Schiff)', 'a9'),
  album('10', 'Johann Sebastian Bach', 'Brandenburg Concertos', 'a10')
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
  it('peels composer prefixes, catalog numbers, volumes and a leading "The"', () => {
    expect(matchHistoryAlbum(index, 'Johann Sebastian Bach', 'Bach: The Goldberg Variations, BWV 988')?.ratingKey).toBe('7')
    expect(matchHistoryAlbum(index, 'Johann Sebastian Bach', 'Bach: Brandenburg Concertos')?.ratingKey).toBe('10')
    expect(matchHistoryAlbum(index, 'Songs: Ohia', 'Magnolia Electric Co.')?.ratingKey).toBe('8')
    expect(matchHistoryAlbum(index, 'Ludwig van Beethoven', 'Beethoven: The Piano Sonatas, Volume I')?.ratingKey).toBe('9')
  })
  it('keeps the loose rung to the same artist and to different works', () => {
    expect(matchHistoryAlbum(index, 'Someone Else', 'Bach: The Goldberg Variations')).toBeNull()
    expect(matchHistoryAlbum(index, 'Ludwig van Beethoven', 'Beethoven: Complete Piano Sonatas & Concertos')).toBeNull()
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
