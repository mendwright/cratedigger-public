import { describe, it, expect, vi } from 'vitest'
import type { PlexAlbum } from '../../../shared/plex'
import type { AuditFinding, AuditResponse } from '../../../shared/tagger'
import { TriageController, type TriageDeps } from './triage-controller.svelte'

type PlexApi = Window['cratedigger']['plex']
type TaggerApi = Window['cratedigger']['tagger']

const REL = 'c9b2f3a4-1111-2222-3333-444455556666'
const REL2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function album(opts: { ratingKey: string; guids?: string[] }): PlexAlbum {
  return {
    ratingKey: opts.ratingKey,
    artist: 'Artist',
    title: 'Title',
    trackCount: null,
    guids: opts.guids ?? []
  } as unknown as PlexAlbum
}

function makeController(
  opts: {
    albums?: PlexAlbum[]
    plex?: Record<string, unknown>
    tagger?: Record<string, unknown>
  } = {}
) {
  const plex = {
    listDupDismissals: vi.fn(async () => [] as string[]),
    addDupDismissal: vi.fn(async (_a: { key: string }) => ['g1']),
    removeDupDismissal: vi.fn(async (_a: { key: string }) => [] as string[]),
    listReviewedAlbums: vi.fn(async () => ({}) as Record<string, { reviewedAt: number; ignoredFlags: string[] }>),
    setReviewedAlbum: vi.fn(async (_a: { ratingKey: string; ignoredFlags: string[] }) => ({
      rk: { reviewedAt: 1, ignoredFlags: ['no-year'] }
    })),
    clearReviewedAlbum: vi.fn(async (_a: { ratingKey: string }) => ({})),
    listReleaseTrackCounts: vi.fn(async () => ({}) as Record<string, number>),
    getReleaseTrackCount: vi.fn(async (_a: { mbid: string }) => 10),
    ...opts.plex
  }
  const tagger = {
    auditMusic: vi.fn(
      async (): Promise<AuditResponse> => ({
        ok: true,
        scanned_albums: 3,
        mb_fetch_failures: [],
        findings: []
      })
    ),
    retag: vi.fn(async () => ({ ok: true, mode: 'commit', album: 'B', albumartist: 'A' })),
    ...opts.tagger
  }
  const flashToast = vi.fn<(kind: 'ok' | 'err', text: string) => void>()
  const ensureAllAlbums = vi.fn(async () => opts.albums ?? [])
  const getAllAlbums = vi.fn(() => opts.albums ?? [])
  const ensureDuplicatesMediaScan = vi.fn()
  const deps: TriageDeps = {
    flashToast,
    ensureAllAlbums,
    getAllAlbums,
    ensureDuplicatesMediaScan,
    plex: plex as unknown as PlexApi,
    tagger: tagger as unknown as TaggerApi
  }
  return { c: new TriageController(deps), plex, tagger, flashToast, ensureAllAlbums, ensureDuplicatesMediaScan }
}

describe('TriageController — load + mode + filters', () => {
  it('load ensures the library and refreshes the three persisted caches', async () => {
    const { c, plex, ensureAllAlbums } = makeController({
      plex: {
        listDupDismissals: vi.fn(async () => ['g1']),
        listReviewedAlbums: vi.fn(async () => ({ rk: { reviewedAt: 1, ignoredFlags: [] } })),
        listReleaseTrackCounts: vi.fn(async () => ({ [REL]: 10 }))
      }
    })
    await c.load()
    expect(ensureAllAlbums).toHaveBeenCalledOnce()
    expect(c.dupDismissals.has('g1')).toBe(true)
    expect(c.reviewedAlbums.rk).toBeTruthy()
    expect(c.mbTrackCounts[REL]).toBe(10)
    expect(c.loading).toBe(false)
    expect(plex.listDupDismissals).toHaveBeenCalled()
  })

  it('load records an error when ensureAllAlbums throws', async () => {
    const { c, ensureAllAlbums } = makeController()
    ensureAllAlbums.mockRejectedValueOnce(new Error('library down'))
    await c.load()
    expect(c.error).toBe('library down')
    expect(c.loading).toBe(false)
  })

  it('toggleFilter adds and removes a flag', () => {
    const { c } = makeController()
    c.toggleFilter('no-year')
    expect(c.filters.has('no-year')).toBe(false)
    c.toggleFilter('no-year')
    expect(c.filters.has('no-year')).toBe(true)
  })

  it('setMode triggers the media scan only when entering duplicates', () => {
    const { c, ensureDuplicatesMediaScan } = makeController()
    c.setMode('mistagged')
    expect(c.mode).toBe('mistagged')
    expect(ensureDuplicatesMediaScan).not.toHaveBeenCalled()
    c.setMode('duplicates')
    expect(ensureDuplicatesMediaScan).toHaveBeenCalledOnce()
  })
})

