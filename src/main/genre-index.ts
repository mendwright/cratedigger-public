import { BrowserWindow } from 'electron'
import {
  getReleaseGenres,
  getReleaseGroupGenres,
  getReleaseGroupForRelease,
  getGenreVocabulary
} from './musicbrainz.js'
import { getLastfmAlbumTags } from './bios.js'
import { BackgroundJobRunner, sleep } from './background-job.js'
import { getValue, patchRecord, setValue } from './store.js'
import { buildGenreVocabulary, genresFromTags } from '../shared/genre-vocab.js'
import type { GenreVocabulary } from '../shared/genre-vocab.js'
import type { GenreIndexProgress } from '../shared/plex.js'

// Backfills a real genre per album, because Plex's own tags don't support
// browsing. Measured on this library: 4,061 albums, 13% with no genre at all,
// 551 filed under a single "Rock", and 355 genres used exactly once. The crate
// rail built on that shows five giant buckets and a few hundred rows reading
// "1".
//
// Source order is most-specific-first:
//   1. MB release genres     — the MBID Plex actually stores
//   2. MB release-group      — where MB more often keeps them
//   3. Last.fm album tags    — filtered through MB's genre vocabulary
// Plex's own tags are the final fallback, applied at view time rather than
// written here (see the `albumGenres` comment in store.ts).

// Everything the indexer needs for one album, gathered by the renderer off the
// already-loaded album list so main doesn't re-query Plex. Mirrors
// `GenreIndexJobItem` in shared/ipc-contract.ts.
export interface GenreJobItem {
  ratingKey: string
  artist: string
  title: string
  releaseMbid: string | null
  releaseGroupMbid: string | null
}

const job = new BackgroundJobRunner<GenreIndexProgress>(
  {
    running: false,
    done: 0,
    total: 0,
    current: null,
    error: null
  },
  (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mb:genre-index-progress', progress)
    }
  }
)

export function getGenreIndexProgress(): GenreIndexProgress {
  return job.getProgress()
}

export function stopGenreIndex(): void {
  job.stop()
}

export function clearAlbumGenres(): void {
  setValue('albumGenres', {})
}

async function resolveGenres(
  item: GenreJobItem,
  vocab: GenreVocabulary | null
): Promise<string[]> {
  if (item.releaseMbid) {
    const genres = await getReleaseGenres(item.releaseMbid)
    if (genres.length > 0) return genres
  }

  // Every Plex guid in this library is a *release* MBID — not one album came
  // back with a release-group guid — so without this hop the release-group
  // tier would never run, and that's where MB keeps most genres.
  let rgid = item.releaseGroupMbid
  if (!rgid && item.releaseMbid) {
    rgid = await getReleaseGroupForRelease(item.releaseMbid)
  }
  if (rgid) {
    const genres = await getReleaseGroupGenres(rgid)
    if (genres.length > 0) return genres
  }

  // Last.fm picks up most of what MB misses — it knew hard rock / glam metal
  // for Ratt, cool jazz for Bill Evans and surf rock for the Beach Boys, none
  // of which MB had. Its tags are folksonomy, so only names MB recognises as
  // genres survive.
  if (vocab) {
    const tags = await getLastfmAlbumTags({ artist: item.artist, album: item.title })
    const genres = genresFromTags(tags, vocab)
    if (genres.length > 0) return genres
  }

  return []
}

export async function startGenreIndex(
  items: GenreJobItem[],
  opts: { rebuild?: boolean } = {}
): Promise<void> {
  const existing = getValue('albumGenres')
  const todo = opts.rebuild
    ? items
    : items.filter((it) => !Object.prototype.hasOwnProperty.call(existing, it.ratingKey))

  await job.run(
    {
      done: 0,
      total: todo.length,
      current: null,
      error: null
    },
    async () => {
      // Fetched once per run rather than per album. A failure here is not
      // fatal — it only costs us the Last.fm tier, so MB genres still index.
      let vocab: GenreVocabulary | null = null
      try {
        const names = await getGenreVocabulary()
        if (names.length > 0) vocab = buildGenreVocabulary(names)
      } catch {
        vocab = null
      }

      for (const item of todo) {
        if (job.cancelled) break
        try {
          const genres = await resolveGenres(item, vocab)
          patchRecord('albumGenres', item.ratingKey, genres)
          job.update({
            done: job.progress.done + 1,
            current: genres[0] ?? `${item.artist} — ${item.title}`
          })
        } catch (err) {
          // One bad album shouldn't end a multi-hour crawl — but deliberately
          // do NOT write an empty result here. MB throws 503s under load, and
          // an empty write is indistinguishable from "checked, nothing found":
          // the album would be skipped by every later "index new albums" run
          // and stay genre-less forever off one transient blip. Leaving the key
          // absent means the next run retries it. (Observed for real: an album
          // MB had three genres for resolved to nothing on a second pass.)
          job.update({
            done: job.progress.done + 1,
            current: null,
            error: err instanceof Error ? err.message : String(err)
          })
        }
        // Breather so on-demand UI lookups can slip into the MB queue while a
        // multi-thousand-album crawl is running.
        await sleep(0)
      }
    },
    { current: null }
  )
}
