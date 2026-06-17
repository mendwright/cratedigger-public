import type {
  AlbumCredits,
  ArtistRelation,
  CreditedWork,
  CreditPerson,
  MbArtistReleaseGroup,
  MbReleaseCandidate
} from '../shared/plex.js'
import { getAlbumMatch } from './store.js'
import { JsonCache } from './mb-cache.js'
import { invalidateCreditIndex } from './credit-index.js'
import { originalYears } from './original-years.js'
import { createPaced } from './paced.js'

const MB_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'cratedigger/0.4.0 ( https://github.com/jaybeaman/cratedigger )'
const MIN_GAP_MS = 1100

const paced = createPaced(MIN_GAP_MS)

// Injectable fetch so unit tests can stub HTTP without hitting MusicBrainz.
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)

export function _setFetchForTests(f: typeof fetch): void {
  fetchImpl = f
}

// MB's error responses for 5xx (especially during maintenance windows) are full
// HTML pages. Dumping them into Error messages produces a wall of markup that
// gets displayed verbatim in the UI's credits error slot — see the 503 bug.
// Reduce the body to either the HTML <title> or a short, single-line excerpt.
function summarizeErrorBody(status: number, body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return `HTTP ${status}`
  if (/^\s*</.test(trimmed)) {
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(trimmed)?.[1]?.trim()
    if (title) return title
    if (status === 503) return 'Service Unavailable'
    return `HTTP ${status}`
  }
  const oneLine = trimmed.replace(/\s+/g, ' ')
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine
}

