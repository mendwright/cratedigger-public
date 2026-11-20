import type { PlexCollection } from '../../../shared/plex'
import type { Session } from './plex-state.svelte'

type PlexApi = Window['cratedigger']['plex']

export interface CratesDeps {
  session: () => Session | null
  sectionKey: () => string | null
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Keep the in-memory album caches' collection tags in step with an
   *  add/remove, so the crate filter and picker checkmarks update live
   *  without a full library re-fetch. */
  patchAlbumCrate: (albumRatingKey: string, crateTitle: string, present: boolean) => void
  /** Fired after a crate is deleted so the orchestrator can clear an
   *  active crate filter pointing at it. */
  onCrateDeleted: (ratingKey: string) => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * Crates: the user's hand-picked album shelves, stored as Plex collections
 * (type=9, album grain) — server-side, so Plexamp and the shop Mac see the
 * same crates. Membership truth for the UI is the Collection tags on each
 * album row (fetched with the library); this controller owns the crate
 * list itself plus the add/remove/create/delete calls.
 */
export class CratesController {
  crates = $state<PlexCollection[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  #deps: CratesDeps
  private plex: PlexApi

  constructor(deps: CratesDeps) {
    this.#deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
  }

  private get serverId(): string | null {
    const s = this.#deps.session()
    return s?.signedIn ? (s.preferredServerId ?? null) : null
  }

  async refresh(): Promise<void> {
    const sid = this.serverId
    const sectionKey = this.#deps.sectionKey()
    if (!sid || !sectionKey) return
    this.loading = true
    this.error = null
    try {
      this.crates = await this.plex.listCollections({ serverId: sid, sectionKey })
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  /** New empty crate from the rail — filed into afterwards via right-click. */
  async createEmpty(title: string): Promise<void> {
    const sid = this.serverId
    const sectionKey = this.#deps.sectionKey()
    if (!sid || !sectionKey || !title.trim()) return
    try {
      const created = await this.plex.createCollection({
        serverId: sid,
        sectionKey,
        title: title.trim(),
        albumRatingKeys: []
      })
      this.crates = [...this.crates, created]
      this.#deps.flashToast('ok', `Started crate “${created.title}” — right-click albums to file them`)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async create(title: string, album: { ratingKey: string; label: string }): Promise<void> {
    const sid = this.serverId
    const sectionKey = this.#deps.sectionKey()
    if (!sid || !sectionKey || !title.trim()) return
    try {
      const created = await this.plex.createCollection({
        serverId: sid,
        sectionKey,
        title: title.trim(),
        albumRatingKeys: [album.ratingKey]
      })
      this.crates = [...this.crates, { ...created, childCount: Math.max(created.childCount, 1) }]
      this.#deps.patchAlbumCrate(album.ratingKey, created.title, true)
      this.#deps.flashToast('ok', `Started crate “${created.title}” with ${album.label}`)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  // add/removeItem are optimistic: the membership patch and count land
  // BEFORE the server call so the picker row answers the click instantly,
  // and are rolled back if Plex says no. (The toast still fires, but it
  // pops at the bottom of the screen where nobody's looking mid-modal.)
  async add(crate: PlexCollection, album: { ratingKey: string; label: string }): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    this.#deps.patchAlbumCrate(album.ratingKey, crate.title, true)
    this.bumpCount(crate.ratingKey, +1)
    try {
      await this.plex.collectionAdd({
        serverId: sid,
        ratingKey: crate.ratingKey,
        albumRatingKeys: [album.ratingKey]
      })
      this.#deps.flashToast('ok', `Filed ${album.label} in “${crate.title}”`)
    } catch (err) {
      this.#deps.patchAlbumCrate(album.ratingKey, crate.title, false)
      this.bumpCount(crate.ratingKey, -1)
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async removeItem(crate: PlexCollection, album: { ratingKey: string; label: string }): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    this.#deps.patchAlbumCrate(album.ratingKey, crate.title, false)
    this.bumpCount(crate.ratingKey, -1)
    try {
      await this.plex.collectionRemoveItem({
        serverId: sid,
        ratingKey: crate.ratingKey,
        albumRatingKey: album.ratingKey
      })
      this.#deps.flashToast('ok', `Took ${album.label} out of “${crate.title}”`)
    } catch (err) {
      this.#deps.patchAlbumCrate(album.ratingKey, crate.title, true)
      this.bumpCount(crate.ratingKey, +1)
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  private bumpCount(ratingKey: string, delta: number): void {
    this.crates = this.crates.map((c) =>
      c.ratingKey === ratingKey ? { ...c, childCount: Math.max(0, c.childCount + delta) } : c
    )
  }

  /** Deletes the crate itself; the albums in it are untouched. */
  async remove(crate: PlexCollection): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    try {
      await this.plex.deleteCollection({ serverId: sid, ratingKey: crate.ratingKey })
      this.crates = this.crates.filter((c) => c.ratingKey !== crate.ratingKey)
      this.#deps.onCrateDeleted(crate.ratingKey)
      this.#deps.flashToast('ok', `Deleted crate “${crate.title}” (albums kept)`)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }
}
