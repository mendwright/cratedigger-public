import { beforeEach, describe, expect, it, vi } from 'vitest'

// store.ts instantiates electron-store and (lazily) touches Electron's app
// paths + safeStorage. Replace both with in-memory fakes: the unit under test
// is the typed generic accessor layer (getValue/setValue/patchRecord/
// deleteFromRecord) and the thin domain helpers built on it. The encryption
// envelope (encrypt/decrypt/migrateSecrets) is intentionally NOT covered here
// — it needs real fs + crypto interplay and the mocking outweighs the value.
const h = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  defaults: {} as Record<string, unknown>
}))

vi.mock('electron-store', () => ({
  default: class FakeStore {
    path = '/tmp/cratedigger-test-store.json'

    constructor(opts: { defaults: Record<string, unknown> }) {
      h.defaults = opts.defaults
    }

    get(key: string): unknown {
      // Mirrors conf: stored value if present, otherwise the (shared!)
      // defaults entry.
      return h.data.has(key) ? h.data.get(key) : h.defaults[key]
    }

    set(key: string, value: unknown): void {
      h.data.set(key, value)
    }
  }
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cratedigger-test-userdata' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => ''
  }
}))

import {
  getValue,
  setValue,
  getFromRecord,
  patchRecord,
  deleteFromRecord,
  getAlbumMatch,
  setAlbumMatch,
  clearAlbumMatch,
  addDupDismissal,
  removeDupDismissal,
  setLabelAlias,
  addToListenLater,
  removeFromListenLater,
  appendArtFixLog,
  getArtFixLog,
  popArtFixLog,
  getArtFixProgress,
  setArtFixDecision,
  clearArtFixDecision
} from './store.js'
import type { ArtFixLogEntry } from '../shared/plex.js'

beforeEach(() => {
  h.data.clear()
})

describe('store defaults', () => {
  it('registers the exact persisted-key/default contract with electron-store', () => {
    // This is the on-disk compatibility contract: key strings and defaults
    // must never change (an existing user's store file must load identically).
    expect(h.defaults).toEqual({
      clientIdentifier: '',
      authToken: null,
      preferredServerId: null,
      // Sleeve's paper. Tracks DEFAULT_THEME_ID — this is the colour the
      // window is constructed with, before the renderer applies a theme.
      windowBackground: '#0c0b0a',
      albumMatches: {},
      albumComposerOverrides: {},
      originalYearOverrides: {},
      taggerUrl: '',
      taggerApiKey: '',
      slskdUrl: '',
      slskdApiKey: '',
      tautulliUrl: '',
      tautulliApiKey: '',
      plexAdminToken: '',
      deletedAlbums: [],
      smartPlaylists: [],
      spotifyClientId: '',
      spotifyRefreshToken: '',
      spotifyImports: [],
      spotifyImportDir: '',
      mbTrackCounts: {},
      lastfmApiKey: '',
      ticketmasterApiKey: '',
      geniusClientId: '',
      geniusClientSecret: '',
      dupDismissals: [],
      reviewedAlbums: {},
      albumLabels: {},
      albumGenres: {},
      albumLabelsBackup: {},
      labelAliases: {},
      continuousPlayback: true,
      continuationMode: null,
      radioHistory: [],
      coverOverrides: {},
      releaseRadar: null,
      listenLater: [],
      showNotificationsEnabled: true,
      notifiedShowIds: [],
      showsNotifyBaselineSet: false,
      bijouUrl: '',
      kioskUrl: '',
      bijouNotifiedGrabIds: [],
      bijouNotifyBaselineSet: false,
      recentlyNotifiedShows: [],
      showMarks: {},
      roamingShowMarks: { items: {} },
      roamingListenLater: { items: {} },
      artFixRollback: [],
      artFixProgress: {},
      acquisitionJobs: [],
      slskdPeerHistory: {},
      mirrorPlexToken: '',
      mirrorAccountName: '',
      playlistMirrors: {},
      accounts: [],
      activeAccountId: null
    })
  })
})

describe('getValue / setValue', () => {
  it('returns the default when nothing is stored', () => {
    expect(getValue('preferredServerId')).toBeNull()
    expect(getValue('showNotificationsEnabled')).toBe(true)
    expect(getValue('showsNotifyBaselineSet')).toBe(false)
    expect(getValue('dupDismissals')).toEqual([])
    expect(getValue('albumLabels')).toEqual({})
    expect(getValue('albumComposerOverrides')).toEqual({})
    expect(getValue('acquisitionJobs')).toEqual([])
    expect(getValue('slskdPeerHistory')).toEqual({})
  })

  it('round-trips stored values', () => {
    setValue('preferredServerId', 'srv-1')
    expect(getValue('preferredServerId')).toBe('srv-1')
    setValue('continuationMode', 'radio')
    expect(getValue('continuationMode')).toBe('radio')
  })

  it('falls back to the default when the stored value is null-ish', () => {
    // Defensive ?? semantics carried over from the old per-key getters.
    h.data.set('dupDismissals', null)
    expect(getValue('dupDismissals')).toEqual([])
  })

  it('returns container copies — mutating the result never leaks into the store or defaults', () => {
    const list = getValue('dupDismissals')
    list.push('mutant')
    expect(getValue('dupDismissals')).toEqual([])
    expect(h.defaults.dupDismissals).toEqual([])

    setValue('albumLabels', { a: ['X'] })
    const map = getValue('albumLabels')
    map.b = ['Y']
    expect(getValue('albumLabels')).toEqual({ a: ['X'] })
  })
})

