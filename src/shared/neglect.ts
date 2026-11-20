// Neglected favorites and neglected gems, from the 20-year listening history.
//
//   favorites — albums Jay put real hours into, then drifted away from.
//               Built from his history only. Plex's star ratings are not his
//               (he never rates), so they play no part here.
//   gems      — albums Plex rates highly (mostly critic scores) that he has
//               barely played, judged against the whole history.
//
// Without a history (no tagger, Mary's Air, the shop) callers fall back to
// the old Plex-only rules.

import { buildHistoryIndex, matchHistoryAlbum } from './history-match.js'
import type { PlexAlbum } from './plex.js'

/** One album as the tagger's /history/<who>/albums returns it. */
export interface HistoryAlbumRow {
  a: string // artist
  b: string // album
  n: number // plays
  s: number // seconds listened
  last: number // unix seconds of the last play
  key: string | null // Plex rating key, when a Plex-era play carried one
}

/** All-time listening for one library album. */
export interface AlbumListen {
  plays: number
  seconds: number
  last: number
}

/** ratingKey → all-time listening. Albums never heard are absent. */
export type AlbumListenMap = Record<string, AlbumListen>

/**
 * Match the tagger's album rows to library albums. A Plex rating key wins when
 * it's still in the library; otherwise (Last.fm / Spotify / Apple eras, or a
 * re-added album) match by name. Several history rows can land on one album
 * (editions, credit spellings): plays and seconds add up, the latest play wins.
 */
export function buildAlbumListens(rows: HistoryAlbumRow[], albums: PlexAlbum[]): AlbumListenMap {
  const live = new Set(albums.map((a) => a.ratingKey))
  const index = buildHistoryIndex(albums)
  const out: AlbumListenMap = {}
  for (const r of rows) {
    const key = r.key && live.has(r.key) ? r.key : matchHistoryAlbum(index, r.a, r.b)?.ratingKey
    if (!key) continue
    const cur = out[key]
    if (cur) {
      cur.plays += r.n
      cur.seconds += r.s
      cur.last = Math.max(cur.last, r.last)
    } else {
      out[key] = { plays: r.n, seconds: r.s, last: r.last }
    }
  }
  return out
}

const YEAR = 365.25 * 86400

/** Real time with it: more than one full listen of a typical album. */
export const FAVORITE_MIN_SECONDS = 3600
/** Gone at least this long before it counts as neglected. */
export const FAVORITE_MIN_GAP_SECONDS = YEAR
/** Plex rating (0–10) a gem needs: four stars and up. */
export const GEM_MIN_RATING = 8
/** "Barely played": under about one full listen, all time. */
export const GEM_MAX_SECONDS = 3600

/**
 * Hours listened × years since the last play, for albums with an hour or more
 * that have been gone a year or more. Anything else scores -1 (not neglected).
 */
export function favoriteScore(listen: AlbumListen | undefined, nowSec: number): number {
  if (!listen || listen.seconds < FAVORITE_MIN_SECONDS) return -1
  const gone = nowSec - listen.last
  if (gone < FAVORITE_MIN_GAP_SECONDS) return -1
  return (listen.seconds / 3600) * (gone / YEAR)
}

export function isNeglectedFavorite(listen: AlbumListen | undefined, nowSec: number): boolean {
  return favoriteScore(listen, nowSec) > 0
}

/** Plex rates it highly and the whole history has barely touched it. */
export function isNeglectedGem(rating: number | null | undefined, listen: AlbumListen | undefined): boolean {
  return (rating ?? 0) >= GEM_MIN_RATING && (listen?.seconds ?? 0) < GEM_MAX_SECONDS
}
