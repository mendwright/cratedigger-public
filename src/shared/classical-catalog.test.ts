import { describe, expect, it } from 'vitest'
import type { AlbumCredits } from './plex'
import { buildClassicalCatalog } from './classical-catalog'

it('indexes composers, parent works, movements, recordings, and owned albums', () => {
  const credits = {
    releaseMbid: 'release-1', releaseLevel: [], byTrack: {}, trackArtists: {}, members: [],
    originalDate: null,
    classical: {
      source: 'exact', alignmentConfidence: 'exact', releaseMbid: 'release-1',
      matchedTracks: 2, totalTracks: 2,
      alignment: { acoustidRecording: 0, recordingGuid: 2, releaseTrackGuid: 0, discIndex: 0, titleDuration: 0, unmatched: 0 },
      composers: [{ person: { mbid: 'bach', name: 'J. S. Bach' }, trackCount: 2 }],
      byTrack: {
        t1: { matchMethod: 'recording-guid', releaseTrackMbid: 'rt1', recordingMbid: 'r1', workMbid: 'm1', workTitle: 'I. Allemande', parentWorkMbid: 'w1', parentWorkTitle: 'Partita no. 1', composers: [{ mbid: 'bach', name: 'J. S. Bach' }] },
        t2: { matchMethod: 'recording-guid', releaseTrackMbid: 'rt2', recordingMbid: 'r2', workMbid: 'm2', workTitle: 'II. Courante', parentWorkMbid: 'w1', parentWorkTitle: 'Partita no. 1', composers: [{ mbid: 'bach', name: 'J. S. Bach' }] }
      }
    }
  } satisfies AlbumCredits
  const result = buildClassicalCatalog([{ ratingKey: 'album-1', credits }], 'now')
  expect(result).toMatchObject({ enrichedAlbums: 1, classicalAlbums: 1, recordingCount: 2, workCount: 1 })
  expect(result.composers[0]).toMatchObject({
    person: { mbid: 'bach' }, albumRatingKeys: ['album-1'],
    works: [{ mbid: 'w1', albumRatingKeys: ['album-1'], recordingMbids: ['r1', 'r2'], movementCount: 2 }]
  })
})