async function mbFetchOnce<T>(path: string): Promise<T> {
  return paced(async () => {
    const res = await fetchImpl(`${MB_BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    })
    if (!res.ok) {
      const summary = summarizeErrorBody(res.status, await res.text())
      throw new Error(`MusicBrainz ${res.status}: ${summary}`)
    }
    return (await res.json()) as T
  })
}

// MB occasionally drops TLS connections mid-request (ECONNRESET / undici
// "fetch failed") without a status code, and 503s during high-traffic windows
// also happen. Retry transient failures so the multi-day warmer doesn't
// accumulate hundreds of false errors. 4xx is treated as terminal — bad query
// won't get better with more attempts.
export async function mbFetch<T>(path: string, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await mbFetchOnce<T>(path)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (/MusicBrainz 4\d\d:/.test(msg)) throw err
      if (i === attempts - 1) break
      const backoffMs = 2000 * (i + 1)
      console.warn(`[mb] retrying ${path} in ${backoffMs}ms after error: ${msg}`)
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  throw lastErr
}

import { extractMbidFromGuid } from '../shared/guid.js'

interface MbArtistRef {
  id: string
  name: string
}

interface MbRelation {
  type: string
  attributes?: string[]
  artist?: MbArtistRef
  work?: { id: string; title: string; relations?: MbRelation[] }
}

interface MbArtistCredit {
  name?: string
  artist?: MbArtistRef
}

interface MbRecording {
  id: string
  title: string
  relations?: MbRelation[]
  'artist-credit'?: MbArtistCredit[]
}

interface MbTrack {
  id: string
  position: number
  number: string
  recording: MbRecording
  'artist-credit'?: MbArtistCredit[]
}

interface MbMedium {
  position: number
  tracks?: MbTrack[]
}

interface MbRelease {
  id: string
  title: string
  country?: string
  status?: string
  disambiguation?: string
  media?: MbMedium[]
  relations?: MbRelation[]
  'artist-credit'?: MbArtistCredit[]
  'release-group'?: {
    id: string
    'first-release-date'?: string
    'primary-type'?: string | null
    'secondary-types'?: string[]
  }
}

interface MbReleaseGroup {
  id: string
  title: string
  releases?: { id: string; date?: string; country?: string; status?: string }[]
}

interface MbSearchResult {
  releases?: Array<{ id: string; score?: number; title?: string }>
}

async function searchRelease(artist: string, title: string, year: number | null): Promise<string | null> {
  const parts = [`release:"${title.replace(/"/g, '')}"`, `artist:"${artist.replace(/"/g, '')}"`]
  if (year) parts.push(`date:${year}`)
  const query = encodeURIComponent(parts.join(' AND '))
  const res = await mbFetch<MbSearchResult>(`/release?query=${query}&limit=5&fmt=json`)
  return res.releases?.[0]?.id ?? null
}

async function listReleaseGroupReleaseIds(rgMbid: string): Promise<string[]> {
  const rg = await mbFetch<MbReleaseGroup>(`/release-group/${rgMbid}?inc=releases&fmt=json`)
  const releases = rg.releases ?? []
  const sorted = [...releases].sort((a, b) => {
    const aOff = a.status === 'Official' ? 0 : 1
    const bOff = b.status === 'Official' ? 0 : 1
    if (aOff !== bOff) return aOff - bOff
    const ad = a.date ?? '9999'
    const bd = b.date ?? '9999'
    return ad.localeCompare(bd)
  })
  return sorted.map((r) => r.id)
}

async function pickReleaseFromGroup(rgMbid: string): Promise<string | null> {
  const ids = await listReleaseGroupReleaseIds(rgMbid)
  return ids[0] ?? null
}

const REISSUE_TITLE_RE =
  /\b(deluxe|expanded|anniversary|special|reissue|super|collector'?s|limited|remaster)/i

// Given a release MBID, find its release-group's "original album" — the
// vanilla studio release without deluxe/expanded/anniversary track bloat.
// Heuristic: filter to Official releases with plausible track counts, drop
// anything whose title clearly marks it as a bonus edition, then prefer the
// *smallest* track count among what's left (ties broken by earliest date).
// Cratedigger is album-oriented and the user doesn't want deluxe bonus tracks
// inflating the expected-track-count.
/**
 * Sibling releases in the same release-group with the same `media` total track
 * count as the input release. Used by the slskd flow to recover when MB has
 * multiple pressings of the same album whose tracklists differ (e.g. Itamar
 * Assumpção's Beleléu, leléu, eu: the 1980 original has "Vinheta III" at
 * track 8, the 2010 reissue swaps in "Vinheta radiofônica" at track 12, both
 * 13-track Official releases). The current pick comes back as Cratedigger's
 * `pickEarliestReleaseInGroup` choice; if the slskd download is a reissue,
 * scoring its tracklist against any sibling tells us which pressing the user
 * actually has.
 *
 * Skips the input mbid; capped at 6 results to keep MB calls bounded. Status
 * 'Official' first, then any other status; date-ascending.
 */
export async function listSameCountSiblings(
  releaseMbid: string
): Promise<Array<{ mbid: string; title: string; date: string | null; status: string | null }>> {
  interface Sib {
    id: string
    title?: string
    date?: string
    status?: string
    media?: Array<{ 'track-count'?: number }>
  }
  const rel = await mbFetch<{ 'release-group'?: { id?: string }; media?: Sib['media'] }>(
    `/release/${releaseMbid}?inc=release-groups+media&fmt=json`
  )
  const rgid = rel['release-group']?.id
  if (!rgid) return []
  const selfCount = (rel.media ?? []).reduce(
    (s, m) => s + (m['track-count'] ?? 0),
    0
  )
  if (selfCount === 0) return []
  const browse = await mbFetch<{ releases?: Sib[] }>(
    `/release?release-group=${rgid}&inc=media&limit=100&fmt=json`
  )
  const siblings = browse.releases ?? []
  const out = siblings
    .filter((r) => r.id !== releaseMbid)
    .map((r) => ({
      mbid: r.id,
      title: r.title ?? '',
      date: r.date ?? null,
      status: r.status ?? null,
      trackCount: (r.media ?? []).reduce((s, m) => s + (m['track-count'] ?? 0), 0)
    }))
    .filter((r) => r.trackCount === selfCount)
  out.sort((a, b) => {
    const sa = a.status === 'Official' ? 0 : 1
    const sb = b.status === 'Official' ? 0 : 1
    if (sa !== sb) return sa - sb
    const ad = a.date ?? '9999-99-99'
    const bd = b.date ?? '9999-99-99'
    return ad.localeCompare(bd)
  })
  return out.slice(0, 6).map(({ mbid, title, date, status }) => ({
    mbid,
    title,
    date,
    status
  }))
}

export async function pickEarliestReleaseInGroup(
  releaseMbid: string
): Promise<string | null> {
  interface ReleaseBrief {
    id: string
    title?: string
    date?: string
    status?: string
    media?: Array<{ 'track-count'?: number }>
  }
  // Step 1: get the release-group id. inc=release-groups on a release works.
  const relRes = await mbFetch<{ 'release-group'?: { id?: string } }>(
    `/release/${releaseMbid}?inc=release-groups&fmt=json`
  )
  const rgid = relRes['release-group']?.id
  if (!rgid) return null

  // Step 2: browse all releases in the group, with media for track counts.
  const browse = await mbFetch<{ releases?: ReleaseBrief[] }>(
    `/release?release-group=${rgid}&inc=media&limit=100&fmt=json`
  )
  const siblings = browse.releases ?? []
  if (siblings.length <= 1) return null

  const scored = siblings.map((r) => {
    const trackCount = (r.media ?? []).reduce(
      (s, m) => s + (m['track-count'] ?? 0),
      0
    )
    const title = r.title ?? ''
    return {
      id: r.id,
      date: r.date ?? '',
      status: r.status ?? '',
      trackCount,
      title,
      looksReissue: REISSUE_TITLE_RE.test(title)
    }
  })

  const vanilla = scored.filter(
    (r) => r.status === 'Official' && r.trackCount >= 3 && !r.looksReissue
  )
  const pool = vanilla.length > 0 ? vanilla : scored.filter((r) => r.trackCount >= 3)
  if (pool.length === 0) return null

  pool.sort((a, b) => {
    if (a.trackCount !== b.trackCount) return a.trackCount - b.trackCount
    const ad = a.date || '9999'
    const bd = b.date || '9999'
    return ad.localeCompare(bd)
  })

  const best = pool[0]
  if (!best || best.id === releaseMbid) return null
  return best.id
}

export async function reconcileAlbum(
  plexRatingKey: string,
  artist: string,
  title: string,
  year: number | null,
  guids: string[]
): Promise<{ release: string; releaseGroup: string | null } | null> {
  const manual = getAlbumMatch(plexRatingKey)
  if (manual) return { release: manual, releaseGroup: null }

  for (const g of guids) {
    const parsed = extractMbidFromGuid(g)
    if (!parsed) continue
    if (parsed.entity === 'release') return { release: parsed.mbid, releaseGroup: null }
    if (parsed.entity === 'release-group') {
      const rid = await pickReleaseFromGroup(parsed.mbid)
      if (rid) return { release: rid, releaseGroup: parsed.mbid }
    }
  }
  const rid = await searchRelease(artist, title, year)
  return rid ? { release: rid, releaseGroup: null } : null
}

function toPerson(a: MbArtistRef): CreditPerson {
  return { mbid: a.id, name: a.name }
}

function collectRelationCredits(
  relations: MbRelation[] | undefined,
  out: Array<{ role: string; instrument: string | null; person: CreditPerson }>
): void {
  for (const rel of relations ?? []) {
    if (rel.artist) {
      out.push({
        role: rel.type,
        instrument: rel.attributes?.[0] ?? null,
        person: toPerson(rel.artist)
      })
    }
    if (rel.work) {
      for (const workRel of rel.work.relations ?? []) {
        if (workRel.artist) {
          out.push({
            role: workRel.type,
            instrument: null,
            person: toPerson(workRel.artist)
          })
        }
      }
    }
  }
}

interface AlbumCreditsWithContext extends AlbumCredits {
  releaseGroupMbid: string | null
  albumArtistMbid: string | null
}

async function fetchReleaseCredits(
  mbid: string,
  plexTrackKeys: string[]
): Promise<AlbumCreditsWithContext> {
  const release = await mbFetch<MbRelease>(
    `/release/${mbid}?inc=artist-credits+recordings+recording-level-rels+work-level-rels+artist-rels+release-groups&fmt=json`
  )

  const releaseLevel: AlbumCredits['releaseLevel'] = []
  for (const rel of release.relations ?? []) {
    if (rel.artist) releaseLevel.push({ role: rel.type, person: toPerson(rel.artist) })
  }

  const albumArtistMbid = release['artist-credit']?.[0]?.artist?.id ?? null

  const mbTracks: MbTrack[] = []
  for (const medium of release.media ?? []) {
    for (const t of medium.tracks ?? []) mbTracks.push(t)
  }

  const byTrack: AlbumCredits['byTrack'] = {}
  const trackArtists: AlbumCredits['trackArtists'] = {}
  for (let i = 0; i < plexTrackKeys.length && i < mbTracks.length; i++) {
    const plexKey = plexTrackKeys[i]
    const track = mbTracks[i]
    const recording = track.recording
    const credits: Array<{ role: string; instrument: string | null; person: CreditPerson }> = []
    collectRelationCredits(recording.relations, credits)
    byTrack[plexKey] = credits

    const acSource = track['artist-credit'] ?? recording['artist-credit'] ?? []
    const people: CreditPerson[] = []
    const seen = new Set<string>()
    for (const ac of acSource) {
      if (!ac.artist || seen.has(ac.artist.id)) continue
      seen.add(ac.artist.id)
      people.push(toPerson(ac.artist))
    }
    trackArtists[plexKey] = people
  }

  const rg = release['release-group']
  return {
    releaseMbid: release.id,
    originalDate: rg?.['first-release-date'] ?? null,
    releaseLevel,
    byTrack,
    trackArtists,
    members: [],
    primaryType: rg?.['primary-type'] ?? null,
    secondaryTypes: Array.isArray(rg?.['secondary-types']) ? rg!['secondary-types']! : [],
    releaseDisambiguation: release.disambiguation?.trim() || null,
    releaseCountry: release.country?.trim() || null,
    releaseStatus: release.status?.trim() || null,
    releaseGroupMbid: rg?.id ?? null,
    albumArtistMbid
  }
}

interface MbArtistMembersLookup {
  id: string
  relations?: Array<{
    type: string
    direction?: string
    'target-type'?: string
    artist?: MbArtistRef
  }>
}

const membersCache = new JsonCache<CreditPerson[]>('artist-members')
const relationsCache = new JsonCache<ArtistRelation[]>('artist-relations')

export async function getArtistRelations(mbid: string): Promise<ArtistRelation[]> {
  const cached = await relationsCache.get(mbid)
  if (cached !== undefined) return cached ?? []
  try {
    const data = await mbFetch<MbArtistMembersLookup>(
      `/artist/${mbid}?inc=artist-rels&fmt=json`
    )
    const out: ArtistRelation[] = []
    const seen = new Set<string>()
    for (const rel of data.relations ?? []) {
      if (!rel.artist) continue
      const key = `${rel.type}:${rel.direction ?? ''}:${rel.artist.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        type: rel.type,
        direction: rel.direction ?? '',
        artist: { mbid: rel.artist.id, name: rel.artist.name }
      })
    }
    await relationsCache.set(mbid, out)
    return out
  } catch {
    await relationsCache.set(mbid, [])
    return []
  }
}

