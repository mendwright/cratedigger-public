import type {
  SpotifyGap,
  SpotifyImportEntry,
  SpotifyImportReport,
  SpotifyPlaylistSummary,
  SpotifyStatus,
  SpotifyTrack
} from '../../../shared/spotify'
import { bestPlexMatch, plexQueryFor } from '../../../shared/spotify-match'
import { parsePlaylistFile, uniquifyNames, type ParsedPlaylist } from '../../../shared/playlist-file'
import type { PastedPlaylist } from '../../../shared/playlist-url'
import type { SingleFiledEvent } from '../../../shared/singles'

type PlexApi = Window['cratedigger']['plex']
type SpotifyApi = Window['cratedigger']['spotify']
type SinglesApi = Window['cratedigger']['singles']

/** How long after the last single lands before the playlist refills — the
 *  Singles section needs a moment to scan the new file, and a batch of
 *  grabs tends to finish in a cluster. */
const REFILL_DEBOUNCE_MS = 30_000

export interface SpotifyImportDeps {
  /** serverId + music sections to match against (active/album library
   *  first, then siblings like the Singles bin), or null while signed out. */
  context: () => { serverId: string; sectionKeys: string[] } | null
  /** Create/refill the destination Plex playlist. Injected from
   *  PlaylistsController so playlist bookkeeping stays in one place. */
  createPlaylist: (title: string, itemRatingKeys: string[]) => Promise<{ ratingKey: string } | null>
  replacePlaylist: (ratingKey: string, title: string, itemRatingKeys: string[]) => Promise<string>
  /** ratingKey of an existing manual Plex playlist with this exact name, or
   *  null. Lets a re-import whose report was lost adopt the original
   *  playlist instead of creating a same-named twin. */
  findPlaylistByName: (title: string) => string | null
  /** Is this ratingKey in the CURRENT account's playlist list? Guards the
   *  refill path against stale rks from before a Plex user switch. */
  playlistExists: (ratingKey: string) => boolean
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Auto-acquire a playlist's gaps off Soulseek (private build). Each
   *  enqueued file is registered as a pending single for `playlistId` so
   *  main can file it into the Singles bin when it lands. Absent in the
   *  public build — the paste flow then stops at the gap report. */
  grabGaps?: (playlistId: string, gaps: SpotifyGap[]) => Promise<void>
  plex?: PlexApi
  spotify?: SpotifyApi
  singles?: SinglesApi
}

export interface ImportProgress {
  playlistId: string
  name: string
  done: number
  total: number
}

/**
 * Spotify playlist import: connect (PKCE in main), browse playlists, and
 * import — each track is matched against Plex search (spotify-match scoring);
 * hits land in a real Plex playlist, misses become the persisted gap report.
 * Re-importing the same playlist refills the same Plex playlist, so gaps
 * filled by later acquisitions slot in on the next run.
 */
export class SpotifyImportController {
  status = $state<SpotifyStatus>({ configured: false, connected: false })
  connecting = $state(false)
  playlists = $state<SpotifyPlaylistSummary[]>([])
  playlistsLoading = $state(false)
  error = $state<string | null>(null)
  progress = $state<ImportProgress | null>(null)
  reports = $state<SpotifyImportReport[]>([])
  // Playlists parsed from export files (Exportify CSV / data-export JSON) —
  // the no-API path since Spotify put dev-mode behind Premium (Feb 2026).
  // Backed by a remembered folder re-read on every activate (a reload once
  // ate 404 session-only file picks); one-off file picks layer on top.
  filePlaylists = $state<ParsedPlaylist[]>([])
  importDir = $state<string | null>(null)
  // Playlists read from the local Music.app library (macOS Apple Events) —
  // covers Apple Music cloud playlists once Sync Library has pulled them.
  applePlaylists = $state<{ id: string; name: string; trackCount: number }[]>([])
  appleLoading = $state(false)
  appleError = $state<string | null>(null)
  // "Paste a playlist": the resolved paste waiting for the user to confirm
  // (name it, decide on the grab) — a link is fetched the moment it's
  // pasted so the count shows before anything is created.
  pasted = $state<PastedPlaylist | null>(null)
  pasteBusy = $state(false)
  pasteError = $state<string | null>(null)
  /** Playlists waiting on their refill timer after a single landed. */
  refillPending = $state<Record<string, true>>({})

