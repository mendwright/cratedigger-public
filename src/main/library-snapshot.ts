import { app } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { PlexAlbum } from '../shared/plex.js'

// Disk-persisted copy of the most recent full-library snapshot — the
// listAllAlbums result behind the renderer's `allAlbums` — so the next launch
// can paint the crate immediately and revalidate from Plex in the background
// instead of blocking on ~9 paged requests. Follows original-years.ts: a
// single JSON file in userData, lazy first load, atomic tmp+rename writes.
// No debounce here, though — writes happen once per full fetch (minutes
// apart at worst), not per record.
//
// The snapshot is keyed by `${serverId}:${sectionKey}` and get() only serves
// an exact key match, so a snapshot captured against another server, account,
// or section is never handed out. One snapshot is enough: the app browses one
// section at a time, and whichever full fetch ran last owns the file.
//
// Contents are plain Plex album metadata (see PlexAlbum) with original years
// already overlaid at capture time. No auth token lives in these objects, and
// the raw thumb paths only become URLs in the renderer via the token-hiding
// cratedigger-plex:// protocol.

interface SnapshotFile {
  key: string
  savedAt: number
  albums: PlexAlbum[]
}

export function snapshotKey(serverId: string, sectionKey: string): string {
  return `${serverId}:${sectionKey}`
}

export class LibrarySnapshotStore {
  private snapshot: SnapshotFile | null = null
  private loaded = false
  private loadPromise: Promise<void> | null = null

  // app.getPath('userData') needs app.whenReady(); resolve lazily on first use.
  private file(): string {
    return join(app.getPath('userData'), 'library-snapshot.json')
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await readFile(this.file(), 'utf8')
          const parsed = JSON.parse(raw) as SnapshotFile
          // Shape check so a corrupt or foreign file reads as "no snapshot"
          // instead of feeding the renderer junk.
          if (parsed && typeof parsed.key === 'string' && Array.isArray(parsed.albums)) {
            this.snapshot = parsed
          }
        } catch {
          // No file yet (or unreadable) — start empty; the next full fetch
          // rewrites it.
        } finally {
          this.loaded = true
        }
      })()
    }
    await this.loadPromise
  }

  /** The stored albums — null unless the snapshot is for exactly this key. */
  async get(key: string): Promise<PlexAlbum[] | null> {
    await this.ensureLoaded()
    return this.snapshot && this.snapshot.key === key ? this.snapshot.albums : null
  }

  // Replace the snapshot wholesale. Ordered behind ensureLoaded so a slow
  // first disk read can't resolve late and clobber this newer data in memory.
  async set(key: string, albums: PlexAlbum[]): Promise<void> {
    await this.ensureLoaded()
    this.snapshot = { key, savedAt: Date.now(), albums }
    await this.write()
  }

  // An album was deleted from the library: drop it from the stored snapshot
  // too, so it can't flash back into the grid on the next warm launch.
  async removeAlbum(ratingKey: string): Promise<void> {
    await this.ensureLoaded()
    if (!this.snapshot) return
    const remaining = this.snapshot.albums.filter((a) => a.ratingKey !== ratingKey)
    if (remaining.length === this.snapshot.albums.length) return
    this.snapshot = { ...this.snapshot, albums: remaining }
    await this.write()
  }

  /** Sign-out: forget the snapshot entirely, memory and file both. */
  async clear(): Promise<void> {
    await this.ensureLoaded()
    this.snapshot = null
    try {
      await rm(this.file(), { force: true })
    } catch (err) {
      console.error('[library-snapshot] clear failed:', err)
    }
  }

  private async write(): Promise<void> {
    if (!this.snapshot) return
    const path = this.file()
    try {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, JSON.stringify(this.snapshot))
      await rename(tmp, path)
    } catch (err) {
      // A failed write only costs the next launch its warm start — the
      // in-memory copy is already current, so log and move on.
      console.error('[library-snapshot] write failed:', err)
    }
  }
}

export const librarySnapshot = new LibrarySnapshotStore()
