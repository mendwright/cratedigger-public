import { BrowserWindow } from 'electron'
import type {
  MbArtistReleaseGroup,
  ReleaseRadarProgress,
  ReleaseRadarRow,
  ReleaseRadarSnapshot
} from '../shared/plex.js'
import {
  fetchArtistReleaseGroups,
  getArtistReleaseGroupsCached
} from './musicbrainz.js'
import { BackgroundJobRunner, sleep } from './background-job.js'
import { resolveServerContext } from './plex/connection.js'
import { listAllArtistsWithGuids, type LibraryArtist } from './plex/library.js'
import { getValue, setValue } from './store.js'

// Release Radar: walk every library artist with an MBID, ask MusicBrainz for
// their release-groups, and bucket the results into "recent" and "upcoming".
//
// Pacing: MB enforces 1.1s between requests via paced(), and we add a small
// PAUSE_MS so on-demand UI calls (album credits) can slip into the queue
// without starving while the radar is running. CACHE_TTL_MS keeps us from
// re-hammering MB for an artist we already fetched today.

const RECENT_WINDOW_DAYS = 60
const UPCOMING_WINDOW_DAYS = 365
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000
const PAUSE_MS = 250
// Secondary-types we drop: live recordings, compilations, soundtracks, etc —
// the radar surfaces *new artist work*, not reissues and stage tapes.
const EXCLUDED_SECONDARY = new Set([
  'compilation',
  'live',
  'soundtrack',
  'remix',
  'dj-mix',
  'mixtape/street',
  'demo',
  'interview',
  'spokenword',
  'audiobook',
  'audio drama'
])

const job = new BackgroundJobRunner<ReleaseRadarProgress>(
  {
    running: false,
    phase: 'idle',
    done: 0,
    total: 0,
    fetched: 0,
    errors: 0,
    currentArtist: null,
    lastError: null,
    snapshot: null
  },
  (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('releases:progress', progress)
    }
  }
)

export function getReleaseRadarProgress(): ReleaseRadarProgress {
  return { ...job.getProgress(), snapshot: getValue('releaseRadar') }
}

export function stopReleaseRadar(): void {
  job.stop()
}

// MB dates come as YYYY, YYYY-MM, or YYYY-MM-DD. Normalise to a JS Date by
// padding missing components — pad with `01` so the date sorts at the start
// of the period, which matches "first release date".
function parseFirstReleaseDate(date: string): Date | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(date)
  if (!m) return null
  const yyyy = parseInt(m[1], 10)
  const mm = parseInt(m[2] ?? '01', 10) - 1
  const dd = parseInt(m[3] ?? '01', 10)
  const d = new Date(Date.UTC(yyyy, mm, dd))
  return Number.isNaN(d.getTime()) ? null : d
}

function isWanted(rg: MbArtistReleaseGroup): boolean {
  if (!rg.firstReleaseDate) return false
  for (const t of rg.secondaryTypes) {
    if (EXCLUDED_SECONDARY.has(t.toLowerCase())) return false
  }
  return true
}

function bucket(
  artists: LibraryArtist[],
  groupsByArtist: Map<string, MbArtistReleaseGroup[]>
): ReleaseRadarSnapshot {
  const now = Date.now()
  const recentCutoff = now - RECENT_WINDOW_DAYS * 24 * 3600 * 1000
  const upcomingCutoff = now + UPCOMING_WINDOW_DAYS * 24 * 3600 * 1000
  const recent: ReleaseRadarRow[] = []
  const upcoming: ReleaseRadarRow[] = []
  // Collab release-groups (e.g. Drake & Kanye) appear in the per-artist
  // browse response for every credited artist. Dedupe by release-group MBID,
  // attributing the row to the first library artist we encountered.
  const seen = new Set<string>()

  for (const artist of artists) {
    if (!artist.mbid) continue
    const groups = groupsByArtist.get(artist.mbid) ?? []
    for (const rg of groups) {
      if (!isWanted(rg) || !rg.firstReleaseDate) continue
      if (seen.has(rg.mbid)) continue
      const d = parseFirstReleaseDate(rg.firstReleaseDate)
      if (!d) continue
      const ts = d.getTime()
      const row: ReleaseRadarRow = {
        artistMbid: artist.mbid,
        artistName: artist.name,
        artistRatingKey: artist.ratingKey,
        releaseGroupMbid: rg.mbid,
        title: rg.title,
        firstReleaseDate: rg.firstReleaseDate,
        primaryType: rg.primaryType,
        disambiguation: rg.disambiguation
      }
      if (ts > now && ts <= upcomingCutoff) {
        upcoming.push(row)
        seen.add(rg.mbid)
      } else if (ts <= now && ts >= recentCutoff) {
        recent.push(row)
        seen.add(rg.mbid)
      }
    }
  }

  // Most-recent-first for "recent"; soonest-first for "upcoming".
  recent.sort((a, b) => b.firstReleaseDate.localeCompare(a.firstReleaseDate))
  upcoming.sort((a, b) => a.firstReleaseDate.localeCompare(b.firstReleaseDate))

  return { recent, upcoming, builtAt: now }
}

export async function runReleaseRadar(serverId: string): Promise<ReleaseRadarSnapshot> {
  const result = await job.run(
    {
      phase: 'enumerating',
      done: 0,
      total: 0,
      fetched: 0,
      errors: 0,
      currentArtist: null,
      lastError: null
    },
    async () => {
      const ctx = await resolveServerContext(serverId)
      const artists = await listAllArtistsWithGuids(ctx)
      const withMbid = artists.filter((a) => !!a.mbid)
      job.update({ phase: 'fetching', total: withMbid.length })

      const groupsByArtist = new Map<string, MbArtistReleaseGroup[]>()
      for (const artist of withMbid) {
        if (job.cancelled) break
        const mbid = artist.mbid!
        job.update({ currentArtist: artist.name })
        try {
          let didFetch = false
          const cached = await getArtistReleaseGroupsCached(mbid)
          if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            groupsByArtist.set(mbid, cached.groups)
          } else {
            const entry = await fetchArtistReleaseGroups(mbid)
            groupsByArtist.set(mbid, entry.groups)
            didFetch = true
          }
          job.update({
            done: job.progress.done + 1,
            fetched: didFetch ? job.progress.fetched + 1 : job.progress.fetched
          })
          if (didFetch && !job.cancelled) await sleep(PAUSE_MS)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[release-radar] ${artist.name} (${mbid}): ${msg}`, err)
          job.update({
            done: job.progress.done + 1,
            errors: job.progress.errors + 1,
            lastError: `${artist.name}: ${msg}`
          })
        }
      }

      const snapshot = bucket(withMbid, groupsByArtist)
      setValue('releaseRadar', snapshot)
      job.update({ phase: 'done', currentArtist: null, snapshot })
      return snapshot
    }
  )
  // `undefined` means a run was already in flight — hand back the last stored
  // snapshot rather than kicking off a second concurrent walk.
  return result ?? getValue('releaseRadar') ?? { recent: [], upcoming: [], builtAt: null }
}