describe('record helpers', () => {
  it('getFromRecord returns null for missing keys', () => {
    expect(getFromRecord('mbTrackCounts', 'nope')).toBeNull()
  })

  it('patchRecord adds without clobbering siblings', () => {
    patchRecord('mbTrackCounts', 'mbid-1', 10)
    patchRecord('mbTrackCounts', 'mbid-2', 12)
    expect(getFromRecord('mbTrackCounts', 'mbid-1')).toBe(10)
    expect(getValue('mbTrackCounts')).toEqual({ 'mbid-1': 10, 'mbid-2': 12 })
  })

  it('deleteFromRecord removes only the named key', () => {
    patchRecord('originalYearOverrides', 'rk1', 1957)
    patchRecord('originalYearOverrides', 'rk2', 1999)
    deleteFromRecord('originalYearOverrides', 'rk1')
    expect(getValue('originalYearOverrides')).toEqual({ rk2: 1999 })
  })

  it('never mutates the shared defaults object', () => {
    patchRecord('coverOverrides', 'rk1', {
      source: 'itunes',
      url: 'http://x/y.jpg',
      thumbUrl: 'http://x/y-thumb.jpg',
      setAt: 1
    })
    expect(h.defaults.coverOverrides).toEqual({})
    deleteFromRecord('coverOverrides', 'rk1')
    expect(h.defaults.coverOverrides).toEqual({})
  })
})

describe('domain helpers over the generic layer', () => {
  it('album match set/get/clear', () => {
    expect(getAlbumMatch('rk1')).toBeNull()
    setAlbumMatch('rk1', 'mb-release-1')
    expect(getAlbumMatch('rk1')).toBe('mb-release-1')
    clearAlbumMatch('rk1')
    expect(getAlbumMatch('rk1')).toBeNull()
  })

  it('dup dismissals dedupe and return the updated list', () => {
    expect(addDupDismissal('k1')).toEqual(['k1'])
    expect(addDupDismissal('k1')).toEqual(['k1'])
    expect(addDupDismissal('k2')).toEqual(['k1', 'k2'])
    expect(removeDupDismissal('k1')).toEqual(['k2'])
  })

  it('listen later dedupes by ratingKey and preserves insertion order', () => {
    const a = { ratingKey: 'a', title: 'A', artist: 'AA', thumb: null, addedAt: '2026-01-01' }
    const b = { ratingKey: 'b', title: 'B', artist: 'BB', thumb: null, addedAt: '2026-01-02' }
    addToListenLater(a as never)
    addToListenLater(b as never)
    expect(addToListenLater(a as never).map((e) => e.ratingKey)).toEqual(['a', 'b'])
    expect(removeFromListenLater('a').map((e) => e.ratingKey)).toEqual(['b'])
  })

  it('setLabelAlias collapses chains to a single hop', () => {
    setLabelAlias('K', 'K Records')
    setLabelAlias('K Recs', 'K')
    // 'K Recs' → 'K' → 'K Records' must flatten.
    expect(getValue('labelAliases')).toEqual({
      K: 'K Records',
      'K Recs': 'K Records'
    })
  })
})

describe('Art Fixer rollback log + progress', () => {
  const entry = (rk: string, overrides: Partial<ArtFixLogEntry> = {}): ArtFixLogEntry => ({
    rk,
    prevRatingKey: 'metadata://posters/old',
    newUrl: 'https://cdn/new.jpg',
    newRatingKey: null,
    source: 'deezer',
    at: 1,
    ...overrides
  })

  it('appends in order', () => {
    appendArtFixLog(entry('1'))
    appendArtFixLog(entry('2'))
    expect(getArtFixLog().map((e) => e.rk)).toEqual(['1', '2'])
  })

  it('popArtFixLog returns and removes the most recent entry', () => {
    appendArtFixLog(entry('1'))
    appendArtFixLog(entry('2'))
    expect(popArtFixLog()?.rk).toBe('2')
    expect(getArtFixLog().map((e) => e.rk)).toEqual(['1'])
    expect(popArtFixLog()?.rk).toBe('1')
    expect(popArtFixLog()).toBeNull()
    expect(getArtFixLog()).toEqual([])
  })

  it('records and clears per-album decisions', () => {
    setArtFixDecision('100', 'accepted')
    setArtFixDecision('200', 'skipped')
    const progress = getArtFixProgress()
    expect(progress['100'].decision).toBe('accepted')
    expect(progress['200'].decision).toBe('skipped')
    expect(typeof progress['100'].at).toBe('number')

    clearArtFixDecision('100')
    expect(getArtFixProgress()['100']).toBeUndefined()
    expect(getArtFixProgress()['200'].decision).toBe('skipped')
  })
})
