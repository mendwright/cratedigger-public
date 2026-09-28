import { describe, expect, it } from 'vitest'
import { importedPlaylistRows } from './imported-playlist'
import type { PlaylistItem } from './plex'
import type { SpotifyImportReport } from './spotify'

const item = (ratingKey: string, playlistItemID: number, title: string): PlaylistItem => ({
  ratingKey,
  playlistItemID,
  title,
  artist: 'artist',
  album: 'album',
  albumRatingKey: null,
  durationMs: 1000,
  thumb: null
})

describe('importedPlaylistRows', () => {
  it('keeps unmatched tracks in their original positions among Plex matches', () => {
    const report: SpotifyImportReport = {
      playlistId: 'file:old list',
      name: 'old list',
      plexRatingKey: 'playlist',
      importedAt: 1,
      total: 3,
      matchedCount: 2,
      gaps: [{ artist: 'b', title: 'missing', album: 'B', durationMs: 2000 }],
      entries: [
        { artist: 'a', title: 'first', album: 'A', durationMs: 1000, matchedRatingKey: '1' },
        { artist: 'b', title: 'missing', album: 'B', durationMs: 2000, matchedRatingKey: null },
        { artist: 'c', title: 'third', album: 'C', durationMs: 3000, matchedRatingKey: '3' }
      ]
    }

    const rows = importedPlaylistRows(report, [item('1', 11, 'first'), item('3', 13, 'third')])
    expect(rows.map((row) => row.kind === 'matched' ? row.item.title : row.source.title)).toEqual([
      'first',
      'missing',
      'third'
    ])
    expect(rows.map((row) => row.kind)).toEqual(['matched', 'missing', 'matched'])
  })

  it('retains Plex tracks added after import', () => {
    const report: SpotifyImportReport = {
      playlistId: 'x', name: 'x', plexRatingKey: 'p', importedAt: 1,
      total: 1, matchedCount: 1, gaps: [],
      entries: [{ artist: 'a', title: 'first', album: 'A', durationMs: 1, matchedRatingKey: '1' }]
    }
    const rows = importedPlaylistRows(report, [item('1', 1, 'first'), item('2', 2, 'added')])
    expect(rows.map((row) => row.kind === 'matched' ? row.item.title : row.source.title)).toEqual(['first', 'added'])
  })
})
