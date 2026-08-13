import { describe, it, expect } from 'vitest'
import { pickBestSingleFile } from './slskd-pick'
import type { SlskdAlbumCandidate, SlskdFile } from './slskd'

function file(over: Partial<SlskdFile>): SlskdFile {
  return {
    filename: 'Music\\Pointer Sisters\\Black & White\\03 - Slow Hand.flac',
    size: 30_000_000,
    bitRate: null,
    length: 232,
    extension: 'flac',
    ...over
  }
}

function cand(over: Partial<SlskdAlbumCandidate>, files: SlskdFile[]): SlskdAlbumCandidate {
  return {
    username: 'peer',
    hasFreeUploadSlot: true,
    uploadSpeed: 500_000,
    queueLength: 0,
    folder: 'Music\\Pointer Sisters\\Black & White',
    guessedArtist: null,
    guessedAlbum: null,
    files,
    score: 0,
    avgMatchScore: 0,
    avgQualityScore: 0,
    formatSummary: 'flac',
    matchedTracks: 0,
    successfulAlbums: 0,
    failedAlbums: 0,
    historicalAverageSpeed: 0,
    ...over
  }
}

const DURATION = 232_000

describe('pickBestSingleFile', () => {
  it('finds the titled file inside album folders, ignoring track numbers', () => {
    const pick = pickBestSingleFile('Slow Hand', DURATION, [
      cand({}, [
        file({ filename: 'a\\01 - Sweet Perfection.flac', length: 190 }),
        file({ filename: 'a\\03 - Slow Hand.flac' })
      ])
    ])
    expect(pick?.file.filename).toContain('Slow Hand')
  })

  // Regression: a dash-suffixed Spotify gap title ("… - Remastered 2003")
  // never gated against plain soulseek filenames.
  it('matches a plain filename against a dash-suffixed want title', () => {
    const pick = pickBestSingleFile('Slow Hand - Remastered 2003', DURATION, [
      cand({}, [file({ filename: 'a\\03 - Slow Hand.flac' })])
    ])
    expect(pick?.file.filename).toContain('Slow Hand')
  })

  it('returns null when no filename matches the title', () => {
    expect(
      pickBestSingleFile('Slow Hand', DURATION, [
        cand({}, [file({ filename: 'a\\something else.flac' })])
      ])
    ).toBeNull()
  })

  it('prefers the duration-correct copy over a wildly long one', () => {
    const pick = pickBestSingleFile('Slow Hand', DURATION, [
      cand({}, [
        file({ filename: 'a\\Slow Hand (12 inch version).flac', length: 512 }),
        file({ filename: 'b\\Slow Hand.flac', length: 233 })
      ])
    ])
    expect(pick?.file.filename).toBe('b\\Slow Hand.flac')
  })

  it('prefers flac over low-bitrate mp3, and free slots over queues', () => {
    const mp3 = cand({ username: 'mp3guy' }, [
      file({ filename: 'x\\Slow Hand.mp3', extension: 'mp3', bitRate: 192 })
    ])
    const flacQueued = cand({ username: 'flacguy', hasFreeUploadSlot: false }, [
      file({ filename: 'y\\Slow Hand.flac' })
    ])
    const flacFree = cand({ username: 'bestguy' }, [file({ filename: 'z\\Slow Hand.flac' })])
    const pick = pickBestSingleFile('Slow Hand', DURATION, [mp3, flacQueued, flacFree])
    expect(pick?.candidate.username).toBe('bestguy')
  })

  it('tolerates unknown durations', () => {
    const pick = pickBestSingleFile('Slow Hand', null, [
      cand({}, [file({ length: null })])
    ])
    expect(pick).not.toBeNull()
  })
})
