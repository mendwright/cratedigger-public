import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MbReleaseCandidate, PlexAlbum } from '../../../shared/plex'
import type { InboxFolder, PreviewResponse } from '../../../shared/tagger'
import {
  InboxController,
  pickBestCandidate,
  guessCommonTag,
  guessSearchArtist,
  unanimousReleaseMbid,
  decisionsFromPreview,
  type InboxDeps
} from './inbox-controller.svelte'
import type { Session } from './plex-state.svelte'

type TaggerApi = Window['cratedigger']['tagger']

afterEach(() => vi.unstubAllGlobals())

function candidate(opts: Partial<MbReleaseCandidate> & { mbid: string }): MbReleaseCandidate {
  return {
    mbid: opts.mbid,
    title: opts.title ?? '',
    artistName: opts.artistName ?? '',
    trackCount: opts.trackCount ?? 10,
    country: opts.country ?? null,
    status: opts.status ?? null,
    disambiguation: opts.disambiguation ?? null,
    date: opts.date ?? null
  } as unknown as MbReleaseCandidate
}

function folder(opts: {
  folder?: string
  path?: string
  fileCount?: number
  tags?: { artist?: string; albumartist?: string; composer?: string; album?: string }[]
  paths?: string[]
}): InboxFolder {
  const tagList = opts.tags ?? []
  const paths = opts.paths ?? tagList.map((_, i) => `/inbox/F/${i}.flac`)
  return {
    folder: opts.folder ?? 'F',
    path: opts.path ?? '/inbox/F',
    file_count: opts.fileCount ?? Math.max(tagList.length, paths.length),
    files: paths.map((p, i) => ({ path: p, tags: tagList[i] ?? {} }))
  } as unknown as InboxFolder
}

function previewResponse(opts: {
  rows: {
    path: string
    default_choice: string
    track_index?: number
    agree?: boolean
    disagree?: boolean
  }[]
  clean?: boolean
  totalTracks?: number
}): PreviewResponse {
  return {
    ok: true,
    mode: 'preview',
    clean: opts.clean ?? true,
    file_count: opts.rows.length,
    total_tracks: opts.totalTracks ?? opts.rows.length,
    rows: opts.rows.map((r) => ({
      path: r.path,
      default_choice: r.default_choice,
      agree: r.agree ?? false,
      disagree: r.disagree ?? false,
      matcher_pick: r.track_index !== undefined ? { track_index: r.track_index } : null,
      acoustid_pick: r.track_index !== undefined ? { track_index: r.track_index } : null
    }))
  } as unknown as PreviewResponse
}

function makeController(
  opts: {
    folders?: InboxFolder[]
    albums?: PlexAlbum[]
    candidates?: MbReleaseCandidate[]
    signedIn?: boolean
    tagger?: Record<string, unknown>
  } = {}
) {
  const tagger = {
    health: vi.fn(async () => ({ ok: true, music_root: '/music', inbox_root: '/inbox' })),
    listInbox: vi.fn(async () => opts.folders ?? []),
    getFolder: vi.fn(async (_a: { name: string }) => folder({})),
    prefingerprint: vi.fn(async () => ({ ok: true, file_count: 2, fingerprinted: 2, cached: 0, errors: [] })),
    deleteFolder: vi.fn(async () => undefined),
    deleteFiles: vi.fn(async () => undefined),
    apply: vi.fn(async () => ({ ok: true, mode: 'commit', album: 'Album' })),
    mergeInboxIntoAlbum: vi.fn(async () => ({ ok: true, album: 'Existing' })),
    getRelease: vi.fn(async (_a: { mbid: string }) => ({ release_mbid: _a.mbid })),
    ...opts.tagger
  }
  const plex = {
    searchReleaseCandidates: vi.fn(async () => opts.candidates ?? [])
  }
  vi.stubGlobal('window', { cratedigger: { tagger, plex } })

  const flashToast = vi.fn<(kind: 'ok' | 'err', text: string) => void>()
  const session = vi.fn<() => Session | null>(() =>
    opts.signedIn === false
      ? ({ signedIn: false } as Session)
      : ({ signedIn: true, preferredServerId: 'srv', user: {} } as unknown as Session)
  )
  const ensureAllAlbums = vi.fn(async () => opts.albums ?? [])
  const removeSlskdDownloadsForFolder = vi.fn()
  const deps: InboxDeps = {
    flashToast,
    session,
    ensureAllAlbums,
    removeSlskdDownloadsForFolder,
    tagger: tagger as unknown as TaggerApi
  }
  return { c: new InboxController(deps), tagger, plex, flashToast, ensureAllAlbums, removeSlskdDownloadsForFolder }
}

