import { AccoladeIndex, type Accolade, type AccoladeSource } from '../../../shared/accolades'

type AccoladesApi = Window['cratedigger']['accolades']

export interface AccoladesDeps {
  /** Which sources the user has switched on (settings), in trust order. */
  enabledSources: () => readonly AccoladeSource[]
  /** Defaults to the live bridge; tests pass a stub. */
  api?: AccoladesApi
}

/**
 * Critics' picks for cover stickers. Loads the tagger's list once (main caches
 * it, with a disk fallback) and answers "which picks does this album have?"
 * by artist + title. The index rebuilds itself when the source switches
 * change, so toggling a source in Settings updates every cover at once.
 */
export class AccoladesController {
  entries = $state.raw<readonly Accolade[]>([])
  #api: AccoladesApi
  #enabled: AccoladesDeps['enabledSources']
  #loading: Promise<void> | null = null

  // Lazy: first read happens after the constructor has stored #enabled.
  index = $derived.by(() => new AccoladeIndex(this.entries, this.#enabled()))

  constructor(deps: AccoladesDeps) {
    this.#api = deps.api ?? window.cratedigger.accolades
    this.#enabled = deps.enabledSources
  }

  load(): Promise<void> {
    if (!this.#loading) {
      this.#loading = this.#api
        .list()
        .then((entries) => {
          this.entries = entries
        })
        .catch(() => {
          // No tagger / offline with no cache: no stickers, nothing to say.
        })
    }
    return this.#loading
  }

  lookup(artist: string | null | undefined, title: string | null | undefined): Accolade[] {
    if (!artist || !title) return []
    return this.index.lookup(artist, title)
  }
}
