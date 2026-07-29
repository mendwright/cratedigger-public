// Pure derivation logic for the artist/person entity page (Entity.svelte).
// Data in, data out — no plexState reads, no component context — so the
// grouping/sorting/filtering rules are unit-testable without a Svelte mount.
import type { PersonAppearance, PlexAlbum } from '../../../shared/plex'

export type AppearanceRow = { album: PlexAlbum; roles: PersonAppearance['roles'] }

export type AppearanceGroup = {
  role: string
  instrument: string | null
  label: string
  albums: PlexAlbum[]
}

// Display order for role groups: performance roles first (what the user came
// to see), then production/writing, then catch-all. A label matches the
// earliest entry it contains as a substring.
export const ROLE_RANK = [
  'lead vocals',
  'vocal',
  'vocals',
  'guitar',
  'bass',
  'bass guitar',
  'drums',
  'keyboard',
  'piano',
  'producer',
  'mix',
  'engineer',
  'composer',
  'writer',
  'arranger',
  'member'
]

export function roleRank(label: string): number {
  const l = label.toLowerCase()
  for (let i = 0; i < ROLE_RANK.length; i++) if (l.includes(ROLE_RANK[i])) return i
  return ROLE_RANK.length
}

/**
 * Group the inverted-index appearances by role/instrument so the page can
 * show "guitar (4 albums)", "vocals (2 albums)" — finer-grained than the
 * MB-walked entityCredited section, which only carries release-level roles.
 * Each group's album list is year-sorted (oldest first); groups are ordered
 * by {@link roleRank} then label.
 */
export function groupAppearances(appearances: AppearanceRow[] | null): AppearanceGroup[] {
  if (!appearances) return []
  const groups = new Map<string, AppearanceGroup>()
  for (const a of appearances) {
    for (const r of a.roles) {
      const key = r.instrument ? `${r.role}::${r.instrument}` : r.role
      const label = r.instrument ?? r.role
      let g = groups.get(key)
      if (!g) {
        g = { role: r.role, instrument: r.instrument, label, albums: [] }
        groups.set(key, g)
      }
      if (!g.albums.some((x) => x.ratingKey === a.album.ratingKey)) g.albums.push(a.album)
    }
  }
  const out = [...groups.values()]
  for (const g of out) g.albums.sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999))
  out.sort((a, b) => {
    const r = roleRank(a.label) - roleRank(b.label)
    if (r !== 0) return r
    return a.label.localeCompare(b.label)
  })
  return out
}

export type EntitySort = 'most-played' | 'release'

/**
 * Album comparator for the entity page's sort toggle. "most-played" ranks by
 * viewCount desc, then lastViewedAt desc; both modes fall through to year
 * asc, then title.
 */
export function compareAlbums(a: PlexAlbum, b: PlexAlbum, sort: EntitySort): number {
  if (sort === 'most-played') {
    const ac = a.viewCount ?? 0
    const bc = b.viewCount ?? 0
    if (bc !== ac) return bc - ac
    const al = a.lastViewedAt ?? 0
    const bl = b.lastViewedAt ?? 0
    if (bl !== al) return bl - al
  }
  const ay = a.year ?? 9999
  const by = b.year ?? 9999
  if (ay !== by) return ay - by
  return a.title.localeCompare(b.title)
}

export type CreditedAlbumEntry = { album: PlexAlbum; roles: string[] }

export const TWO_YEARS_SECS = 2 * 365 * 24 * 60 * 60

/**
 * "Deep cuts": credited albums the user owns but hasn't played in ~2y (or
 * ever). Rediscovery candidates, year-sorted, capped at 6. `nowSecs` is
 * injectable for tests; defaults to the current time.
 */
export function filterDeepCuts(
  inLibrary: CreditedAlbumEntry[],
  nowSecs: number = Math.floor(Date.now() / 1000)
): CreditedAlbumEntry[] {
  const items = inLibrary.filter((entry) => {
    const vc = entry.album.viewCount ?? 0
    if (vc === 0) return true
    const lv = entry.album.lastViewedAt
    if (!lv) return false
    return nowSecs - lv > TWO_YEARS_SECS
  })
  return items.sort((a, b) => (a.album.year ?? 9999) - (b.album.year ?? 9999)).slice(0, 6)
}