async function fetchArtistMembers(mbid: string): Promise<CreditPerson[]> {
  const cached = await membersCache.get(mbid)
  if (cached !== undefined) return cached ?? []
  try {
    const data = await mbFetch<MbArtistMembersLookup>(
      `/artist/${mbid}?inc=artist-rels&fmt=json`
    )
    const out: CreditPerson[] = []
    const seen = new Set<string>()
    for (const rel of data.relations ?? []) {
      if (rel.type !== 'member of band') continue
      if (rel.direction && rel.direction !== 'backward') continue
      if (!rel.artist || seen.has(rel.artist.id)) continue
      seen.add(rel.artist.id)
      out.push(toPerson(rel.artist))
    }
    await membersCache.set(mbid, out)
    return out
  } catch {
    await membersCache.set(mbid, [])
    return []
  }
}

function isEmptyCredits(c: AlbumCredits): boolean {
  if (c.releaseLevel.length > 0) return false
  for (const v of Object.values(c.byTrack)) {
    if (v.length > 0) return false
  }
  return true
}

const albumCreditsCache = new JsonCache<AlbumCredits>('album-credits')
const MAX_RELEASE_ATTEMPTS = 5

export async function getAlbumCreditsCached(
  plexRatingKey: string,
  artist: string,
  title: string,
  year: number | null,
  guids: string[],
  plexTrackKeys: string[]
): Promise<AlbumCredits | null> {
  const cached = await albumCreditsCache.get(plexRatingKey)
  if (cached !== undefined) {
    // Keep the original-year index current every time credits are touched —
    // this is the hook the library warmer rides to fill the whole library.
    void originalYears.record(plexRatingKey, cached?.originalDate ?? null)
    return cached
  }

  const resolved = await reconcileAlbum(plexRatingKey, artist, title, year, guids)
  if (!resolved) return null

  const firstCredits = await fetchReleaseCredits(resolved.release, plexTrackKeys)
  const rgMbid = resolved.releaseGroup ?? firstCredits.releaseGroupMbid

  const finalize = async (c: AlbumCreditsWithContext): Promise<AlbumCredits> => {
    const members = c.albumArtistMbid ? await fetchArtistMembers(c.albumArtistMbid) : []
    return {
      releaseMbid: c.releaseMbid,
      originalDate: firstCredits.originalDate ?? c.originalDate,
      releaseLevel: c.releaseLevel,
      byTrack: c.byTrack,
      trackArtists: c.trackArtists,
      members,
      primaryType: c.primaryType ?? null,
      secondaryTypes: c.secondaryTypes ?? [],
      releaseDisambiguation: c.releaseDisambiguation ?? null,
      releaseCountry: c.releaseCountry ?? null,
      releaseStatus: c.releaseStatus ?? null
    }
  }

  if (!isEmptyCredits(firstCredits) || !rgMbid) {
    const result = await finalize(firstCredits)
    await albumCreditsCache.set(plexRatingKey, result)
    void originalYears.record(plexRatingKey, result.originalDate)
    invalidateCreditIndex()
    return result
  }

  const siblingIds = await listReleaseGroupReleaseIds(rgMbid)
  let best: AlbumCreditsWithContext = firstCredits
  let attempts = 1
  for (const sid of siblingIds) {
    if (sid === resolved.release) continue
    if (attempts >= MAX_RELEASE_ATTEMPTS) break
    attempts++
    try {
      const candidate = await fetchReleaseCredits(sid, plexTrackKeys)
      if (!isEmptyCredits(candidate)) {
        best = candidate
        break
      }
    } catch {
      // keep trying
    }
  }

  const result = await finalize(best)
  await albumCreditsCache.set(plexRatingKey, result)
  void originalYears.record(plexRatingKey, result.originalDate)
  invalidateCreditIndex()
  return result
}

