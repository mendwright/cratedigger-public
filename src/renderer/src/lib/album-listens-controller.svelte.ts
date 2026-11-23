import type { AlbumListen, AlbumListenMap } from '../../../shared/neglect'

type HistoryApi = Window['cratedigger']['history']

/**
 * All-time listening per library album, from the 20-year history on the
 * tagger. Drives neglected favorites (sort + shelf) and neglected gems.
 * `map` stays null when there's no history for this account (no tagger,
 * Mary's Air, the shop) — callers then use the old Plex-only rules.
 */
export class AlbumListensController {
  map = $state.raw<AlbumListenMap | null>(null)
  #api: HistoryApi
  #loading: Promise<void> | null = null

  constructor(api?: HistoryApi) {
    this.#api = api ?? window.cratedigger.history
  }

  load(): Promise<void> {
    if (!this.#loading) {
      this.#loading = this.#api
        .albumListens()
        .then((map) => {
          this.map = map
        })
        .catch(() => {
          // Tagger down: fall back quietly; a later reload() can retry.
        })
        .finally(() => {
          if (this.map === null) this.#loading = null
        })
    }
    return this.#loading
  }

  /** After an account switch the history belongs to someone else. */
  reset(): void {
    this.map = null
    this.#loading = null
  }

  get(ratingKey: string): AlbumListen | undefined {
    return this.map?.[ratingKey]
  }
}
