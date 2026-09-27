import type { CreditPerson, PlexTrack } from './plex'
import type { ClassicalTrackMetadata } from './classical-model'

export interface DiscGroup {
  discNumber: number | null
  tracks: PlexTrack[]
}

export interface DiscDiagnostics {
  duplicateCoords: Array<{
    disc: number | null
    index: number | null
    count: number
  }>
  missingDisc: number
  missingIndex: number
}

export interface WorkMovement {
  track: PlexTrack
  movementLabel: string
}

export interface WorkGroup {
  key: string
  title: string | null
  composers: CreditPerson[]
  movements: WorkMovement[]
}

export interface DiscWorkGroups {
  discNumber: number | null
  groups: WorkGroup[]
}

function validCoordinate(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Return tracks in disc/track order without mutating the input. Tracks with an
 * incomplete or malformed coordinate retain their response order at the end.
 */
export function stableSortTracks(tracks: PlexTrack[]): PlexTrack[] {
  return tracks
    .map((track, responseIndex) => ({ track, responseIndex }))
    .sort((a, b) => {
      const aValid = validCoordinate(a.track.parentIndex) && validCoordinate(a.track.index)
      const bValid = validCoordinate(b.track.parentIndex) && validCoordinate(b.track.index)

      if (aValid !== bValid) return aValid ? -1 : 1
      if (!aValid || !bValid) return a.responseIndex - b.responseIndex

      const aDisc = a.track.parentIndex
      const bDisc = b.track.parentIndex
      const aIndex = a.track.index
      const bIndex = b.track.index
      if (
        !validCoordinate(aDisc) ||
        !validCoordinate(bDisc) ||
        !validCoordinate(aIndex) ||
        !validCoordinate(bIndex)
      ) return a.responseIndex - b.responseIndex
      return aDisc - bDisc || aIndex - bIndex || a.responseIndex - b.responseIndex
    })
    .map(({ track }) => track)
}

/**
 * Project a flat Plex track list into ordered discs. Any track missing either
 * half of its disc/track coordinate is placed in one final `Other` group.
 */
export function projectDiscGroups(tracks: PlexTrack[]): DiscGroup[] {
  const groups = new Map<number, PlexTrack[]>()
  const other: PlexTrack[] = []

  for (const track of stableSortTracks(tracks)) {
    if (!validCoordinate(track.parentIndex) || !validCoordinate(track.index)) {
      other.push(track)
      continue
    }
    const group = groups.get(track.parentIndex)
    if (group) group.push(track)
    else groups.set(track.parentIndex, [track])
  }

  const projected: DiscGroup[] = [...groups].map(([discNumber, discTracks]) => ({
    discNumber,
    tracks: discTracks
  }))
  if (other.length > 0) projected.push({ discNumber: null, tracks: other })
  return projected
}

export function hasMultipleDiscs(groups: DiscGroup[]): boolean {
  const realDiscs = groups.filter((group) => group.discNumber !== null)
  return realDiscs.length > 1 || realDiscs.some((group) => (group.discNumber ?? 0) > 1)
}

export function discDiagnostics(tracks: PlexTrack[]): DiscDiagnostics {
  let missingDisc = 0
  let missingIndex = 0
  const coordinateCounts = new Map<string, {
    disc: number | null
    index: number | null
    count: number
  }>()

  for (const track of tracks) {
    const disc = validCoordinate(track.parentIndex) ? track.parentIndex : null
    const index = validCoordinate(track.index) ? track.index : null
    if (disc === null) missingDisc++
    if (index === null) missingIndex++

    const key = `${disc ?? 'null'}:${index ?? 'null'}`
    const existing = coordinateCounts.get(key)
    if (existing) existing.count++
    else coordinateCounts.set(key, { disc, index, count: 1 })
  }

  return {
    duplicateCoords: [...coordinateCounts.values()].filter(({ count }) => count > 1),
    missingDisc,
    missingIndex
  }
}

function movementLabels(tracks: PlexTrack[]): string[] {
  const titles = tracks.map((track) => track.title)
  if (titles.length < 2) return titles

  const lower = titles.map((title) => title.toLocaleLowerCase())
  let prefixLength = lower[0].length
  for (let i = 1; i < lower.length; i++) {
    prefixLength = Math.min(prefixLength, lower[i].length)
    let j = 0
    while (j < prefixLength && lower[0][j] === lower[i][j]) j++
    prefixLength = j
  }
  if (prefixLength === 0) return titles

  const sharedPrefix = titles[0].slice(0, prefixLength)
  const delimiter = /:\s*|\s+[–—-]\s+|\s*\/\s*/g
  let cut = 0
  for (const match of sharedPrefix.matchAll(delimiter)) {
    cut = (match.index ?? 0) + match[0].length
  }
  if (cut === 0) return titles

  const labels = titles.map((title) => title.slice(cut).trim())
  return labels.every(Boolean) ? labels : titles
}

function groupComposers(
  tracks: PlexTrack[],
  byTrack: Record<string, ClassicalTrackMetadata>
): CreditPerson[] {
  const people: CreditPerson[] = []
  const seen = new Set<string>()
  for (const track of tracks) {
    for (const person of byTrack[track.ratingKey]?.composers ?? []) {
      if (seen.has(person.mbid)) continue
      seen.add(person.mbid)
      people.push(person)
    }
  }
  return people
}

/**
 * Preserve disc order while projecting consecutive MusicBrainz work runs.
 * Repeated non-adjacent works intentionally remain separate presentation
 * groups; unknown tracks form in-place loose runs.
 */
export function projectClassicalTracks(
  discs: DiscGroup[],
  byTrack: Record<string, ClassicalTrackMetadata>
): DiscWorkGroups[] {
  return discs.map((disc) => {
    const runs: Array<{ identity: string | null; tracks: PlexTrack[] }> = []
    for (const track of disc.tracks) {
      const metadata = byTrack[track.ratingKey]
      const identity = metadata?.parentWorkMbid ?? metadata?.workMbid ?? null
      const previous = runs.at(-1)
      if (previous && previous.identity === identity) previous.tracks.push(track)
      else runs.push({ identity, tracks: [track] })
    }

    const occurrences = new Map<string, number>()
    let loose = 0
    const groups = runs.map((run): WorkGroup => {
      const first = byTrack[run.tracks[0].ratingKey]
      let key: string
      if (run.identity) {
        const occurrence = (occurrences.get(run.identity) ?? 0) + 1
        occurrences.set(run.identity, occurrence)
        key = `work:${run.identity}:${occurrence}`
      } else {
        key = `loose:${++loose}`
      }
      const labels = movementLabels(run.tracks)
      return {
        key,
        title: run.identity ? first?.parentWorkTitle ?? first?.workTitle ?? null : null,
        composers: groupComposers(run.tracks, byTrack),
        movements: run.tracks.map((track, index) => ({
          track,
          movementLabel: labels[index]
        }))
      }
    })

    return { discNumber: disc.discNumber, groups }
  })
}

export function hasWorkStructure(discs: DiscWorkGroups[]): boolean {
  return discs.some((disc) =>
    disc.groups.some((group) => group.title !== null && group.movements.length > 1)
  )
}
