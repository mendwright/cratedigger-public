import { describe, expect, it } from 'vitest'
import { extractBandcampLyrics, selectBandcampTrack } from './bandcamp'

describe('selectBandcampTrack', () => {
  const results = [
    {
      type: 't',
      name: 'Big Boi',
      band_name: 'Someone Else',
      album_name: 'Other',
      item_url_path: 'https://wrong.bandcamp.com/track/big-boi'
    },
    {
      type: 't',
      name: 'Big Boi',
      band_name: 'Thomas Dollbaum',
      album_name: 'Birds of Paradise',
      item_url_path: 'https://thomasdollbaum.bandcamp.com/track/big-boi'
    }
  ]

  it('requires an exact normalized artist and title match', () => {
    expect(selectBandcampTrack(results, 'Thomas Dollbaum', 'Big Boi', 'Birds of Paradise')).toBe(
      'https://thomasdollbaum.bandcamp.com/track/big-boi'
    )
    expect(selectBandcampTrack(results, 'Big Boi', 'Big Boi', 'Birds of Paradise')).toBeNull()
  })

  it('prefers the requested album when duplicate tracks exist', () => {
    const duplicate = { ...results[1], album_name: 'Live', item_url_path: 'https://live.example' }
    expect(
      selectBandcampTrack([duplicate, results[1]], 'Thomas Dollbaum', 'Big Boi', 'Birds of Paradise')
    ).toBe('https://thomasdollbaum.bandcamp.com/track/big-boi')
  })
})

describe('extractBandcampLyrics', () => {
  const recording = {
    '@type': 'MusicRecording',
    name: 'Big Boi',
    byArtist: { name: 'Thomas Dollbaum' },
    inAlbum: { name: 'Birds of Paradise' },
    recordingOf: { lyrics: { text: 'First line\nSecond line' } }
  }
  const page = (value: unknown) =>
    `<html><script type="application/ld+json">${JSON.stringify(value)}</script></html>`

  it('reads artist-supplied lyrics from structured track data', () => {
    expect(extractBandcampLyrics(page(recording), 'Thomas Dollbaum', 'Big Boi', 'Birds of Paradise'))
      .toBe('First line\nSecond line')
  })

  it('rejects a mismatched track page', () => {
    expect(extractBandcampLyrics(page(recording), 'Someone Else', 'Big Boi', 'Birds of Paradise'))
      .toBeNull()
  })

  it('treats a page without structured data as indeterminate', () => {
    expect(extractBandcampLyrics('<html>challenge</html>', 'Artist', 'Title', 'Album')).toBeUndefined()
  })
})
