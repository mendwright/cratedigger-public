import type { GenreIndexProgress, PlexAlbum } from '../../../shared/plex'
import { splitAlbumMbids } from '../../../shared/guid'
import { effectiveGenres } from '../../../shared/genre-text'

type PlexApi = Window['cratedigger']['plex']

/** The per-album payload the main-process genre indexer needs: identity plus
 *  the MBIDs to look the release up by, and the artist/title Last.fm needs for
 *  its fallback lookup. Pure; exported for testing. */
export function albumToGenreItem(a: PlexAlbum): {
  ratingKey: string
  artist: string
  title: string
  releaseMbid: string | null
  releaseGroupMbid: string | null
} {
  const { release, releaseGroup } = splitAlbumMbids(a.guids)
  return {
    ratingKey: a.ratingKey,
    artist: a.artist,
    title: a.title,
    releaseMbid: release,
    releaseGroupMbid: releaseGroup
  }
}

export interface GenreIndexDeps {
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Clear any active genre filters — called after the index is wiped so the
   *  rail and chips don't keep pointing at crates that no longer exist. */
  clearGenreFilters: () => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * The MusicBrainz genre index. Owns the per-album genre map and the background
 * indexer's progress, and answers "what genres is this album filed under" for
 * the crate rail, the genre chips and the library filter.
 *
 * Plex's genres stay the fallback rather than being overwritten — see
 * {@link genresFor} — so clearing the index puts the library straight back to
 * how it browsed before, with no refetch.
 */
export class GenreIndexController {
  genres = $state<Record<string, string[]>>({})
  progress = $state<GenreIndexProgress>({
    running: false,
    done: 0,
    total: 0,
    current: null,
    error: null
  })

  #deps: GenreIndexDeps
  #plex: PlexApi

  constructor(deps: GenreIndexDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  /** True once the index has anything in it. The library filter uses this to
   *  decide whether genre filtering can still be pushed to the Plex server —
   *  MB genres don't exist there, so once we have any, genre filtering has to
   *  run client-side against the full library. */
  get active(): boolean {
    return Object.keys(this.genres).length > 0
  }

  /** How many albums have been indexed and actually got a genre. */
  get indexedCount(): number {
    return Object.values(this.genres).filter((g) => g.length > 0).length
  }

  /** The genres an album is filed under: MusicBrainz's when we have them,
   *  Plex's otherwise. */
  genresFor(album: PlexAlbum): string[] {
    return effectiveGenres(this.genres[album.ratingKey], album.genres)
  }

  subscribe(): () => void {
    return this.#plex.onGenreIndexProgress((p) => {
      this.progress = p
      if (!p.running && p.done > 0) void this.loadGenres()
    })
  }

  async loadGenres(): Promise<void> {
    try {
      this.genres = await this.#plex.listAlbumGenres()
    } catch {
      // leave existing value in place
    }
  }

  async start(opts: { rebuild?: boolean } = {}): Promise<void> {
    const albums = await this.#deps.ensureAllAlbums()
    const items = albums.map(albumToGenreItem)
    await this.#plex.startGenreIndex({ items, rebuild: opts.rebuild })
  }

  async stop(): Promise<void> {
    await this.#plex.stopGenreIndex()
  }

  async clear(): Promise<void> {
    await this.#plex.clearAlbumGenres()
    this.genres = {}
    this.#deps.clearGenreFilters()
  }
}