describe('TriageController — dismissals + reviews', () => {
  it('dismissDupGroup stores the returned dismissal set', async () => {
    const { c, plex } = makeController()
    await c.dismissDupGroup('g1')
    expect(plex.addDupDismissal).toHaveBeenCalledWith({ key: 'g1' })
    expect(c.dupDismissals.has('g1')).toBe(true)
  })

  it('dismissDupGroup toasts on failure', async () => {
    const { c, flashToast } = makeController({
      plex: { addDupDismissal: vi.fn(async () => { throw new Error('store ro') }) }
    })
    await c.dismissDupGroup('g1')
    expect(flashToast).toHaveBeenCalledWith('err', 'store ro')
  })

  it('markAlbumReviewed persists ignored flags', async () => {
    const { c, plex } = makeController()
    await c.markAlbumReviewed('rk', ['no-year'])
    expect(plex.setReviewedAlbum).toHaveBeenCalledWith({ ratingKey: 'rk', ignoredFlags: ['no-year'] })
    expect(c.reviewedAlbums.rk).toBeTruthy()
  })
})

describe('TriageController — MB track-count scan', () => {
  it('scans only albums whose release MBID is not yet cached', async () => {
    const { c, plex } = makeController({
      albums: [
        album({ ratingKey: '1', guids: [`mbid://release/${REL}`] }),
        album({ ratingKey: '2', guids: [`mbid://release/${REL2}`] })
      ]
    })
    c.mbTrackCounts = { [REL]: 9 } // already cached → only REL2 scanned
    await c.runScan()
    expect(plex.getReleaseTrackCount).toHaveBeenCalledTimes(1)
    expect(plex.getReleaseTrackCount).toHaveBeenCalledWith({ mbid: REL2 })
    expect(c.mbTrackCounts[REL2]).toBe(10)
    expect(c.scan?.running).toBe(false)
    expect(c.scan?.done).toBe(1)
  })

  it('counts failed lookups and surfaces them in the completion toast', async () => {
    const { c, flashToast } = makeController({
      albums: [
        album({ ratingKey: '1', guids: [`mbid://release/${REL}`] }),
        album({ ratingKey: '2', guids: [`mbid://release/${REL2}`] })
      ],
      plex: {
        getReleaseTrackCount: vi.fn(async (a: { mbid: string }) => {
          if (a.mbid === REL) throw new Error('mb 503')
          return 10
        })
      }
    })
    await c.runScan()
    expect(c.scan?.running).toBe(false)
    expect(c.scan?.done).toBe(2)
    expect(c.scan?.failed).toBe(1)
    expect(c.mbTrackCounts[REL]).toBeUndefined()
    expect(c.mbTrackCounts[REL2]).toBe(10)
    expect(flashToast).toHaveBeenCalledWith('err', expect.stringContaining('1 of 2'))
  })

  it('does not toast a failure note when every lookup succeeds', async () => {
    const { c, flashToast } = makeController({
      albums: [album({ ratingKey: '1', guids: [`mbid://release/${REL}`] })]
    })
    await c.runScan()
    expect(c.scan?.failed).toBe(0)
    expect(flashToast).not.toHaveBeenCalled()
  })

  it('toasts and skips when the cache is already warm', async () => {
    const { c, plex, flashToast } = makeController({
      albums: [album({ ratingKey: '1', guids: [`mbid://release/${REL}`] })]
    })
    c.mbTrackCounts = { [REL]: 9 }
    await c.runScan()
    expect(plex.getReleaseTrackCount).not.toHaveBeenCalled()
    expect(flashToast).toHaveBeenCalledWith('ok', 'MB cache already up to date')
    expect(c.scan).toBeNull()
  })
})

