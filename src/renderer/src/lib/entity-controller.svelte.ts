import type {
  ArtistBio,
  ArtistBrowse,
  CreditedWork,
  PersonAppearance,
  PlexAlbum
} from '../../../shared/plex'
import { matchCreditedWorks } from '../../../shared/title-match'
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
  /** The current entity's MBID — also the request-sequence guard. Read by
   *  PlexState.closeEntity to pop the matching nav frame. */
  mbid: string | null = null

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
   */
  load(mbid: string, name: string): void {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    this.mbid = mbid
    this.entity = { browse: null, info: null, name }
    this.loading = true
    this.error = null
    this.credited = null
    this.creditedError = null
    this.creditedLoading = true
    this.appearances = null
    this.bio = null
    this.bioLoading = true
    const serverId = s.preferredServerId

    void this.#plex
      .getArtistBio({ mbid, name })
      .then((bio) => {
        if (this.mbid !== mbid) return
        this.bio = bio
      })
      .catch(() => {
        // optional enrichment
      })
      .finally(() => {
        if (this.mbid === mbid) this.bioLoading = false
      })

    void this.#plex
      .browseArtist({ serverId, name, mbid })
      .then((browse) => {
        if (this.mbid !== mbid || !this.entity) return
        this.entity = { ...this.entity, browse }
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
      })
      .catch(() => {
        // non-essential; header just stays minimal
      })

    void this.#loadCredited(mbid)
    void this.#loadAppearances(mbid)
  }

  // Hits the inverted album-credits index. No MB roundtrip; the entity page
  // shows in-library credits the moment the index has built (~once per
  // session). Independent of #loadCredited's slower MB walk.
  async #loadAppearances(mbid: string): Promise<void> {
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
      if (this.mbid === mbid) this.appearances = rows
    } catch (err) {
      // non-fatal — the user still gets the MB-walked credited section
      console.warn('[entity] appearances index failed:', err)
    }
  }

  // Note: unlike the other fetches this has no mbid guard — matches the
  // original loadEntityCredited (a known quirk, preserved by this refactor).
  async #loadCredited(mbid: string): Promise<void> {
    try {
      const [works, albums] = await Promise.all([
        this.#plex.getArtistCreditedWorks({ mbid }),
        this.#deps.ensureAllAlbums()
      ])
      this.credited = matchCreditedWorks(works, albums)
      this.creditedError = null
    } catch (err) {
      this.creditedError = err instanceof Error ? err.message : String(err)
    } finally {
      this.creditedLoading = false
    }
  }

  // Note: deliberately leaves `appearances` untouched (matches the original
  // clearEntityState) — load() resets it before the next page renders.
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
  }
}
