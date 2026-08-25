import type {
  ArtistBio,
  ArtistBrowse,
  CreditedWork,
  PersonAppearance,
  PlexAlbum
} from '../../../shared/plex'
import { matchCreditedWorks } from '../../../shared/title-match'
import { missingFromLibrary, type MissingRelease } from './entity-view'
import { LruCache } from './lru'
import type { MbArtistInfo, Session } from './plex-state.svelte'

/** The artist/person header payload, filled in across three parallel fetches. */
export interface EntityData {
  browse: ArtistBrowse | null
  info: MbArtistInfo | null
  name: string
}

type CreditedResult = {
  inLibrary: { album: PlexAlbum; roles: string[] }[]
  notInLibrary: CreditedWork[]
}
type AppearanceRow = { album: PlexAlbum; roles: PersonAppearance['roles'] }

// One artist's cached page, filled piece-by-piece as each fetch settles —
// the pieces land at very different speeds (appearances is a local index hit,
// the MB credit walk can take seconds), so caching them individually beats
// waiting for the whole bundle. `undefined` means "never settled for this
// artist"; the matching load() flag then shows the spinner as usual.
type EntityCacheEntry = {
  entity?: EntityData
  credited?: CreditedResult
  appearances?: AppearanceRow[]
  bio?: ArtistBio | null
  missing?: MissingRelease[] | null
}

// Walking a credit graph means bouncing between a handful of people —
// 8 entries comfortably covers a bounce loop without hoarding album arrays.
const ENTITY_LRU = 8

type PlexApi = Window['cratedigger']['plex']

export interface EntityDeps {
  session: () => Session | null
  /** The full-library album list, for matching MB credits + in-library appearances. */
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * The artist/person entity page, extracted from PlexState. Owns the header
 * (`entity`), the MB-walked "credited works" section, the instant in-library
 * "appearances" section (from the inverted credits index), and the artist bio
 * — each loaded by its own fetch and guarded by {@link mbid} so a slow earlier
 * artist can't clobber a newer one.
 *
 * View orchestration stays on PlexState: `openEntity` clears the album / now-
 * playing overlays + pushes the nav frame, then calls {@link load}; `goBack`
 * etc. call {@link clear}. Deps (session, the library album list, IPC) are
 * injected so the request-guard + credit-matching logic is unit-testable.
 */
export class EntityController {
  entity = $state<EntityData | null>(null)
  loading = $state(false)
  error = $state<string | null>(null)
  credited = $state<CreditedResult | null>(null)
  creditedLoading = $state(false)
  creditedError = $state<string | null>(null)
  appearances = $state<AppearanceRow[] | null>(null)
  bio = $state<ArtistBio | null>(null)
  bioLoading = $state(false)
  /** MB discography the user doesn't own (albums/EPs). Null until loaded. */
  missing = $state<MissingRelease[] | null>(null)
  missingLoading = $state(false)
  /** The current entity's MBID — also the request-sequence guard. Read by
   *  PlexState.closeEntity to pop the matching nav frame, and reactively by
   *  Entity.svelte to reset per-artist view state (bio tab, expansion). */
  mbid = $state<string | null>(null)

  // Session-scoped stale-while-revalidate cache, keyed by MBID. Bouncing
  // between two artists while walking the credit graph re-renders each page
  // instantly from here while load() re-fires every fetch to freshen it.
  #cache = new LruCache<string, EntityCacheEntry>(ENTITY_LRU)

  #deps: EntityDeps
  #plex: PlexApi

