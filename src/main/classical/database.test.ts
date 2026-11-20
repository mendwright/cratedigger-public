import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { AlbumCredits } from '../../shared/plex'
import { ClassicalDatabase } from './database'

const dirs: string[] = []

function testDb(): ClassicalDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'cratedigger-classical-'))
  dirs.push(dir)
  return new ClassicalDatabase(join(dir, 'catalog.sqlite'))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ClassicalDatabase', () => {
  it('loads the bundled repertoire snapshot', () => {
    const db = testDb()
    const imported = db.importOpenOpusFile(join(process.cwd(), 'resources', 'classical', 'openopus-work-dump.json.gz'))
    expect(imported.composers).toBeGreaterThan(200)
    expect(imported.works).toBeGreaterThan(24_000)
    expect(db.search({ query: 'beeth' }).items[0]?.title).toBe('Ludwig van Beethoven')
    db.close()
  })

  it('imports the global repertoire and provides prefix search without substring matches', () => {
    const db = testDb()
    db.importOpenOpus({
      status: { version: 'test-1' },
      composers: [
        {
          name: 'Bach', complete_name: 'Johann Sebastian Bach', epoch: 'Baroque',
          birth: '1685-01-01', death: '1750-01-01', popular: '1', recommended: '1',
          works: [{ title: 'Goldberg Variations, BWV 988', subtitle: 'For keyboard', genre: 'Keyboard', popular: '1', recommended: '1' }]
        },
        {
          name: 'Beethoven', complete_name: 'Ludwig van Beethoven', epoch: 'Classical',
          birth: '1770-01-01', death: '1827-01-01', popular: '1', recommended: '1', works: []
        },
        {
          name: 'Laibach', complete_name: 'Laibach', epoch: 'Modern',
          birth: null, death: null, popular: '0', recommended: '0', works: []
        }
      ]
    })

    expect(db.getHome().stats).toMatchObject({ composers: 3, works: 1 })
    expect(db.search({ query: 'beeth' }).items.map((item) => item.title)).toEqual(['Ludwig van Beethoven'])
    expect(db.search({ query: 'bach' }).items.map((item) => item.title)).toContain('Johann Sebastian Bach')
    expect(db.search({ query: 'bach' }).items.map((item) => item.title)).not.toContain('Laibach')
    db.close()
  })

  it('attaches owned recordings to works and keeps performers separate from composers', () => {
    const db = testDb()
    db.importOpenOpus({
      status: { version: 'test-1' },
      composers: [{
        name: 'Bach', complete_name: 'Johann Sebastian Bach', epoch: 'Baroque',
        birth: '1685-01-01', death: '1750-01-01', popular: '1', recommended: '1',
        works: [{ title: 'Goldberg Variations', subtitle: '', genre: 'Keyboard', popular: '1', recommended: '1' }]
      }]
    })
    const credits: AlbumCredits = {
      releaseMbid: 'release-1', originalDate: '1982-01-01', releaseLevel: [], members: [], trackArtists: {},
      byTrack: { 'track-1': [{ role: 'instrument', instrument: 'piano', person: { mbid: 'gould-mbid', name: 'Glenn Gould' } }] },
      classical: {
        source: 'exact', alignmentConfidence: 'exact', releaseMbid: 'release-1', matchedTracks: 1, totalTracks: 1,
        alignment: { acoustidRecording: 0, recordingGuid: 1, releaseTrackGuid: 0, discIndex: 0, titleDuration: 0, unmatched: 0 },
        composers: [{ person: { mbid: 'bach-mbid', name: 'Johann Sebastian Bach' }, trackCount: 1 }],
        byTrack: { 'track-1': { matchMethod: 'recording-guid', releaseTrackMbid: null, recordingMbid: 'recording-1', workMbid: 'work-1', workTitle: 'Goldberg Variations', parentWorkMbid: null, parentWorkTitle: null, composers: [{ mbid: 'bach-mbid', name: 'Johann Sebastian Bach' }] } }
      }
    }
    db.importOwnedCredits([{ ratingKey: 'plex-album-1', credits }])

    const work = db.search({ query: 'goldberg', kinds: ['work'] }).items[0]
    expect(work.ownedCount).toBe(1)
    expect(db.search({ query: 'gould' }).items).toMatchObject([{ kind: 'performer', title: 'Glenn Gould' }])
    expect(db.search({ query: 'bach', kinds: ['performer'] }).items).toEqual([])
    db.close()
  })

  it('requeues interrupted enrichment without charging a failed attempt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cratedigger-classical-'))
    dirs.push(dir)
    const path = join(dir, 'catalog.sqlite')
    const album = {
      plexServerId: 'server-1', ratingKey: 'album-1', title: 'Goldberg Variations',
      artist: 'Glenn Gould', year: 1982, thumb: null, candidate: true
    }

    const first = new ClassicalDatabase(path)
    first.syncOwnedAlbums([album])
    expect(first.claimNextSyncJob()?.attempts).toBe(1)
    first.close()

    const restarted = new ClassicalDatabase(path)
    expect(restarted.recoverInterruptedSyncJobs()).toBe(1)
    expect(restarted.claimNextSyncJob()?.attempts).toBe(1)
    restarted.close()
  })
})
