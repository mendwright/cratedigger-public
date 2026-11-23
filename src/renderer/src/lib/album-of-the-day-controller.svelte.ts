import type { PlexAlbum } from '../../../shared/plex'
import type { KeyValueStorage } from './storage'

/** FNV-1a hash of `seedStr` reduced into `[0, len)`. Deterministic, so the
 *  same date+section always picks the same album, but different days/sections
 *  don't collide. Exported for direct testing. */
export function seedIndex(seedStr: string, len: number): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % len
}

export interface AlbumOfTheDayDeps {
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  activeSectionKey: () => string | null
  /** Where the day's pick is memoised. PlexState wires localStorage. */
  storage: KeyValueStorage
}

/**
 * "Album of the day" pick, extracted from PlexState. Deterministic per day per
 * section (FNV-1a over `section:date`) and memoised in the injected storage so
 * the pick is stable across reloads within a day. Components read
 * `plexState.albumOfTheDay.album`.
 */
export class AlbumOfTheDayController {
  album = $state<PlexAlbum | null>(null)

  #deps: AlbumOfTheDayDeps

  constructor(deps: AlbumOfTheDayDeps) {
    this.#deps = deps
  }

  async load(): Promise<void> {
    const all = await this.#deps.ensureAllAlbums()
    if (all.length === 0) {
      this.album = null
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const sectionKey = this.#deps.activeSectionKey() ?? 'default'
    const cacheKey = `jayamp:album-of-the-day:${sectionKey}:${today}`
    const cachedRk = this.#deps.storage.getItem(cacheKey)
    if (cachedRk) {
      const hit = all.find((a) => a.ratingKey === cachedRk)
      if (hit) {
        this.album = hit
        return
      }
    }
    const pick = all[seedIndex(`${sectionKey}:${today}`, all.length)]
    this.album = pick
    this.#deps.storage.setItem(cacheKey, pick.ratingKey)
  }
}