  #deps: SpotifyImportDeps
  private plex: PlexApi
  private spotify: SpotifyApi
  private singles: SinglesApi
  private refillTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(deps: SpotifyImportDeps) {
    this.#deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
    this.spotify = deps.spotify ?? window.cratedigger.spotify
    this.singles = deps.singles ?? window.cratedigger.singles
  }

  /**
   * Listen for gap grabs landing in the Singles bin and refill their
   * playlist a beat later. Returns the unsubscribe; the host owns the
   * lifetime. Each playlist gets one timer, pushed back by every new single
   * so a batch refills once, not N times.
   */
  subscribeSingles(): () => void {
    const detach = this.singles.onFiled((ev: SingleFiledEvent) => {
      this.#deps.flashToast('ok', `Filed “${ev.title}” to Singles`)
      this.scheduleRefill(ev.playlistId)
    })
    return () => {
      detach()
      for (const t of this.refillTimers.values()) clearTimeout(t)
      this.refillTimers.clear()
      this.refillPending = {}
    }
  }

  private scheduleRefill(playlistId: string): void {
    const prior = this.refillTimers.get(playlistId)
    if (prior) clearTimeout(prior)
    this.refillPending = { ...this.refillPending, [playlistId]: true }
    this.refillTimers.set(
      playlistId,
      setTimeout(() => {
        this.refillTimers.delete(playlistId)
        const { [playlistId]: _gone, ...rest } = this.refillPending
        this.refillPending = rest
        const report = this.reportFor(playlistId)
        if (!report) return
        if (this.progress) {
          // Something else is importing — try again after it.
          this.scheduleRefill(playlistId)
          return
        }
        void this.reimport(report)
      }, REFILL_DEBOUNCE_MS)
    )
  }

  async activate(): Promise<void> {
    try {
      this.status = await this.spotify.status()
      this.reports = await this.spotify.getImportReports()
    } catch {
      // status stays disconnected; the connect card shows setup steps
    }
    void this.refreshImportFolder()
    if (this.status.connected && this.playlists.length === 0) void this.loadPlaylists()
  }

  private adoptFolder(res: { dir: string | null; playlists: ParsedPlaylist[] }): void {
    this.importDir = res.dir
    if (res.playlists.length === 0) return
    const names = new Set(res.playlists.map((p) => p.name))
    // Folder wins over stale session entries of the same name.
    this.filePlaylists = [...res.playlists, ...this.filePlaylists.filter((p) => !names.has(p.name))]
  }

  async refreshImportFolder(): Promise<void> {
    try {
      this.adoptFolder(await this.spotify.loadImportFolder())
    } catch {
      // remembered folder unreadable — panel just shows the pick button
    }
  }

