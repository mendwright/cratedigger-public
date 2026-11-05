import { getCreditedNames, getInLibraryAppearances } from './credit-index.js'
import { personNameKey, studioHow, type StudioPerson } from '../shared/studio.js'

// Resolve the configured studio names against the local credits cache and
// collect each person's board credits. Names, not MBIDs, are what the user
// types; MusicBrainz sometimes has two entries for one name, so every
// matching id is merged and the one with the most board credits is kept as
// the person's link target.
export async function listStudioPeople(names: readonly string[]): Promise<StudioPerson[]> {
  const credited = await getCreditedNames()
  const byKey = new Map<string, string[]>()
  for (const [mbid, name] of credited) {
    const k = personNameKey(name)
    const list = byKey.get(k)
    if (list) list.push(mbid)
    else byKey.set(k, [mbid])
  }
  const out: StudioPerson[] = []
  for (const name of names) {
    const albums: StudioPerson['albums'] = {}
    let best: { mbid: string; n: number } | null = null
    for (const mbid of byKey.get(personNameKey(name)) ?? []) {
      let n = 0
      for (const app of await getInLibraryAppearances(mbid)) {
        const how = studioHow(app.roles)
        if (!how) continue
        n++
        const prev = albums[app.plexRatingKey]
        // Keep the strongest role if two ids credit the same album.
        if (!prev || prev === 'mixed' || (prev === 'produced' && how === 'recorded')) {
          albums[app.plexRatingKey] = how
        }
      }
      if (!best || n > best.n) best = { mbid, n }
    }
    out.push({ name, mbid: best?.mbid ?? null, albums })
  }
  return out
}
