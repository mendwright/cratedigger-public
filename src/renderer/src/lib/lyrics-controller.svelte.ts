import type { AlbumDetail, LyricsResult } from '../../../shared/plex'

type PlexApi = Window['cratedigger']['plex']

/** What the track-row lyrics toggle passes in — enough for the LRCLIB/Genius
 *  lookup (the IPC dedupes + disk-caches in main). */
export interface LyricsToggleArgs {
  trackRatingKey: string
  artist: string
  title: string
  album: string
  durationMs: number | null
}

export interface LyricsDeps {
  /** ratingKey of the album open in album-detail — the prefetch loop bails if
   *  the user navigates away mid-flight. */
  currentAlbumRatingKey: () => string | null
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * Per-track lyrics, extracted from PlexState: the fetch cache plus which panels
 * are open. The cache ({@link byTrack}) is keyed by track ratingKey and
 * persists for the session (main disk-caches too), so only {@link openByTrack}
 * is torn down when an album closes. Components read `plexState.lyrics.*`.
 */
export class LyricsController {
  // Per-track lyrics cache keyed by track ratingKey. Each entry is the
  // LyricsResult (or null for confirmed-no-lyrics), the sentinel 'loading',
  // or 'error'. We carry 'loading' as a value rather than a separate map so
  // the renderer reads one source of truth.
  byTrack = $state<Record<string, LyricsResult | 'loading' | 'error' | null>>({})
  // Track ratingKeys whose lyrics panel is currently open in the UI.
  openByTrack = $state<Record<string, boolean>>({})

  #deps: LyricsDeps
  #plex: PlexApi

  constructor(deps: LyricsDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Toggle a track's lyrics panel. Opening fires a one-shot fetch unless the
  // track is already cached (including null-not-found and 'error' — the user
  // can close and re-open to retry).
  async toggle(args: LyricsToggleArgs): Promise<void> {
    const isOpen = !!this.openByTrack[args.trackRatingKey]
    if (isOpen) {
      const next = { ...this.openByTrack }
      delete next[args.trackRatingKey]
      this.openByTrack = next
      return
    }
    this.openByTrack = { ...this.openByTrack, [args.trackRatingKey]: true }
    if (this.byTrack[args.trackRatingKey] !== undefined) return
    this.byTrack = { ...this.byTrack, [args.trackRatingKey]: 'loading' }
    try {
      const result = await this.#plex.getLyrics({
        artist: args.artist,
        title: args.title,
        album: args.album,
        durationMs: args.durationMs
      })
      this.byTrack = { ...this.byTrack, [args.trackRatingKey]: result }
    } catch {
      this.byTrack = { ...this.byTrack, [args.trackRatingKey]: 'error' }
    }
  }

  // Close every open lyrics panel (the cache is left intact). Called when an
  // album closes.
  closeAll(): void {
    this.openByTrack = {}
  }

  // Fire-and-forget background lyrics prefetch for every track on the album
  // the user just opened. Already-fetched tracks (anything not undefined in
  // the cache) are skipped, and the JsonCache in main short-circuits future
  // hits to disk — so this is essentially free on a warm cache.
  //
  // We drain the track list through a small pool of persistent workers rather
  // than awaiting fixed batches. Cold lookups are wildly uneven — an LRCLIB hit
  // is ~300ms, but a miss falls through LRCLIB /search → a Genius scrape and can
  // run 8–17s. A batch-and-wait loop is gated by the slowest track in each
  // batch, so a single dead-end lyric stalled the next three tracks and a
  // 14-track album took ~45s to warm. With a worker pool a slow track only ties
  // up its own worker; the fast majority finish near-instantly and only the
  // genuine stragglers lag. Pool size stays modest to stay polite to LRCLIB and
  // not trip Genius bot detection.
  async prefetchAlbum(detail: AlbumDetail): Promise<void> {
    const albumRk = detail.album.ratingKey
    const tracks = detail.tracks
    const poolSize = 4
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < tracks.length) {
        // Bail if the user navigated to a different album while we were
        // working — no point hammering LRCLIB for an album they left.
        if (this.#deps.currentAlbumRatingKey() !== albumRk) return
        const t = tracks[cursor++]
        if (this.byTrack[t.ratingKey] !== undefined) continue
        this.byTrack = { ...this.byTrack, [t.ratingKey]: 'loading' }
        try {
          const result = await this.#plex.getLyrics({
            artist: detail.album.artist,
            title: t.title,
            album: detail.album.title,
            durationMs: t.duration
          })
          this.byTrack = { ...this.byTrack, [t.ratingKey]: result }
        } catch {
          this.byTrack = { ...this.byTrack, [t.ratingKey]: 'error' }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(poolSize, tracks.length) }, () => worker())
    )
  }
}
