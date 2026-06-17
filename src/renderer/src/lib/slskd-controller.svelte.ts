import type { MbReleaseCandidate } from '../../../shared/plex'
import type {
  SlskdAlbumCandidate,
  SlskdDownloads,
  SlskdHealth,
  SlskdSearchResult
} from '../../../shared/slskd'

type PlexApi = Window['cratedigger']['plex']
type SlskdApi = Window['cratedigger']['slskd']

export type SlskdQueueItem = {
  artist: string
  album: string
  status: 'pending' | 'enqueued' | 'skipped'
}

/**
 * Parse a pasted "Artist - Album" list into queue items. Pure; exported for testing.
 *
 * Accept hyphen / en-dash / em-dash. Strict form is " - " (space on both
 * sides). Fall back to "Club- Infants" (no space on left, space on right) so
 * sloppy paste still parses. Dashes with no surrounding space at all (e.g.
 * "Glenn-Copeland") still get ignored — those are hyphenated names. Lazy left
 * side picks the FIRST separator so further dashes in the album title stay intact.
 */
export function parseSlskdList(text: string): SlskdQueueItem[] {
  const STRICT = /^(.+?)\s+[-–—]\s+(.+)$/
  const LOOSE = /^(.+?)[-–—]\s+(.+)$/
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const queue: SlskdQueueItem[] = []
  for (const line of lines) {
    const m = STRICT.exec(line) ?? LOOSE.exec(line)
    if (!m) continue
    const artist = m[1].trim()
    const album = m[2].trim()
    if (!artist || !album) continue
    queue.push({ artist, album, status: 'pending' })
  }
  return queue
}

/** Normalized memo-cache key for a search. Pure; exported for testing. */
export function slskdCacheKey(artist: string, album: string): string {
  return `${artist.toLowerCase().trim()}\u0000${album.toLowerCase().trim()}`
}

export interface SlskdDeps {
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Plex IPC (used only for the release picker's MB candidate search). */
  plex?: PlexApi
  /** Slskd IPC. Defaults to the live bridge; tests pass a stub. */
  slskd?: SlskdApi
}

/**
 * The Soulseek (slskd) download client, extracted from PlexState. Owns the
 * server {@link config}/{@link health}, the search-queue workflow ({@link queue}
 * + {@link current} + a prefetch-window memo cache), the MB {@link releasePicker}
 * override modal, and the live {@link downloads} list (2.5s poll). The actual
 * slskd calls happen in main; this drives them. Components read `plexState.slskd.*`.
 *
 * View orchestration (openSlskd/closeSlskd) stays on PlexState and calls
 * {@link activate}/{@link deactivate}.
 */
export class SlskdController {
  config = $state<{ url: string; apiKey: string } | null>(null)
  health = $state<SlskdHealth | null>(null)
  tab = $state<'search' | 'downloads'>('search')
  downloads = $state<SlskdDownloads | null>(null)
  downloadsLoading = $state(false)
  downloadsError = $state<string | null>(null)
  downloadsFilter = $state<'all' | 'inProgress' | 'queued' | 'completed' | 'errored'>('all')
  queue = $state<SlskdQueueItem[]>([])
  queueSearchProgress = $state<{ started: number; done: number; failed: number }>({
    started: 0,
    done: 0,
    failed: 0
  })
  queueIndex = $state<number>(-1)
  current = $state<{
    artist: string
    album: string
    loading: boolean
    error: string | null
    result: SlskdSearchResult | null
    enqueueingFolder: string | null
    enqueueStatus: Record<string, 'pending' | 'ok' | 'err'>
    enqueueError: string | null
  } | null>(null)
  releasePicker = $state<{
    artist: string
    album: string
    query: { artist: string; title: string }
    candidates: MbReleaseCandidate[]
    loading: boolean
    error: string | null
    submitting: boolean
  } | null>(null)

