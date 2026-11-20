import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlexAlbum } from '../shared/plex'

// library-snapshot.ts resolves its file under Electron's userData; point that
// at a fresh (not-yet-created) directory per test so every store starts cold,
// tests can't see each other's files, and set() exercises the same mkdir path
// a first launch does.
const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir } }))

import { LibrarySnapshotStore, snapshotKey } from './library-snapshot'

const KEY = snapshotKey('server-1', '3')
const FILE = 'library-snapshot.json'

function album(ratingKey: string, overrides: Partial<PlexAlbum> = {}): PlexAlbum {
  return {
    ratingKey,
    title: `Album ${ratingKey}`,
    artist: 'Artist',
    artistRatingKey: null,
    year: 1984,
    thumb: `/library/metadata/${ratingKey}/thumb/1`,
    addedAt: 1_700_000_000,
    rating: null,
    lastViewedAt: null,
    viewCount: null,
    guids: [`mbid://release/${ratingKey}`],
    trackCount: 10,
    studio: null,
    genres: ['Electronic'],
    ...overrides
  }
}

beforeEach(async () => {
  h.dir = join(await mkdtemp(join(tmpdir(), 'library-snapshot-')), 'userData')
})

describe('LibrarySnapshotStore', () => {
  it('round-trips a snapshot across instances (fresh load from disk)', async () => {
    const albums = [album('1'), album('2', { year: 2001, studio: 'Warp' })]
    await new LibrarySnapshotStore().set(KEY, albums)
    expect(await new LibrarySnapshotStore().get(KEY)).toEqual(albums)
  })

  it('returns null when the stored snapshot is for a different key', async () => {
    await new LibrarySnapshotStore().set(KEY, [album('1')])
    // Wrong server and wrong section both miss — a snapshot must never be
    // served against a context it wasn't captured for.
    expect(await new LibrarySnapshotStore().get(snapshotKey('server-2', '3'))).toBeNull()
    expect(await new LibrarySnapshotStore().get(snapshotKey('server-1', '4'))).toBeNull()
  })

  it('returns null when no snapshot file exists', async () => {
    expect(await new LibrarySnapshotStore().get(KEY)).toBeNull()
  })

  it('returns null when the file is corrupt JSON', async () => {
    await mkdir(h.dir, { recursive: true })
    await writeFile(join(h.dir, FILE), 'not json {{{')
    expect(await new LibrarySnapshotStore().get(KEY)).toBeNull()
  })

  it('returns null when the file parses but has the wrong shape', async () => {
    await mkdir(h.dir, { recursive: true })
    await writeFile(join(h.dir, FILE), JSON.stringify({ key: 42, albums: 'nope' }))
    expect(await new LibrarySnapshotStore().get(KEY)).toBeNull()
  })

  it('replaces the previous snapshot wholesale on set (one snapshot, last key wins)', async () => {
    const store = new LibrarySnapshotStore()
    await store.set(KEY, [album('1')])
    const otherKey = snapshotKey('server-1', '9')
    await store.set(otherKey, [album('2')])
    const fresh = new LibrarySnapshotStore()
    expect(await fresh.get(KEY)).toBeNull()
    expect(await fresh.get(otherKey)).toEqual([album('2')])
  })

  it('writes atomically: only the final file remains and it parses clean', async () => {
    await new LibrarySnapshotStore().set(KEY, [album('1')])
    // tmp+rename must not litter .tmp files next to the real one.
    expect(await readdir(h.dir)).toEqual([FILE])
    const parsed = JSON.parse(await readFile(join(h.dir, FILE), 'utf8'))
    expect(parsed.key).toBe(KEY)
    expect(Array.isArray(parsed.albums)).toBe(true)
    expect(typeof parsed.savedAt).toBe('number')
  })

  it('removeAlbum drops the album and persists the smaller snapshot', async () => {
    const store = new LibrarySnapshotStore()
    await store.set(KEY, [album('1'), album('2')])
    await store.removeAlbum('1')
    expect(await store.get(KEY)).toEqual([album('2')])
    expect(await new LibrarySnapshotStore().get(KEY)).toEqual([album('2')])
  })

  it('removeAlbum is a no-op without a snapshot or a matching ratingKey', async () => {
    const store = new LibrarySnapshotStore()
    // Nothing stored yet — must not conjure a file out of nowhere.
    await store.removeAlbum('ghost')
    expect(await new LibrarySnapshotStore().get(KEY)).toBeNull()
    await store.set(KEY, [album('1')])
    await store.removeAlbum('ghost')
    expect(await store.get(KEY)).toEqual([album('1')])
  })

  it('clear forgets the snapshot in memory and on disk', async () => {
    const store = new LibrarySnapshotStore()
    await store.set(KEY, [album('1')])
    await store.clear()
    expect(await store.get(KEY)).toBeNull()
    expect(await new LibrarySnapshotStore().get(KEY)).toBeNull()
  })
})
