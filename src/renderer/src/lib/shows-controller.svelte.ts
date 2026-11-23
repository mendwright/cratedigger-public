import type {
  PlexAlbum,
  ReportedShowMatch,
  ShowMark,
  ShowRow,
  ShowsProgress,
  Venue
} from '../../../shared/plex'
import { canonicalArtistKey } from '../../../shared/artist-aliases'
import type { Session } from './plex-state.svelte'

type PlexApi = Window['cratedigger']['plex']
type ShowsApi = Window['cratedigger']['shows']

/** Library cross-reference: canonical artist key → owned-album count + a Plex
 *  artistRatingKey if any owned album carried one. Built once per lookup so all
 *  venues share one table instead of each re-scanning the library. Keys go
 *  through canonicalArtistKey, so "The Uranium Club" on a venue bill hits a
 *  library entry filed as "Minneapolis Uranium Club". */
export function buildArtistIndex(
  albums: PlexAlbum[]
): Map<string, { count: number; ratingKey: string | null }> {
  const index = new Map<string, { count: number; ratingKey: string | null }>()
  for (const a of albums) {
    const key = canonicalArtistKey(a.artist)
    if (!key) continue
    const cur = index.get(key)
    if (cur) {
      cur.count += 1
      if (!cur.ratingKey && a.artistRatingKey) cur.ratingKey = a.artistRatingKey
    } else {
      index.set(key, { count: 1, ratingKey: a.artistRatingKey })
    }
  }
  return index
}

/** Match a show's headliner + support acts against the library index. Returns
 *  the total owned-album count across all matched names, and the first matched
 *  name's Plex ratingKey / MBID (for instant Entity-page navigation). */
export function matchAgainstLibrary(
  artist: string,
  supports: string[],
  index: Map<string, { count: number; ratingKey: string | null }>,
  mbidByName: Map<string, string>
): {
  ownedAlbumCount: number
  matchedArtistName: string | null
  plexArtistRatingKey: string | null
  plexArtistMbid: string | null
} {
  const candidates = [artist, ...supports]
  let ownedAlbumCount = 0
  let matchedArtistName: string | null = null
  let plexArtistRatingKey: string | null = null
  let plexArtistMbid: string | null = null
  for (const c of candidates) {
    const key = canonicalArtistKey(c)
    const hit = index.get(key)
    if (hit) {
      ownedAlbumCount += hit.count
      if (!matchedArtistName) {
        matchedArtistName = c
        plexArtistRatingKey = hit.ratingKey
        plexArtistMbid = mbidByName.get(key) ?? null
      }
    }
  }
  return { ownedAlbumCount, matchedArtistName, plexArtistRatingKey, plexArtistMbid }
}

/** Upcoming shows whose bill (headliner or any support act) includes
 *  `artistName`, on or after `todayIso`, soonest first. Pure so the Now Playing
 *  screen can derive its "playing soon near you" callout straight from the
 *  loaded rows + the currently-playing artist. Matches on the bill directly
 *  (not a row's `matchedArtistName`, which may be a *different* owned support
 *  act on the same show). `todayIso` is passed in (YYYY-MM-DD) to keep this a
 *  pure function. */
export function showsForArtist(
  rows: ShowRow[],
  artistName: string | null | undefined,
  todayIso: string
): ShowRow[] {
  const key = canonicalArtistKey(artistName ?? '')
  if (!key) return []
  return rows
    .filter((r) => r.event.date >= todayIso)
    .filter(
      (r) =>
        canonicalArtistKey(r.event.artistName) === key ||
        r.event.supportArtists.some((s) => canonicalArtistKey(s) === key)
    )
    .sort((a, b) => a.event.date.localeCompare(b.event.date))
}

/** A mark "counts" when it pins the show or holds tickets — bare leftovers
 *  (pinned=false, tickets=0) are treated as unmarked. */
export function isMarked(mark: ShowMark | undefined): boolean {
  return !!mark && (mark.pinned || mark.tickets > 0)
}

/** Display order: marked shows (pinned / tickets bought) first, then library
 *  matches, then the rest — each group date-ascending. Pure; the screen
 *  derives this from rows + marks so a pin re-sorts live. */
export function orderShowRows(
  rows: ShowRow[],
  marks: Record<string, ShowMark>
): ShowRow[] {
  return [...rows].sort((a, b) => {
    const aMarked = isMarked(marks[a.event.id])
    const bMarked = isMarked(marks[b.event.id])
    if (aMarked !== bMarked) return aMarked ? -1 : 1
    // Owned-artist grouping only applies below the marked block — a pinned
    // show you own nothing by must not push later-dated pins around.
    if (!aMarked) {
      const aOwned = a.ownedAlbumCount > 0 ? 0 : 1
      const bOwned = b.ownedAlbumCount > 0 ? 0 : 1
      if (aOwned !== bOwned) return aOwned - bOwned
    }
    return a.event.date.localeCompare(b.event.date)
  })
}