describe('pickBestCandidate', () => {
  it('only considers exact track-count matches', () => {
    const got = pickBestCandidate([candidate({ mbid: 'a', trackCount: 9 })], 10)
    expect(got).toBeNull()
  })

  it('prefers US + Official over a bare candidate', () => {
    const got = pickBestCandidate(
      [
        candidate({ mbid: 'plain', trackCount: 10 }),
        candidate({ mbid: 'us', trackCount: 10, country: 'US', status: 'Official' })
      ],
      10
    )
    expect(got?.mbid).toBe('us')
  })

  it('prefers the exact performance credit over country when supplied', () => {
    const got = pickBestCandidate(
      [
        candidate({ mbid: 'wrong-us', trackCount: 6, country: 'US', artistName: 'Wrong Orchestra' }),
        candidate({
          mbid: 'hahn-eu',
          trackCount: 6,
          country: 'XE',
          artistName: 'Hilary Hahn, Swedish Radio Symphony Orchestra, Esa-Pekka Salonen'
        })
      ],
      6,
      'Hilary Hahn | Swedish Radio Symphony Orchestra | Esa-Pekka Salonen'
    )
    expect(got?.mbid).toBe('hahn-eu')
  })

  it('refuses to auto-pick when no release artist matches the file credits', () => {
    const got = pickBestCandidate(
      [candidate({ mbid: 'bardo-pond', trackCount: 6, artistName: 'Bardo Pond' })],
      6,
      'Angine de Poitrine | Khn de Poitrine'
    )
    expect(got).toBeNull()
  })

  it('breaks score ties by earliest date', () => {
    const got = pickBestCandidate(
      [
        candidate({ mbid: 'reissue', trackCount: 10, country: 'US', status: 'Official', date: '2010-01-01' }),
        candidate({ mbid: 'original', trackCount: 10, country: 'US', status: 'Official', date: '1977-01-01' })
      ],
      10
    )
    expect(got?.mbid).toBe('original')
  })
})

describe('guessCommonTag', () => {
  it('returns the unanimous value', () => {
    const f = folder({ tags: [{ album: 'X' }, { album: 'X' }] })
    expect(guessCommonTag(f, 'album')).toBe('X')
  })

  it('returns the first value when they disagree', () => {
    const f = folder({ tags: [{ artist: 'A' }, { artist: 'B' }] })
    expect(guessCommonTag(f, 'artist')).toBe('A')
  })

  it('returns null when no file carries the tag', () => {
    const f = folder({ tags: [{}, {}] })
    expect(guessCommonTag(f, 'album')).toBeNull()
  })
})

describe('guessSearchArtist', () => {
  it('uses the composer for classical searches instead of the performers', () => {
    const f = folder({
      tags: [{
        composer: 'Claude Debussy',
        albumartist: 'San Francisco Symphony, Michael Tilson Thomas',
        artist: 'San Francisco Symphony'
      }]
    })
    expect(guessSearchArtist(f)).toBe('Claude Debussy')
  })

  it('keeps a unanimous band credit instead of mistaking its songwriter for classical composer', () => {
    const f = folder({
      tags: [{
        composer: 'Khn de Poitrine',
        albumartist: 'Angine de Poitrine',
        artist: 'Angine De Poitrine'
      }]
    })
    expect(guessSearchArtist(f)).toBe('Angine de Poitrine')
  })

  it('falls back to album artist and then track artist', () => {
    expect(guessSearchArtist(folder({ tags: [{ albumartist: 'Zubin Mehta' }] }))).toBe('Zubin Mehta')
    expect(guessSearchArtist(folder({ tags: [{ artist: 'Los Angeles Philharmonic' }] }))).toBe(
      'Los Angeles Philharmonic'
    )
  })

  it('uses only the first artist from a classical pipe-separated credit line', () => {
    const f = folder({ tags: [{ composer: 'Schoenberg | Sibelius | Hilary Hahn' }] })
    expect(guessSearchArtist(f)).toBe('Schoenberg')
  })
})

