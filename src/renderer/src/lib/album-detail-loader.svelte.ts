import type {
  AlbumCredits,
  AlbumDetail,
  AlbumMediaInfo,
  Bio,
  BookletImage,
  PlexAlbum,
  SimilarArtist
} from '../../../shared/plex'

// Deep module owning everything that hangs off a single album: the album
// object, its MusicBrainz credits, its bio summary, its booklet images, plus
// the two discovery rails shown beside it — the "more from this label" rail
// and the "similar artists" rail. Two instances live on plexState — one for
// the open album-detail view, one for the now-playing screen — so the two
// scopes can coexist (browsing a different album while a track plays) without
// the parallel state trees they used to need.
//
// The rails reach past the single album into the whole library (ensureAllAlbums,
// the label index) and into MB/Plex artist-relation IPC, so those are injected
// as deps rather than reached for directly — keeping the rail logic unit-testable
// without an Electron bridge or a live server.

import { isCuratedPlexSummary, pickMoreCompleteBio } from '../../../shared/bio-text'
import { mbidFromGuid, splitAlbumMbids } from '../../../shared/guid'
import { yearFromDate } from '../../../shared/original-year'
import type { Session } from './plex-state.svelte'

type PlexApi = Window['cratedigger']['plex']
type TaggerApi = Window['cratedigger']['tagger']

// Score an MB artist-relation type for the similar-artists rail. Strict
// allowlist — only types that genuinely mean "you might also like this band."
// Everything else (subgroup aliases like Bingo Hand Job, tribute / cover acts
// like Out of Time, touring sidemen via `instrumental supporting musician`,
// non-performing roles like `artistic director`, member relations, personal
// relations, etc.) returns 0 and is dropped at the call site.
function relationWeight(type: string): number {
  switch (type) {
    case 'collaboration': return 40
    case 'influenced by': return 15
    default: return 0
  }
}

function formatCreditsError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err)
  msg = msg
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
  if (/MusicBrainz 503/.test(msg)) {
    return 'MusicBrainz is temporarily unavailable. Try again in a few minutes.'
  }
  if (/MusicBrainz 5\d\d/.test(msg)) {
    return 'MusicBrainz is having trouble right now. Try again shortly.'
  }
  return msg
}

export interface LoadOptions {
  // Pre-fetched AlbumDetail (e.g. from the hover-prefetch LRU on plex-state).
  // When supplied AND its ratingKey matches, skip the getAlbumDetail
  // round-trip and use the seed directly. Caller is responsible for
  // confirming the seed matches the ratingKey it intends to load.
  seed?: AlbumDetail
  // Whether to also fetch the album booklet. Default true for the
  // album-detail scope; now-playing scope passes false since it doesn't
  // display the booklet.
  includeBooklet?: boolean
}

export interface AlbumDetailLoaderDeps {
  /** Full-library album list — both rails match the open album against it. */
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Indexed record labels keyed by album ratingKey — the label rail's primary signal. */
  albumLabels: () => Record<string, string[]>
  /**
   * Resolve a raw label name to its canonical form via the user's alias map.
   * Defaults to identity so existing tests don't have to wire it up — only the
   * production loader threads in the live alias controller.
   */
  canonicalLabel?: (name: string) => string
  /** Current session — the similar-artists rail needs the server id for Plex's own list. */
  session: () => Session | null
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
  /** Tagger IPC (MB release → album-artist MBID). Defaults to the live bridge. */
  tagger?: TaggerApi
  /**
   * Called once credits resolve and yield the album's original release year
   * (release-group first-release-date), so the owner can re-date the album in
   * its library caches — the discography strip and grid then show 1984 for a
   * 2005 reissue without a reload. originalYear is null when MusicBrainz has no
   * usable date. Optional: the now-playing scope doesn't need it.
   */
  onOriginalYear?: (ratingKey: string, originalYear: number | null) => void
  /**
   * A user's manual original-year override for an album, if pinned. The
   * {@link AlbumDetailLoader.effectiveOriginalYear} getter prefers it over the
   * MusicBrainz release-group date. Optional — tests and a bare loader just fall
   * back to the MB date.
   */
  originalYearOverride?: (ratingKey: string) => number | null
  /**
   * Per-album media info (codec / bitrate / size) keyed by ratingKey, surfaced
   * in the stats row. Optional — null when not wired (tests).
   */
  mediaInfoFor?: (ratingKey: string) => AlbumMediaInfo | null
}

