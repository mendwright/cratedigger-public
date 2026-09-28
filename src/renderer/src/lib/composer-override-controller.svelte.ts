import type { ComposerOverride, ComposerSearchResult } from '../../../shared/classical-model'

// The preload bridge exposes every channel (plex:* and mb:*) under one object.
type PlexApi = Window['cratedigger']['plex']

export interface ComposerOverrideDeps {
  /** Toast helper — lives on PlexState (shared across controllers), injected here. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** IPC bridge (plex:* + mb:* channels). Defaults to the live bridge; tests stub. */
  plex?: PlexApi
}

/**
 * Manual composer overrides. Plex browses classical by performer and buries the
 * composer; MusicBrainz reconciliation can't always align a box set's tracks (a
 * different disc split than MB, or untagged rips), so the composer stays hidden
 * even when it's obvious from the record. This holds a per-album user-pinned
 * composer (ratingKey → {mbid, name}), hydrated from electron-store at startup.
 * `resolveEffectiveComposers` gives the override precedence over the MB model for
 * the hero line — but it deliberately does NOT authorize work→movement nesting,
 * which still requires trustworthy alignment. Pinning a composer is an identity
 * assertion, not a claim about which movement belongs to which work.
 */
export class ComposerOverrideController {
  // ratingKey → pinned composer. Hydrated from the store via load() at startup.
  overrides = $state<Record<string, ComposerOverride>>({})

  #deps: ComposerOverrideDeps
  #plex: PlexApi

  constructor(deps: ComposerOverrideDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Hydrate the override map from the store. Tolerates an empty store on first run.
  async load(): Promise<void> {
    try {
      this.overrides = await this.#plex.listComposerOverrides()
    } catch {
      // store may be empty on first run; ignore and keep the {} default
    }
  }

  get(ratingKey: string): ComposerOverride | undefined {
    return this.overrides[ratingKey]
  }

  guess(name: string): Promise<ComposerSearchResult | null> {
    return this.#plex.searchComposerByName({ name: name.trim() })
  }

  // Resolve a free-text composer name to a canonical MusicBrainz identity, so the
  // pinned override carries a real MBID (clickable into the entity graph) and MB's
  // canonical spelling ("Ludwig van Beethoven", not the typed "Beethoven").
  // Returns null when MB can't confidently match the name.
  async resolve(name: string): Promise<ComposerOverride | null> {
    const query = name.trim()
    if (!query) return null
    const person = await this.#plex.searchComposerByName({ name: query })
    return person ? { mbid: person.mbid, name: person.name } : null
  }

  // Pin a composer for an album and persist it. Updates the reactive map first so
  // the open album's hero line lights up immediately, then writes through IPC.
  async set(ratingKey: string, composer: ComposerOverride): Promise<void> {
    this.overrides = { ...this.overrides, [ratingKey]: composer }
    try {
      await this.#plex.setComposerOverride({ plexRatingKey: ratingKey, composer })
      this.#deps.flashToast('ok', `Composer pinned to ${composer.name}`)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : 'Could not pin composer')
    }
  }

  // Drop the override and persist the removal, reverting to the MusicBrainz model.
  async clear(ratingKey: string): Promise<void> {
    const next = { ...this.overrides }
    delete next[ratingKey]
    this.overrides = next
    try {
      await this.#plex.clearComposerOverride({ plexRatingKey: ratingKey })
      this.#deps.flashToast('ok', 'Composer override cleared')
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : 'Could not clear composer')
    }
  }
}
