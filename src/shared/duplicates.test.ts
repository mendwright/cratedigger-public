import { describe, it, expect } from 'vitest'
import type { AlbumMediaInfo, PlexAlbum } from './plex'
import { dupKey, buildDuplicateGroups, albumSourceRoot, pickBestInGroup } from './duplicates'

function album(opts: Partial<PlexAlbum> & { ratingKey: string }): PlexAlbum {
  return {
    ratingKey: opts.ratingKey,
    artist: opts.artist ?? 'Artist',
    title: opts.title ?? 'Title',
    trackCount: opts.trackCount ?? null,
    guids: opts.guids ?? []
  } as unknown as PlexAlbum
}

function media(opts: Partial<AlbumMediaInfo>): AlbumMediaInfo {
  return {
    avgBitrate: opts.avgBitrate ?? null,
    trackCount: opts.trackCount ?? null,
    totalSize: opts.totalSize ?? null,
    samplePath: opts.samplePath ?? null
  } as unknown as AlbumMediaInfo
}

describe('dupKey', () => {
  it('strips a leading "the", parens/brackets, edition suffixes, and non-alphanumerics', () => {
    expect(dupKey(album({ ratingKey: '1', artist: 'The Beatles', title: 'Abbey Road (Remastered)' }))).toBe(
      dupKey(album({ ratingKey: '2', artist: 'Beatles', title: 'Abbey Road' }))
    )
  })

  it('collapses a "Deluxe Edition" reissue onto the base album', () => {
    expect(dupKey(album({ ratingKey: '1', artist: 'Spoon', title: 'Gimme Fiction' }))).toBe(
      dupKey(album({ ratingKey: '2', artist: 'Spoon', title: 'Gimme Fiction [Deluxe Edition]' }))
    )
  })

  it('keeps genuinely different albums apart', () => {
    expect(dupKey(album({ ratingKey: '1', artist: 'Spoon', title: 'Kill the Moonlight' }))).not.toBe(
      dupKey(album({ ratingKey: '2', artist: 'Spoon', title: 'Gimme Fiction' }))
    )
  })
})

describe('buildDuplicateGroups', () => {
  it('clusters albums sharing a dupKey, skipping singletons', () => {
    const groups = buildDuplicateGroups([
      album({ ratingKey: 'b', artist: 'Spoon', title: 'Gimme Fiction' }),
      album({ ratingKey: 'a', artist: 'Spoon', title: 'Gimme Fiction (Deluxe)' }),
      album({ ratingKey: 'c', artist: 'Pixies', title: 'Doolittle' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].albums.map((a) => a.ratingKey)).toEqual(['a', 'b']) // sorted by ratingKey
  })

  it('skips albums missing artist or title', () => {
    const groups = buildDuplicateGroups([
      album({ ratingKey: '1', artist: '', title: 'X' }),
      album({ ratingKey: '2', artist: '', title: 'X' })
    ])
    expect(groups).toEqual([])
  })

  it('sorts groups by artist (sans "the") then title', () => {
    const groups = buildDuplicateGroups([
      album({ ratingKey: '1', artist: 'The Zombies', title: 'Odessey' }),
      album({ ratingKey: '2', artist: 'The Zombies', title: 'Odessey' }),
      album({ ratingKey: '3', artist: 'ABBA', title: 'Arrival' }),
      album({ ratingKey: '4', artist: 'ABBA', title: 'Arrival' })
    ])
    expect(groups.map((g) => g.artist)).toEqual(['ABBA', 'The Zombies'])
  })
})

describe('albumSourceRoot', () => {
  it('returns the sibling root under /music', () => {
    expect(albumSourceRoot('/music/redacted/Artist/Album/01.flac')).toBe('redacted')
    expect(albumSourceRoot('music/main/Artist/Album/01.flac')).toBe('main')
  })

  it('returns null for nullish or non-/music paths', () => {
    expect(albumSourceRoot(null)).toBeNull()
    expect(albumSourceRoot(undefined)).toBeNull()
    expect(albumSourceRoot('/data/other/x.flac')).toBeNull()
  })
})

describe('pickBestInGroup', () => {
  const group = {
    key: 'k',
    artist: 'Spoon',
    title: 'Gimme Fiction',
    albums: [album({ ratingKey: 'main' }), album({ ratingKey: 'red' })]
  }

  it('always prefers the redacted-tree copy, even at lower bitrate', () => {
    const info: Record<string, AlbumMediaInfo> = {
      main: media({ avgBitrate: 1411, samplePath: '/music/main/A/B/1.flac' }),
      red: media({ avgBitrate: 192, samplePath: '/music/redacted/A/B/1.mp3' })
    }
    expect(pickBestInGroup(group, info)).toBe('red')
  })

  it('falls back to higher bitrate when neither is redacted', () => {
    const info: Record<string, AlbumMediaInfo> = {
      main: media({ avgBitrate: 1411, samplePath: '/music/main/A/B/1.flac' }),
      red: media({ avgBitrate: 320, samplePath: '/music/slskd/A/B/1.mp3' })
    }
    expect(pickBestInGroup(group, info)).toBe('main')
  })

  it('uses the album trackCount when media info is absent', () => {
    const g = {
      key: 'k',
      artist: 'A',
      title: 'B',
      albums: [album({ ratingKey: 'few', trackCount: 5 }), album({ ratingKey: 'many', trackCount: 12 })]
    }
    expect(pickBestInGroup(g, {})).toBe('many')
  })
})
