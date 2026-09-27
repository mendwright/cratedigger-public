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

type PlexApi = Window['cratedigger']['plex']
type SpotifyApi = Window['cratedigger']['spotify']

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
  plex?: PlexApi
  spotify?: SpotifyApi
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

  #deps: SpotifyImportDeps
  private plex: PlexApi
  private spotify: SpotifyApi

  constructor(deps: SpotifyImportDeps) {
    this.#deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
    this.spotify = deps.spotify ?? window.cratedigger.spotify
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
   * The shared core: match every track against Plex, write the destination
   * playlist, persist the gap report. Sequential search per track — an
   * N-way fanout of /hubs/search against a swap-bound PMS is how you wedge
   * it; ~3–4 tracks/s in practice.
   */
  private async importTracks(
    playlistId: string,
    name: string,
    tracks: SpotifyTrack[]
  ): Promise<void> {
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
      for (const sectionKey of ctx.sectionKeys) {
        try {
          const results = await this.plex.searchLibrary({
            serverId: ctx.serverId,
            sectionKey,
            query: plexQueryFor(t)
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
  }

  /**
   * Re-run an import from its persisted report — the playlist-detail
   * "re-import" button. Resolves the source by the report's id prefix
   * (file: / apple: / live Spotify) from whatever this session has loaded.
   */
  async reimport(report: SpotifyImportReport): Promise<void> {
    if (this.progress) return
    const id = report.playlistId
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

  async removeReport(playlistId: string): Promise<void> {
    this.reports = this.reports.filter((r) => r.playlistId !== playlistId)
    await this.spotify.setImportReports(this.plainReports())
  }
}