// Overlay each album's original release year onto its `year` field, so a 2005
// reissue of a 1984 album reads as 1984 everywhere downstream — the grid, the
// discography strip, decade buckets, year sort. For albums whose credits are
// cached but predate the original-year index, harvest the date from the credits
// cache (no network) and record it. Albums with no cached credits keep their
// Plex year and get filled in later by the warmer or a fresh open. Pure-local:
// never makes a MusicBrainz request.
export async function overlayOriginalYears(
  albums: Array<{ ratingKey: string; year: number | null }>
): Promise<void> {
  for (const album of albums) {
    if (await originalYears.has(album.ratingKey)) continue
    const credits = await albumCreditsCache.get(album.ratingKey)
    if (credits === undefined) continue // not warmed yet — leave Plex's year
    await originalYears.record(album.ratingKey, credits?.originalDate ?? null)
  }
  await originalYears.overlay(albums)
}

interface MbArtistLookup {
  id: string
  name: string
  'sort-name'?: string
  country?: string
  disambiguation?: string
  type?: string
  'begin-area'?: { name: string }
}

interface MbArtistRelationsLookup {
  id: string
  relations?: Array<{
    type: string
    attributes?: string[]
    release?: { id: string; title: string; date?: string }
    'release-group'?: {
      id: string
      title: string
      'first-release-date'?: string
      'primary-type'?: string
    }
    recording?: { id: string; title: string }
  }>
}

