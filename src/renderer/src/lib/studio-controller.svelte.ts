import type { StudioHow, StudioPerson } from '../../../shared/studio'

type StudioApi = Window['cratedigger']['studio']

export interface StudioBadge {
  name: string
  mbid: string | null
  how: StudioHow
}

/**
 * Studio badges ("recorded by Albini"): the configured people and their
 * board credits, resolved in main from the cached MusicBrainz credits.
 * Keyed by Plex ratingKey — exact, no title matching. Reload after the
 * Settings list changes; otherwise once per launch.
 */
export class StudioController {
  people = $state.raw<readonly StudioPerson[]>([])
  #api: StudioApi
  #loading: Promise<void> | null = null

  byAlbum = $derived.by(() => {
    const map = new Map<string, StudioBadge[]>()
    for (const p of this.people) {
      for (const [rk, how] of Object.entries(p.albums)) {
        const list = map.get(rk)
        const badge = { name: p.name, mbid: p.mbid, how }
        if (list) list.push(badge)
        else map.set(rk, [badge])
      }
    }
    return map
  })

  constructor(deps: { api?: StudioApi } = {}) {
    this.#api = deps.api ?? window.cratedigger.studio
  }

  load(force = false): Promise<void> {
    if (force || !this.#loading) {
      this.#loading = this.#api
        .list()
        .then((people) => {
          this.people = people
        })
        .catch(() => {
          // No credits cached yet: no badges, nothing to say.
        })
    }
    return this.#loading
  }

  forAlbum(ratingKey: string | null | undefined): StudioBadge[] {
    if (!ratingKey) return []
    return this.byAlbum.get(ratingKey) ?? []
  }
}
