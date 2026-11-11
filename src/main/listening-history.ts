import type { ChartDimension, ChartEntry } from '../shared/charts.js'
import { PUBLIC_BUILD } from '../shared/build-flags.js'
import type { HistoryArtistStats, HistoryReview, HistoryItemStats, HistorySummary } from '../shared/listening-history.js'
import {
  buildHistoryIndex,
  matchHistoryAlbum,
  matchHistoryArtist,
  type HistoryLibraryIndex
} from '../shared/history-match.js'
import { librarySnapshot } from './library-snapshot.js'
import { getAccountInfo, getActiveAccountId, getTaggerApiKey, getTaggerUrl } from './store.js'

// The signed-in person's long-run listening history, from the tagger
// (GET /history/<plex username>…, see service/app/history.py). Private data
// on the tailnet: no tagger, or no history for this account (Mary's Air, the
// shop) → null, and the UI just doesn't show it.

const TTL_MS = 5 * 60_000
const memo = new Map<string, { at: number; value: unknown }>()

function profile(): string | null {
  const id = getActiveAccountId()
  return (id && getAccountInfo(id)?.username) || null
}

async function get<T>(path: string, params: Record<string, string | number | null | undefined> = {}): Promise<T | null> {
  if (PUBLIC_BUILD) return null
  const base = getTaggerUrl().replace(/\/$/, '')
  const key = getTaggerApiKey()
  const who = profile()
  if (!base || !key || !who) return null
  const url = new URL(`${base}/history/${encodeURIComponent(who)}${path}`)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  const cacheKey = url.toString()
  const hit = memo.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  let r: Response
  try {
    r = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(20_000) })
  } catch {
    return null // off the tailnet / tagger down — the feature just stays quiet
  }
  if (r.status === 404) {
    memo.set(cacheKey, { at: Date.now(), value: null })
    return null
  }
  if (!r.ok) throw new Error(`listening history: HTTP ${r.status}`)
  const value = (await r.json()) as T
  memo.set(cacheKey, { at: Date.now(), value })
  return value
}

export function clearHistoryCache(): void {
  memo.clear()
}

export async function historySummary(): Promise<HistorySummary | null> {
  return await get<HistorySummary>('')
}

export async function historyItem(args: { artist: string; album?: string | null; track?: string | null }): Promise<HistoryItemStats | null> {
  return await get<HistoryItemStats>('/item', { artist: args.artist, album: args.album, track: args.track })
}

interface RawEntry extends ChartEntry {
  art?: string | null
  album?: string | null // tracks: the album they were mostly heard on
}

// Older plays (Last.fm era) have only names, no Plex keys. Look each one up
// in the library snapshot (shared/history-match.ts) so the card gets the
// library's cover and opens the album / artist page; anything not in the
// library keeps Last.fm's cover.
let indexMemo: { at: number; index: HistoryLibraryIndex } | null = null

async function libraryIndex(): Promise<HistoryLibraryIndex> {
  if (indexMemo && Date.now() - indexMemo.at < TTL_MS) return indexMemo.index
  const index = buildHistoryIndex(await librarySnapshot.allAlbums())
  indexMemo = { at: Date.now(), index }
  return index
}

export async function historyTop(args: {
  dimension: ChartDimension
  start: number | null
  end: number | null
  limit: number
  artist?: string
}): Promise<ChartEntry[] | null> {
  const doc = await get<{ entries: RawEntry[] }>('/top', {
    dim: args.dimension,
    artist: args.artist,
    start: args.start,
    end: args.end,
    limit: Math.max(1, Math.min(args.limit || 200, 500))
  })
  if (!doc) return null
  return enrichEntries(doc.entries, args.dimension)
}

async function enrichEntries(entries: RawEntry[], dimension: ChartDimension): Promise<ChartEntry[]> {
  const index = await libraryIndex()
  return entries.map((e) => {
    const out: ChartEntry = {
      rank: e.rank,
      title: e.title,
      subtitle: e.subtitle,
      plays: e.plays,
      seconds: e.seconds,
      ratingKey: e.ratingKey,
      thumb: e.thumb,
      album: e.album ?? null,
      art: e.art ?? null
    }
    if (dimension === 'artists') {
      if (!out.ratingKey) out.ratingKey = matchHistoryArtist(index, e.title)
      // Plex serves an artist's picture at its metadata thumb path.
      if (out.ratingKey) out.thumb = `/library/metadata/${out.ratingKey}/thumb`
      return out
    }
    // Albums match on their own title; tracks on the album they came from.
    const albumTitle = dimension === 'albums' ? e.title : e.album
    if ((!out.ratingKey || !out.thumb) && e.subtitle && albumTitle) {
      const hit = matchHistoryAlbum(index, e.subtitle, albumTitle)
      if (hit) {
        out.ratingKey = out.ratingKey ?? hit.ratingKey
        out.thumb = out.thumb ?? hit.thumb
      }
    }
    return out
  })
}

export async function historyReview(bounds: { start: number; end: number }): Promise<HistoryReview | null> {
  const report = await get<HistoryReview>('/review', bounds)
  if (!report) return null
  const [artists, albums, tracks, discoveries] = await Promise.all([
    enrichEntries(report.topArtist ? [report.topArtist] : [], 'artists'),
    enrichEntries(report.topAlbum ? [report.topAlbum] : [], 'albums'),
    enrichEntries(report.topTrack ? [report.topTrack] : [], 'tracks'),
    enrichEntries(report.newArtists, 'artists')
  ])
  return { ...report, topArtist: artists[0] ?? null, topAlbum: albums[0] ?? null, topTrack: tracks[0] ?? null, newArtists: discoveries }
}
export async function historyArtist(args: { artist: string; start: number | null; end: number | null }): Promise<HistoryArtistStats | null> {
  return get<HistoryArtistStats>('/artist', args)
}