interface MbRecordingReleasesLookup {
  id: string
  title: string
  releases?: Array<{ id: string; title: string; date?: string; status?: string }>
}

const creditedWorksCache = new JsonCache<CreditedWork[]>('credited-works')
const recordingReleasesCache = new JsonCache<NonNullable<MbRecordingReleasesLookup['releases']>>(
  'recording-releases'
)

const MAX_RECORDING_ENRICHMENT = 30
const MAX_RELEASES_PER_RECORDING = 2

async function fetchRecordingReleases(
  recMbid: string
): Promise<MbRecordingReleasesLookup['releases']> {
  const cached = await recordingReleasesCache.get(recMbid)
  if (cached !== undefined) return cached ?? []
  try {
    const rec = await mbFetch<MbRecordingReleasesLookup>(
      `/recording/${recMbid}?inc=releases&fmt=json`
    )
    const list = rec.releases ?? []
    await recordingReleasesCache.set(recMbid, list)
    return list
  } catch {
    await recordingReleasesCache.set(recMbid, [])
    return []
  }
}

export async function getArtistCreditedWorks(mbid: string): Promise<CreditedWork[]> {
  const cached = await creditedWorksCache.get(mbid)
  if (cached !== undefined) return cached ?? []

  const data = await mbFetch<MbArtistRelationsLookup>(
    `/artist/${mbid}?inc=release-rels+release-group-rels+recording-rels&fmt=json`
  )

  const bucket = new Map<string, CreditedWork>()
  const recordingRels = new Map<string, { title: string; roles: string[] }>()

  for (const rel of data.relations ?? []) {
    const role = rel.type
    const roleDetail = rel.attributes?.length ? `${role} (${rel.attributes.join(', ')})` : role

    if (rel['release-group']) {
      const rg = rel['release-group']
      const key = `rg:${rg.id}`
      let entry = bucket.get(key)
      if (!entry) {
        entry = {
          kind: 'release-group',
          mbid: rg.id,
          title: rg.title,
          date: rg['first-release-date'] || null,
          roles: []
        }
        bucket.set(key, entry)
      }
      if (!entry.roles.includes(roleDetail)) entry.roles.push(roleDetail)
    } else if (rel.release) {
      const r = rel.release
      const key = `r:${r.id}`
      let entry = bucket.get(key)
      if (!entry) {
        entry = {
          kind: 'release',
          mbid: r.id,
          title: r.title,
          date: r.date || null,
          roles: []
        }
        bucket.set(key, entry)
      }
      if (!entry.roles.includes(roleDetail)) entry.roles.push(roleDetail)
    } else if (rel.recording) {
      const rec = rel.recording
      let entry = recordingRels.get(rec.id)
      if (!entry) {
        entry = { title: rec.title, roles: [] }
        recordingRels.set(rec.id, entry)
      }
      if (!entry.roles.includes(roleDetail)) entry.roles.push(roleDetail)
    }
  }

  const recList = [...recordingRels.entries()].slice(0, MAX_RECORDING_ENRICHMENT)
  for (const [recMbid, info] of recList) {
    const releases = await fetchRecordingReleases(recMbid)
    for (const release of (releases ?? []).slice(0, MAX_RELEASES_PER_RECORDING)) {
      const key = `r:${release.id}`
      let entry = bucket.get(key)
      if (!entry) {
        entry = {
          kind: 'release',
          mbid: release.id,
          title: release.title,
          date: release.date || null,
          roles: []
        }
        bucket.set(key, entry)
      }
      for (const r of info.roles) if (!entry.roles.includes(r)) entry.roles.push(r)
    }
  }

  const works = [...bucket.values()].sort((a, b) => {
    const da = a.date ?? ''
    const db = b.date ?? ''
    if (da && db) return db.localeCompare(da)
    if (da) return -1
    if (db) return 1
    return a.title.localeCompare(b.title)
  })

  await creditedWorksCache.set(mbid, works)
  return works
}

