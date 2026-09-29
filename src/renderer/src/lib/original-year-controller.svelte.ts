type PlexApi = Window['cratedigger']['plex']

export interface OriginalYearDeps {
  /** Toast helper — lives on PlexState (shared across controllers), injected here. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * Manual "original release year" overrides, extracted from PlexState. The
 * auto feature dates an album by its MusicBrainz release-group first-release-date,
 * which is right for ordinary reissues but wrong for box sets / "complete"
 * compilations whose release group is genuinely newer than the music it
 * collects (a 1957 session first boxed in 1999). This holds the per-album
 * user override (ratingKey → year), hydrated from electron-store at startup and
 * mutated from the album page; the main process overlays it on top of the auto
 * index so a pinned year wins everywhere a year shows or sorts.
 */
export class OriginalYearController {
  // ratingKey → pinned year. Hydrated from the store via load() at startup.
  overrides = $state<Record<string, number>>({})

  #deps: OriginalYearDeps
  #plex: PlexApi

  constructor(deps: OriginalYearDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Hydrate the override map from the store. Tolerates an empty store on first
  // run (keeps the {} default).
  async load(): Promise<void> {
    try {
      this.overrides = await this.#plex.listOriginalYearOverrides()
    } catch {
      // store may be empty on first run; ignore and keep the {} default
    }
  }

  // The pinned year for an album, or undefined if none. Callers prefer this over
  // the MusicBrainz-derived year.
  get(ratingKey: string): number | undefined {
    return this.overrides[ratingKey]
  }

  // Pin an original year for an album and persist it. Updates the reactive map
  // first so the open album re-dates immediately, then writes through IPC.
  async set(ratingKey: string, year: number): Promise<void> {
    this.overrides = { ...this.overrides, [ratingKey]: year }
    try {
      await this.#plex.setOriginalYearOverride({ plexRatingKey: ratingKey, year })
      this.#deps.flashToast('ok', `Original year set to ${year}`)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : 'Could not save year')
    }
  }

  // Drop the override and persist the removal, reverting to the auto year.
  async clear(ratingKey: string): Promise<void> {
    const next = { ...this.overrides }
    delete next[ratingKey]
    this.overrides = next
    try {
      await this.#plex.clearOriginalYearOverride({ plexRatingKey: ratingKey })
      this.#deps.flashToast('ok', 'Reverted to automatic year')
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : 'Could not clear year')
    }
  }
}