export interface ShowsDeps {
  /** Force-refresh the full-library album list and return it. The lookup busts
   *  the session cache so artists added since the last load still match. */
  refreshAllAlbums: () => Promise<PlexAlbum[]>
  /** Current session — the library-artist MBID lookup needs the server id. */
  session: () => Session | null
  /** Master toggle. When false, the background check is a no-op (no scan, no
   *  report, no notification). The visible `run()` still reports so the baseline
   *  / notified-set stays current — flipping the toggle on later won't dump the
   *  whole backlog. */
  notificationsEnabled: () => boolean
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
  /** Shows IPC (venue list + per-venue event fetch). Defaults to the live bridge. */
  shows?: ShowsApi
}

/** Map a library-matched row into the slim payload the main process diffs. */
function toReportedMatch(row: ShowRow): ReportedShowMatch {
  return {
    id: row.event.id,
    artistName: row.matchedArtistName ?? row.event.artistName,
    venueName: row.venue.name,
    date: row.event.date,
    ownedAlbumCount: row.ownedAlbumCount
  }
}

/**
 * The "shows near me" view, extracted from PlexState: fetch every configured
 * venue's upcoming events in parallel, cross-reference each act against the
 * library, and surface the matches (owned-album count) at the top. View
 * orchestration (`openShows`/`closeShows`, which flip `PlexState.view`) stays on
 * PlexState and calls {@link run}. Components read `plexState.shows.*`.
 */
export class ShowsController {
  loading = $state(false)
  rows = $state<ShowRow[]>([])
  progress = $state<ShowsProgress>({ done: 0, total: 0, current: null })
  error = $state<string | null>(null)
  venueErrors = $state<{ venueName: string; message: string }[]>([])

  // Newly-announced library matches surfaced by a background check, awaiting the
  // user's acknowledgement. Drives the in-app banner (the native OS notification
  // fires from the main process). Cleared by dismiss() or when the user opens
  // the Shows screen.
  newShowsBanner = $state<ReportedShowMatch[]>([])

  // Show ids announced within main's recency window (persisted, survives
  // restarts). The Shows screen badges these rows "just announced" so the show
  // a notification named is actually findable in the list.
  recentNewIds = $state<string[]>([])

  // Set when the user arrives via a notification / banner click; Shows.svelte
  // scrolls the first just-announced row into view and clears it.
  scrollToNewPending = $state(false)

  // Pinned / tickets-bought marks keyed by VenueShow id, mirrored from the
  // store. Mutations are optimistic (local first, IPC after) — a failed write
  // just means the mark doesn't survive a restart.
  marks = $state<Record<string, ShowMark>>({})

  // Venue filter: selected venue ids; empty = all venues. Session-scoped
  // (deliberately not persisted) — lives on the controller so it survives
  // navigating away from the Shows screen and back.
  venueFilter = $state<string[]>([])

  // Guards against overlapping background checks (the timer + a manual trigger).
  #backgroundRunning = false

  // Request-sequence guard: bumped per run() so a slow earlier lookup can't
  // write rows/progress after a newer one started.
  #runSeq = 0

  #deps: ShowsDeps
  #plex: PlexApi
  #shows: ShowsApi

  constructor(deps: ShowsDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
    this.#shows = deps.shows ?? window.cratedigger.shows
  }