export class AlbumDetailLoader {
  // The loaded album. Sentinel for "is anything loaded here." Callers
  // bind to this for the cover / title / track list, etc.
  album = $state<AlbumDetail | null>(null)
  albumLoading = $state(false)
  albumError = $state<string | null>(null)

  credits = $state<AlbumCredits | null>(null)
  creditsLoading = $state(false)
  creditsError = $state<string | null>(null)

  bio = $state<Bio | null>(null)
  bioLoading = $state(false)

  booklet = $state<BookletImage[] | null>(null)
  bookletLoading = $state(false)

  // "More from this label" rail: albums in the library sharing a record label
  // (or studio) with the open album. railNames is the set of labels matched on,
  // surfaced in the UI as the rail's subtitle.
  labelRail = $state<PlexAlbum[] | null>(null)
  labelRailNames = $state<string[]>([])
  labelRailLoading = $state(false)

  // "Similar artists" rail: Plex's own similar list (primary) merged with MB
  // artist-relations (collaborations / influences), genre-overlap-boosted.
  similarArtists = $state<SimilarArtist[] | null>(null)
  similarArtistsLoading = $state(false)

  // Bumped on every load(). All inflight cascades check it before writing
  // back to state, so a quick album-switch can't race in stale data.
  private loadSeq = 0
  // Per-fetch idempotency keys — preserve the same "skip if already
  // loading this exact key" semantics the original methods had.
  private bioRequestKey: string | null = null
  private bookletRequestKey: string | null = null

  private deps: AlbumDetailLoaderDeps
  private plex: PlexApi
  private tagger: TaggerApi

  constructor(deps: AlbumDetailLoaderDeps) {
    this.deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
    this.tagger = deps.tagger ?? window.cratedigger.tagger
  }

  // ── Shared view-model ─────────────────────────────────────────────────────
  // The album-detail and now-playing screens render the same hero from the same
  // loader, so the bio-vs-summary / original-year / media-info resolution lives
  // here once instead of being re-derived in each screen — which had already let
  // the original-year override silently drift out of the now-playing scope.
  // Plain getters that read $state stay reactive under Svelte 5.

  /** True when Plex carries a genuinely curated summary (not an empty field or a
   *  Last.fm scrape) — the screens show that summary instead of a fetched bio. */
  get hasPlexSummary(): boolean {
    return isCuratedPlexSummary(this.album?.summary)
  }

  /** The bio to render: suppressed when Plex already has a curated summary. */
  get effectiveBio(): Bio | null {
    return this.hasPlexSummary ? null : this.bio
  }

  /** Bio spinner state, matching {@link effectiveBio}'s suppression. */
  get effectiveBioLoading(): boolean {
    return this.hasPlexSummary ? false : this.bioLoading
  }

  /** Original release year: a user's manual override wins, else the MusicBrainz
   *  release-group first-release date carried in credits. */
  get effectiveOriginalYear(): number | null {
    const rk = this.album?.album.ratingKey
    const override = rk ? this.deps.originalYearOverride?.(rk) ?? null : null
    return override ?? yearFromDate(this.credits?.originalDate ?? null)
  }

  /** Codec / bitrate / size for the stats row, if wired and loaded. */
  get effectiveMediaInfo(): AlbumMediaInfo | null {
    const rk = this.album?.album.ratingKey
    return rk ? this.deps.mediaInfoFor?.(rk) ?? null : null
  }

