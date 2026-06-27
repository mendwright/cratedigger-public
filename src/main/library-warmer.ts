import { BrowserWindow } from 'electron'
import type { LibraryWarmerProgress } from '../shared/plex.js'
import { splitAlbumMbids } from '../shared/guid.js'
import { BackgroundJobRunner, sleep } from './background-job.js'
import { getAlbumCreditsCached, isAlbumCreditsCached } from './musicbrainz.js'
import { getAlbumBio, isAlbumBioCached } from './bios.js'
import { resolveServerContext } from './plex/connection.js'
import { getAlbumDetail } from './plex/library.js'

// Background pre-fetcher: walks every album in the library, asks for credits +
// bio, and lets the on-disk JsonCache stash the results. Designed to run
// overnight (or for several nights) and resume cleanly — already-cached items
// are detected before any network call so re-running on a partially-warmed
// library skips them in milliseconds.
//
// Pacing: MusicBrainz already enforces 1.1s between requests via paced(). The
// warmer additionally sleeps PAUSE_MS between *fetched* items so we never
// hammer the public infra non-stop, and so on-demand UI requests have a
// breathing window to slip into the queue while the warmer is running.

export interface WarmerItem {
  ratingKey: string
  artist: string
  title: string
  year: number | null
  guids: string[]
}

const PAUSE_MS = 2000

const job = new BackgroundJobRunner<LibraryWarmerProgress>(
  {
    running: false,
    done: 0,
    fetched: 0,
    errors: 0,
    total: 0,
    current: null,
    lastError: null
  },
  (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('warmer:progress', progress)
    }
  }
)

export function getLibraryWarmerProgress(): LibraryWarmerProgress {
  return job.getProgress()
}

export function stopLibraryWarmer(): void {
  job.stop()
}

export async function startLibraryWarmer(
  serverId: string,
  items: WarmerItem[]
): Promise<void> {
  await job.run(
    {
      done: 0,
      fetched: 0,
      errors: 0,
      total: items.length,
      current: null,
      lastError: null
    },
    async () => {
      // Resolved lazily on first non-cached item — many runs (resumed from a fully
      // warmed library) will never need a Plex call, so skip the connect.
      let serverCtx: Awaited<ReturnType<typeof resolveServerContext>> | null = null

      for (const item of items) {
        if (job.cancelled) break
        job.update({ current: `${item.artist} — ${item.title}` })
        try {
          const [creditsCached, bioCached] = await Promise.all([
            isAlbumCreditsCached(item.ratingKey),
            isAlbumBioCached(item)
          ])
          if (creditsCached && bioCached) {
            job.update({ done: job.progress.done + 1 })
            continue
          }

          let trackKeys: string[] = []
          let resolvedReleaseMbid: string | null = null
          const { release: releaseFromGuid, releaseGroup: rg } = splitAlbumMbids(item.guids)

          if (!creditsCached) {
            if (!serverCtx) serverCtx = await resolveServerContext(serverId)
            const detail = await getAlbumDetail(serverCtx, item.ratingKey)
            trackKeys = detail.tracks.map((t) => t.ratingKey)
            const credits = await getAlbumCreditsCached(
              item.ratingKey,
              item.artist,
              item.title,
              item.year,
              item.guids,
              trackKeys
            )
            resolvedReleaseMbid = credits?.releaseMbid ?? null
          }

          if (!bioCached) {
            await getAlbumBio({
              releaseMbid: resolvedReleaseMbid ?? releaseFromGuid,
              releaseGroupMbid: rg,
              artist: item.artist,
              title: item.title
            })
          }

          job.update({
            done: job.progress.done + 1,
            fetched: job.progress.fetched + 1
          })
          if (!job.cancelled) await sleep(PAUSE_MS)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(
            `[warmer] ${item.ratingKey} ${item.artist} — ${item.title}: ${msg}`,
            err
          )
          job.update({
            done: job.progress.done + 1,
            errors: job.progress.errors + 1,
            lastError: `${item.artist} — ${item.title}: ${msg}`
          })
          // Even on error, give the network a breather before the next item.
          if (!job.cancelled) await sleep(PAUSE_MS)
        }
      }
    },
    { current: null }
  )
}