describe('unanimousReleaseMbid', () => {
  it('returns an ID only when every file carries the same release ID', () => {
    const f = folder({ tags: [{}, {}] })
    f.files[0].tags.musicbrainz_albumid = 'rel'
    f.files[1].tags.musicbrainz_albumid = 'rel'
    expect(unanimousReleaseMbid(f)).toBe('rel')
    f.files[1].tags.musicbrainz_albumid = null
    expect(unanimousReleaseMbid(f)).toBeNull()
  })
})

describe('decisionsFromPreview', () => {
  it('seeds matcher/acoustid picks and leaves manual rows unassigned', () => {
    const preview = previewResponse({
      rows: [
        { path: 'a', default_choice: 'matcher', track_index: 1 },
        { path: 'b', default_choice: 'acoustid', track_index: 2 },
        { path: 'c', default_choice: 'manual' }
      ]
    })
    expect(decisionsFromPreview(preview)).toEqual({ a: 1, b: 2 })
  })
})

describe('InboxController — folder list + health', () => {
  it('refresh loads the inbox folder list', async () => {
    const f = folder({ folder: 'Spoon - Gimme Fiction' })
    const { c } = makeController({ folders: [f] })
    await c.refresh()
    expect(c.folders).toEqual([f])
    expect(c.loading).toBe(false)
  })

  it('refreshHealth records null + error when the service is down', async () => {
    const { c } = makeController({
      tagger: { health: vi.fn(async () => { throw new Error('no tagger') }) }
    })
    await c.refreshHealth()
    expect(c.health).toBeNull()
    expect(c.error).toBe('no tagger')
  })

  it('queues only one background completeness search at a time', async () => {
    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = folder({
      folder: 'First',
      path: '/inbox/First',
      tags: [{ artist: 'First Artist', album: 'First Album' }]
    })
    const second = folder({
      folder: 'Second',
      path: '/inbox/Second',
      tags: [{ artist: 'Second Artist', album: 'Second Album' }]
    })
    const { c, plex } = makeController({ folders: [first, second] })
    plex.searchReleaseCandidates
      .mockImplementationOnce(async () => {
        await firstDone
        return []
      })
      .mockResolvedValueOnce([])
    c.folders = [first, second]

    const scan = c.scanCompleteness()
    await Promise.resolve()

    expect(plex.searchReleaseCandidates).toHaveBeenCalledTimes(1)
    releaseFirst()
    await scan
    expect(plex.searchReleaseCandidates).toHaveBeenCalledTimes(2)
  })

  it('stops queuing background searches when a folder is opened', async () => {
    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = folder({
      folder: 'First',
      path: '/inbox/First',
      tags: [{ artist: 'First Artist', album: 'First Album' }]
    })
    const second = folder({
      folder: 'Second',
      path: '/inbox/Second',
      tags: [{ artist: 'Second Artist', album: 'Second Album' }]
    })
    const { c, plex } = makeController()
    plex.searchReleaseCandidates.mockImplementationOnce(async () => {
      await firstDone
      return []
    })
    c.folders = [first, second]

    const scan = c.scanCompleteness()
    await Promise.resolve()
    const open = c.openFolderDetail(folder({ folder: 'Opened', path: '/inbox/Opened' }))
    releaseFirst()
    await Promise.all([scan, open])

    expect(plex.searchReleaseCandidates).toHaveBeenCalledTimes(1)
    expect(c.completenessScanning).toBe(false)
  })
})

