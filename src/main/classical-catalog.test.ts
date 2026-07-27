import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

import { readClassicalCatalogCache } from './classical-catalog'

function credits(recordingMbid: string): object {
  return {
    releaseMbid: 'release', originalDate: null, releaseLevel: [], byTrack: {},
    trackArtists: {}, members: [],
    classical: {
      source: 'exact', alignmentConfidence: 'exact', releaseMbid: 'release',
      matchedTracks: 1, totalTracks: 1,
      alignment: { acoustidRecording: 0, recordingGuid: 1, releaseTrackGuid: 0, discIndex: 0, titleDuration: 0, unmatched: 0 },
      composers: [],
      byTrack: {
        track: { matchMethod: 'recording-guid', releaseTrackMbid: 'track', recordingMbid, workMbid: null, workTitle: null, parentWorkMbid: null, parentWorkTitle: null, composers: [] }
      }
    }
  }
}

describe('readClassicalCatalogCache', () => {
  it('reads the current v5 classical cache and ignores superseded credit buckets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'classical-catalog-'))
    await mkdir(join(root, 'album-credits'), { recursive: true })
    await mkdir(join(root, 'album-credits-v4'), { recursive: true })
    await mkdir(join(root, 'album-credits-v5'), { recursive: true })
    await writeFile(join(root, 'album-credits', 'old.json'), JSON.stringify({ v: 1, d: credits('legacy') }))
    await writeFile(join(root, 'album-credits-v4', 'stale.json'), JSON.stringify({ v: 1, d: credits('stale') }))
    await writeFile(join(root, 'album-credits-v5', 'current.json'), JSON.stringify({ v: 1, d: credits('current') }))

    const result = await readClassicalCatalogCache(root)

    expect(result.enrichedAlbums).toBe(1)
    expect(result.classicalAlbums).toBe(1)
    expect(result.recordingCount).toBe(1)
  })
})
