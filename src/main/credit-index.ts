import { app } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AlbumCredits } from '../shared/plex.js'

// Inverted view over the on-disk album-credits cache:
//   `personMbid → appearances` across every album the library-warmer has
//   already credited-walked. The build walks `userData/mb-cache/album-credits`
//   directly (bypassing JsonCache so we can enumerate keys), holds the result
//   in process memory, and rebuilds from scratch on invalidation. Full build
//   is well under 100ms for thousands of albums.
//
// Used by the Entity page to populate "your library credits" instantly,
// without the 10–30s MusicBrainz walk that getArtistCreditedWorks needs.

export interface PersonAppearance {
  plexRatingKey: string
  // role / instrument pairs distinct to this album. "instrument" is the
  // specific instrument when the credit came from a per-recording relation
  // ("instrument" + instrument="guitar"); null when the relation didn't
  // carry an instrument (producer, vocals, member-of, etc).
  roles: { role: string; instrument: string | null }[]
}

const CACHE_ENVELOPE_VERSION = 1 // matches mb-cache.ts CACHE_VERSION

let cache: Map<string, PersonAppearance[]> | null = null
let building: Promise<Map<string, PersonAppearance[]>> | null = null

async function build(): Promise<Map<string, PersonAppearance[]>> {
  const dir = join(app.getPath('userData'), 'mb-cache', 'album-credits')
  const index = new Map<string, PersonAppearance[]>()
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    // Directory doesn't exist yet — nothing's been credited-walked.
    return index
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const plexRatingKey = f.slice(0, -'.json'.length)
    let env: { v: number; d: AlbumCredits | null }
    try {
      env = JSON.parse(await readFile(join(dir, f), 'utf8'))
    } catch {
      continue
    }
    if (env.v !== CACHE_ENVELOPE_VERSION || !env.d) continue
    const credits = env.d

    // Collect distinct (role, instrument) pairs per mbid for this album.
    const perPerson = new Map<string, Map<string, string | null>>()
    const add = (mbid: string, role: string, instrument: string | null): void => {
      if (!mbid) return
      let roles = perPerson.get(mbid)
      if (!roles) {
        roles = new Map()
        perPerson.set(mbid, roles)
      }
      const key = instrument ? `${role}::${instrument}` : role
      if (!roles.has(key)) roles.set(key, instrument)
    }

    for (const r of credits.releaseLevel) add(r.person.mbid, r.role, null)
    for (const list of Object.values(credits.byTrack)) {
      for (const c of list) add(c.person.mbid, c.role, c.instrument)
    }
    for (const m of credits.members) add(m.mbid, 'member', null)

    for (const [mbid, rolesMap] of perPerson) {
      const roles: PersonAppearance['roles'] = []
      for (const [key, instrument] of rolesMap) {
        const role = key.includes('::') ? key.split('::', 1)[0] : key
        roles.push({ role, instrument })
      }
      const list = index.get(mbid)
      if (list) list.push({ plexRatingKey, roles })
      else index.set(mbid, [{ plexRatingKey, roles }])
    }
  }
  return index
}

export async function getInLibraryAppearances(mbid: string): Promise<PersonAppearance[]> {
  if (!mbid) return []
  if (!cache) {
    if (!building) building = build()
    cache = await building
    building = null
  }
  return cache.get(mbid) ?? []
}

// Bust the in-memory index. Callers in musicbrainz.ts hook this whenever the
// album-credits cache is written or invalidated so a follow-up lookup
// reflects the change without an app restart.
export function invalidateCreditIndex(): void {
  cache = null
  building = null
}