describe('InboxController — folder detail', () => {
  it('openFolderDetail seeds the matcher query from tags and kicks a fingerprint', async () => {
    const f = folder({ tags: [{ albumartist: 'Spoon', album: 'Gimme Fiction' }] })
    const { c, tagger } = makeController()
    await c.openFolderDetail(f)
    expect(c.openFolder).toBe(f)
    expect(c.match?.folderPath).toBe(f.path)
    expect(c.matcher.query).toEqual({ artist: 'Spoon', title: 'Gimme Fiction' })
    expect(tagger.prefingerprint).toHaveBeenCalledWith({ name: 'F' })
  })

  it('hydrates raw tags and searches by composer before running the match', async () => {
    const summary = folder({
      tags: [{ albumartist: 'San Francisco Symphony, Michael Tilson Thomas', album: 'Images / Jeux' }]
    })
    const detailed = folder({
      tags: [{ albumartist: 'San Francisco Symphony, Michael Tilson Thomas', album: 'Images / Jeux' }]
    })
    detailed.files[0].raw_tags = { composer: ['Claude Debussy'] }
    const { c } = makeController({
      tagger: { getFolder: vi.fn(async () => detailed) }
    })

    await c.openFolderDetail(summary)

    expect(c.matcher.query).toEqual({ artist: 'Claude Debussy', title: 'Images / Jeux' })
  })

  it('opens a unanimously embedded MusicBrainz release directly without text search', async () => {
    const summary = folder({ tags: [{ album: 'Tabula Rasa' }] })
    const detailed = folder({ tags: [{ album: 'Tabula Rasa' }] })
    detailed.files[0].tags.musicbrainz_albumid = 'part-release'
    const { c, tagger, plex } = makeController({
      tagger: {
        getFolder: vi.fn(async () => detailed),
        getRelease: vi.fn(async () => ({
          release_mbid: 'part-release',
          tracks: [{ track_mbid: 'track-1' }]
        })),
        apply: vi.fn(async () =>
          previewResponse({
            rows: [{ path: detailed.files[0].path, default_choice: 'matcher', track_index: 1 }],
            clean: false
          })
        )
      }
    })

    await c.openFolderDetail(summary)

    expect(tagger.getRelease).toHaveBeenCalledWith({ mbid: 'part-release' })
    expect(plex.searchReleaseCandidates).not.toHaveBeenCalled()
  })

  it('rejects an embedded box-set release when its track count exceeds the folder', async () => {
    const summary = folder({
      tags: [{ composer: 'Aaron Copland', album: 'Appalachian Spring / Billy the Kid' }]
    })
    const detailed = folder({
      tags: [{ composer: 'Aaron Copland', album: 'Appalachian Spring / Billy the Kid' }]
    })
    detailed.files[0].tags.musicbrainz_albumid = 'box-release'
    const { c, tagger, plex } = makeController({
      tagger: {
        getFolder: vi.fn(async () => detailed),
        getRelease: vi.fn(async () => ({
          release_mbid: 'box-release',
          tracks: [{ track_mbid: 'box-1' }, { track_mbid: 'box-2' }]
        })),
        apply: vi.fn(async () =>
          previewResponse({
            rows: [{ path: detailed.files[0].path, default_choice: 'manual' }],
            clean: false
          })
        )
      }
    })

    await c.openFolderDetail(summary)

    expect(tagger.getRelease).toHaveBeenCalledWith({ mbid: 'box-release' })
    expect(c.matcher.release).toBeNull()
    expect(c.match?.preview).toBeNull()
    expect(plex.searchReleaseCandidates).toHaveBeenCalledWith({
      artist: 'Aaron Copland',
      title: 'Appalachian Spring / Billy the Kid'
    })
  })

  it('keeps a near-complete embedded release instead of choosing another performance', async () => {
    const tags = Array.from({ length: 3 }, (_, i) => ({
      albumartist: 'Frédéric Chopin; Ivan Moravec',
      album: 'Nocturnes'
    }))
    const summary = folder({ tags })
    const detailed = folder({ tags })
    detailed.files.forEach((file, i) => {
      file.tags.musicbrainz_albumid = 'moravec-release'
      file.tags.musicbrainz_trackid = `recording-${i + 1}`
    })
    const { c, tagger, plex } = makeController({
      tagger: {
        getFolder: vi.fn(async () => detailed),
        getRelease: vi.fn(async () => ({
          release_mbid: 'moravec-release',
          albumartist: 'Chopin; Ivan Moravec',
          tracks: Array.from({ length: 4 }, (_, i) => ({
            track_mbid: `track-${i + 1}`,
            recording_mbid: `recording-${i + 1}`
          }))
        })),
        apply: vi.fn(async () =>
          previewResponse({
            rows: detailed.files.map((file, i) => ({
              path: file.path,
              default_choice: 'matcher',
              track_index: i + 1
            })),
            clean: false,
            totalTracks: 4
          })
        )
      }
    })

    await c.openFolderDetail(summary)

    expect(tagger.getRelease).toHaveBeenCalledWith({ mbid: 'moravec-release' })
    expect(c.matcher.release?.release_mbid).toBe('moravec-release')
    expect(c.match?.preview?.total_tracks).toBe(4)
    expect(plex.searchReleaseCandidates).not.toHaveBeenCalled()
  })

  it('deleteFolderByName deletes, closes the open detail, and refreshes', async () => {
    const f = folder({ folder: 'F' })
    const { c, tagger } = makeController()
    c.openFolder = f
    c.match = { folderPath: f.path } as never
    await c.deleteFolderByName('F')
    expect(tagger.deleteFolder).toHaveBeenCalledWith({ name: 'F' })
    expect(c.openFolder).toBeNull()
    expect(tagger.listInbox).toHaveBeenCalled()
  })

  it('deleteFilesInOpen prunes decisions for removed paths', async () => {
    const open = folder({ folder: 'F', paths: ['/inbox/F/0.flac', '/inbox/F/1.flac'] })
    const refreshed = folder({ folder: 'F', paths: ['/inbox/F/1.flac'] })
    const { c, tagger } = makeController({ tagger: { getFolder: vi.fn(async () => refreshed) } })
    c.openFolder = open
    c.match = {
      folderPath: open.path,
      preview: previewResponse({ rows: [] }),
      decisions: { '/inbox/F/0.flac': 1, '/inbox/F/1.flac': 2 },
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    await c.deleteFilesInOpen(['/inbox/F/0.flac'])
    expect(tagger.deleteFiles).toHaveBeenCalledWith({ name: 'F', paths: ['/inbox/F/0.flac'] })
    expect(c.match?.decisions).toEqual({ '/inbox/F/1.flac': 2 })
    expect(c.match?.preview).toBeNull() // dropped — file set changed
  })

  it('setRowDecision sets and clears a per-file choice', () => {
    const { c } = makeController()
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    c.setRowDecision('a', 3)
    expect(c.match?.decisions).toEqual({ a: 3 })
    c.setRowDecision('a', null)
    expect(c.match?.decisions).toEqual({})
  })
})

describe('InboxController — apply / merge', () => {
  function armed(c: InboxController): void {
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.matcher.release = { release_mbid: 'rel-1' } as never
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: { a: 1 },
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
  }

  it('applyRelease commits, toasts, clears the slskd download, and refreshes', async () => {
    const { c, tagger, flashToast, removeSlskdDownloadsForFolder } = makeController()
    armed(c)
    await c.applyRelease()
    expect(tagger.apply).toHaveBeenCalledWith(
      expect.objectContaining({ folder: '/inbox/F', mbid: 'rel-1', mode: 'commit', refresh_plex: true })
    )
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Applied'))
    expect(removeSlskdDownloadsForFolder).toHaveBeenCalledWith('F')
    expect(c.match).toBeNull()
    expect(c.openFolder).toBeNull()
  })

  it('applyRelease warns (not plain success) when the files moved but the Plex refresh failed', async () => {
    const { c, flashToast, removeSlskdDownloadsForFolder, tagger } = makeController({
      tagger: {
        apply: vi.fn(async () => ({
          ok: true,
          mode: 'commit',
          album: 'Album',
          plex: { ok: false, reason: 'plex unreachable' }
        }))
      }
    })
    armed(c)
    await c.applyRelease()
    expect(flashToast).toHaveBeenCalledWith(
      'err',
      expect.stringContaining('Plex refresh failed')
    )
    expect(flashToast).not.toHaveBeenCalledWith('ok', expect.anything())
    // The files DID move — cleanup still proceeds.
    expect(removeSlskdDownloadsForFolder).toHaveBeenCalledWith('F')
    expect(c.match).toBeNull()
    expect(c.openFolder).toBeNull()
    expect(tagger.listInbox).toHaveBeenCalled()
  })

  it('applyRelease stays a plain success toast when plex.ok is true', async () => {
    const { c, flashToast } = makeController({
      tagger: {
        apply: vi.fn(async () => ({
          ok: true,
          mode: 'commit',
          album: 'Album',
          plex: { ok: true }
        }))
      }
    })
    armed(c)
    await c.applyRelease()
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Applied'))
  })

  it('applyRelease re-pops the picker when the commit comes back as a dirty preview', async () => {
    const { c, removeSlskdDownloadsForFolder } = makeController({
      tagger: {
        apply: vi.fn(async () =>
          previewResponse({ rows: [{ path: 'a', default_choice: 'manual' }], clean: false })
        )
      }
    })
    armed(c)
    await c.applyRelease()
    expect(c.match?.preview).not.toBeNull()
    expect(c.match?.applying).toBe(false)
    expect(c.match?.matchHint).toContain('Reconcile turned dirty')
    expect(removeSlskdDownloadsForFolder).not.toHaveBeenCalled()
  })

  it('applyRelease refuses a different conductor and orchestra', async () => {
    const { c, tagger } = makeController()
    const f = folder({
      folder: 'Mahler 3',
      path: '/inbox/Mahler 3',
      tags: [{ artist: 'San Francisco Symphony, Michael Tilson Thomas' }]
    })
    f.files[0].raw_tags = {
      conductor: ['Michael Tilson Thomas'],
      orchestra: ['San Francisco Symphony']
    }
    c.openFolder = f
    c.matcher.release = {
      release_mbid: 'wrong',
      albumartist: 'Gustav Mahler; Royal Scottish Orchestra, Neeme Järvi'
    } as never
    c.match = {
      folderPath: f.path,
      preview: null,
      decisions: { [f.files[0].path]: 1 },
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }

    await c.applyRelease()

    expect(tagger.apply).not.toHaveBeenCalled()
    expect(c.match?.applyError).toContain('Performance mismatch')
  })

  it('addIntoExistingAlbum merges into the guarded album then cleans up', async () => {
    const { c, tagger, flashToast, removeSlskdDownloadsForFolder } = makeController()
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.matcher.release = { release_mbid: 'rel-1' } as never
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: { ratingKey: 'rk9' } as unknown as PlexAlbum
    }
    await c.addIntoExistingAlbum()
    expect(tagger.mergeInboxIntoAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'srv', ratingKey: 'rk9', mbid: 'rel-1', inboxPath: '/inbox/F' })
    )
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('Merged'))
    expect(removeSlskdDownloadsForFolder).toHaveBeenCalledWith('F')
    expect(c.match).toBeNull()
  })

  it('addIntoExistingAlbum warns when the merge moved files but the Plex refresh failed', async () => {
    const { c, flashToast, removeSlskdDownloadsForFolder } = makeController({
      tagger: {
        mergeInboxIntoAlbum: vi.fn(async () => ({
          ok: true,
          album: 'Existing',
          plex: { ok: false, reason: 'timeout' }
        }))
      }
    })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.matcher.release = { release_mbid: 'rel-1' } as never
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: { ratingKey: 'rk9' } as unknown as PlexAlbum
    }
    await c.addIntoExistingAlbum()
    expect(flashToast).toHaveBeenCalledWith(
      'err',
      expect.stringContaining('Plex refresh failed')
    )
    expect(removeSlskdDownloadsForFolder).toHaveBeenCalledWith('F')
    expect(c.match).toBeNull()
  })

  it('addIntoExistingAlbum bails when signed out', async () => {
    const { c, tagger } = makeController({ signedIn: false })
    c.openFolder = folder({ folder: 'F' })
    c.matcher.release = { release_mbid: 'rel-1' } as never
    c.match = { folderPath: '/inbox/F', existingAlbum: { ratingKey: 'rk' } } as never
    await c.addIntoExistingAlbum()
    expect(tagger.mergeInboxIntoAlbum).not.toHaveBeenCalled()
  })

  it('addIntoExistingAlbum also refuses a performance mismatch', async () => {
    const { c, tagger } = makeController()
    const f = folder({
      folder: 'Mahler 3',
      path: '/inbox/Mahler 3',
      tags: [{}]
    })
    f.files[0].raw_tags = { conductor: ['Michael Tilson Thomas'] }
    c.openFolder = f
    c.matcher.release = {
      release_mbid: 'wrong',
      albumartist: 'Gustav Mahler; Neeme Järvi'
    } as never
    c.match = {
      folderPath: f.path,
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: { ratingKey: 'rk' } as unknown as PlexAlbum
    }

    await c.addIntoExistingAlbum()

    expect(tagger.mergeInboxIntoAlbum).not.toHaveBeenCalled()
    expect(c.match?.applyError).toContain('Performance mismatch')
  })
})