  async pickImportFolder(): Promise<void> {
    try {
      this.adoptFolder(await this.spotify.pickImportFolder())
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async setClientId(id: string): Promise<void> {
    await this.spotify.setClientId(id)
    this.status = await this.spotify.status()
  }

  async connect(): Promise<void> {
    this.connecting = true
    this.error = null
    try {
      await this.spotify.connect()
      this.status = await this.spotify.status()
      await this.loadPlaylists()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.connecting = false
    }
  }

  async disconnect(): Promise<void> {
    await this.spotify.disconnect()
    this.status = await this.spotify.status()
    this.playlists = []
  }

  async loadPlaylists(): Promise<void> {
    this.playlistsLoading = true
    this.error = null
    try {
      this.playlists = await this.spotify.listPlaylists()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.playlistsLoading = false
    }
  }

  reportFor(playlistId: string): SpotifyImportReport | null {
    return this.reports.find((r) => r.playlistId === playlistId) ?? null
  }

  // $state proxies aren't structured-cloneable — EVERY level must be
  // plained before IPC, including each gap object. Shallow-copying only the
  // top made setImportReports throw and reports silently never persisted.
  private plainReports(): SpotifyImportReport[] {
    return this.reports.map((r) => ({
      ...r,
      gaps: r.gaps.map((g) => ({ ...g })),
      entries: r.entries?.map((entry) => ({ ...entry }))
    }))
  }

  /** Import via the live API (needs a connected account). */
  async importPlaylist(summary: SpotifyPlaylistSummary): Promise<void> {
    if (this.progress) return // one import at a time
    this.progress = { playlistId: summary.id, name: summary.name, done: 0, total: summary.trackCount }
    this.error = null
    try {
      const tracks = await this.spotify.getPlaylistTracks({ id: summary.id })
      await this.importTracks(summary.id, summary.name, tracks)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', this.error)
    } finally {
      this.progress = null
    }
  }

  /** Parse a picked Exportify CSV or Spotify data-export JSON into the
   *  session list. Returns how many playlists the file yielded. */
  addFile(text: string, filename: string): number {
    const parsed = parsePlaylistFile(text, filename)
    if (parsed.length === 0) {
      this.#deps.flashToast('err', `Nothing importable in ${filename}`)
      return 0
    }
    // Replace same-named entries so re-dropping an updated export wins;
    // uniquify the merged list (Spotify allows duplicate playlist names).
    const names = new Set(parsed.map((p) => p.name))
    this.filePlaylists = uniquifyNames([
      ...this.filePlaylists.filter((p) => !names.has(p.name)),
      ...parsed
    ])
    return parsed.length
  }

  /** Enumerate Music.app user playlists (first call may show the macOS
   *  Automation consent prompt and launch Music). */
  async loadApplePlaylists(): Promise<void> {
    this.appleLoading = true
    this.appleError = null
    try {
      this.applePlaylists = await window.cratedigger.appleMusic.listPlaylists()
      if (this.applePlaylists.length === 0) {
        this.appleError =
          'Music.app has no user playlists — sign into Apple Music there with Sync Library on'
      }
    } catch (err) {
      this.appleError = err instanceof Error ? err.message : String(err)
    } finally {
      this.appleLoading = false
    }
  }

  /** Import a Music.app playlist. Keyed by persistent ID so re-imports
   *  refill the same Plex playlist. */
  async importFromApple(pl: { id: string; name: string; trackCount: number }): Promise<void> {
    if (this.progress) return
    const id = `apple:${pl.id}`
    this.progress = { playlistId: id, name: pl.name, done: 0, total: pl.trackCount }
    this.error = null
    try {
      const tracks = await window.cratedigger.appleMusic.getPlaylistTracks({ id: pl.id })
      await this.importTracks(id, pl.name, tracks)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', this.error)
    } finally {
      this.progress = null
    }
  }

  /** Import a file-parsed playlist. Keyed `file:<name>` so a re-drop of the
   *  same playlist refills the same Plex playlist. */
  async importFromFile(pl: ParsedPlaylist): Promise<void> {
    if (this.progress) return
    const id = `file:${pl.name}`
    this.progress = { playlistId: id, name: pl.name, done: 0, total: pl.tracks.length }
    this.error = null
    try {
      await this.importTracks(id, pl.name, pl.tracks)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', this.error)
    } finally {
      this.progress = null
    }
  }

  /**
   * "Paste a playlist", step one: resolve whatever was pasted into a
   * reviewable list. Links are fetched now (main reads the service's public
   * page) so the song count is on screen before anything gets created;
   * Artist - Title lines parse locally and arrive nameless.
   */
  async previewPaste(text: string): Promise<void> {
    if (this.pasteBusy) return
    this.pasteBusy = true
    this.pasteError = null
    this.pasted = null
    try {
      this.pasted = await this.spotify.fetchPasted(text)
    } catch (err) {
      this.pasteError = (err instanceof Error ? err.message : String(err))
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^Error:\s*/, '')
    } finally {
      this.pasteBusy = false
    }
  }

  clearPaste(): void {
    this.pasted = null
    this.pasteError = null
  }

  /**
   * Step two: import the reviewed paste under `name`, then — when asked and
   * the host wired a grabber — queue every gap off Soulseek. Links are keyed
   * by their canonical URL so pasting the same list again refills the same
   * Plex playlist; text lists are keyed by name and re-import from the
   * report's own entries.
   */
  async importPasted(name: string, grab: boolean): Promise<void> {
    const pl = this.pasted
    if (!pl || this.progress) return
    const title = name.trim() || pl.name || 'Pasted playlist'
    const id = pl.url ? `url:${pl.url}` : `paste:${title}`
    this.progress = { playlistId: id, name: title, done: 0, total: pl.tracks.length }
    this.error = null
    let report: SpotifyImportReport | null = null
    try {
      report = await this.importTracks(id, title, pl.tracks)
      this.pasted = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', this.error)
    } finally {
      this.progress = null
    }
    if (report && grab && report.gaps.length > 0 && this.#deps.grabGaps) {
      await this.#deps.grabGaps(id, report.gaps)
    }
  }

  /**
   * The shared core: match every track against Plex, write the destination
   * playlist, persist the gap report. Sequential search per track — an
   * N-way fanout of /hubs/search against a swap-bound PMS is how you wedge
   * it; ~3–4 tracks/s in practice.
   */
  private async importTracks(
    playlistId: string,
    name: string,
    tracks: SpotifyTrack[]
  ): Promise<SpotifyImportReport> {
    const ctx = this.#deps.context()
    if (!ctx) throw new Error('Not signed in to Plex')
    this.progress = { playlistId, name, done: 0, total: tracks.length }

    const matched: string[] = []
    const gaps: SpotifyGap[] = []
    const entries: SpotifyImportEntry[] = []
    for (const t of tracks) {
      let hit: ReturnType<typeof bestPlexMatch> = null
      // Album library first, then sibling sections (the Singles bin) — a
      // single only fills a gap the crate can't.
      //
      // The search UI's 12-per-hub cap is far too tight here: the query is
      // title-only, so a common title is crowded out by same-named songs
      // and whole albums by same-named bands (George Michael's "Faith" lost
      // to a hardcore band called Faith and read as a gap). 50 is cheap and
      // the scorer rejects the noise.
      for (const sectionKey of ctx.sectionKeys) {
        try {
          const results = await this.plex.searchLibrary({
            serverId: ctx.serverId,
            sectionKey,
            query: plexQueryFor(t),
            limit: 50
          })
          hit = bestPlexMatch(t, results.tracks)
          if (hit) break
        } catch {
          // One search failing shouldn't sink the import — keep trying the
          // other sections; unresolved tracks become gaps a re-import retries.
        }
      }
      const source = { artist: t.artist, title: t.title, album: t.album, durationMs: t.durationMs }
      if (hit) {
        matched.push(hit.track.ratingKey)
        entries.push({ ...source, matchedRatingKey: hit.track.ratingKey })
      } else {
        gaps.push(source)
        entries.push({ ...source, matchedRatingKey: null })
      }
      this.progress = { ...this.progress!, done: this.progress!.done + 1 }
    }

    // Write into the same Plex playlist a previous import created (refill),
    // or create it. Named after the source list. When the report is gone
    // (lost store, other machine) but a same-named playlist exists, adopt
    // and refill it rather than creating a twin.
    //
    // The stored ratingKey is only trusted if the CURRENT account can see
    // that playlist in its own list. Plex playlists are per-account, but an
    // owner/admin token can still write another user's playlist by rk — so
    // after a user switch a blind adopt "succeeds" into a playlist the
    // signed-in user can never see. Stale rk → adopt by name → create.
    const prior = this.reportFor(playlistId)
    const priorRk = prior?.plexRatingKey ?? null
    const adopt =
      priorRk && this.#deps.playlistExists(priorRk)
        ? priorRk
        : this.#deps.findPlaylistByName(name)
    let plexRatingKey: string
    if (adopt) {
      plexRatingKey = await this.#deps.replacePlaylist(adopt, name, matched)
    } else {
      const created = await this.#deps.createPlaylist(name, matched)
      if (!created) throw new Error('Could not create the Plex playlist')
      plexRatingKey = created.ratingKey
    }

    const report: SpotifyImportReport = {
      playlistId,
      name,
      plexRatingKey,
      importedAt: Date.now(),
      total: tracks.length,
      matchedCount: matched.length,
      gaps,
      entries
    }
    this.reports = [...this.reports.filter((r) => r.playlistId !== playlistId), report]
    await this.spotify.setImportReports(this.plainReports())
    this.#deps.flashToast(
      'ok',
      gaps.length === 0
        ? `“${name}”: all ${matched.length} tracks matched`
        : `“${name}”: ${matched.length}/${tracks.length} matched — ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`
    )
    return report
  }

