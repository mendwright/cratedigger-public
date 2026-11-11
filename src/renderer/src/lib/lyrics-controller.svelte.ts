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
  /** ratingKey of the currently playing track (from the timeline poll) —
   *  the prefetch pool pulls it to the front of the queue so the now-playing
   *  panel never waits behind its album-mates. Optional: theater mode and
   *  tests don't need it. */
  nowPlayingTrackRatingKey?: () => string | null
  /** ratingKey of the album the playing track belongs to. A prefetch keeps
   *  going while its album is either open OR playing, so browsing away from
   *  the album you're listening to doesn't strand its lyrics half-fetched. */
  nowPlayingAlbumRatingKey?: () => string | null
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
  // Albums with a prefetch pool in flight — opening the album you're playing
  // would otherwise start a second pool over the same tracks.
  #prefetching = new Set<string>()

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
    await this.ensure(args)
  }

  // Fetch a track's lyrics into the cache without touching panel state.
  // Theater mode calls this on every track change — the inline panels in the
  // album view stay closed, but the synced lyrics are ready to render.
  async ensure(args: LyricsToggleArgs): Promise<void> {
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

  // Fire-and-forget background lyrics prefetch for every track on an album —
  // fired when the user opens an album and when an album starts playing. Already-fetched tracks (anything not undefined in
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
    if (this.#prefetching.has(albumRk)) return
    this.#prefetching.add(albumRk)
    // Local copy: workers reorder the queue in place (now-playing jumps it).
    const tracks = [...detail.tracks]
    const poolSize = 4
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < tracks.length) {
        // Bail once the album is neither open nor playing — no point
        // hammering LRCLIB for an album the user has left behind.
        if (!this.#wanted(albumRk)) return
        // Queue-jump: if the currently playing track is still waiting in the
        // unfetched tail, swap it up to be taken next. Re-checked on every
        // pull so it also catches playback advancing to a later track while
        // the pool is mid-album.
        const nowRk = this.#deps.nowPlayingTrackRatingKey?.() ?? null
        if (nowRk && tracks[cursor].ratingKey !== nowRk) {
          const i = tracks.findIndex((t, idx) => idx > cursor && t.ratingKey === nowRk)
          if (i !== -1 && this.byTrack[nowRk] === undefined) {
            ;[tracks[cursor], tracks[i]] = [tracks[i], tracks[cursor]]
          }
        }
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
    try {
      await Promise.all(
        Array.from({ length: Math.min(poolSize, tracks.length) }, () => worker())
      )
    } finally {
      this.#prefetching.delete(albumRk)
    }
  }

  #wanted(albumRk: string): boolean {
    return (
      this.#deps.currentAlbumRatingKey() === albumRk ||
      (this.#deps.nowPlayingAlbumRatingKey?.() ?? null) === albumRk
    )
  }
}