describe('InboxController — pick + auto-pick', () => {
  it('pickRelease loads the release, runs the reconciler preview, and seeds decisions', async () => {
    // Use a non-clean preview so we observe the seeded state — auto-apply only
    // fires on clean previews and would otherwise wipe `c.match` before we
    // can assert on it.
    const { c, tagger } = makeController({
      tagger: {
        apply: vi.fn(async () =>
          previewResponse({
            rows: [{ path: 'a', default_choice: 'matcher', track_index: 1 }],
            clean: false
          })
        )
      }
    })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    await c.pickRelease('rel-1')
    expect(tagger.getRelease).toHaveBeenCalledWith({ mbid: 'rel-1' })
    expect(c.match?.preview).not.toBeNull()
    expect(c.match?.decisions).toEqual({ a: 1 })
    expect(c.match?.existingAlbum).toBeNull()
  })

  it('pickRelease auto-applies when the preview is clean and every fingerprint agrees', async () => {
    const applyMock = vi.fn(async (args: { mode: string }) =>
      args.mode === 'preview'
        ? previewResponse({
            rows: [
              {
                path: 'a',
                default_choice: 'matcher',
                track_index: 1,
                agree: true
              }
            ],
            clean: true
          })
        : { ok: true as const, mode: 'commit' as const, album: 'Auto' }
    )
    const { c, tagger, removeSlskdDownloadsForFolder } = makeController({
      tagger: { apply: applyMock }
    })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    await c.pickRelease('rel-1')
    expect(tagger.apply).toHaveBeenCalledTimes(2)
    expect(tagger.apply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: 'preview' })
    )
    expect(tagger.apply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'commit' })
    )
    expect(removeSlskdDownloadsForFolder).toHaveBeenCalledWith('F')
    expect(c.match).toBeNull()
    expect(c.openFolder).toBeNull()
  })

  it('pickRelease does not auto-apply a title-only clean preview', async () => {
    const applyMock = vi.fn(async () =>
      previewResponse({
        rows: [{ path: 'a', default_choice: 'matcher', track_index: 1 }],
        clean: true
      })
    )
    const { c } = makeController({ tagger: { apply: applyMock } })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }

    await c.pickRelease('rel-1')

    expect(applyMock).toHaveBeenCalledTimes(1)
    expect(c.match?.preview?.clean).toBe(true)
  })

  it('pickRelease skips auto-apply when the album is already in the library', async () => {
    const applyMock = vi.fn(async () =>
      previewResponse({
        rows: [{ path: 'a', default_choice: 'matcher', track_index: 1 }],
        clean: true
      })
    )
    const mbid = '11111111-1111-1111-1111-111111111111'
    const existing = {
      ratingKey: 'rk-existing',
      title: 'Existing',
      guids: [`mbid://release/${mbid}`]
    } as unknown as PlexAlbum
    const { c, tagger } = makeController({
      tagger: {
        apply: applyMock,
        getRelease: vi.fn(async (a: { mbid: string }) => ({ release_mbid: a.mbid }))
      },
      albums: [existing]
    })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F' })
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    await c.pickRelease(mbid)
    expect(tagger.apply).toHaveBeenCalledTimes(1)
    expect(c.match?.existingAlbum?.ratingKey).toBe('rk-existing')
  })

  it('runMatchSearch auto-picks a confident candidate when none is chosen yet', async () => {
    const cand = candidate({ mbid: 'auto', trackCount: 2, country: 'US', status: 'Official' })
    const { c, tagger } = makeController({ candidates: [cand] })
    c.openFolder = folder({ folder: 'F', path: '/inbox/F', fileCount: 2 })
    c.match = {
      folderPath: '/inbox/F',
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    c.matcher.setQuery('Spoon', 'Gimme Fiction')
    await c.runMatchSearch()
    expect(tagger.getRelease).toHaveBeenCalledWith({ mbid: 'auto' })
  })
})
