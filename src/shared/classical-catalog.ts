import type { AlbumCredits, CreditPerson } from './plex'

export interface ClassicalCatalogWork {
  mbid: string
  title: string
  albumRatingKeys: string[]
  recordingMbids: string[]
  movementCount: number
}

export interface ClassicalCatalogComposer {
  person: CreditPerson
  albumRatingKeys: string[]
  works: ClassicalCatalogWork[]
}

export interface ClassicalCatalogSnapshot {
  generatedAt: string
  enrichedAlbums: number
  classicalAlbums: number
  recordingCount: number
  workCount: number
  composers: ClassicalCatalogComposer[]
}

export interface CachedAlbumCredits {
  ratingKey: string
  credits: AlbumCredits
}

/** Build the owned-classical graph from the durable album-credit cache. */
export function buildClassicalCatalog(
  albums: CachedAlbumCredits[],
  generatedAt = new Date().toISOString()
): ClassicalCatalogSnapshot {
  type MutableWork = {
    mbid: string
    title: string
    albums: Set<string>
    recordings: Set<string>
    movements: Set<string>
  }
  type MutableComposer = {
    person: CreditPerson
    albums: Set<string>
    works: Map<string, MutableWork>
  }

  const composers = new Map<string, MutableComposer>()
  const allWorks = new Set<string>()
  const allRecordings = new Set<string>()
  let classicalAlbums = 0

  for (const { ratingKey, credits } of albums) {
    const classical = credits.classical
    if (!classical || classical.matchedTracks === 0) continue
    classicalAlbums++
    for (const track of Object.values(classical.byTrack)) {
      if (track.recordingMbid) allRecordings.add(track.recordingMbid)
      const workMbid = track.parentWorkMbid ?? track.workMbid
      const workTitle = track.parentWorkTitle ?? track.workTitle
      if (!workMbid || !workTitle) continue
      allWorks.add(workMbid)
      for (const person of track.composers) {
        let composer = composers.get(person.mbid)
        if (!composer) {
          composer = { person, albums: new Set(), works: new Map() }
          composers.set(person.mbid, composer)
        }
        composer.albums.add(ratingKey)
        let work = composer.works.get(workMbid)
        if (!work) {
          work = {
            mbid: workMbid,
            title: workTitle,
            albums: new Set(),
            recordings: new Set(),
            movements: new Set()
          }
          composer.works.set(workMbid, work)
        }
        work.albums.add(ratingKey)
        if (track.recordingMbid) work.recordings.add(track.recordingMbid)
        if (track.workMbid) work.movements.add(track.workMbid)
      }
    }
  }

  return {
    generatedAt,
    enrichedAlbums: albums.length,
    classicalAlbums,
    recordingCount: allRecordings.size,
    workCount: allWorks.size,
    composers: [...composers.values()]
      .map((composer) => ({
        person: composer.person,
        albumRatingKeys: [...composer.albums],
        works: [...composer.works.values()]
          .map((work) => ({
            mbid: work.mbid,
            title: work.title,
            albumRatingKeys: [...work.albums],
            recordingMbids: [...work.recordings],
            movementCount: work.movements.size
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      }))
      .sort((a, b) => a.person.name.localeCompare(b.person.name))
  }
}