  #deps: SlskdDeps
  #plex: PlexApi
  #slskd: SlskdApi
  #downloadsTimer: ReturnType<typeof setInterval> | null = null
  #downloadsInFlight = false
  #searchSeq = 0
  #searchCache = new Map<string, Promise<SlskdSearchResult>>()
  // Prefetch a small window of upcoming queue items so results are ready when
  // the user clicks through. Searches serialize on the slskd-single-operation
  // mutex in the main process.
  readonly #prefetchWindow = 6

  constructor(deps: SlskdDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
    this.#slskd = deps.slskd ?? window.cratedigger.slskd
  }

  // --- lifecycle (driven by PlexState's view-flip wrappers) ---

  async ensureConfigLoaded(): Promise<void> {
    if (this.config) return
    try {
      this.config = await this.#slskd.getConfig()
    } catch {
      this.config = { url: '', apiKey: '' }
    }
  }

  async activate(): Promise<void> {
    await this.ensureConfigLoaded()
    void this.refreshHealth()
    this.startDownloadsPolling()
  }

  deactivate(): void {
    this.stopDownloadsPolling()
  }

  // --- tab / filter ---

  setTab(tab: 'search' | 'downloads'): void {
    this.tab = tab
  }

  setDownloadsFilter(f: 'all' | 'inProgress' | 'queued' | 'completed' | 'errored'): void {
    this.downloadsFilter = this.downloadsFilter === f ? 'all' : f
  }

  // --- downloads polling ---

