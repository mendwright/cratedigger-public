import type { AlbumCredits, CreditPerson, TrackCredit } from './plex'

export type ClassicalMatchMethod =
  | 'recording-guid'
  | 'acoustid-recording'
  | 'release-track-guid'
  | 'disc-index'
  | 'title-duration'
  | 'none'

export interface ClassicalTrackMetadata {
  matchMethod: ClassicalMatchMethod
  releaseTrackMbid: string | null
  recordingMbid: string | null
  workMbid: string | null
  workTitle: string | null
  parentWorkMbid: string | null
  parentWorkTitle: string | null
  composers: CreditPerson[]
}

export interface ComposerCoverage {
  person: CreditPerson
  trackCount: number
}

export interface ClassicalAlignmentCounts {
  acoustidRecording: number
  recordingGuid: number
  releaseTrackGuid: number
  discIndex: number
  titleDuration: number
  unmatched: number
}

export interface ClassicalAlbumModel {
  source: 'exact' | 'reconciled' | 'none'
  alignmentConfidence: 'exact' | 'strong' | 'weak' | 'none'
  releaseMbid: string | null
  matchedTracks: number
  totalTracks: number
  alignment: ClassicalAlignmentCounts
  composers: ComposerCoverage[]
  byTrack: Record<string, ClassicalTrackMetadata>
}

export interface ComposerOverride extends CreditPerson {}

export interface ComposerSearchResult extends CreditPerson {
  score: number
  disambiguation: string | null
  type: 'Person'
}

export interface EffectiveComposers {
  source: 'override' | 'musicbrainz' | 'none'
  people: CreditPerson[]
}

const CLASSICAL_REPERTOIRE_GENRE = /^(?:classical|chamber music|opera|orchestral|concerto)$/i

/** Explicit Plex genre vocabulary only. Title punctuation and generic
 * "Instrumental" are intentionally insufficient to classify an album. */
export function isClassicalRepertoire(genres: string[]): boolean {
  return genres.some((genre) => CLASSICAL_REPERTOIRE_GENRE.test(genre.trim()))
}

const CLASSICAL_NAME_OR_FORM = /\b(?:bach|beethoven|berlioz|brahms|bruckner|chopin|debussy|dvořák|dvorak|grieg|handel|haydn|liszt|mahler|mendelssohn|monteverdi|mozart|prokofiev|puccini|ravel|rossini|saint-saëns|saint-saens|schubert|schumann|shostakovich|sibelius|strauss|stravinsky|tchaikovsky|verdi|vivaldi|wagner|symphon(?:y|ies)|concerto|sonata|quartet|quintet|partita|prelude|fugue|nocturne|étude|etude|requiem|oratorio|variations?)\b/i
const CLASSICAL_CATALOGUE_NUMBER = /\b(?:opus|op\.?|bwv|hob\.?|k\.?|köchel|d\.?|rv)\s*\d+/i

/** Broader enrichment candidate than the final repertoire classification.
 * Plex genre tags are sparse in real libraries, so composer/work language in
 * the album identity is enough to fetch exact MB relationships. False
 * candidates cost one cached lookup; they do not become classical unless the
 * resulting work graph says so. */
export function isClassicalCandidate(album: {
  artist: string
  title: string
  genres: string[]
}): boolean {
  if (isClassicalRepertoire(album.genres)) return true
  const identity = `${album.artist} ${album.title}`
  return CLASSICAL_NAME_OR_FORM.test(identity) || CLASSICAL_CATALOGUE_NUMBER.test(identity)
}

function searchTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Word-aware catalog matching. Short composer names such as Bach must match
 * a whole token (never bachelor/Laibach); five-plus characters may prefix a
 * token so incremental searches such as "beeth" still find Beethoven. */
export function matchesClassicalQuery(value: string, query: string): boolean {
  const wanted = searchTokens(query)
  if (wanted.length === 0) return true
  const available = searchTokens(value)
  return wanted.every((needle) =>
    available.some((token) => token === needle || (needle.length >= 5 && token.startsWith(needle)))
  )
}