export async function invalidateAlbumCredits(plexRatingKey: string): Promise<void> {
  await albumCreditsCache.delete(plexRatingKey)
  invalidateCreditIndex()
}

export async function isAlbumCreditsCached(plexRatingKey: string): Promise<boolean> {
  return (await albumCreditsCache.get(plexRatingKey)) !== undefined
}

interface MbSearchReleaseHit {
  id: string
  title: string
  status?: string
  date?: string
  country?: string
  disambiguation?: string
  'artist-credit'?: Array<{ name?: string; artist?: { name: string } }>
  media?: Array<{ 'track-count'?: number }>
  'track-count'?: number
}

interface MbSearchReleasesResponse {
  releases?: MbSearchReleaseHit[]
}

export async function searchReleaseCandidates(
  artist: string,
  title: string,
  limit = 20
): Promise<MbReleaseCandidate[]> {
  const parts: string[] = []
  if (title.trim()) parts.push(`release:"${title.replace(/"/g, '')}"`)
  if (artist.trim()) parts.push(`artist:"${artist.replace(/"/g, '')}"`)
  if (parts.length === 0) return []
  const query = encodeURIComponent(parts.join(' AND '))
  const res = await mbFetch<MbSearchReleasesResponse>(
    `/release?query=${query}&limit=${limit}&fmt=json`
  )
  return (res.releases ?? []).map((r) => {
    const names = (r['artist-credit'] ?? [])
      .map((c) => c.name ?? c.artist?.name ?? '')
      .filter(Boolean)
    const trackFromMedia = (r.media ?? []).reduce(
      (sum, m) => sum + (m['track-count'] ?? 0),
      0
    )
    const trackCount =
      typeof r['track-count'] === 'number'
        ? r['track-count']
        : trackFromMedia > 0
          ? trackFromMedia
          : null
    return {
      mbid: r.id,
      title: r.title,
      artistName: names.join(', '),
      date: r.date || null,
      country: r.country || null,
      status: r.status || null,
      disambiguation: r.disambiguation || null,
      trackCount
    }
  })
}

interface MbSearchArtistsResponse {
  artists?: Array<{
    id: string
    name: string
    score?: number
    disambiguation?: string
    type?: string
    country?: string
    'life-span'?: { begin?: string; end?: string; ended?: boolean }
  }>
}

// Persistent name → MBID cache. MB-paced + repeated across sessions for the
// same artists; the cache eliminates a 1–5s wait on every click of a band
// name the user has resolved before.
const artistByNameCache = new JsonCache<string>('artist-by-name')