  startDownloadsPolling(): void {
    if (this.#downloadsTimer !== null) return
    void this.pollDownloads()
    this.#downloadsTimer = setInterval(() => void this.pollDownloads(), 2500)
  }

  stopDownloadsPolling(): void {
    if (this.#downloadsTimer !== null) {
      clearInterval(this.#downloadsTimer)
      this.#downloadsTimer = null
    }
  }

  async pollDownloads(): Promise<void> {
    if (this.#downloadsInFlight) return
    this.#downloadsInFlight = true
    if (this.downloads === null) this.downloadsLoading = true
    try {
      this.downloads = await this.#slskd.listDownloads()
      this.downloadsError = null
    } catch (err) {
      this.downloadsError = err instanceof Error ? err.message : String(err)
    } finally {
      this.#downloadsInFlight = false
      this.downloadsLoading = false
    }
  }

  // After a successful tagger /apply, the inbox folder has been moved into the
  // library and the matching slskd entries are dead history. Find any slskd
  // folder whose leaf basename equals `folderName` and bulk-remove its files.
  // Best-effort: silent on any failure (slskd unreachable, no match). Public so
  // the Inbox controller can fire it post-apply.
  async removeDownloadsByFolder(folderName: string): Promise<void> {
    if (!folderName) return
    try {
      const dl = await this.#slskd.listDownloads()
      for (const u of dl.users) {
        for (const d of u.directories) {
          if (d.files.length === 0) continue
          const parts = d.directory.split(/[\\/]/).filter(Boolean)
          const leaf = parts[parts.length - 1] ?? d.directory
          if (leaf !== folderName) continue
          await this.#slskd
            .removeDownloadsBulk({ username: u.username, ids: d.files.map((f) => f.id) })
            .catch(() => undefined)
        }
      }
    } catch {
      // slskd unreachable or otherwise unavailable — drop silently.
    }
  }

  async removeFile(username: string, id: string): Promise<void> {
    try {
      await this.#slskd.removeDownload({ username, id })
    } catch (err) {
      this.downloadsError = err instanceof Error ? err.message : String(err)
    }
    void this.pollDownloads()
  }

  async retryFile(username: string, id: string, filename: string, size: number): Promise<void> {
    try {
      await this.#slskd.retryDownload({ username, id, filename, size })
    } catch (err) {
      this.downloadsError = err instanceof Error ? err.message : String(err)
    }
    void this.pollDownloads()
  }

  async removeDirectory(username: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    try {
      await this.#slskd.removeDownloadsBulk({ username, ids })
    } catch (err) {
      this.downloadsError = err instanceof Error ? err.message : String(err)
    }
    void this.pollDownloads()
  }

  async retryDirectory(
    username: string,
    files: { id: string; filename: string; size: number }[]
  ): Promise<void> {
    if (files.length === 0) return
    try {
      await this.#slskd.retryDownloadsBulk({ username, files })
    } catch (err) {
      this.downloadsError = err instanceof Error ? err.message : String(err)
    }
    void this.pollDownloads()
  }

  // --- config / health ---

  async refreshHealth(): Promise<void> {
    try {
      this.health = await this.#slskd.health()
    } catch (err) {
      this.health = {
        ok: false,
        url: this.config?.url ?? '',
        reachable: false,
        version: null,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async saveConfig(url: string, apiKey: string): Promise<void> {
    await this.#slskd.setConfig({ url, apiKey })
    this.config = { url, apiKey }
    void this.refreshHealth()
  }

  // --- search queue ---

  #bumpSearchProgress(field: 'started' | 'done' | 'failed'): void {
    const p = this.queueSearchProgress
    this.queueSearchProgress = { ...p, [field]: p[field] + 1 }
  }

  parseList(text: string): void {
    const queue = parseSlskdList(text)
    this.queue = queue
    this.queueIndex = queue.length > 0 ? 0 : -1
    this.queueSearchProgress = { started: 0, done: 0, failed: 0 }
    if (queue.length > 0) {
      void this.runSearch(queue[0].artist, queue[0].album)
    } else {
      this.current = null
    }
  }

  clearQueue(): void {
    this.queue = []
    this.queueIndex = -1
    this.current = null
    this.#searchCache.clear()
    this.queueSearchProgress = { started: 0, done: 0, failed: 0 }
  }

  goToQueueItem(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queueIndex = index
    const item = this.queue[index]
    void this.runSearch(item.artist, item.album)
  }

  nextQueueItem(): void {
    const next = this.queueIndex + 1
    if (next >= this.queue.length) return
    this.goToQueueItem(next)
  }

  markCurrentItem(status: 'enqueued' | 'skipped'): void {
    const i = this.queueIndex
    if (i < 0 || i >= this.queue.length) return
    const next = [...this.queue]
    next[i] = { ...next[i], status }
    this.queue = next
  }

  #ensureSearch(
    artist: string,
    album: string,
    preferredReleaseMbid?: string
  ): Promise<SlskdSearchResult> {
    const baseKey = slskdCacheKey(artist, album)
    const key = preferredReleaseMbid ? `${baseKey}\x00${preferredReleaseMbid}` : baseKey
    const hit = this.#searchCache.get(key)
    if (hit) return hit
    this.#bumpSearchProgress('started')
    const promise = this.#slskd.search({ artist, album, preferredReleaseMbid })
    this.#searchCache.set(key, promise)
    promise.then(
      () => this.#bumpSearchProgress('done'),
      () => {
        this.#bumpSearchProgress('failed')
        // Don't cache failures — let the next visit retry.
        if (this.#searchCache.get(key) === promise) this.#searchCache.delete(key)
      }
    )
    return promise
  }

  #prefetchAround(startIndex: number): void {
    if (startIndex < 0) return
    const end = Math.min(this.queue.length, startIndex + this.#prefetchWindow)
    for (let i = startIndex; i < end; i++) {
      const item = this.queue[i]
      if (!item) continue
      void this.#ensureSearch(item.artist, item.album).catch(() => undefined)
    }
  }

  async runSearch(artist: string, album: string, preferredReleaseMbid?: string): Promise<void> {
    const seq = ++this.#searchSeq
    this.current = {
      artist,
      album,
      loading: true,
      error: null,
      result: null,
      enqueueingFolder: null,
      enqueueStatus: {},
      enqueueError: null
    }
    // Kick off prefetch for current + next N-1 queued items. If this search was
    // triggered outside the queue (manual), idx is -1 and nothing happens.
    // Prefetches use the default (no override) key so they don't collide.
    if (!preferredReleaseMbid) {
      const key = slskdCacheKey(artist, album)
      const idx = this.queue.findIndex((q) => slskdCacheKey(q.artist, q.album) === key)
      if (idx >= 0) this.#prefetchAround(idx)
    }
    try {
      const result = await this.#ensureSearch(artist, album, preferredReleaseMbid)
      if (seq !== this.#searchSeq) return
      this.current = {
        ...this.current,
        loading: false,
        result
      }
    } catch (err) {
      if (seq !== this.#searchSeq) return
      this.current = {
        ...this.current,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  // --- MB release-override picker ---

  openReleasePicker(): void {
    const current = this.current
    if (!current) return
    this.releasePicker = {
      artist: current.artist,
      album: current.album,
      query: { artist: current.artist, title: current.album },
      candidates: [],
      loading: true,
      error: null,
      submitting: false
    }
    void this.runReleasePickerSearch()
  }

  // Entry point from BrowserPane / Shows: seed current so the picker has
  // artist/album immediately, open the picker (it shows its own spinner), and
  // kick the underlying slskd search in the background.
  searchSoulseekFor(artist: string, album: string): void {
    this.current = {
      artist,
      album,
      loading: true,
      error: null,
      result: null,
      enqueueingFolder: null,
      enqueueStatus: {},
      enqueueError: null
    }
    this.openReleasePicker()
    void this.runSearch(artist, album)
  }

  closeReleasePicker(): void {
    this.releasePicker = null
  }

  setReleasePickerQuery(artist: string, title: string): void {
    if (!this.releasePicker) return
    this.releasePicker = {
      ...this.releasePicker,
      query: { artist, title }
    }
  }

  async runReleasePickerSearch(): Promise<void> {
    const state = this.releasePicker
    if (!state) return
    this.releasePicker = { ...state, loading: true, error: null }
    try {
      const results = await this.#plex.searchReleaseCandidates({
        artist: state.query.artist,
        title: state.query.title
      })
      if (
        this.releasePicker &&
        this.releasePicker.artist === state.artist &&
        this.releasePicker.album === state.album
      ) {
        this.releasePicker = {
          ...this.releasePicker,
          candidates: results,
          loading: false
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.releasePicker) {
        this.releasePicker = { ...this.releasePicker, error: msg, loading: false }
      }
    }
  }

  async confirmReleasePicker(mbReleaseMbid: string): Promise<void> {
    const state = this.releasePicker
    if (!state) return
    this.releasePicker = { ...state, submitting: true, error: null }
    // Fire-and-forget the re-search; close the modal immediately so the user
    // sees the loading spinner in the search view.
    this.releasePicker = null
    await this.runSearch(state.artist, state.album, mbReleaseMbid)
  }

  // --- enqueue ---

  async enqueueCandidate(candidate: SlskdAlbumCandidate): Promise<void> {
    const current = this.current
    if (!current) return
    const key = `${candidate.username}|${candidate.folder}`
    this.current = {
      ...current,
      enqueueingFolder: key,
      enqueueError: null,
      enqueueStatus: { ...current.enqueueStatus, [key]: 'pending' }
    }
    try {
      const result = await this.#slskd.enqueue({
        username: candidate.username,
        files: candidate.files.map((f) => ({ filename: f.filename, size: f.size }))
      })
      if (!this.current) return
      const status: 'ok' | 'err' = result.errors.length > 0 ? 'err' : 'ok'
      this.current = {
        ...this.current,
        enqueueingFolder: null,
        enqueueStatus: { ...this.current.enqueueStatus, [key]: status },
        enqueueError:
          result.errors.length > 0
            ? `${result.errors.length} file(s) failed: ${result.errors[0].error}`
            : null
      }
      if (status === 'ok') {
        this.markCurrentItem('enqueued')
        this.#deps.flashToast(
          'ok',
          `Queued ${result.accepted} file(s) from ${candidate.username}` +
            (result.alreadyInProgress ? ` (${result.alreadyInProgress} already in progress)` : '')
        )
      } else {
        this.#deps.flashToast('err', `Some files failed to enqueue`)
      }
    } catch (err) {
      if (!this.current) return
      const msg = err instanceof Error ? err.message : String(err)
      this.current = {
        ...this.current,
        enqueueingFolder: null,
        enqueueStatus: { ...this.current.enqueueStatus, [key]: 'err' },
        enqueueError: msg
      }
      this.#deps.flashToast('err', msg)
    }
  }
}