  /**
   * Re-run an import from its persisted report — the playlist-detail
   * "re-import" button. Resolves the source by the report's id prefix
   * (file: / apple: / live Spotify) from whatever this session has loaded.
   */
  async reimport(report: SpotifyImportReport): Promise<void> {
    if (this.progress) return
    const id = report.playlistId
    if (id.startsWith('url:') || id.startsWith('paste:')) {
      await this.reimportPasted(report)
      return
    }
    if (id.startsWith('file:')) {
      const name = id.slice('file:'.length)
      let pl = this.filePlaylists.find((p) => p.name === name)
      if (!pl) {
        // Fresh boot with the panel never opened — the remembered export
        // folder hasn't been read yet. Load it before giving up.
        await this.refreshImportFolder()
        pl = this.filePlaylists.find((p) => p.name === name)
      }
      if (!pl) {
        this.#deps.flashToast('err', `“${name}” isn't in the export folder — open the import panel`)
        return
      }
      await this.importFromFile(pl)
      return
    }
    if (id.startsWith('apple:')) {
      const appleId = id.slice('apple:'.length)
      let pl = this.applePlaylists.find((p) => p.id === appleId)
      if (!pl) {
        await this.loadApplePlaylists()
        pl = this.applePlaylists.find((p) => p.id === appleId)
      }
      if (!pl) {
        this.#deps.flashToast('err', 'Playlist not found in Music.app anymore')
        return
      }
      await this.importFromApple(pl)
      return
    }
    let summary = this.playlists.find((p) => p.id === id)
    if (!summary && this.status.connected) {
      await this.loadPlaylists()
      summary = this.playlists.find((p) => p.id === id)
    }
    if (!summary) {
      this.#deps.flashToast('err', 'Playlist not found on Spotify — connect or use the export file')
      return
    }
    await this.importPlaylist(summary)
  }