export async function searchArtistByName(name: string): Promise<string | null> {
  const q = name.trim()
  if (!q) return null
  const cacheKey = q.toLowerCase()
  const hit = await artistByNameCache.get(cacheKey)
  if (hit !== undefined) return hit
  // Unquoted multi-term query. The previous strict-phrase form (`artist:"NAME"`)
  // returned 0 hits for any artist with a stopword in the name — MB tokenizes
  // "The"/"A" out of the indexed field, so the phrase never matched.
  // E.g. "Conway The Machine" → 0 quoted, 1 unquoted with score 100.
  const query = encodeURIComponent(q.replace(/"/g, ''))
  const res = await mbFetch<MbSearchArtistsResponse>(
    `/artist?query=${query}&limit=5&fmt=json`
  )
  const list = res.artists ?? []
  if (list.length === 0) {
    await artistByNameCache.set(cacheKey, null)
    return null
  }
  // Prefer exact case-insensitive name match. If none, take the top-scored
  // hit only when MB is confident (≥90). Lower scores often jump to a
  // distantly-related artist; we'd rather return null than mislead.
  const exact = list.find((a) => a.name.toLowerCase() === q.toLowerCase())
  if (exact) {
    await artistByNameCache.set(cacheKey, exact.id)
    return exact.id
  }
  const top = list[0] as (typeof list)[number] & { score?: number }
  if ((top.score ?? 0) >= 90) {
    await artistByNameCache.set(cacheKey, top.id)
    return top.id
  }
  await artistByNameCache.set(cacheKey, null)
  return null
}

export async function getReleaseLabels(mbid: string): Promise<string[]> {
  interface Res {
    'label-info'?: Array<{ label?: { name?: string } }>
  }
  const res = await mbFetch<Res>(`/release/${mbid}?inc=labels&fmt=json`)
  const names = new Set<string>()
  for (const li of res['label-info'] ?? []) {
    const name = li.label?.name?.trim()
    if (name) names.add(name)
  }
  return [...names]
}

// Plex's MB agent commonly stores release-group MBIDs rather than release
// MBIDs, so for a given release-group we fetch every release in it with labels
// and return the union — gives broader coverage without picking the "wrong"
// pressing.
export async function getReleaseGroupLabels(rgid: string): Promise<string[]> {
  interface Res {
    releases?: Array<{
      'label-info'?: Array<{ label?: { name?: string } }>
    }>
  }
  const res = await mbFetch<Res>(
    `/release?release-group=${rgid}&inc=labels&limit=100&fmt=json`
  )
  const names = new Set<string>()
  for (const r of res.releases ?? []) {
    for (const li of r['label-info'] ?? []) {
      const name = li.label?.name?.trim()
      if (name) names.add(name)
    }
  }
  return [...names]
}

// Last-resort fallback for albums with no MBID of any kind and no Plex studio
// tag. Search MB for the release by artist+title, accept only a high-confidence
// match, then fetch its labels.
export async function findLabelsByArtistTitle(
  artist: string,
  title: string
): Promise<string[]> {
  if (!artist.trim() || !title.trim()) return []
  const esc = (s: string): string => s.replace(/["\\]/g, ' ').trim()
  const q = `release:"${esc(title)}" AND artist:"${esc(artist)}"`
  interface SearchRes {
    releases?: Array<{ id: string; score?: number }>
  }
  const sr = await mbFetch<SearchRes>(
    `/release?query=${encodeURIComponent(q)}&limit=1&fmt=json`
  )
  const top = sr.releases?.[0]
  if (!top?.id) return []
  // Only trust near-exact matches — we're guessing by name, and picking the
  // wrong release would attach false labels.
  if (typeof top.score === 'number' && top.score < 90) return []
  return getReleaseLabels(top.id)
}

export { extractMbidFromGuid }

export async function getReleaseTrackCount(mbid: string): Promise<number> {
  interface Res {
    media?: Array<{ 'track-count'?: number }>
  }
  const res = await mbFetch<Res>(`/release/${mbid}?inc=media&fmt=json`)
  return (res.media ?? []).reduce((sum, m) => sum + (m['track-count'] ?? 0), 0)
}

export async function getReleaseCandidate(
  mbid: string
): Promise<MbReleaseCandidate | null> {
  interface Res {
    id: string
    title?: string
    date?: string
    country?: string
    status?: string
    disambiguation?: string
    'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>
    media?: Array<{ 'track-count'?: number }>
  }
  try {
    const r = await mbFetch<Res>(
      `/release/${mbid}?inc=artist-credits+media&fmt=json`
    )
    const names = (r['artist-credit'] ?? [])
      .map((c) => c.name ?? c.artist?.name ?? '')
      .filter(Boolean)
    const trackCount = (r.media ?? []).reduce(
      (s, m) => s + (m['track-count'] ?? 0),
      0
    )
    return {
      mbid: r.id,
      title: r.title ?? '',
      artistName: names.join(', '),
      date: r.date || null,
      country: r.country || null,
      status: r.status || null,
      disambiguation: r.disambiguation || null,
      trackCount: trackCount > 0 ? trackCount : null
    }
  } catch {
    return null
  }
}

export async function getReleaseTracks(mbid: string): Promise<string[]> {
  interface Res {
    media?: Array<{
      tracks?: Array<{ title?: string; recording?: { title?: string } }>
    }>
  }
  const res = await mbFetch<Res>(`/release/${mbid}?inc=recordings&fmt=json`)
  const titles: string[] = []
  for (const m of res.media ?? []) {
    for (const t of m.tracks ?? []) {
      const title = t.title || t.recording?.title || ''
      if (title) titles.push(title)
    }
  }
  return titles
}

export async function getArtistInfo(mbid: string): Promise<{
  mbid: string
  name: string
  disambiguation: string | null
  type: string | null
  origin: string | null
} | null> {
  try {
    const a = await mbFetch<MbArtistLookup>(`/artist/${mbid}?fmt=json`)
    return {
      mbid: a.id,
      name: a.name,
      disambiguation: a.disambiguation || null,
      type: a.type || null,
      origin: a['begin-area']?.name || a.country || null
    }
  } catch {
    return null
  }
}

interface MbUrlRelation {
  type: string
  url?: { id: string; resource: string }
}

interface MbUrlRelsLookup {
  id: string
  relations?: MbUrlRelation[]
}

const artistUrlRelsCache = new JsonCache<MbUrlRelation[]>('artist-url-rels')
const releaseGroupUrlRelsCache = new JsonCache<MbUrlRelation[]>('rg-url-rels')

async function fetchUrlRels(
  path: string,
  cache: JsonCache<MbUrlRelation[]>,
  cacheKey: string
): Promise<MbUrlRelation[]> {
  const hit = await cache.get(cacheKey)
  if (hit !== undefined) return hit ?? []
  try {
    const data = await mbFetch<MbUrlRelsLookup>(path)
    const rels = data.relations ?? []
    await cache.set(cacheKey, rels)
    return rels
  } catch {
    await cache.set(cacheKey, [])
    return []
  }
}

export async function getArtistUrlRelations(mbid: string): Promise<MbUrlRelation[]> {
  return fetchUrlRels(`/artist/${mbid}?inc=url-rels&fmt=json`, artistUrlRelsCache, mbid)
}

export async function getReleaseGroupUrlRelations(
  mbid: string
): Promise<MbUrlRelation[]> {
  return fetchUrlRels(
    `/release-group/${mbid}?inc=url-rels&fmt=json`,
    releaseGroupUrlRelsCache,
    mbid
  )
}

export async function getReleaseGroupForRelease(
  releaseMbid: string
): Promise<string | null> {
  try {
    interface Res {
      'release-group'?: { id: string }
    }
    const data = await mbFetch<Res>(
      `/release/${releaseMbid}?inc=release-groups&fmt=json`
    )
    return data['release-group']?.id ?? null
  } catch {
    return null
  }
}

// Cached envelope for release-radar: per-artist list of release-groups plus
// the timestamp when MB was queried so the caller can decide whether the entry
// is fresh enough to reuse or needs a re-fetch.
interface ArtistReleaseGroupsEntry {
  fetchedAt: number
  groups: MbArtistReleaseGroup[]
}

interface MbReleaseGroupRow {
  id: string
  title?: string
  'first-release-date'?: string
  'primary-type'?: string | null
  'secondary-types'?: string[]
  disambiguation?: string
}

interface MbReleaseGroupBrowseResponse {
  'release-group-count'?: number
  'release-group-offset'?: number
  'release-groups'?: MbReleaseGroupRow[]
}

const artistReleaseGroupsCache = new JsonCache<ArtistReleaseGroupsEntry>(
  'release-groups-by-artist'
)

const RELEASE_GROUP_PAGE = 100
const RELEASE_GROUP_MAX_PAGES = 5

// All MB release-groups for an artist, lightly normalised. We persist the
// fetchedAt timestamp inside the cache entry so the caller (release-radar)
// can apply its own freshness policy without us picking one for them.
export async function getArtistReleaseGroupsCached(
  artistMbid: string
): Promise<ArtistReleaseGroupsEntry | null> {
  const cached = await artistReleaseGroupsCache.get(artistMbid)
  if (cached !== undefined) return cached
  return null
}

export async function fetchArtistReleaseGroups(
  artistMbid: string
): Promise<ArtistReleaseGroupsEntry> {
  // Browse the artist's release-groups; MB caps each page so paginate until
  // we exhaust the count. We exclude Compilation/Live/Soundtrack/etc via the
  // type-filter param so we don't waste pages on stuff the radar will drop.
  const all: MbArtistReleaseGroup[] = []
  let offset = 0
  for (let page = 0; page < RELEASE_GROUP_MAX_PAGES; page++) {
    const data = await mbFetch<MbReleaseGroupBrowseResponse>(
      `/release-group?artist=${artistMbid}&type=album|ep|single&limit=${RELEASE_GROUP_PAGE}&offset=${offset}&fmt=json`
    )
    const rows = data['release-groups'] ?? []
    for (const r of rows) {
      if (!r.id || !r.title) continue
      all.push({
        mbid: r.id,
        title: r.title,
        firstReleaseDate: r['first-release-date'] || null,
        primaryType: r['primary-type'] ?? null,
        secondaryTypes: Array.isArray(r['secondary-types']) ? r['secondary-types'] : [],
        disambiguation: r.disambiguation?.trim() || null
      })
    }
    offset += rows.length
    const total = data['release-group-count'] ?? offset
    if (rows.length < RELEASE_GROUP_PAGE || offset >= total) break
  }
  const entry: ArtistReleaseGroupsEntry = { fetchedAt: Date.now(), groups: all }
  await artistReleaseGroupsCache.set(artistMbid, entry)
  return entry
}
