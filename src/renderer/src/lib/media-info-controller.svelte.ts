import type { AlbumMediaInfo, PlexAlbum } from '../../../shared/plex'
import { buildDuplicateGroups } from '../../../shared/duplicates'

type PlexApi = Window['cratedigger']['plex']

export interface MediaInfoDeps {
  /** Active server id, or null when signed out / no preferred server. */
  serverId: () => string | null
  /** Current full-library snapshot, read synchronously by the duplicates scan. */
  getAllAlbums: () => PlexAlbum[]
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * Per-album media info (codec / bitrate / size), extracted from PlexState.
 * Owns the {@link byAlbum} cache that feeds the format badges on album cards
 * and the stats rows on album-detail / now-playing, the concurrency-capped
 * trickle-fetch queue behind {@link request}, and the duplicates-mode bulk
 * {@link runScanForDuplicates | scan} with progress + cancellation. Components
 * read `plexState.mediaInfo.*`.
 */
export class MediaInfoController {
  byAlbum = $state<Record<string, AlbumMediaInfo>>({})
  scan = $state<{ running: boolean; total: number; done: number } | null>(null)
  private scanCancel = false

  // Background trickle-fetcher for the format badges on album cards. Cards
  // request their info on mount; we keep a small concurrency cap so a fast
  // scroll doesn't flood the Plex server.
  private queue: string[] = []
  private queued = new Set<string>()
  private inFlight = 0
  // Low concurrency on purpose — each request fetches /children?includeMedia=1
  // and competes with cover-image transcodes for Plex connection slots. With
  // 200 cards mounting at once, even 4 in flight starves cover loads.
  private static readonly CONCURRENCY = 2

  #deps: MediaInfoDeps
  #plex: PlexApi

  constructor(deps: MediaInfoDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  infoFor(ratingKey: string): AlbumMediaInfo | null {
    return this.byAlbum[ratingKey] ?? null
  }

  /** Enqueue a fetch for one album. Coalesces duplicate requests (already
   *  cached or already queued/in-flight keys are no-ops). */
  request(ratingKey: string): void {
    if (this.byAlbum[ratingKey]) return
    if (this.queued.has(ratingKey)) return
    if (!this.#deps.serverId()) return
    this.queued.add(ratingKey)
    this.queue.push(ratingKey)
    this.pump()
  }

  private pump(): void {
    const serverId = this.#deps.serverId()
    if (!serverId) return
    while (this.inFlight < MediaInfoController.CONCURRENCY && this.queue.length > 0) {
      const rk = this.queue.shift()
      if (!rk) break
      if (this.byAlbum[rk]) {
        this.queued.delete(rk)
        continue
      }
      this.inFlight++
      void this.#plex
        .getAlbumMediaInfo({ serverId, ratingKey: rk })
        .then((info) => {
          this.byAlbum = { ...this.byAlbum, [rk]: info }
        })
        .catch(() => {
          // ignore — leave un-badged
        })
        .finally(() => {
          this.queued.delete(rk)
          this.inFlight--
          this.pump()
        })
    }
  }

  /** Bulk-fetch media info for every album in a duplicate group, with
   *  progress on {@link scan}. Sequential on purpose (it can cover hundreds
   *  of albums); {@link cancelScan} latches a stop between fetches. */
  async runScanForDuplicates(): Promise<void> {
    const serverId = this.#deps.serverId()
    if (!serverId) return
    if (this.scan?.running) return
    const groups = buildDuplicateGroups(this.#deps.getAllAlbums())
    const targets: string[] = []
    for (const g of groups) {
      for (const a of g.albums) {
        if (!this.byAlbum[a.ratingKey]) targets.push(a.ratingKey)
      }
    }
    if (targets.length === 0) {
      this.scan = { running: false, total: 0, done: 0 }
      return
    }
    this.scanCancel = false
    this.scan = { running: true, total: targets.length, done: 0 }
    try {
      for (const rk of targets) {
        if (this.scanCancel) break
        try {
          const info = await this.#plex.getAlbumMediaInfo({ serverId, ratingKey: rk })
          this.byAlbum = { ...this.byAlbum, [rk]: info }
        } catch {
          // skip; keep scanning
        }
        if (this.scan) {
          this.scan = { ...this.scan, done: this.scan.done + 1 }
        }
      }
    } finally {
      if (this.scan) this.scan = { ...this.scan, running: false }
    }
  }

  cancelScan(): void {
    this.scanCancel = true
  }

  /** Forget any prior duplicates-scan progress (e.g. after a library reload)
   *  so the next visit to duplicates mode re-runs the scan. */
  resetScan(): void {
    this.scan = null
  }
}
