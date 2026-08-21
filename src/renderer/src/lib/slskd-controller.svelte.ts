import type { MbReleaseCandidate, PlexAlbum } from '../../../shared/plex'
import type {
  SlskdAlbumCandidate,
  SlskdBrowseAlbum,
  SlskdDownloads,
  SlskdFile,
  SlskdHealth,
  SlskdSearchResult,
  SlskdSuccessfulPeer,
  SlskdUserBrowse
} from '../../../shared/slskd'
import {
  buildLibraryIndex,
  findAlbumInLibrary,
  stripEditionSuffix,
  type LibraryIndex
} from '../../../shared/title-match'
import { pickBestSingleFile } from '../../../shared/slskd-pick'
import { guessArtistAlbum, splitPath } from '../../../shared/slskd-folder'

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
  /**
   * Lazily load + cache the full Plex album library, used to flag search/queue
   * items the user already owns ("already in your library"). Optional; when
   * absent the ownership tells just never appear.
   */
  ensureAllAlbums?: () => Promise<PlexAlbum[]>
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
  tab = $state<'search' | 'downloads' | 'uploaders'>('search')
  downloads = $state<SlskdDownloads | null>(null)
  downloadsLoading = $state(false)
  downloadsError = $state<string | null>(null)
  downloadsFilter = $state<'all' | 'inProgress' | 'queued' | 'completed' | 'errored'>('all')
  successfulPeers = $state<SlskdSuccessfulPeer[]>([])
  peersLoading = $state(false)
  peersError = $state<string | null>(null)
  peerBrowse = $state<{
    username: string
    loading: boolean
    error: string | null
    result: SlskdUserBrowse | null
    enqueueStatus: Record<string, 'pending' | 'ok' | 'err'>
  } | null>(null)
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
  /** Full Plex library, lazily loaded on activate, for the "already owned" tell. */
  libraryAlbums = $state<PlexAlbum[] | null>(null)
  #libraryIndex = $derived(this.libraryAlbums ? buildLibraryIndex(this.libraryAlbums) : null)

  #deps: SlskdDeps
  #plex: PlexApi
  #slskd: SlskdApi
  #libraryLoading = false
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
    void this.#loadLibrary()
    void this.loadSuccessfulPeers()
    if (this.config?.url) this.startDownloadsPolling()
  }

  // Load the full Plex library once so search/queue items can be flagged as
  // already-owned. Best-effort and silent — if it fails the tells just don't show.
  async #loadLibrary(): Promise<void> {
    if (this.libraryAlbums || this.#libraryLoading || !this.#deps.ensureAllAlbums) return
    this.#libraryLoading = true
    try {
      this.libraryAlbums = await this.#deps.ensureAllAlbums()
    } catch {
      // leave libraryAlbums null — ownership tells stay hidden
    } finally {
      this.#libraryLoading = false
    }
  }

  /**
   * Return the user's existing Plex album for this artist/album (and optional
   * MB release mbid) if they already own it, else null. Drives the "already in
   * your library" tell in the search view. Reactive: re-runs once the library
   * finishes loading.
   */
  ownedAlbum(artist: string, album: string, mbid?: string | null): PlexAlbum | null {
    const index: LibraryIndex | null = this.#libraryIndex
    if (!index) return null
    return findAlbumInLibrary(index, artist, album, mbid)
  }

  deactivate(): void {
    this.stopDownloadsPolling()
  }

  // --- tab / filter ---

  setTab(tab: 'search' | 'downloads' | 'uploaders'): void {
    this.tab = tab
    if (tab === 'uploaders') void this.loadSuccessfulPeers()
  }

  async loadSuccessfulPeers(): Promise<void> {
    if (this.peersLoading) return
    this.peersLoading = true
    try {
      this.successfulPeers = await this.#slskd.listSuccessfulPeers()
      this.peersError = null
    } catch (err) {
      this.peersError = err instanceof Error ? err.message : String(err)
    } finally {
      this.peersLoading = false
    }
  }

  async browsePeer(username: string): Promise<void> {
    this.peerBrowse = {
      username,
      loading: true,
      error: null,
      result: null,
      enqueueStatus: {}
    }
    try {
      const result = await this.#slskd.browseUser({ username })
      if (this.peerBrowse?.username !== username) return
      this.peerBrowse = { ...this.peerBrowse, loading: false, result }
    } catch (err) {
      if (this.peerBrowse?.username !== username) return
      this.peerBrowse = {
        ...this.peerBrowse,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  openPeer(username: string): void {
    this.tab = 'uploaders'
    void this.browsePeer(username)
  }

  closePeerBrowse(): void {
    this.peerBrowse = null
  }

  async enqueueBrowseAlbum(album: SlskdBrowseAlbum): Promise<void> {
    const browse = this.peerBrowse
    if (!browse || browse.loading) return
    const key = album.folder
    this.peerBrowse = {
      ...browse,
      enqueueStatus: { ...browse.enqueueStatus, [key]: 'pending' }
    }
    try {
      const result = await this.#slskd.enqueue({
        username: browse.username,
        files: album.files.map((file) => ({ filename: file.filename, size: file.size })),
        intent: {
          artist: album.guessedArtist ?? browse.username,
          album: album.guessedAlbum ?? album.name,
          folder: album.folder,
          releaseMbid: null,
          expectedTrackCount: album.files.length,
          files: album.files.map((file) => ({
            filename: file.filename,
            size: file.size,
            durationSeconds: file.length
          }))
        }
      })
      if (this.peerBrowse?.username !== browse.username) return
      const status: 'ok' | 'err' = result.errors.length > 0 ? 'err' : 'ok'
      this.peerBrowse = {
        ...this.peerBrowse,
        enqueueStatus: { ...this.peerBrowse.enqueueStatus, [key]: status }
      }
      this.#deps.flashToast(
        status,
        status === 'ok'
          ? `Queued “${album.name}” from ${browse.username}`
          : `${result.errors.length} file(s) failed to queue`
      )
    } catch (err) {
      if (this.peerBrowse?.username !== browse.username) return
      this.peerBrowse = {
        ...this.peerBrowse,
        enqueueStatus: { ...this.peerBrowse.enqueueStatus, [key]: 'err' }
      }
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
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

  /**
   * From the downloads tab: re-run the album search for a directory whose
   * transfers went bad (rejected/errored) so a different uploader can be
   * picked. Artist/album come from the recorded acquisition job when we have
   * one (preserving any release override), falling back to guessing from the
   * remote folder name. The cached search result is dropped first so the
   * network is asked fresh instead of replaying the list that produced the
   * failing uploader.
   */
  searchAgainForDirectory(username: string, directory: string): void {
    const norm = (p: string) => p.replace(/[\\/]+$/, '')
    const dir = norm(directory)
    const job = (this.downloads?.acquisitions ?? []).find(
      (j) =>
        j.username === username &&
        (norm(j.folder) === dir || dir.endsWith(norm(j.folder)) || norm(j.folder).endsWith(dir))
    )
    let artist = job?.artist ?? null
    let album = job?.album ?? null
    if (!artist || !album) {
      // splitPath expects a file path; append a dummy leaf so the directory's
      // last segment is treated as the album folder.
      const guessed = guessArtistAlbum([...splitPath(directory), 'x'])
      artist = artist ?? guessed.artist
      album = album ?? guessed.album
    }
    if (!album) return
    const baseKey = slskdCacheKey(artist ?? '', album)
    for (const key of [...this.#searchCache.keys()]) {
      if (key === baseKey || key.startsWith(`${baseKey}\x00`)) this.#searchCache.delete(key)
    }
    this.tab = 'search'
    void this.runSearch(artist ?? '', album, job?.releaseMbid ?? undefined)
  }

  /**
   * How many files you currently have pending with a peer, from the live
   * downloads poll — lets search results show "you already have N queued
   * with this user" next to their free-slot/queued chip.
   */
  pendingWithPeer(username: string): { downloading: number; queued: number } {
    const u = this.downloads?.users.find((x) => x.username === username)
    if (!u) return { downloading: 0, queued: 0 }
    const queued = u.totalFiles - u.inProgressFiles - u.completedFiles - u.erroredFiles
    return { downloading: u.inProgressFiles, queued: Math.max(0, queued) }
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

  // Sweep every "Completed, Succeeded" transfer off slskd's list in one go.
  // The files themselves are long since on disk (and likely already filed) —
  // this is list hygiene, one bulk call per user.
  clearingSucceeded = $state(false)

  async clearSucceeded(): Promise<void> {
    const dl = this.downloads
    if (!dl || this.clearingSucceeded) return
    this.clearingSucceeded = true
    let removed = 0
    try {
      for (const u of dl.users) {
        const ids = u.directories
          .flatMap((d) => d.files)
          .filter((f) => f.state.includes('Succeeded'))
          .map((f) => f.id)
        if (ids.length === 0) continue
        try {
          const r = await this.#slskd.removeDownloadsBulk({ username: u.username, ids })
          removed += r.removed
        } catch {
          // one uploader failing shouldn't stop the sweep
        }
      }
      this.#deps.flashToast('ok', `Cleared ${removed} finished download${removed === 1 ? '' : 's'}`)
    } finally {
      this.clearingSucceeded = false
      void this.pollDownloads()
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
    if (url) this.startDownloadsPolling()
    else this.stopDownloadsPolling()
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

  // --- batch song queue ("queue all songs" over playlist gaps) ---

  // Progress + outcomes for the current/last batch. Outcomes are keyed
  // `${artist}|${title}` so gap rows can badge themselves.
  songBatch = $state<{ done: number; total: number; running: boolean } | null>(null)
  songBatchOutcome = $state<Record<string, 'queued' | 'none' | 'err'>>({})

  /**
   * Auto-acquire a list of songs: one slskd search per track (title-grade),
   * pure pickBestSingleFile chooses the file, single-file enqueue (no album
   * intent). Sequential on purpose — each search is its own slskd
   * lifecycle, and hammering the daemon with 16 concurrent searches is how
   * the API thread wedges. Skips songs already queued this session.
   */
  async queueSongs(
    items: { artist: string; title: string; durationMs: number | null }[]
  ): Promise<void> {
    if (this.songBatch?.running) return
    const todo = items.filter(
      (it) => this.songBatchOutcome[`${it.artist}|${it.title}`] !== 'queued'
    )
    this.songBatch = { done: 0, total: todo.length, running: true }
    let queued = 0
    let noMatch = 0
    let errored = 0
    let consecutiveErrors = 0
    let aborted = false
    for (const it of todo) {
      const key = `${it.artist}|${it.title}`
      try {
        // "- Remastered 2003"-style dash suffixes tank soulseek recall; the
        // picker's duration scoring protects precision on the loosened query.
        const query = stripEditionSuffix(it.title)
        const result = await this.#slskd.search({ artist: it.artist, album: query })
        const pick = pickBestSingleFile(it.title, it.durationMs, result.candidates)
        if (!pick) {
          noMatch++
          this.songBatchOutcome = { ...this.songBatchOutcome, [key]: 'none' }
        } else {
          const r = await this.#slskd.enqueue({
            username: pick.candidate.username,
            files: [{ filename: pick.file.filename, size: pick.file.size }]
          })
          const ok = r.errors.length === 0 && (r.accepted > 0 || r.alreadyInProgress > 0)
          this.songBatchOutcome = { ...this.songBatchOutcome, [key]: ok ? 'queued' : 'err' }
          if (ok) queued++
          else errored++
        }
        consecutiveErrors = 0
      } catch {
        errored++
        consecutiveErrors++
        this.songBatchOutcome = { ...this.songBatchOutcome, [key]: 'err' }
        // Three straight throws means slskd itself is down/disconnected —
        // grinding through the rest of the list would just fail them all.
        if (consecutiveErrors >= 3) {
          aborted = true
        }
      }
      if (!this.songBatch) break
      this.songBatch = { ...this.songBatch, done: this.songBatch.done + 1 }
      if (aborted) break
    }
    if (this.songBatch) this.songBatch = { ...this.songBatch, running: false }
    const parts: string[] = []
    if (noMatch > 0) parts.push(`${noMatch} had no good match`)
    if (errored > 0) parts.push(`${errored} failed`)
    this.#deps.flashToast(
      queued === todo.length ? 'ok' : 'err',
      aborted
        ? `Stopped — Soulseek isn't answering (is slskd connected?). Queued ${queued} of ${todo.length}.`
        : `Queued ${queued} of ${todo.length} song${todo.length === 1 ? '' : 's'}` +
            (parts.length > 0 ? ` — ${parts.join(', ')}` : '')
    )
  }

  // --- enqueue ---

  /**
   * Enqueue ONE file from a candidate folder — the "just the song" path for
   * playlist-gap filling. No AcquisitionIntent on purpose: intents describe
   * album-level jobs (expected track counts, MB release); a single track is
   * a plain download that lands in the inbox and gets tagged there.
   */
  async enqueueSingleFile(candidate: SlskdAlbumCandidate, file: SlskdFile): Promise<void> {
    const current = this.current
    if (!current) return
    const key = `${candidate.username}|${file.filename}`
    this.current = {
      ...current,
      enqueueStatus: { ...current.enqueueStatus, [key]: 'pending' }
    }
    try {
      const result = await this.#slskd.enqueue({
        username: candidate.username,
        files: [{ filename: file.filename, size: file.size }]
      })
      if (!this.current) return
      const status: 'ok' | 'err' = result.errors.length > 0 ? 'err' : 'ok'
      this.current = {
        ...this.current,
        enqueueStatus: { ...this.current.enqueueStatus, [key]: status },
        enqueueError: result.errors.length > 0 ? result.errors[0].error : this.current.enqueueError
      }
      if (status === 'ok') {
        const base = file.filename.split(/[\\/]/).pop() ?? file.filename
        this.#deps.flashToast('ok', `Queued “${base}” from ${candidate.username}`)
      }
    } catch (err) {
      if (!this.current) return
      this.current = {
        ...this.current,
        enqueueStatus: { ...this.current.enqueueStatus, [key]: 'err' },
        enqueueError: err instanceof Error ? err.message : String(err)
      }
    }
  }

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
        files: candidate.files.map((f) => ({ filename: f.filename, size: f.size })),
        intent: {
          artist: current.artist,
          album: current.album,
          folder: candidate.folder,
          releaseMbid: current.result?.release?.mbid ?? null,
          expectedTrackCount: current.result?.release?.expectedTrackCount ?? null,
          files: candidate.files.map((f) => ({
            filename: f.filename,
            size: f.size,
            durationSeconds: f.length
          }))
        }
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
