import type { MbReleaseCandidate } from '../../../shared/plex'

type PlexApi = Window['cratedigger']['plex']

export interface ManualMatchDeps {
  /** Toast helper — lives on PlexState (shared across controllers), injected here. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Called after a match is pinned or cleared so the album's credits refresh
   *  (PlexState reloads the open album-detail loader if it's showing this album). */
  onMatchChanged: (plexRatingKey: string) => Promise<void> | void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/** The manual-match modal's state, or null when the modal is closed. */
export interface ManualMatchState {
  plexRatingKey: string
  artist: string
  title: string
  query: { artist: string; title: string }
  candidates: MbReleaseCandidate[]
  loading: boolean
  error: string | null
  submitting: boolean
}

/**
 * Manual album→MusicBrainz match, extracted from PlexState: the modal that
 * lets the user search MB releases and pin one when auto-reconcile picked
 * wrong. Confirm/clear persist via IPC (`plex:set-album-match` /
 * `plex:clear-album-match`, which bust the per-album credit cache in main)
 * and then refresh the open album's credits through
 * {@link ManualMatchDeps.onMatchChanged}. Components read
 * `plexState.manualMatch.*`.
 */
export class ManualMatchController {
  current = $state<ManualMatchState | null>(null)

  #deps: ManualMatchDeps
  #plex: PlexApi

  constructor(deps: ManualMatchDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  open(plexRatingKey: string, artist: string, title: string): void {
    this.current = {
      plexRatingKey,
      artist,
      title,
      query: { artist, title },
      candidates: [],
      loading: true,
      error: null,
      submitting: false
    }
    void this.runSearch()
  }

  close(): void {
    this.current = null
  }

  setQuery(artist: string, title: string): void {
    if (!this.current) return
    this.current = { ...this.current, query: { artist, title } }
  }

  async runSearch(): Promise<void> {
    const m = this.current
    if (!m) return
    this.current = { ...m, loading: true, error: null }
    try {
      const results = await this.#plex.searchReleaseCandidates({
        artist: m.query.artist,
        title: m.query.title
      })
      if (this.current && this.current.plexRatingKey === m.plexRatingKey) {
        this.current = { ...this.current, candidates: results, loading: false }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.current && this.current.plexRatingKey === m.plexRatingKey) {
        this.current = { ...this.current, error: msg, loading: false }
      }
    }
  }

  async confirm(mbReleaseMbid: string): Promise<void> {
    const m = this.current
    if (!m) return
    this.current = { ...m, submitting: true, error: null }
    try {
      await this.#plex.setAlbumMatch({
        plexRatingKey: m.plexRatingKey,
        mbReleaseMbid
      })
      this.current = null
      await this.#deps.onMatchChanged(m.plexRatingKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.current) {
        this.current = { ...this.current, submitting: false, error: msg }
      }
    }
  }

  async clearMatch(plexRatingKey: string): Promise<void> {
    try {
      await this.#plex.clearAlbumMatch({ plexRatingKey })
      await this.#deps.onMatchChanged(plexRatingKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', msg)
    }
  }
}