  // Load (or no-op if already loaded with same ratingKey) the album and
  // run the cascade. Idempotent for the same ratingKey unless the prior
  // load errored — caller can retry by clear()-then-load().
  async load(
    serverId: string,
    ratingKey: string,
    opts: LoadOptions = {}
  ): Promise<void> {
    if (
      this.album?.album.ratingKey === ratingKey &&
      !this.albumError
    ) {
      return
    }
    const includeBooklet = opts.includeBooklet ?? true
    const seq = ++this.loadSeq
    this._resetCascadeState()

    // Seed path — caller already has the AlbumDetail (e.g. hover-prefetch
    // hit). Render the hero immediately and fire credits/bio in parallel.
    if (opts.seed && opts.seed.album.ratingKey === ratingKey) {
      this.album = opts.seed
      this.albumLoading = false
      this._continueCascade(opts.seed, seq, includeBooklet)
      return
    }

    this.albumLoading = true
    try {
      const detail = await this.plex.getAlbumDetail({
        serverId,
        ratingKey
      })
      if (seq !== this.loadSeq) return
      this.album = detail
      this._continueCascade(detail, seq, includeBooklet)
    } catch (err) {
      if (seq === this.loadSeq) {
        this.albumError = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (seq === this.loadSeq) this.albumLoading = false
    }
  }

  // Manual-match changes the album's MBID, so credits need to refetch.
  // Booklet doesn't change (it's tied to release MBID resolution but the
  // GUI shows the picker before the booklet is critical) — refetch
  // credits only and let booklet stay until next full load().
  async reloadCredits(): Promise<void> {
    if (!this.album) return
    this.credits = null
    this.creditsError = null
    void this._loadCredits(this.album, this.loadSeq)
  }

  // Drop everything, including the rails. Subsequent load() starts from scratch.
  clear(): void {
    this.loadSeq++
    this.album = null
    this.albumLoading = false
    this.albumError = null
    this._resetCascadeState()
    this.resetRails()
  }

  // Reset just the two rails. Separate from clear() because the now-playing
  // scope refreshes its rails on every track change without tearing down the
  // album loader itself.
  resetRails(): void {
    this.labelRail = null
    this.labelRailNames = []
    this.labelRailLoading = false
    this.similarArtists = null
    this.similarArtistsLoading = false
  }

  // Wipe cascade outputs but keep loadSeq's current value — used by
  // load() at the top of every call to clear stale data before kicking
  // off a fresh cascade.
  private _resetCascadeState(): void {
    this.credits = null
    this.creditsLoading = false
    this.creditsError = null
    this.bio = null
    this.bioLoading = false
    this.bioRequestKey = null
    this.booklet = null
    this.bookletLoading = false
    this.bookletRequestKey = null
  }

  private _continueCascade(
    detail: AlbumDetail,
    seq: number,
    includeBooklet: boolean
  ): void {
    void this._loadCredits(detail, seq)
    // Bio is only fetched when Plex has no *curated* summary. An empty field
    // obviously qualifies, but so does a Last.fm scrape Plex's agent wrote
    // there (truncated text + "Read more on Last.fm" footer) — our own fetch
    // gets the full text, so the scrape is just a floor, not a short-circuit.
    if (!isCuratedPlexSummary(detail.summary)) {
      void this._loadBio(detail, seq)
    }
    if (includeBooklet) {
      void this._loadBooklet(detail, seq)
    }
  }

  private async _loadCredits(detail: AlbumDetail, seq: number): Promise<void> {
    if (seq !== this.loadSeq) return
    this.creditsLoading = true
    this.creditsError = null
    try {
      const credits = await this.plex.getAlbumCredits({
        ratingKey: detail.album.ratingKey,
        artist: detail.album.artist,
        title: detail.album.title,
        year: detail.album.year,
        guids: [...detail.guids],
        // Structured-clone-safe snapshot: alignment needs each track's
        // guids/disc/index/title/duration, and Svelte $state proxies don't
        // survive IPC — spread to plain objects and copy the guids array.
        tracks: detail.tracks.map((t) => ({ ...t, guids: [...t.guids] }))
      })
      if (seq !== this.loadSeq) return
      this.credits = credits
      if (credits) {
        this.deps.onOriginalYear?.(detail.album.ratingKey, yearFromDate(credits.originalDate))
      }
      if (!credits) this.creditsError = 'no matching release on MusicBrainz'
    } catch (err) {
      if (seq === this.loadSeq) this.creditsError = formatCreditsError(err)
    } finally {
      if (seq === this.loadSeq) this.creditsLoading = false
    }
  }

  private async _loadBio(detail: AlbumDetail, seq: number): Promise<void> {
    if (isCuratedPlexSummary(detail.summary)) return
    const key = detail.album.ratingKey
    if (this.bioRequestKey === key) return
    this.bioRequestKey = key
    this.bioLoading = true

    const releaseMbidFromCredits = this.credits?.releaseMbid ?? null
    const { release: releaseFromGuid, releaseGroup: releaseGroupFromGuid } =
      splitAlbumMbids(detail.guids)

    try {
      const bio = await this.plex.getAlbumBio({
        releaseMbid: releaseMbidFromCredits ?? releaseFromGuid,
        releaseGroupMbid: releaseGroupFromGuid,
        artist: detail.album.artist,
        title: detail.album.title
      })
      // Verify our album hasn't been replaced under us before writing.
      // The original code checked openAlbum.ratingKey AND the summary
      // condition — same check here.
      const current = this.album
      if (
        seq === this.loadSeq &&
        current?.album.ratingKey === key &&
        !isCuratedPlexSummary(current.summary)
      ) {
        // If Plex's summary was a Last.fm scrape, keep whichever text is more
        // complete — the fetched bio (full content) or the stripped scrape.
        this.bio = pickMoreCompleteBio(bio, current.summary)
      }
    } catch {
      // Bio is optional enrichment — stay silent. But if Plex had a scrape,
      // the stripped scrape still beats showing nothing.
      const current = this.album
      if (
        seq === this.loadSeq &&
        current?.album.ratingKey === key &&
        !isCuratedPlexSummary(current.summary)
      ) {
        this.bio = pickMoreCompleteBio(null, current.summary)
      }
    } finally {
      if (this.bioRequestKey === key) this.bioLoading = false
    }
  }

  private async _loadBooklet(detail: AlbumDetail, seq: number): Promise<void> {
    if (seq !== this.loadSeq) return
    // Resolve a release MBID — prefer the one the credits IPC returned
    // (most accurate), fall back to scanning the album's guids.
    let releaseMbid = this.credits?.releaseMbid ?? null
    if (!releaseMbid) {
      releaseMbid = splitAlbumMbids(detail.guids).release
    }
    if (!releaseMbid) {
      // No usable release MBID — empty booklet, not an error.
      this.booklet = []
      return
    }

    const key = `${detail.album.ratingKey}::${releaseMbid}`
    if (this.bookletRequestKey === key) return
    this.bookletRequestKey = key
    this.bookletLoading = true
    try {
      const images = await this.plex.getBooklet({ releaseMbid })
      if (
        this.bookletRequestKey === key &&
        this.album?.album.ratingKey === detail.album.ratingKey
      ) {
        this.booklet = images
      }
    } catch {
      if (this.bookletRequestKey === key) this.booklet = []
    } finally {
      if (this.bookletRequestKey === key) this.bookletLoading = false
    }
  }

  // "More from this label" rail. Collects the open album's labels (indexed
  // labels + Plex studio), then scans the whole library for other albums
  // sharing any of them. Guards every write against an album-switch by
  // re-checking this.album's ratingKey across each await.
  async loadLabelRail(): Promise<void> {
    const detail = this.album
    if (!detail) return
    const rk = detail.album.ratingKey
    this.labelRail = null
    this.labelRailLoading = true

    const labels = this.deps.albumLabels()
    const canonical = this.deps.canonicalLabel ?? ((n: string) => n)
    const indexed = labels[rk] ?? []
    const studio = detail.album.studio ? [detail.album.studio] : []
    const names = new Set<string>()
    for (const n of [...indexed, ...studio]) {
      const c = canonical(n.trim())
      if (c) names.add(c)
    }
    this.labelRailNames = [...names]
    if (names.size === 0) {
      this.labelRail = []
      this.labelRailLoading = false
      return
    }

    try {
      const all = await this.deps.ensureAllAlbums()
      if (this.album?.album.ratingKey !== rk) return
      const matches: PlexAlbum[] = []
      for (const a of all) {
        if (a.ratingKey === rk) continue
        const aIndexed = labels[a.ratingKey] ?? []
        const aStudio = a.studio ? [a.studio] : []
        for (const c of [...aIndexed, ...aStudio]) {
          if (names.has(canonical(c.trim()))) {
            matches.push(a)
            break
          }
        }
      }
      matches.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      if (this.album?.album.ratingKey !== rk) return
      this.labelRail = matches.slice(0, 30)
    } catch {
      if (this.album?.album.ratingKey === rk) this.labelRail = []
    } finally {
      if (this.album?.album.ratingKey === rk) this.labelRailLoading = false
    }
  }

  // Resolve the album-artist's MBID: try each candidate release MBID against
  // the tagger (its albumartist_ids), falling back to a Plex name search.
  private async resolveAlbumArtistMbid(
    detail: AlbumDetail,
    releaseMbidHint: string | null
  ): Promise<string | null> {
    const candidates: string[] = []
    if (releaseMbidHint) candidates.push(releaseMbidHint)
    for (const g of detail.guids) {
      const m = mbidFromGuid(g)
      if (m && !candidates.includes(m)) candidates.push(m)
    }
    for (const mbid of candidates) {
      try {
        const release = await this.tagger.getRelease({ mbid })
        if (release.albumartist_ids[0]) return release.albumartist_ids[0]
      } catch {
        // try next
      }
    }
    try {
      return await this.plex.searchArtistByName({ name: detail.album.artist })
    } catch {
      return null
    }
  }

  // "Similar artists" rail. Primary signal is Plex's own similar-artists list
  // (Last.fm/Gracenote-backed — what Plexamp uses); MB artist-relations add
  // genuine collaborations/influences on top; in-library genre overlap boosts.
  async loadSimilarArtists(): Promise<void> {
    const detail = this.album
    if (!detail) return
    const rk = detail.album.ratingKey
    const s = this.deps.session()
    const serverId = s?.signedIn ? s.preferredServerId : null
    this.similarArtists = null
    this.similarArtistsLoading = true
    try {
      const all = await this.deps.ensureAllAlbums()
      if (this.album?.album.ratingKey !== rk) return

      const byArtist = new Map<string, { ratingKey: string; count: number; genres: Set<string> }>()
      for (const a of all) {
        const key = a.artist.toLowerCase()
        let entry = byArtist.get(key)
        if (!entry) {
          entry = { ratingKey: a.artistRatingKey ?? '', count: 0, genres: new Set() }
          byArtist.set(key, entry)
        }
        entry.count += 1
        for (const g of a.genres) entry.genres.add(g)
      }

      const openGenres = new Set(detail.genres ?? [])
      const candidates = new Map<string, SimilarArtist>()
      const byName = new Map<string, SimilarArtist>()

      // Primary signal: Plex's own similar-artists (Last.fm/Gracenote-backed).
      // This is what Plexamp uses and is the right source for "like this band".
      if (serverId && detail.album.artistRatingKey) {
        try {
          const plexSimilar = await this.plex.listSimilarArtists({
            serverId,
            artistRatingKey: detail.album.artistRatingKey
          })
          if (this.album?.album.ratingKey !== rk) return
          let rank = 0
          for (const a of plexSimilar) {
            const nameKey = a.title.toLowerCase()
            const mbidKey = a.mbid ?? `name:${nameKey}`
            if (candidates.has(mbidKey) || byName.has(nameKey)) continue
            const libEntry = byArtist.get(nameKey)
            const score = 100 - rank * 2 // Plex returns in similarity order
            const c: SimilarArtist = {
              mbid: a.mbid ?? '',
              name: a.title,
              score,
              reasons: ['plex'],
              inLibrary: !!libEntry,
              plexArtistRatingKey: libEntry?.ratingKey || a.ratingKey,
              albumCount: libEntry?.count ?? 0
            }
            candidates.set(mbidKey, c)
            byName.set(nameKey, c)
            rank++
          }
        } catch {
          // fall through to MB signal
        }
      }

      // Secondary signal: MB artist-rels for genuine collaborations / influences.
      // These bump the Plex list up or add new ones where MB has data Plex lacks.
      const artistMbid = await this.resolveAlbumArtistMbid(
        detail,
        this.credits?.releaseMbid ?? null
      )
      if (this.album?.album.ratingKey !== rk) return
      if (artistMbid) {
        try {
          const relations = await this.plex.getArtistRelations({ mbid: artistMbid })
          if (this.album?.album.ratingKey !== rk) return
          for (const rel of relations) {
            if (!rel.artist.mbid || rel.artist.mbid === artistMbid) continue
            // Band members aren't "similar artists" to the band. Plex covers the
            // real similarity signal, so leave MB purely to collaborations,
            // influences, and associated-with edges.
            if (rel.type === 'member of band') continue
            const weight = relationWeight(rel.type)
            if (weight === 0) continue
            const existing =
              candidates.get(rel.artist.mbid) ?? byName.get(rel.artist.name.toLowerCase())
            if (existing) {
              existing.score += weight
              if (!existing.reasons.includes(rel.type)) existing.reasons.push(rel.type)
              if (!existing.mbid) existing.mbid = rel.artist.mbid
              continue
            }
            const libEntry = byArtist.get(rel.artist.name.toLowerCase())
            const c: SimilarArtist = {
              mbid: rel.artist.mbid,
              name: rel.artist.name,
              score: weight,
              reasons: [rel.type],
              inLibrary: !!libEntry,
              plexArtistRatingKey: libEntry?.ratingKey || null,
              albumCount: libEntry?.count ?? 0
            }
            candidates.set(rel.artist.mbid, c)
            byName.set(rel.artist.name.toLowerCase(), c)
          }
        } catch {
          // ignore — Plex results alone are fine
        }
      }

      if (openGenres.size > 0) {
        for (const c of candidates.values()) {
          if (!c.inLibrary) continue
          const libEntry = byArtist.get(c.name.toLowerCase())
          if (!libEntry) continue
          let overlap = 0
          for (const g of openGenres) if (libEntry.genres.has(g)) overlap += 1
          if (overlap > 0) {
            c.score += Math.min(overlap * 8, 24)
            c.reasons.push(`${overlap} shared genre${overlap === 1 ? '' : 's'}`)
          }
        }
      }

      const list = [...candidates.values()]
      const inLib = list.filter((c) => c.inLibrary).sort((a, b) => b.score - a.score).slice(0, 12)
      const notInLib = list.filter((c) => !c.inLibrary).sort((a, b) => b.score - a.score).slice(0, 8)

      if (this.album?.album.ratingKey !== rk) return
      this.similarArtists = [...inLib, ...notInLib]
    } catch {
      if (this.album?.album.ratingKey === rk) this.similarArtists = []
    } finally {
      if (this.album?.album.ratingKey === rk) this.similarArtistsLoading = false
    }
  }
}
