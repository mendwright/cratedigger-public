import type { CoverCandidate, CoverOverride } from '../../../shared/plex'

type PlexApi = Window['cratedigger']['plex']

export interface CoverArtDeps {
  /** Toast helper — lives on PlexState (shared across controllers), injected here. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/** The cover-picker modal's state, or null when the modal is closed. */
export interface CoverPickerState {
  plexRatingKey: string
  artist: string
  title: string
  mbReleaseMbid: string | null
  query: { artist: string; title: string }
  candidates: CoverCandidate[]
  loading: boolean
  error: string | null
  submitting: boolean
}

/**
 * Cover art, extracted from PlexState: the per-album override map (read on the
 * hot path by `PlexState.thumbUrl`) plus the cover-picker modal that sets it.
 * The picker searches iTunes/Cover Art Archive candidates or takes a local
 * upload, persists the choice via IPC, and updates {@link overrides} so thumbs
 * repaint immediately. Components read `plexState.coverArt.*`.
 */
export class CoverArtController {
  // Per-album cover overrides, hydrated from electron-store at startup (see
  // load()) and mutated through the picker. PlexState.thumbUrl() consults this.
  overrides = $state<Record<string, CoverOverride>>({})

  picker = $state<CoverPickerState | null>(null)

  #deps: CoverArtDeps
  #plex: PlexApi

  constructor(deps: CoverArtDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Hydrate the override map from the store. Tolerates an empty store on first
  // run (keeps the {} default).
  async load(): Promise<void> {
    try {
      this.overrides = await this.#plex.listCoverOverrides()
    } catch {
      // store may be empty on first run; ignore and keep the {} default
    }
  }

  open(
    plexRatingKey: string,
    artist: string,
    title: string,
    mbReleaseMbid: string | null
  ): void {
    this.picker = {
      plexRatingKey,
      artist,
      title,
      mbReleaseMbid,
      query: { artist, title },
      candidates: [],
      loading: true,
      error: null,
      submitting: false
    }
    void this.runSearch()
  }

  close(): void {
    this.picker = null
  }

  setQuery(artist: string, title: string): void {
    if (!this.picker) return
    this.picker = { ...this.picker, query: { artist, title } }
  }

  async runSearch(): Promise<void> {
    const state = this.picker
    if (!state) return
    this.picker = { ...state, loading: true, error: null }
    try {
      const results = await this.#plex.searchCoverCandidates({
        artist: state.query.artist,
        title: state.query.title,
        mbReleaseMbid: state.mbReleaseMbid
      })
      if (this.picker && this.picker.plexRatingKey === state.plexRatingKey) {
        this.picker = { ...this.picker, candidates: results, loading: false }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.picker && this.picker.plexRatingKey === state.plexRatingKey) {
        this.picker = { ...this.picker, error: msg, loading: false }
      }
    }
  }

  async confirm(candidate: CoverCandidate): Promise<void> {
    const state = this.picker
    if (!state) return
    this.picker = { ...state, submitting: true, error: null }
    const override: CoverOverride = {
      source: candidate.source,
      url: candidate.url,
      thumbUrl: candidate.thumbUrl,
      setAt: Date.now()
    }
    try {
      await this.#plex.setCoverOverride({
        plexRatingKey: state.plexRatingKey,
        override
      })
      this.overrides = { ...this.overrides, [state.plexRatingKey]: override }
      this.picker = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.picker) {
        this.picker = { ...this.picker, submitting: false, error: msg }
      }
    }
  }

  // Pick an image off the local machine via a native open-dialog (handled in
  // main) and pin it as the album's cover. No-op if the user cancels.
  async uploadLocal(): Promise<void> {
    const state = this.picker
    if (!state) return
    this.picker = { ...state, submitting: true, error: null }
    try {
      const res = await this.#plex.uploadLocalCover({
        plexRatingKey: state.plexRatingKey
      })
      if (res.canceled || !res.override) {
        if (this.picker && this.picker.plexRatingKey === state.plexRatingKey) {
          this.picker = { ...this.picker, submitting: false }
        }
        return
      }
      this.overrides = { ...this.overrides, [state.plexRatingKey]: res.override }
      this.picker = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.picker && this.picker.plexRatingKey === state.plexRatingKey) {
        this.picker = { ...this.picker, submitting: false, error: msg }
      }
    }
  }

  async clearForAlbum(plexRatingKey: string): Promise<void> {
    try {
      await this.#plex.clearCoverOverride({ plexRatingKey })
      const next = { ...this.overrides }
      delete next[plexRatingKey]
      this.overrides = next
      if (this.picker && this.picker.plexRatingKey === plexRatingKey) {
        this.picker = null
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.#deps.flashToast('err', msg)
    }
  }
}
