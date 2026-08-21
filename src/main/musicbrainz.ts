import type {
  AlbumCredits,
  ArtistRelation,
  CreditedWork,
  CreditPerson,
  LabelDiscography,
  LabelReleaseGroup,
  MbArtistReleaseGroup,
  MbReleaseCandidate,
  PlexTrack
} from '../shared/plex.js'
import type {
  ClassicalAlbumModel,
  ClassicalMatchMethod,
  ClassicalTrackMetadata,
  ComposerSearchResult
} from '../shared/classical-model.js'
import { getAlbumMatch } from './store.js'
import { normalizeTitle, stripEditionSuffix } from '../shared/title-match.js'
import { JsonCache } from './mb-cache.js'
import { invalidateCreditIndex } from './credit-index.js'
import { originalYears } from './original-years.js'
import { createPaced } from './paced.js'
import { identifyMusicFiles } from './tagger.js'

const MB_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'cratedigger/0.4.0 ( https://github.com/mendwright/cratedigger )'
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
  'sort-name'?: string
}

interface MbRelation {
  type: string
  direction?: string
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
  length?: number
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
  releases?: Array<{
    id: string
    score?: number
    title?: string
    date?: string
    media?: Array<{ 'track-count'?: number }>
  }>
}

function plexDiscSignature(tracks: PlexTrack[]): number[] | null {
  if (tracks.length === 0) return null
  const counts = new Map<number, number>()
  for (const track of tracks) {
    if (
      track.parentIndex == null ||
      track.index == null ||
      !Number.isInteger(track.parentIndex) ||
      !Number.isInteger(track.index) ||
      track.parentIndex < 1 ||
      track.index < 1
    ) return null
    counts.set(track.parentIndex, (counts.get(track.parentIndex) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([, count]) => count)
}

function sameDiscSignature(
  candidate: NonNullable<MbSearchResult['releases']>[number],
  signature: number[]
): boolean {
  const counts = (candidate.media ?? []).map((medium) => medium['track-count'] ?? 0)
  return counts.length === signature.length && counts.every((count, index) => count === signature[index])
}

async function searchRelease(
  artist: string,
  title: string,
  year: number | null,
  plexTracks: PlexTrack[] = []
): Promise<string | null> {
  const parts = [`release:"${title.replace(/"/g, '')}"`, `artist:"${artist.replace(/"/g, '')}"`]
  if (year) parts.push(`date:${year}`)
  const query = encodeURIComponent(parts.join(' AND '))
  const res = await mbFetch<MbSearchResult>(`/release?query=${query}&limit=5&fmt=json`)
  const exact = res.releases?.[0]?.id
  if (exact) return exact

  // Classical Plex titles are often manually normalized to
  // "Composer: Work (Performer)" while MusicBrainz uses an edition title.
  // If exact-title reconciliation misses, search the composer token but only
  // accept a candidate whose complete per-disc track-count signature matches
  // Plex. This is deliberately stricter than title similarity: it recovers
  // retitled boxes without guessing among unrelated releases.
  const colon = title.indexOf(':')
  const composerToken = colon > 0 ? title.slice(0, colon).trim() : ''
  const signature = plexDiscSignature(plexTracks)
  if (composerToken.length < 3 || !signature) return null

  const fallbackParts = [
    `release:${composerToken.replace(/["()]/g, ' ')}`,
    `artist:"${artist.replace(/"/g, '')}"`
  ]
  if (year) fallbackParts.push(`date:${year}`)
  const fallbackQuery = encodeURIComponent(fallbackParts.join(' AND '))
  const fallback = await mbFetch<MbSearchResult>(
    `/release?query=${fallbackQuery}&limit=10&fmt=json`
  )
  return fallback.releases?.find((candidate) => sameDiscSignature(candidate, signature))?.id ?? null
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
  guids: string[],
  plexTracks: PlexTrack[] = []
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
  const rid = await searchRelease(artist, title, year, plexTracks)
  return rid ? { release: rid, releaseGroup: null } : null
}

function toPerson(a: MbArtistRef): CreditPerson {
  return { mbid: a.id, name: a.name }
}

function toComposerPerson(a: MbArtistRef): CreditPerson {
  const sortName = a['sort-name']?.trim()
  if (!sortName) return toPerson(a)
  const comma = sortName.indexOf(',')
  const name = comma > 0
    ? `${sortName.slice(comma + 1).trim()} ${sortName.slice(0, comma).trim()}`
    : sortName
  return { mbid: a.id, name: name || a.name }
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

interface MbTrackWithPosition {
  track: MbTrack
  disc: number
  index: number
}

interface AlignedTrack {
  plex: PlexTrack
  mb: MbTrackWithPosition | null
  method: ClassicalMatchMethod
}

const TRACK_GUID_RE = /^mbid:\/\/(?:(recording|track)\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

function trackGuidTargets(guids: string[]): { releaseTracks: string[]; recordings: string[]; acoustid: string[] } {
  const releaseTracks: string[] = []
  const recordings: string[] = []
  const acoustid: string[] = []
  for (const guid of guids) {
    if (guid.startsWith('acoustid-recording://')) {
      acoustid.push(guid.slice('acoustid-recording://'.length).toLowerCase())
      continue
    }
    const match = TRACK_GUID_RE.exec(guid)
    if (!match) continue
    const mbid = match[2].toLowerCase()
    // Live Plex payloads use a bare mbid://UUID for the MusicBrainz release
    // track id. Explicit forms are accepted for forward compatibility.
    if (!match[1] || match[1].toLowerCase() === 'track') releaseTracks.push(mbid)
    else recordings.push(mbid)
  }
  return { releaseTracks, recordings, acoustid }
}

function alignPlexTracks(plexTracks: PlexTrack[], release: MbRelease): AlignedTrack[] {
  const candidates: MbTrackWithPosition[] = []
  for (const medium of release.media ?? []) {
    for (const track of medium.tracks ?? []) {
      candidates.push({ track, disc: medium.position, index: track.position })
    }
  }

  const used = new Set<MbTrackWithPosition>()
  const aligned = new Map<string, AlignedTrack>()
  const plexDiscCounts = new Map<number, number>()
  let plexCoordinatesComplete = true
  for (const track of plexTracks) {
    if (track.parentIndex == null || track.index == null) {
      plexCoordinatesComplete = false
      continue
    }
    plexDiscCounts.set(track.parentIndex, (plexDiscCounts.get(track.parentIndex) ?? 0) + 1)
  }
  const media = release.media ?? []
  const discLayoutMatches =
    plexCoordinatesComplete &&
    plexDiscCounts.size === media.length &&
    media.every((medium) => plexDiscCounts.get(medium.position) === (medium.tracks ?? []).length)
  const claim = (
    plex: PlexTrack,
    candidate: MbTrackWithPosition | undefined,
    method: ClassicalMatchMethod
  ): boolean => {
    if (!candidate || used.has(candidate)) return false
    used.add(candidate)
    aligned.set(plex.ratingKey, { plex, mb: candidate, method })
    return true
  }

  // Exact identifiers search the entire release, independent of disc offsets.
  for (const plex of plexTracks) {
    const targets = trackGuidTargets(plex.guids)
    const byReleaseTrack = candidates.find(
      (candidate) => !used.has(candidate) && targets.releaseTracks.includes(candidate.track.id.toLowerCase())
    )
    if (claim(plex, byReleaseTrack, 'release-track-guid')) continue
    const byRecording = candidates.find(
      (candidate) => !used.has(candidate) && targets.recordings.includes(candidate.track.recording.id.toLowerCase())
    )
    if (claim(plex, byRecording, 'recording-guid')) continue
    const byAcoustid = candidates.find(
      (candidate) => !used.has(candidate) && targets.acoustid.includes(candidate.track.recording.id.toLowerCase())
    )
    claim(plex, byAcoustid, 'acoustid-recording')
  }

  // Coordinates are safe only when the complete Plex disc layout matches the
  // complete MB media layout. Equal total track counts are insufficient: a
  // different box-set split can map a movement to the wrong work while still
  // yielding plausible single-composer coverage.
  if (discLayoutMatches) {
    for (const plex of plexTracks) {
      if (aligned.has(plex.ratingKey) || plex.parentIndex == null || plex.index == null) continue
      const matches = candidates.filter(
        (candidate) =>
          !used.has(candidate) && candidate.disc === plex.parentIndex && candidate.index === plex.index
      )
      if (matches.length === 1) claim(plex, matches[0], 'disc-index')
    }
  }

  // Last structured fallback: a unique normalized title with a close duration.
  for (const plex of plexTracks) {
    if (aligned.has(plex.ratingKey)) continue
    const title = normalizeTitle(plex.title)
    const matches = candidates.filter((candidate) => {
      if (used.has(candidate) || normalizeTitle(candidate.track.recording.title) !== title) return false
      const mbDuration = candidate.track.recording.length
      return plex.duration == null || mbDuration == null || Math.abs(plex.duration - mbDuration) <= 5000
    })
    if (matches.length === 1) claim(plex, matches[0], 'title-duration')
  }

  return plexTracks.map(
    (plex) => aligned.get(plex.ratingKey) ?? { plex, mb: null, method: 'none' }
  )
}

function classicalMetadata(aligned: AlignedTrack): ClassicalTrackMetadata {
  const mbTrack = aligned.mb?.track ?? null
  const performance = mbTrack?.recording.relations?.find(
    (relation) => relation.type === 'performance' && relation.work
  )
  const work = performance?.work ?? null
  const parent = work?.relations?.find(
    (relation) => relation.type === 'parts' && relation.direction === 'backward' && relation.work
  )?.work ?? null
  const composers = (work?.relations ?? [])
    .filter((relation) => relation.type === 'composer' && relation.artist)
    .map((relation) => toComposerPerson(relation.artist!))

  return {
    matchMethod: aligned.method,
    releaseTrackMbid: mbTrack?.id ?? null,
    recordingMbid: mbTrack?.recording.id ?? null,
    workMbid: work?.id ?? null,
    workTitle: work?.title ?? null,
    parentWorkMbid: parent?.id ?? null,
    parentWorkTitle: parent?.title ?? null,
    composers
  }
}

function buildClassicalAlbumModel(
  releaseMbid: string,
  aligned: AlignedTrack[]
): ClassicalAlbumModel {
  const alignment = {
    acoustidRecording: 0,
    recordingGuid: 0,
    releaseTrackGuid: 0,
    discIndex: 0,
    titleDuration: 0,
    unmatched: 0
  }
  const byTrack: ClassicalAlbumModel['byTrack'] = {}
  const composerCounts = new Map<string, { person: CreditPerson; trackCount: number }>()

  for (const item of aligned) {
    if (item.method === 'acoustid-recording') alignment.acoustidRecording++
    else if (item.method === 'recording-guid') alignment.recordingGuid++
    else if (item.method === 'release-track-guid') alignment.releaseTrackGuid++
    else if (item.method === 'disc-index') alignment.discIndex++
    else if (item.method === 'title-duration') alignment.titleDuration++
    else alignment.unmatched++

    const metadata = classicalMetadata(item)
    byTrack[item.plex.ratingKey] = metadata
    const seen = new Set<string>()
    for (const person of metadata.composers) {
      if (seen.has(person.mbid)) continue
      seen.add(person.mbid)
      const existing = composerCounts.get(person.mbid)
      if (existing) existing.trackCount++
      else composerCounts.set(person.mbid, { person, trackCount: 1 })
    }
  }

  const exact = alignment.acoustidRecording + alignment.recordingGuid + alignment.releaseTrackGuid
  const matchedTracks = aligned.length - alignment.unmatched
  const alignmentConfidence =
    matchedTracks === 0
      ? 'none'
      : alignment.unmatched === 0 && exact === aligned.length
        ? 'exact'
        : alignment.unmatched === 0 && alignment.titleDuration === 0
          ? 'strong'
          : 'weak'
  return {
    source: exact > 0 ? 'exact' : matchedTracks > 0 ? 'reconciled' : 'none',
    alignmentConfidence,
    releaseMbid,
    matchedTracks,
    totalTracks: aligned.length,
    alignment,
    composers: [...composerCounts.values()].sort(
      (a, b) => b.trackCount - a.trackCount || a.person.name.localeCompare(b.person.name)
    ),
    byTrack
  }
}

async function fetchReleaseCredits(
  mbid: string,
  plexTracks: PlexTrack[]
): Promise<AlbumCreditsWithContext> {
  const release = await mbFetch<MbRelease>(
    `/release/${mbid}?inc=artist-credits+recordings+recording-level-rels+work-rels+work-level-rels+artist-rels+release-groups&fmt=json`
  )

  const releaseLevel: AlbumCredits['releaseLevel'] = []
  for (const rel of release.relations ?? []) {
    if (rel.artist) releaseLevel.push({ role: rel.type, person: toPerson(rel.artist) })
  }

  const albumArtistMbid = release['artist-credit']?.[0]?.artist?.id ?? null

  const alignedTracks = alignPlexTracks(plexTracks, release)

  const byTrack: AlbumCredits['byTrack'] = {}
  const trackArtists: AlbumCredits['trackArtists'] = {}
  for (const aligned of alignedTracks) {
    const plexKey = aligned.plex.ratingKey
    const track = aligned.mb?.track
    if (!track) {
      byTrack[plexKey] = []
      trackArtists[plexKey] = []
      continue
    }
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
    classical: buildClassicalAlbumModel(release.id, alignedTracks),
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

// v5 requests the recording→work edge (`work-rels`) as well as nested work
// relations. v4 requested only `work-level-rels`, which MusicBrainz documents
// as a switch and therefore cached recordings without works or composers.
const albumCreditsCache = new JsonCache<AlbumCredits>('album-credits-v5')
const MAX_RELEASE_ATTEMPTS = 5

export async function getAlbumCreditsCached(
  plexRatingKey: string,
  artist: string,
  title: string,
  year: number | null,
  guids: string[],
  plexTracks: PlexTrack[]
): Promise<AlbumCredits | null> {
  const cached = await albumCreditsCache.get(plexRatingKey)
  if (cached !== undefined) {
    // Keep the original-year index current every time credits are touched —
    // this is the hook the library warmer rides to fill the whole library.
    void originalYears.record(plexRatingKey, cached?.originalDate ?? null)
    return cached
  }

  const resolved = await reconcileAlbum(plexRatingKey, artist, title, year, guids, plexTracks)
  if (!resolved) return null

  let firstCredits = await fetchReleaseCredits(resolved.release, plexTracks)
  // Alternate box-set layouts make coordinates unsafe (Gulda's Plex 11-disc
  // split vs MB's 9). In that tail, identify the audio itself and re-align by
  // exact recording MBID. This endpoint is read-only; it never tags files.
  if (
    firstCredits.classical &&
    (firstCredits.classical.alignmentConfidence === 'weak' ||
      firstCredits.classical.alignmentConfidence === 'none')
  ) {
    const fingerprintable = plexTracks.filter((track) => track.filePath)
    if (fingerprintable.length > 0) {
      try {
        const hits = await identifyMusicFiles(fingerprintable.map((track) => track.filePath!))
        const byPath = new Map(hits.map((hit) => [hit.path, hit]))
        const identified = plexTracks.map((track) => {
          const hit = track.filePath ? byPath.get(track.filePath) : undefined
          if (!hit || hit.error || hit.score < 0.8 || hit.recording_mbids.length === 0) return track
          return {
            ...track,
            guids: [
              ...track.guids,
              ...hit.recording_mbids.map((mbid) => `acoustid-recording://${mbid}`)
            ]
          }
        })
        if (identified.some((track, i) => track !== plexTracks[i])) {
          firstCredits = await fetchReleaseCredits(resolved.release, identified)
        }
      } catch {
        // Tagger unavailable / AcoustID outage: retain the conservative weak
        // model and let the person-filtered suggestion remain the visible tail.
      }
    }
  }
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
      releaseStatus: c.releaseStatus ?? null,
      classical: c.classical
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
      const candidate = await fetchReleaseCredits(sid, plexTracks)
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
  const cleanArtist = artist.replace(/"/g, '').trim()
  let cleanTitle = title.replace(/"/g, '').trim()
  // Classical tags frequently prepend the composer ("Copland: Fanfare…")
  // while MusicBrainz keeps the composer in artist credit and not the release
  // title. Requiring that prefix in both fields makes the broad AND search
  // eliminate the exact release.
  const colon = cleanTitle.indexOf(':')
  if (colon > 0 && cleanArtist) {
    const prefix = cleanTitle.slice(0, colon).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleLowerCase()
    const normalizedArtist = cleanArtist
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .toLocaleLowerCase()
    if (prefix.length >= 3 && normalizedArtist.includes(prefix)) {
      cleanTitle = cleanTitle.slice(colon + 1).trim()
    }
  }
  const parts: string[] = []
  if (cleanTitle) parts.push(`release:"${cleanTitle}"`)
  if (cleanArtist) parts.push(`artist:"${cleanArtist}"`)
  if (parts.length === 0) return []
  let query = encodeURIComponent(parts.join(' AND '))
  let res = await mbFetch<MbSearchReleasesResponse>(
    `/release?query=${query}&limit=${limit}&fmt=json`
  )
  // MB phrase search is literal enough that punctuation omitted by a human
  // makes compilations disappear: "The Planets Star Wars" returns zero for
  // "Holst: The Planets / Williams: Star Wars Suite". If the exact pass is
  // empty, require each meaningful title word instead. Keeping AND between
  // the words avoids flooding the picker with every release of The Planets.
  if ((res.releases ?? []).length === 0 && cleanTitle) {
    const stopWords = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to'])
    const numberWords: Record<string, string> = {
      one: '1',
      two: '2',
      three: '3',
      four: '4',
      five: '5',
      six: '6',
      seven: '7',
      eight: '8',
      nine: '9',
      ten: '10',
      eleven: '11',
      twelve: '12'
    }
    const seen = new Set<string>()
    const titleTerms = (cleanTitle.match(/[\p{L}\p{N}]+/gu) ?? [])
      .map((term) => numberWords[term.toLocaleLowerCase()] ?? term)
      .filter((term) => {
        const key = term.toLocaleLowerCase()
        if ((key.length === 1 && !/^\d$/.test(key)) || stopWords.has(key) || seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
    if (titleTerms.length > 0) {
      const broadParts = titleTerms.map((term) => `release:${term}`)
      if (cleanArtist) broadParts.push(`artist:"${cleanArtist}"`)
      query = encodeURIComponent(broadParts.join(' AND '))
      res = await mbFetch<MbSearchReleasesResponse>(
        `/release?query=${query}&limit=${limit}&fmt=json`
      )
      // Classical tags often contain a whole semicolon/pipe-separated credit
      // line where MusicBrainz expects one artist. If that credit constraint
      // eliminates every result, keep the required title terms and let the
      // inbox rank the returned performances against the file credits.
      if ((res.releases ?? []).length === 0 && cleanArtist) {
        query = encodeURIComponent(titleTerms.map((term) => `release:${term}`).join(' AND '))
        res = await mbFetch<MbSearchReleasesResponse>(
          `/release?query=${query}&limit=${limit}&fmt=json`
        )
      }
    }
  }
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

const composerByNameCache = new JsonCache<ComposerSearchResult>('composer-by-name-v1')

/** Person-constrained fallback so a same-name band can never win. */
export async function searchComposerByName(name: string): Promise<ComposerSearchResult | null> {
  const q = name.trim()
  if (!q) return null
  const cacheKey = q.toLowerCase()
  const cached = await composerByNameCache.get(cacheKey)
  if (cached !== undefined) return cached
  const query = encodeURIComponent(`${q.replace(/"/g, '')} AND type:person`)
  const res = await mbFetch<MbSearchArtistsResponse>(`/artist?query=${query}&limit=5&fmt=json`)
  const person = (res.artists ?? []).find(
    (artist) => artist.type === 'Person' && (artist.score ?? 0) >= 90
  )
  if (!person) return null
  const result: ComposerSearchResult = {
    mbid: person.id,
    name: person.name,
    score: person.score ?? 0,
    disambiguation: person.disambiguation?.trim() || null,
    type: 'Person'
  }
  await composerByNameCache.set(cacheKey, result)
  return result
}

interface MbSearchRecordingsResponse {
  recordings?: Array<{
    id: string
    title: string
    score?: number
    releases?: Array<{
      id: string
      title: string
      status?: string
      date?: string
      'release-group'?: {
        id: string
        'primary-type'?: string | null
        'secondary-types'?: string[]
      }
    }>
  }>
}

// (artist, title, sourceAlbum) → LP resolution is deterministic; persist it so
// repeat clicks on the same gap row skip the paced MB round-trip.
const lpForTrackCache = new JsonCache<{ album: string; mbid: string }>('lp-for-track')

/**
 * Find the full-length album a track appears on. Playlist exports often carry
 * the single/7" the streaming service attached the track to ("Night Terrors"
 * on the single "Night Terrors"); when the user asks Soulseek for "the album"
 * they want the LP. Searches MB recordings and considers only releases whose
 * release-group primary type is Album with no secondary types (skips
 * compilations / live albums / soundtracks). Keeps `sourceAlbum` when it is
 * itself one of those LPs; otherwise picks the earliest dated candidate.
 * Returns null when the track never appeared on an LP.
 */
export async function findLpForTrack(
  artist: string,
  title: string,
  sourceAlbum?: string | null
): Promise<{ album: string; mbid: string } | null> {
  // Exports separate collaborators with ";" ("Whitney;Waxahatchee") — MB wants
  // the primary artist. Feat/edition suffixes on the title also hurt recall.
  const primaryArtist = artist.split(';')[0].trim() || artist
  const cleanTitle =
    stripEditionSuffix(title)
      .replace(/\s*\((?:feat|ft|with)\.?\s[^)]*\)\s*/i, ' ')
      .trim() || title
  if (!primaryArtist.trim() || !cleanTitle.trim()) return null

  const cacheKey = [primaryArtist, cleanTitle, sourceAlbum ?? '']
    .map((s) => s.toLowerCase().trim())
    .join(' ')
  const hit = await lpForTrackCache.get(cacheKey)
  if (hit !== undefined) return hit

  const query = encodeURIComponent(
    `recording:"${cleanTitle.replace(/"/g, '')}" AND artist:"${primaryArtist.replace(/"/g, '')}"`
  )
  const res = await mbFetch<MbSearchRecordingsResponse>(
    `/recording?query=${query}&limit=10&fmt=json`
  )

  const candidates: Array<{ album: string; mbid: string; date: string }> = []
  for (const rec of res.recordings ?? []) {
    if ((rec.score ?? 0) < 80) continue
    for (const rel of rec.releases ?? []) {
      const rg = rel['release-group']
      if (rg?.['primary-type'] !== 'Album') continue
      if ((rg['secondary-types'] ?? []).length > 0) continue
      if (rel.status && rel.status !== 'Official') continue
      candidates.push({ album: rel.title, mbid: rel.id, date: rel.date ?? '' })
    }
  }
  if (candidates.length === 0) {
    await lpForTrackCache.set(cacheKey, null)
    return null
  }

  const srcNorm = sourceAlbum ? normalizeTitle(sourceAlbum) : ''
  const srcHit = srcNorm
    ? candidates.find((c) => normalizeTitle(c.album) === srcNorm)
    : undefined
  const pick =
    srcHit ??
    [...candidates].sort((a, b) =>
      (a.date || '9999').localeCompare(b.date || '9999')
    )[0]
  const out = { album: pick.album, mbid: pick.mbid }
  await lpForTrackCache.set(cacheKey, out)
  return out
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

// ---- Genres ----
//
// Plex's own genre tags are coarse and inconsistent (one library: 551 albums
// under "Rock", 13% with no genre at all, 355 genres used exactly once). MB's
// are specific and share one vocabulary, which is what makes a crate rail
// browsable — "shoegaze" is a crate, "Rock" never was.
//
// MB keeps genres on both the release and its release-group, and which one is
// populated varies by how the release was entered. Release first (it's the
// MBID Plex actually stores), then the group.
//
// Cached on disk because the backfill is a multi-hour crawl at MB's 1 req/sec
// and must survive a restart mid-run.
const releaseGenresCache = new JsonCache<string[]>('release-genres-v1')
const releaseGroupGenresCache = new JsonCache<string[]>('release-group-genres-v1')

interface MbGenreRow {
  name?: string
  count?: number
}

// MB returns genres with a vote count. Zero-vote genres exist but are noise,
// so we keep anything with at least one vote and sort by votes descending —
// the first genre is then the one the most editors agreed on.
function readGenres(rows: MbGenreRow[] | undefined): string[] {
  const out: Array<{ name: string; count: number }> = []
  for (const row of rows ?? []) {
    const name = row.name?.trim()
    if (!name) continue
    out.push({ name, count: row.count ?? 0 })
  }
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return out.map((g) => g.name)
}

export async function getReleaseGenres(mbid: string): Promise<string[]> {
  const cached = await releaseGenresCache.get(mbid)
  if (cached !== undefined && cached !== null) return cached
  interface Res {
    genres?: MbGenreRow[]
  }
  const res = await mbFetch<Res>(`/release/${mbid}?inc=genres&fmt=json`)
  const genres = readGenres(res.genres)
  await releaseGenresCache.set(mbid, genres)
  return genres
}

// MB's curated genre vocabulary (~2,200 names), used to decide whether a
// Last.fm tag is a genre or somebody's personal shelf label. One paginated
// crawl at 100/page; cached on disk because it changes on the order of weeks
// and we do not want 22 requests on every app start.
const genreVocabCache = new JsonCache<string[]>('mb-genre-vocabulary-v1')
const GENRE_VOCAB_PAGE = 100
// Well above the current 2,188 — a guard against an endless loop if MB ever
// returns a bad count, not a real ceiling.
const GENRE_VOCAB_MAX_PAGES = 60

export async function getGenreVocabulary(): Promise<string[]> {
  const cached = await genreVocabCache.get('all')
  if (cached !== undefined && cached !== null && cached.length > 0) return cached

  interface Res {
    'genre-count'?: number
    genres?: Array<{ name?: string }>
  }
  const names: string[] = []
  let offset = 0
  for (let page = 0; page < GENRE_VOCAB_MAX_PAGES; page++) {
    const res = await mbFetch<Res>(
      `/genre/all?fmt=json&limit=${GENRE_VOCAB_PAGE}&offset=${offset}`
    )
    const rows = res.genres ?? []
    for (const row of rows) {
      const name = row.name?.trim()
      if (name) names.push(name)
    }
    offset += rows.length
    if (rows.length === 0 || offset >= (res['genre-count'] ?? 0)) break
  }
  if (names.length > 0) await genreVocabCache.set('all', names)
  return names
}

export async function getReleaseGroupGenres(rgid: string): Promise<string[]> {
  const cached = await releaseGroupGenresCache.get(rgid)
  if (cached !== undefined && cached !== null) return cached
  interface Res {
    genres?: MbGenreRow[]
  }
  const res = await mbFetch<Res>(`/release-group/${rgid}?inc=genres&fmt=json`)
  const genres = readGenres(res.genres)
  await releaseGroupGenresCache.set(rgid, genres)
  return genres
}


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

// ---- Label discography (the label page's "not in your library" browse) ----

interface LabelDiscographyEntry {
  fetchedAt: number
  discography: LabelDiscography | null
}

interface MbLabelSearchResponse {
  labels?: Array<{ id: string; name?: string; score?: number }>
}

interface MbLabelReleaseBrowseResponse {
  'release-count'?: number
  releases?: Array<{
    id: string
    title?: string
    'release-group'?: MbReleaseGroupRow
    'artist-credit'?: Array<{ name?: string; artist?: { name: string } }>
  }>
}

const labelDiscographyCache = new JsonCache<LabelDiscographyEntry>('label-discography')

const LABEL_RELEASE_PAGE = 100
// Chemikal Underground fits in one page; Blue Note does not. Three pages
// (300 releases, ~3.3s paced) keeps the first open tolerable — past that we
// set `truncated` and the UI says so.
const LABEL_RELEASE_MAX_PAGES = 3

// Resolve a label *name* (that's all the label index stores) to its MB
// catalog: search for the label entity, then browse its releases and fold
// them into release-groups with artist credits. Null when MB has no
// confident match for the name.
export async function fetchLabelDiscography(name: string): Promise<LabelDiscographyEntry> {
  const search = await mbFetch<MbLabelSearchResponse>(
    `/label?query=${encodeURIComponent(`label:"${name.replace(/"/g, '')}"`)}&limit=5&fmt=json`
  )
  // Require a near-exact hit — a fuzzy label match would fill the page with a
  // stranger's catalog, which is worse than showing nothing.
  const target = normalizeTitle(name)
  const hit = (search.labels ?? []).find(
    (l) => l.id && l.name && ((l.score ?? 0) >= 90 || normalizeTitle(l.name) === target)
  )
  if (!hit?.id || !hit.name) {
    const entry: LabelDiscographyEntry = { fetchedAt: Date.now(), discography: null }
    await labelDiscographyCache.set(name.toLowerCase(), entry)
    return entry
  }

  const byRg = new Map<string, LabelReleaseGroup>()
  let truncated = false
  let offset = 0
  for (let page = 0; page < LABEL_RELEASE_MAX_PAGES; page++) {
    const data = await mbFetch<MbLabelReleaseBrowseResponse>(
      `/release?label=${hit.id}&inc=release-groups+artist-credits&limit=${LABEL_RELEASE_PAGE}&offset=${offset}&fmt=json`
    )
    const rows = data.releases ?? []
    for (const r of rows) {
      const rg = r['release-group']
      if (!rg?.id) continue
      if (byRg.has(rg.id)) continue
      const artist = (r['artist-credit'] ?? [])
        .map((c) => c.name ?? c.artist?.name ?? '')
        .filter(Boolean)
        .join('')
      byRg.set(rg.id, {
        rgMbid: rg.id,
        title: rg.title ?? r.title ?? '',
        artist,
        firstReleaseDate: rg['first-release-date'] || null,
        primaryType: rg['primary-type'] ?? null,
        secondaryTypes: Array.isArray(rg['secondary-types']) ? rg['secondary-types'] : []
      })
    }
    offset += rows.length
    const total = data['release-count'] ?? offset
    if (rows.length < LABEL_RELEASE_PAGE || offset >= total) break
    if (page === LABEL_RELEASE_MAX_PAGES - 1 && offset < total) truncated = true
  }

  const entry: LabelDiscographyEntry = {
    fetchedAt: Date.now(),
    discography: {
      labelMbid: hit.id,
      labelName: hit.name,
      groups: [...byRg.values()].filter((g) => g.title),
      truncated
    }
  }
  await labelDiscographyCache.set(name.toLowerCase(), entry)
  return entry
}

export async function getLabelDiscographyCached(
  name: string
): Promise<LabelDiscographyEntry | null> {
  const cached = await labelDiscographyCache.get(name.toLowerCase())
  return cached ?? null
}