  constructor(deps: EntityDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  private get session(): Session | null {
    return this.#deps.session()
  }

  /**
   * Fire the entity page's fetches (bio, browse, info, credited, appearances).
   * Each result is dropped unless `mbid` still matches when it lands — the
   * guard against a stale earlier artist overwriting a newer selection.
   *
   * Stale-while-revalidate: a recently viewed artist hydrates every section
   * from the cache synchronously (no spinners for pieces already settled),
   * and the fetches below all still run, updating both state and the cache in
   * place as fresher answers land. A cache miss is exactly the old cold path.
   */
  /**
   * Show the page for `name` before its MBID is known: header with the name,
   * library pill pulsing, every section quiet. The click reads as instant;
   * {@link load} fills it in once the ID resolves, {@link cancelResolving}
   * takes it down if it can't be. Resolving = `entity` set with `mbid` null.
   */
  beginResolving(name: string): void {
    this.mbid = null
    this.entity = { browse: null, info: null, name }
    this.loading = true
    this.error = null
    this.credited = null
    this.creditedError = null
    this.creditedLoading = false
    this.appearances = null
    this.bio = null
    this.bioLoading = false
    this.missing = null
    this.missingLoading = false
  }

  get resolving(): boolean {
    return this.entity !== null && this.mbid === null
  }

  /** Take down a page opened by {@link beginResolving} that never resolved. */
  cancelResolving(): void {
    if (this.resolving) this.clear()
  }

  load(mbid: string, name: string): void {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    const entry = this.#cache.get(mbid) ?? {}
    this.#cache.set(mbid, entry)
    this.mbid = mbid
    this.entity = entry.entity ?? { browse: null, info: null, name }
    this.loading = !entry.entity?.browse
    this.error = null
    this.credited = entry.credited ?? null
    this.creditedError = null
    this.creditedLoading = !entry.credited
    this.appearances = entry.appearances ?? null
    this.bio = entry.bio ?? null
    this.bioLoading = entry.bio === undefined
    this.missing = entry.missing ?? null
    this.missingLoading = entry.missing === undefined
    const serverId = s.preferredServerId

    void this.#plex
      .getArtistBio({ mbid, name })
      .then((bio) => {
        // Fresh data for this MBID is cache-worthy even if the user has
        // already moved on — only the *state* write needs the guard.
        entry.bio = bio
        if (this.mbid !== mbid) return
        this.bio = bio
      })
      .catch(() => {
        // optional enrichment
      })
      .finally(() => {
        if (this.mbid === mbid) this.bioLoading = false
      })

    const browsePromise = this.#plex.browseArtist({ serverId, name, mbid })
    void browsePromise
      .then((browse) => {
        if (this.mbid !== mbid || !this.entity) return
        this.entity = { ...this.entity, browse }
        entry.entity = this.entity
      })
      .catch((err) => {
        if (this.mbid !== mbid) return
        this.error = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        if (this.mbid === mbid) this.loading = false
      })

    void this.#plex
      .getArtistInfo({ mbid })
      .then((info) => {
        if (this.mbid !== mbid || !this.entity) return
        this.entity = { ...this.entity, info }
        entry.entity = this.entity
      })
      .catch(() => {
        // non-essential; header just stays minimal
      })

    void this.#loadCredited(mbid, entry)
    void this.#loadAppearances(mbid, entry)
    void this.#loadMissing(mbid, name, browsePromise, entry)
  }

  // The artist's own discography diffed against the library — "albums not on
  // your server". Waits on browse (best-effort) so the matched Plex artist's
  // title can join the MB name as a match candidate; a browse failure only
  // costs that alias, not the section.
  async #loadMissing(
    mbid: string,
    name: string,
    browsePromise: Promise<ArtistBrowse>,
    entry: EntityCacheEntry
  ): Promise<void> {
    try {
      const [groups, albums, browse] = await Promise.all([
        this.#plex.getArtistDiscography({ mbid }),
        this.#deps.ensureAllAlbums(),
        browsePromise.catch(() => null)
      ])
      if (this.mbid !== mbid) return
      const names = [name]
      if (browse?.plexArtist?.title) names.push(browse.plexArtist.title)
      this.missing = missingFromLibrary(groups, names, albums)
      entry.missing = this.missing
    } catch {
      // non-essential enrichment — the section just doesn't render
    } finally {
      if (this.mbid === mbid) this.missingLoading = false
    }
  }

  // Hits the inverted album-credits index. No MB roundtrip; the entity page
  // shows in-library credits the moment the index has built (~once per
  // session). Independent of #loadCredited's slower MB walk.
  async #loadAppearances(mbid: string, entry: EntityCacheEntry): Promise<void> {
    try {
      const [appearances, albums] = await Promise.all([
        this.#plex.getInLibraryAppearances({ mbid }),
        this.#deps.ensureAllAlbums()
      ])
      if (this.mbid !== mbid) return
      const byRk = new Map<string, PlexAlbum>()
      for (const a of albums) byRk.set(a.ratingKey, a)
      const rows: AppearanceRow[] = []
      for (const ap of appearances) {
        const album = byRk.get(ap.plexRatingKey)
        if (!album) continue // album was removed from library since the credit was cached
        rows.push({ album, roles: ap.roles })
      }
      rows.sort((a, b) => (a.album.year ?? 9999) - (b.album.year ?? 9999))
      entry.appearances = rows
      if (this.mbid === mbid) this.appearances = rows
    } catch (err) {
      // non-fatal — the user still gets the MB-walked credited section
      console.warn('[entity] appearances index failed:', err)
    }
  }

  // Note: unlike the other fetches this has no mbid guard — matches the
  // original loadEntityCredited (a known quirk, preserved by this refactor).
  async #loadCredited(mbid: string, entry: EntityCacheEntry): Promise<void> {
    try {
      const [works, albums] = await Promise.all([
        this.#plex.getArtistCreditedWorks({ mbid }),
        this.#deps.ensureAllAlbums()
      ])
      this.credited = matchCreditedWorks(works, albums)
      entry.credited = this.credited
      this.creditedError = null
    } catch (err) {
      this.creditedError = err instanceof Error ? err.message : String(err)
    } finally {
      this.creditedLoading = false
    }
  }

  /**
   * Drop every cached artist bundle. Called when the library itself mutates
   * (album deletion, server/section switch) — the in-library sections of a
   * cached page would otherwise flash rows that no longer exist.
   */
  invalidateCache(): void {
    this.#cache.clear()
  }

  // Note: deliberately leaves `appearances` untouched (matches the original
  // clearEntityState) — load() resets it before the next page renders. The
  // cache also survives clear(): closing the page shouldn't cost the instant
  // re-open.
  clear(): void {
    this.entity = null
    this.mbid = null
    this.loading = false
    this.error = null
    this.credited = null
    this.creditedLoading = false
    this.creditedError = null
    this.bio = null
    this.bioLoading = false
    this.missing = null
    this.missingLoading = false
  }
}