  /**
   * Pasted sources re-import from what the report remembers: a link is
   * fetched afresh (so edits to the source list come through), falling back
   * to the stored entries if the page is unreachable; a text list only ever
   * has its entries.
   */
  private async reimportPasted(report: SpotifyImportReport): Promise<void> {
    const id = report.playlistId
    const fromEntries = (): SpotifyTrack[] | null =>
      report.entries?.map((e) => ({
        artist: e.artist,
        title: e.title,
        album: e.album,
        durationMs: e.durationMs,
        isLocal: false
      })) ?? null
    let tracks: SpotifyTrack[] | null = null
    if (id.startsWith('url:')) {
      try {
        tracks = (await this.spotify.fetchPasted(id.slice('url:'.length))).tracks
      } catch (err) {
        tracks = fromEntries()
        if (!tracks) {
          this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
          return
        }
      }
    } else {
      tracks = fromEntries()
    }
    if (!tracks) {
      this.#deps.flashToast('err', `“${report.name}” has no saved track list — paste it again`)
      return
    }
    this.progress = { playlistId: id, name: report.name, done: 0, total: tracks.length }
    this.error = null
    try {
      await this.importTracks(id, report.name, tracks)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', this.error)
    } finally {
      this.progress = null
    }
  }

  async removeReport(playlistId: string): Promise<void> {
    this.reports = this.reports.filter((r) => r.playlistId !== playlistId)
    await this.spotify.setImportReports(this.plainReports())
    if (this.#deps.grabGaps) {
      // Private build only — the handler isn't registered in the public one.
      void this.singles.forget(playlistId).catch(() => {})
    }
  }
}