/**
 * Does the aligned work graph itself look like classical repertoire?
 *
 * MusicBrainz gives pop songs the same skeleton as classical movements —
 * every song is a "work", every songwriter a work-level relation — so a
 * non-empty ClassicalAlbumModel proves nothing about the record (a Divorce
 * album once wore its lead writer as the album artist because of this).
 * What pop works essentially never have: a parent work (movements of a
 * larger piece) or a catalogue number in the work title. Require a majority
 * of matched works to carry one of those signals before the model may
 * reshape presentation or enter the classical catalog. Genre tags, when
 * present, are a separate and sufficient signal (isClassicalRepertoire).
 */
export function modelAssertsRepertoire(model: ClassicalAlbumModel | null | undefined): boolean {
  if (!model || model.matchedTracks === 0) return false
  let workTracks = 0
  let classicalShaped = 0
  for (const track of Object.values(model.byTrack)) {
    if (!track.workMbid) continue
    workTracks++
    const titles = `${track.workTitle ?? ''} ${track.parentWorkTitle ?? ''}`
    if (
      track.parentWorkMbid ||
      CLASSICAL_CATALOGUE_NUMBER.test(titles) ||
      CLASSICAL_NAME_OR_FORM.test(titles)
    ) {
      classicalShaped++
    }
  }
  return workTracks > 0 && classicalShaped >= Math.ceil(workTracks / 2)
}

const PERFORMER_ROLES = new Set(['instrument', 'vocal', 'performer', 'conductor', 'orchestra'])

export function classicalTrackPerformers(credits: TrackCredit[]): CreditPerson[] {
  // One person per row even when they hold several roles on the track
  // (guitar + backing vocals). Dedupe in a single pass — a filter().map()
  // chain runs the whole filter before the map ever marks anyone seen, so
  // it never dedupes, and the duplicate MBID then blows up the keyed each
  // block that renders these (it took the Now Playing screen down with it).
  const seen = new Set<string>()
  const people: CreditPerson[] = []
  for (const credit of credits) {
    if (!PERFORMER_ROLES.has(credit.role) || seen.has(credit.person.mbid)) continue
    seen.add(credit.person.mbid)
    people.push(credit.person)
  }
  return people
}

/** Performers credited on the broadest share of an album's tracks. This
 * replaces Plex's often-composer-valued album artist on classical programs. */
export function classicalAlbumPerformers(credits: AlbumCredits | null | undefined): CreditPerson[] {
  if (!credits?.classical) return []
  const counts = new Map<string, { person: CreditPerson; tracks: number }>()
  const trackLists = Object.values(credits.byTrack)
  for (const list of trackLists) {
    for (const person of classicalTrackPerformers(list)) {
      const hit = counts.get(person.mbid)
      if (hit) hit.tracks++
      else counts.set(person.mbid, { person, tracks: 1 })
    }
  }
  const max = Math.max(0, ...[...counts.values()].map((entry) => entry.tracks))
  if (max === 0) return []
  return [...counts.values()].filter((entry) => entry.tracks === max).map((entry) => entry.person)
}

/** Composer identity precedence for hero/index consumers. Manual identity is
 * independent of track alignment; MB composers require trustworthy alignment.
 * This resolver deliberately says nothing about work nesting. */
export function resolveEffectiveComposers(
  model: ClassicalAlbumModel | null | undefined,
  override: ComposerOverride | null | undefined
): EffectiveComposers {
  const trusted =
    model?.alignmentConfidence === 'exact' || model?.alignmentConfidence === 'strong'
  if (trusted && model.composers.length > 0) {
    return { source: 'musicbrainz', people: model.composers.map(({ person }) => person) }
  }
  if (override?.mbid && override.name.trim()) {
    return { source: 'override', people: [{ mbid: override.mbid, name: override.name.trim() }] }
  }
  return { source: 'none', people: [] }
}
