import type { LabelIndexProgress, PlexAlbum } from '../../../shared/plex'
import { splitAlbumMbids } from '../../../shared/guid'

type PlexApi = Window['cratedigger']['plex']

/** The per-album payload the main-process label indexer needs: identity +
 *  studio + the MBIDs to look the release up by. Pure; exported for testing. */
export function albumToIndexItem(a: PlexAlbum): {
  ratingKey: string
  artist: string
  title: string
  studio: string | null
  releaseMbid: string | null
  releaseGroupMbid: string | null
} {
  const { release, releaseGroup } = splitAlbumMbids(a.guids)
  return {
    ratingKey: a.ratingKey,
    artist: a.artist,
    title: a.title,
    studio: a.studio,
    releaseMbid: release,
    releaseGroupMbid: releaseGroup
  }
}

export interface LabelIndexDeps {
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Clear any active label filters — called after the index is wiped so the
   *  filter UI doesn't keep referencing labels that no longer resolve. */
  clearLabelFilters: () => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * The record-label index, extracted from PlexState. Owns the per-album label
 * map ({@link labels}, the primary signal for the album-detail "more from this
 * label" rail and the label filter), the background-indexer {@link progress},
 * and the {@link backupCount}. The actual indexing runs in main; this drives it
 * (start/stop/retry/clear/restore) and mirrors its progress events. Components
 * read `plexState.labelIndex.*`.
 */
export class LabelIndexController {
  labels = $state<Record<string, string[]>>({})
  progress = $state<LabelIndexProgress>({
    running: false,
    done: 0,
    total: 0,
    current: null,
    error: null
  })
  backupCount = $state(0)

  #deps: LabelIndexDeps
  #plex: PlexApi

  constructor(deps: LabelIndexDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Subscribe to the main-process indexer's progress stream. Returns a detach
  // fn (PlexState stores it for dispose). When a run finishes with results, the
  // freshly-built labels are pulled in.
  subscribe(): () => void {
    return this.#plex.onLabelIndexProgress((p) => {
      this.progress = p
      if (!p.running && p.done > 0) void this.loadLabels()
    })
  }

  async loadLabels(): Promise<void> {
    try {
      this.labels = await this.#plex.listAlbumLabels()
    } catch {
      // leave existing value in place
    }
    void this.loadBackup()
  }

  async loadBackup(): Promise<void> {
    try {
      const backup = await this.#plex.getAlbumLabelsBackup()
      this.backupCount = Object.keys(backup).length
    } catch {
      // ignore
    }
  }

  async restoreBackup(): Promise<void> {
    try {
      this.labels = await this.#plex.restoreAlbumLabelsBackup()
    } catch {
      // ignore
    }
  }

  async loadProgress(): Promise<void> {
    try {
      this.progress = await this.#plex.labelIndexProgress()
    } catch {
      // ignore
    }
  }

  // Index the whole library (rebuild=true wipes first; false fills gaps).
  async start(rebuild = false): Promise<void> {
    const albums = await this.#deps.ensureAllAlbums()
    const items = albums.map(albumToIndexItem)
    await this.#plex.startLabelIndex({ items, rebuild })
  }

  async stop(): Promise<void> {
    await this.#plex.stopLabelIndex()
  }

  // Re-index only the albums that came back with no labels last time.
  async retryEmpty(): Promise<void> {
    const albums = await this.#deps.ensureAllAlbums()
    const empties = new Set<string>()
    for (const [rk, arr] of Object.entries(this.labels)) {
      if (arr.length === 0) empties.add(rk)
    }
    const items = albums.filter((a) => empties.has(a.ratingKey)).map(albumToIndexItem)
    if (items.length === 0) return
    await this.#plex.startLabelIndex({ items, rebuild: true })
  }

  async clear(): Promise<void> {
    await this.#plex.clearAlbumLabels()
    this.labels = {}
    this.#deps.clearLabelFilters()
    void this.loadBackup()
  }
}
