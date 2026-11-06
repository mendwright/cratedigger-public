import type { PlexAlbum } from './plex'
import { compactTitle, normalizeTitle } from './title-match'

// Match names from the listening history (mostly Last.fm scrobbles, so plain
// strings with no Plex keys) to albums and artists in the library, so year
// charts get library covers and click through. Last.fm spells things a bit
// differently from the library, so the ladder goes from strict to loose:
//
//   * accents never decide a match ("Construcao" = "Construção")
//   * a shorter or longer artist credit still matches when one contains the
//     other: "Jorge Ben" ↔ "Jorge Ben Jor", "Milton Nascimento" ↔ "Milton
//     Nascimento & Lô Borges", "Nina Nastasia & Jim White" ↔ "Nina Nastasia"
//     — but only for an album with the same title, or (artists) as a whole-
//     word prefix of two or more words, so "Ben" never matches "Ben Folds".

function fold(s: string): string {
  return normalizeTitle(s.normalize('NFD').replace(/\p{M}+/gu, ''))
}
function foldCompact(s: string): string {
  return compactTitle(s.normalize('NFD').replace(/\p{M}+/gu, ''))
}

export interface HistoryLibraryIndex {
  byArtistTitle: Map<string, PlexAlbum>
  byArtistCompact: Map<string, PlexAlbum>
  byTitle: Map<string, PlexAlbum[]>
  artists: Map<string, string> // folded artist name → artist rating key
}

export function buildHistoryIndex(albums: PlexAlbum[]): HistoryLibraryIndex {
  const index: HistoryLibraryIndex = {
    byArtistTitle: new Map(),
    byArtistCompact: new Map(),
    byTitle: new Map(),
    artists: new Map()
  }
  for (const a of albums) {
    const artist = fold(a.artist || '')
    const title = fold(a.title || '')
    if (!artist || !title) continue
    if (a.artistRatingKey && !index.artists.has(artist)) index.artists.set(artist, a.artistRatingKey)
    const k = `${artist}\u0000${title}`
    if (!index.byArtistTitle.has(k)) index.byArtistTitle.set(k, a)
    const kc = `${artist}\u0000${foldCompact(a.title)}`
    if (!index.byArtistCompact.has(kc)) index.byArtistCompact.set(kc, a)
    const list = index.byTitle.get(title)
    if (list) list.push(a)
    else index.byTitle.set(title, [a])
  }
  return index
}

function overlaps(a: string, b: string): boolean {
  const pa = ` ${a} `
  const pb = ` ${b} `
  return pa.includes(pb) || pb.includes(pa)
}

export function matchHistoryAlbum(index: HistoryLibraryIndex, artist: string, title: string): PlexAlbum | null {
  const a = fold(artist)
  const t = fold(title)
  if (!a || !t) return null
  const exact = index.byArtistTitle.get(`${a}\u0000${t}`) ?? index.byArtistCompact.get(`${a}\u0000${foldCompact(title)}`)
  if (exact) return exact
  for (const cand of index.byTitle.get(t) ?? []) {
    if (overlaps(a, fold(cand.artist || ''))) return cand
  }
  return null
}

export function matchHistoryArtist(index: HistoryLibraryIndex, artist: string): string | null {
  const a = fold(artist)
  if (!a) return null
  const exact = index.artists.get(a)
  if (exact) return exact
  // Whole-word prefix either way, and the shorter name must be at least two
  // words (a lone "Ben" matches nothing). Prefer the closest-length name, so
  // "Jorge Ben" picks "Jorge Ben Jor" over a longer duo credit.
  let best: { key: string; diff: number } | null = null
  for (const [name, key] of index.artists) {
    const shorter = name.length < a.length ? name : a
    if (!shorter.includes(' ')) continue
    if (!(name.startsWith(`${a} `) || a.startsWith(`${name} `))) continue
    const diff = Math.abs(name.length - a.length)
    if (!best || diff < best.diff) best = { key, diff }
  }
  return best?.key ?? null
}