describe('TriageController — mistagged audit + repair', () => {
  it('runMistaggedScan stores findings on success', async () => {
    const finding = { album: 'B', albumartist: 'A', release_mbid: REL } as unknown as AuditFinding
    const { c } = makeController({
      tagger: {
        auditMusic: vi.fn(
          async (): Promise<AuditResponse> => ({
            ok: true,
            scanned_albums: 5,
            mb_fetch_failures: ['x'],
            findings: [finding]
          })
        )
      }
    })
    await c.runMistaggedScan()
    expect(c.mistaggedScan?.running).toBe(false)
    expect(c.mistaggedScan?.findings).toEqual([finding])
    expect(c.mistaggedScan?.scannedAlbums).toBe(5)
  })

  it('runMistaggedScan records the error when the audit reports not-ok', async () => {
    const { c } = makeController({
      tagger: {
        auditMusic: vi.fn(async (): Promise<AuditResponse> => ({ ok: false, reason: 'no mount' }))
      }
    })
    await c.runMistaggedScan()
    expect(c.mistaggedScan?.error).toBe('no mount')
    expect(c.mistaggedScan?.running).toBe(false)
  })

  it('repairMistaggedAlbum retags the common album dir and drops the finding', async () => {
    const finding = {
      album: 'B',
      albumartist: 'A',
      release_mbid: REL,
      issue: 'duration_mismatch',
      file_count: 2,
      track_count: 2,
      items: [
        { path: '/music/main/A/B/01.flac' },
        { path: '/music/main/A/B/02.flac' }
      ],
      proposed_mapping: {
        '/music/main/A/B/01.flac': { track_index: 0, title: 't1', track: 1, cost: 0 },
        '/music/main/A/B/02.flac': { track_index: 1, title: 't2', track: 2, cost: 0 }
      }
    } as unknown as AuditFinding
    const { c, tagger, flashToast } = makeController()
    c.mistaggedScan = {
      running: false,
      error: null,
      scannedAt: 1,
      findings: [finding],
      scannedAlbums: 1,
      mbFetchFailures: []
    }
    await c.repairMistaggedAlbum(finding)
    expect(tagger.retag).toHaveBeenCalledWith(
      expect.objectContaining({
        source_paths: ['/music/main/A/B'],
        mbid: REL,
        file_to_track: { '/music/main/A/B/01.flac': 0, '/music/main/A/B/02.flac': 1 },
        refresh_plex: true,
        dry_run: false
      })
    )
    expect(c.mistaggedRepairs['/music/main/A/B']).toBe('done')
    expect(c.mistaggedScan?.findings).toEqual([])
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Repaired'))
  })

  it('repairMistaggedAlbum surfaces a refusal reason', async () => {
    const finding = {
      release_mbid: REL,
      items: [{ path: '/music/main/A/B/01.flac' }, { path: '/music/main/A/B/02.flac' }],
      proposed_mapping: { '/music/main/A/B/01.flac': { track_index: 0, title: 't', track: 1, cost: 0 } }
    } as unknown as AuditFinding
    const { c } = makeController({
      tagger: { retag: vi.fn(async () => ({ ok: false, reason: 'conflict' })) }
    })
    await c.repairMistaggedAlbum(finding)
    const state = c.mistaggedRepairs['/music/main/A/B']
    expect(state).toEqual({ error: 'conflict' })
  })
})
