import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { applyOriginalYears, yearFromDate, type HasAlbumYear } from '../shared/original-year.js'

// Persistent index of Plex album ratingKey → original release year. This is the
// year Cratedigger files an album under everywhere it shows or sorts a year, so
// a 2005 reissue of a 1984 album reads as 1984. Fed from two places:
//   1. record() — called whenever an album's MusicBrainz credits are touched
//      (on-demand opens *and* the library warmer's full crawl), harvesting the
//      release-group first-release-date that credits already carry.
//   2. the lazy backfill in musicbrainz.ts, for albums whose credits are cached
//      but predate this index.
// A value of null means "we looked and MusicBrainz had no usable original date"
// — recorded so we stop probing; absence means "not resolved yet" and callers
// fall back to Plex's edition year.
//
// Kept as a *single* JSON file (unlike the per-key files of mb-cache) because
// overlay() touches the whole library on every list call — thousands of per-key
// file reads wouldn't scale. The map lives in memory after first load; writes
// are debounced and atomic (tmp + rename) so a crash mid-write can't corrupt it.

const FLUSH_DELAY_MS = 1500

class OriginalYearIndex {
  private map = new Map<string, number | null>()
  // User-set manual overrides (ratingKey → year), seeded once from electron-store
  // via loadOverrides() at startup. These win over the MB-derived map in overlay()
  // — for box sets / compilations whose release group is newer than the music, the
  // auto year is right about the *release group* but wrong about the recording, so
  // the user pins the real year here.
  private overrides = new Map<string, number>()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private dirty = false
  private flushTimer: NodeJS.Timeout | null = null

  // app.getPath('userData') needs app.whenReady(); resolve lazily on first use.
  private file(): string {
    return join(app.getPath('userData'), 'original-years.json')
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await readFile(this.file(), 'utf8')
          const parsed = JSON.parse(raw) as Record<string, number | null>
          for (const [key, value] of Object.entries(parsed)) this.map.set(key, value)
        } catch {
          // No file yet (or unreadable) — start empty.
        } finally {
          this.loaded = true
        }
      })()
    }
    await this.loadPromise
  }

  // Whether we've already resolved this album (year *or* a recorded null). Lets
  // the backfill skip work it's already done without another disk read.
  async has(ratingKey: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.map.has(ratingKey)
  }

  async get(ratingKey: string): Promise<number | null | undefined> {
    await this.ensureLoaded()
    return this.map.has(ratingKey) ? this.map.get(ratingKey) : undefined
  }

  // Record an original year from a MusicBrainz date string (or explicit null).
  // Returns the parsed year so callers can reuse it without re-parsing.
  async record(ratingKey: string, originalDate: string | null): Promise<number | null> {
    await this.ensureLoaded()
    const year = yearFromDate(originalDate)
    if (this.map.has(ratingKey) && this.map.get(ratingKey) === year) return year
    this.map.set(ratingKey, year)
    this.scheduleFlush()
    return year
  }

  // Seed the manual-override map from electron-store. Called once at startup
  // (before any overlay runs). Replacing the whole map keeps it the single
  // source of truth even if called again after a settings reload.
  loadOverrides(overrides: Record<string, number>): void {
    this.overrides = new Map(Object.entries(overrides))
  }

  // Set / clear a single manual override in memory. The store write is the
  // caller's responsibility (ipc.ts) — this keeps the in-memory overlay map in
  // sync so the next list call reflects the change without a reload.
  setOverride(ratingKey: string, year: number): void {
    this.overrides.set(ratingKey, year)
  }

  clearOverride(ratingKey: string): void {
    this.overrides.delete(ratingKey)
  }

  // Overlay every known original year onto the given albums in place (delegating
  // to the pure shared logic). The auto index goes on first, then user overrides
  // on top so a pinned year always wins. Albums we know nothing about keep their
  // Plex year.
  async overlay<T extends HasAlbumYear>(albums: T[]): Promise<void> {
    await this.ensureLoaded()
    applyOriginalYears(albums, this.map)
    applyOriginalYears(albums, this.overrides)
  }

  private scheduleFlush(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const path = this.file()
    const snapshot = JSON.stringify(Object.fromEntries(this.map))
    try {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, snapshot)
      await rename(tmp, path)
    } catch (err) {
      // Re-arm so a transient failure retries on the next record().
      this.dirty = true
      console.error('[original-years] flush failed:', err)
    }
  }
}

export const originalYears = new OriginalYearIndex()
