import type {
  ArtFixCandidate,
  ArtFixQueueItem,
  ArtFixScanProgress
} from '../../../shared/plex'
import { splitAlbumMbids } from '../../../shared/guid'

type PlexApi = Window['cratedigger']['plex']

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Owns the Art Fixer screen: the low-res review queue, the candidate covers for
// the current album, and the accept/skip/search/revert/scan actions. View
// orchestration (openArtFixer/closeArtFixer) stays on PlexState; this loads and
// shapes the data and talks to window.cratedigger.plex.artFix*. Deps (serverId)
// are injected so it stays testable without a live session.
export class ArtFixController {
  #api: PlexApi
  #serverId: () => string | null
  #detachScan: (() => void) | null = null

  queue = $state<ArtFixQueueItem[]>([])
  source = $state<'seed' | 'scan' | null>(null)
  scannedAt = $state<number | null>(null)
  index = $state(0)

  candidates = $state<ArtFixCandidate[]>([])
  candidatesLoading = $state(false)

  scanProgress = $state<ArtFixScanProgress | null>(null)
  loading = $state(false)
  applying = $state(false)
  error = $state<string | null>(null)

  // Session tallies for the header readout.
  acceptedCount = $state(0)
  skippedCount = $state(0)

  current = $derived<ArtFixQueueItem | null>(this.queue[this.index] ?? null)
  remaining = $derived(Math.max(0, this.queue.length - this.index))

  constructor(deps: { serverId: () => string | null; api?: PlexApi }) {
    this.#api = deps.api ?? window.cratedigger.plex
    this.#serverId = deps.serverId
  }

  async activate(): Promise<void> {
    if (!this.#detachScan) {
      this.#detachScan = this.#api.onArtFixScanProgress((p) => {
        this.scanProgress = p
      })
    }
    await this.loadQueue()
  }

  dispose(): void {
    this.#detachScan?.()
    this.#detachScan = null
  }

  async loadQueue(): Promise<void> {
    this.loading = true
    this.error = null
    try {
      const q = await this.#api.artFixListQueue()
      this.queue = q.items
      this.source = q.source
      this.scannedAt = q.scannedAt
      this.index = 0
      await this.loadCandidates()
    } catch (e) {
      this.error = msg(e)
    } finally {
      this.loading = false
    }
  }

  // Fetch candidate covers for the current album. Seed-sourced items lack a
  // thumb path + release MBID, so resolve those from the album detail first —
  // that also lets Cover Art Archive kick in for the no-match set.
  async loadCandidates(): Promise<void> {
    const item = this.current
    this.candidates = []
    if (!item) return
    const serverId = this.#serverId()
    if (!serverId) {
      this.error = 'No server selected'
      return
    }
    this.candidatesLoading = true
    try {
      let mbid = item.mbid
      if (item.thumb === null || mbid === null) {
        const detail = await this.#api.getAlbumDetail({ serverId, ratingKey: item.rk })
        item.thumb = detail.album.thumb
        mbid = splitAlbumMbids(detail.guids).release
        item.mbid = mbid
      }
      this.candidates = await this.#api.artFixGetCandidates({
        serverId,
        rk: item.rk,
        artist: item.artist,
        album: item.album,
        mbid,
        seedUrl: item.seed?.candUrl ?? null
      })
    } catch (e) {
      this.error = msg(e)
    } finally {
      this.candidatesLoading = false
    }
  }

  // Re-query candidates with an explicit artist/album (the wrong-edition fix).
  async manualSearch(artist: string, album: string): Promise<void> {
    const item = this.current
    if (!item) return
    const serverId = this.#serverId()
    if (!serverId) return
    this.candidatesLoading = true
    this.error = null
    try {
      this.candidates = await this.#api.artFixGetCandidates({
        serverId,
        rk: item.rk,
        artist: artist.trim(),
        album: album.trim(),
        mbid: item.mbid
      })
    } catch (e) {
      this.error = msg(e)
    } finally {
      this.candidatesLoading = false
    }
  }

  async accept(candidate: ArtFixCandidate): Promise<void> {
    const item = this.current
    const serverId = this.#serverId()
    if (!item || !serverId) return
    this.applying = true
    this.error = null
    try {
      // Spread the candidate to a plain object — it's a Svelte $state proxy and
      // proxies aren't structured-cloneable across IPC ("object could not be
      // cloned"). ArtFixCandidate is flat, so a shallow copy is enough.
      await this.#api.artFixAccept({ serverId, rk: item.rk, candidate: { ...candidate } })
      this.acceptedCount++
      this.#advance()
    } catch (e) {
      this.error = msg(e)
    } finally {
      this.applying = false
    }
  }

  async skip(): Promise<void> {
    const item = this.current
    if (!item) return
    try {
      await this.#api.artFixSkip({ rk: item.rk })
      this.skippedCount++
      this.#advance()
    } catch (e) {
      this.error = msg(e)
    }
  }

  // Move to the next album. Decided items are persisted server-side, so we just
  // step the cursor; the next loadQueue() (or revert) re-derives membership.
  #advance(): void {
    this.index++
    void this.loadCandidates()
  }

  async revertLast(): Promise<void> {
    const serverId = this.#serverId()
    if (!serverId) return
    try {
      const res = await this.#api.artFixRevertLast({ serverId })
      if (res.reverted) {
        // The reverted album re-enters the queue — reload to surface it.
        await this.loadQueue()
      }
    } catch (e) {
      this.error = msg(e)
    }
  }

  async rescan(): Promise<void> {
    const serverId = this.#serverId()
    if (!serverId) return
    this.error = null
    try {
      const q = await this.#api.artFixScan({ serverId })
      this.queue = q.items
      this.source = q.source
      this.scannedAt = q.scannedAt
      this.index = 0
      await this.loadCandidates()
    } catch (e) {
      this.error = msg(e)
    }
  }

  cancelScan(): void {
    void this.#api.artFixCancelScan()
  }
}