  async run(): Promise<void> {
    const seq = ++this.#runSeq
    this.loading = true
    this.error = null
    this.rows = []
    this.venueErrors = []
    void this.loadMarks()
    try {
      // Force-refresh the library snapshot. The cached list would otherwise
      // miss anything added since the last load (which silently breaks library
      // matching on new-to-you artists).
      const albums = await this.#deps.refreshAllAlbums()
      const venues = await this.#shows.listVenues()
      const artistIndex = buildArtistIndex(albums)
      // Pull every library artist's Plex-stored MBID once per lookup. Used to
      // attach `plexArtistMbid` to matched rows so band-link clicks open the
      // Entity page instantly — no MusicBrainz search hop.
      const mbidByName = new Map<string, string>()
      try {
        const s = this.#deps.session()
        const serverId = s?.signedIn ? s.preferredServerId : null
        if (serverId) {
          const list = await this.#plex.listLibraryArtistsWithGuids({ serverId })
          for (const a of list) {
            if (a.mbid) mbidByName.set(canonicalArtistKey(a.name), a.mbid)
          }
        }
      } catch {
        // non-fatal — rows just won't carry plexArtistMbid, and clicks fall
        // back to the searchArtistByName path (cached on disk after first hit)
      }
      this.progress = { done: 0, total: venues.length, current: null }
      // Fire all venues in parallel — each adapter manages its own pacing.
      await Promise.all(
        venues.map(async (venue: Venue) => {
          if (seq !== this.#runSeq) return
          this.progress = { ...this.progress, current: venue.name }
          try {
            const events = await this.#shows.fetchVenue({ venueId: venue.id })
            if (seq !== this.#runSeq) return
            const newRows: ShowRow[] = []
            for (const ev of events) {
              const match = matchAgainstLibrary(
                ev.artistName,
                ev.supportArtists,
                artistIndex,
                mbidByName
              )
              newRows.push({ event: ev, venue, ...match })
            }
            if (newRows.length > 0) {
              // Dedup by event id before merging. Svelte's keyed each-block
              // crashes on duplicate keys, silently aborting all subsequent
              // renders — so a single dup in any adapter would kill the rest
              // of the list. Defense in depth.
              const existingIds = new Set(this.rows.map((r) => r.event.id))
              const uniqueNewRows = newRows.filter((r) => {
                if (existingIds.has(r.event.id)) return false
                existingIds.add(r.event.id)
                return true
              })
              if (uniqueNewRows.length === 0) return
              const merged = [...this.rows, ...uniqueNewRows]
              // Library matches float to the top, sorted by date within the
              // matched group. Non-matches fall below, also date-sorted.
              merged.sort((a, b) => {
                const aMatched = a.ownedAlbumCount > 0 ? 0 : 1
                const bMatched = b.ownedAlbumCount > 0 ? 0 : 1
                if (aMatched !== bMatched) return aMatched - bMatched
                return a.event.date.localeCompare(b.event.date)
              })
              this.rows = merged
            }
          } catch (err) {
            // Per-venue failures don't kill the batch. Collect ONLY genuine
            // failures for the user — the two "expected" classes (Ticketmaster
            // key not set, no scraper adapter yet for a webview-only venue) are
            // setup issues, not transient errors, and listing them every time
            // clutters the bottom of the page. Real failures (rate limits, page
            // redesigns, 5xx) still surface.
            const message = err instanceof Error ? err.message : String(err)
            console.warn('[shows] fetch failed for', venue.name, message)
            const isSetupNoise =
              /Ticketmaster API key not set/i.test(message) ||
              /No adapter yet for .* \(webview\)/i.test(message)
            if (seq === this.#runSeq && !isSetupNoise) {
              this.venueErrors = [...this.venueErrors, { venueName: venue.name, message }]
            }
          } finally {
            if (seq === this.#runSeq) {
              this.progress = { ...this.progress, done: this.progress.done + 1 }
            }
          }
        })
      )
      // Reconcile the notified-set with what's currently showing. Keeps the
      // baseline fresh so opening the screen counts as "seen" and the background
      // check won't later re-alert for shows already on the page. Fire-and-
      // forget; the visible screen already shows the matches, so suppress the
      // in-app banner here.
      if (seq === this.#runSeq) void this.#reportMatches(this.rows, false)
    } catch (err) {
      if (seq === this.#runSeq) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (seq === this.#runSeq) {
        this.loading = false
        this.progress = { ...this.progress, current: null }
      }
    }
  }

  /**
   * Quiet background scan: fetch every venue, match against the library, and
   * hand the matches to the main process to diff + notify. Does NOT touch the
   * visible screen state (`rows`/`loading`/`progress`) so it's safe to run on a
   * timer while the user is elsewhere in the app. No-ops when notifications are
   * off or a scan (foreground or background) is already in flight.
   */
  async backgroundCheck(): Promise<void> {
    if (!this.#deps.notificationsEnabled()) return
    if (this.#backgroundRunning || this.loading) return
    this.#backgroundRunning = true
    try {
      const matched = await this.#scanMatchedRows()
      await this.#reportMatches(matched, true)
    } catch {
      // Background path is best-effort — a failed scan just means no alert this
      // cycle; the next timer tick retries.
    } finally {
      this.#backgroundRunning = false
    }
  }

  /** Lazy-load for satellite views (the Now Playing "playing soon" callout) that
   *  want to read `rows` without owning the Shows screen's load lifecycle. Runs a
   *  full scan only when nothing's loaded yet and none is in flight — so repeated
   *  Now-Playing opens within a session are free, mirroring openShows' reuse rule
   *  (rows persist for the session; the 6h background check never touches them). */
  ensureFresh(): void {
    if (this.rows.length === 0 && !this.loading) void this.run()
  }

  dismissBanner(): void {
    this.newShowsBanner = []
  }

  toggleVenueFilter(venueId: string): void {
    this.venueFilter = this.venueFilter.includes(venueId)
      ? this.venueFilter.filter((v) => v !== venueId)
      : [...this.venueFilter, venueId]
  }

  clearVenueFilter(): void {
    this.venueFilter = []
  }

  /** Pull persisted marks from main (also prunes past-show marks there). */
  async loadMarks(): Promise<void> {
    try {
      this.marks = await this.#shows.listMarks()
    } catch {
      // non-fatal — marks just won't show until the next successful load
    }
  }

  togglePin(row: ShowRow): void {
    const cur = this.marks[row.event.id]
    this.#setMark(row.event.id, {
      pinned: !(cur?.pinned ?? false),
      tickets: cur?.tickets ?? 0,
      date: row.event.date
    })
  }

  /** Bump the tickets-bought count by delta (clamped at 0). */
  adjustTickets(row: ShowRow, delta: number): void {
    const cur = this.marks[row.event.id]
    this.#setMark(row.event.id, {
      pinned: cur?.pinned ?? false,
      tickets: Math.max(0, (cur?.tickets ?? 0) + delta),
      date: row.event.date
    })
  }

  #setMark(id: string, mark: ShowMark): void {
    // Optimistic local write; mirrors the store's delete-when-bare rule so
    // the in-memory map never disagrees with disk about what "unmarked" is.
    if (!mark.pinned && mark.tickets <= 0) {
      const { [id]: _, ...rest } = this.marks
      this.marks = rest
    } else {
      this.marks = { ...this.marks, [id]: mark }
    }
    void this.#shows.setMark({ id, mark }).catch(() => {
      // non-fatal — the optimistic state stands for this session
    })
  }

  /** Pull the persisted recently-announced ids from main. Cheap local IPC. */
  async refreshRecentNew(): Promise<void> {
    try {
      this.recentNewIds = await this.#shows.listRecentNotified()
    } catch {
      // non-fatal — rows just won't carry the "just announced" badge
    }
  }

  /** True when a recently-announced show isn't in the visible rows — i.e. the
   *  current list predates the announcement and needs a re-scan. The
   *  notification path checks this so clicking the alert never lands on a
   *  stale list that's missing the very show it named. */
  hasUnseenNewShows(): boolean {
    if (this.recentNewIds.length === 0) return false
    const visible = new Set(this.rows.map((r) => r.event.id))
    return this.recentNewIds.some((id) => !visible.has(id))
  }

  /** Fetch + match every venue, returning only library-matched rows. Mirrors the
   *  matching `run()` does but without any UI side effects. */
  async #scanMatchedRows(): Promise<ShowRow[]> {
    const albums = await this.#deps.refreshAllAlbums()
    const venues = await this.#shows.listVenues()
    const artistIndex = buildArtistIndex(albums)
    const mbidByName = new Map<string, string>()
    try {
      const s = this.#deps.session()
      const serverId = s?.signedIn ? s.preferredServerId : null
      if (serverId) {
        const list = await this.#plex.listLibraryArtistsWithGuids({ serverId })
        for (const a of list) {
          if (a.mbid) mbidByName.set(canonicalArtistKey(a.name), a.mbid)
        }
      }
    } catch {
      // non-fatal — matches just won't carry plexArtistMbid
    }
    const matched: ShowRow[] = []
    const seenIds = new Set<string>()
    const perVenue = await Promise.all(
      venues.map(async (venue: Venue): Promise<ShowRow[]> => {
        try {
          const events = await this.#shows.fetchVenue({ venueId: venue.id })
          const out: ShowRow[] = []
          for (const ev of events) {
            const match = matchAgainstLibrary(
              ev.artistName,
              ev.supportArtists,
              artistIndex,
              mbidByName
            )
            if (match.ownedAlbumCount > 0) out.push({ event: ev, venue, ...match })
          }
          return out
        } catch {
          return []
        }
      })
    )
    for (const rows of perVenue) {
      for (const row of rows) {
        if (seenIds.has(row.event.id)) continue
        seenIds.add(row.event.id)
        matched.push(row)
      }
    }
    return matched
  }

  /** Report matched rows to main for diff + native notification. When
   *  `showBanner` and main reports newly-announced matches, raise the in-app
   *  banner too. */
  async #reportMatches(rows: ShowRow[], showBanner: boolean): Promise<void> {
    const matches = rows
      .filter((r) => r.ownedAlbumCount > 0)
      .map(toReportedMatch)
    try {
      const { newMatches } = await this.#shows.reportMatches({ matches })
      if (showBanner && newMatches.length > 0) {
        this.newShowsBanner = newMatches
      }
      // The report may have just recorded new announcements — pull the
      // persisted recent-set back so badges appear without a reopen.
      if (newMatches.length > 0) void this.refreshRecentNew()
    } catch {
      // non-fatal — notification is a nicety, not core flow
    }
  }
}
