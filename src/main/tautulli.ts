import { getTautulliUrl, getTautulliApiKey } from './store.js'
import type {
  ChartDimension,
  ChartEntry,
  ChartResult,
  ChartUser,
  ChartWindow,
  TautulliHealth
} from '../shared/charts.js'

// Thin client over the Tautulli API (https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference).
// Tautulli runs alongside Plex with admin scope, so unlike Cratedigger's own
// (non-owner) Plex session it sees EVERY user's play history — which is what
// the Charts feature needs. All calls are `GET /api/v2?apikey=&cmd=&...`.

function base(): string {
  const u = getTautulliUrl().trim().replace(/\/+$/, '')
  if (!u) throw new Error('Tautulli URL not configured (Settings → Charts)')
  return u
}

async function call<T>(cmd: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = getTautulliApiKey()
  if (!key) throw new Error('Tautulli API key not configured (Settings → Charts)')
  const url = new URL(`${base()}/api/v2`)
  url.searchParams.set('apikey', key)
  url.searchParams.set('cmd', cmd)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  let r: Response
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch {
    throw new Error('Could not reach Tautulli — check the URL and that it is running.')
  }
  const body = (await r.json()) as { response?: { result?: string; message?: string; data?: T } }
  const res = body.response
  if (!res || res.result !== 'success') {
    throw new Error(`Tautulli: ${res?.message || 'request failed'}`)
  }
  return res.data as T
}

export async function tautulliHealth(): Promise<TautulliHealth> {
  try {
    await call('status')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

interface RawUser {
  user_id: number
  username: string
  friendly_name: string | null
  user_thumb: string | null
  is_active: number
}

interface HistoryRow {
  date: number
  user_id: number
  title: string
  parent_title: string
  grandparent_title: string
  rating_key: number | string
  parent_rating_key: number | string
  grandparent_rating_key: number | string
  // Seconds actually played for this row (Tautulli's play_duration).
  duration?: number
  thumb: string | null
  parent_thumb: string | null
  grandparent_thumb: string | null
}

interface HistoryResponse {
  recordsFiltered: number
  totalrecords: number
  data: HistoryRow[]
}

// --- caching ----------------------------------------------------------------
// First open of Charts fans out a per-user history fetch; cache so window
// toggles and re-renders don't re-hammer Tautulli. Cleared whenever config
// changes (see setConfig handler in ipc.ts).
const PAGE = 1000
const MAX_PAGES = 25
const USERS_TTL = 30 * 60_000
const HIST_TTL = 5 * 60_000

let usersCache: { at: number; users: ChartUser[] } | null = null
const histCache = new Map<string, { at: number; rows: HistoryRow[] }>()

export function clearTautulliCaches(): void {
  usersCache = null
  histCache.clear()
  artistThumbCache.clear()
}

async function userTrackCount(userId: number): Promise<number> {
  const r = await call<HistoryResponse>('get_history', {
    media_type: 'track',
    user_id: userId,
    length: 1
  })
  return r.recordsFiltered ?? 0
}

export async function getChartUsers(): Promise<ChartUser[]> {
  if (usersCache && Date.now() - usersCache.at < USERS_TTL) return usersCache.users
  const raw = await call<RawUser[]>('get_users')
  const active = raw.filter((u) => u.user_id > 0 && u.is_active !== 0)
  const counts = await Promise.all(
    active.map((u) => userTrackCount(u.user_id).catch(() => 0))
  )
  const users: ChartUser[] = active
    .map((u, i) => ({
      userId: u.user_id,
      name: u.friendly_name || u.username,
      thumb: u.user_thumb || null,
      trackPlays: counts[i]
    }))
    .filter((u) => u.trackPlays > 0)
    .sort((a, b) => b.trackPlays - a.trackPlays)
  usersCache = { at: Date.now(), users }
  return users
}

function windowStart(window: ChartWindow): number {
  if (window === 'all') return 0
  const days = window === 'week' ? 7 : window === 'month' ? 30 : 365
  return Math.floor(Date.now() / 1000) - days * 86400
}

// Page through a user's track history (newest first), stopping once rows fall
// before `since`. Cached per (user, window).
async function userTrackHistory(userId: number, window: ChartWindow): Promise<HistoryRow[]> {
  const cacheKey = `${userId}:${window}`
  const hit = histCache.get(cacheKey)
  if (hit && Date.now() - hit.at < HIST_TTL) return hit.rows
  const since = windowStart(window)
  const rows: HistoryRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await call<HistoryResponse>('get_history', {
      media_type: 'track',
      user_id: userId,
      order_column: 'date',
      order_dir: 'desc',
      length: PAGE,
      start: page * PAGE
    })
    const batch = r.data || []
    if (batch.length === 0) break
    let crossed = false
    for (const row of batch) {
      if (since && row.date < since) {
        crossed = true
        break
      }
      rows.push(row)
    }
    if (crossed || batch.length < PAGE) break
  }
  histCache.set(cacheKey, { at: Date.now(), rows })
  return rows
}

// Seconds listened for one history row. Rows from a source that doesn't
// record play time (the pre-Tautulli Plex backfill) get a flat estimate so
// older listening still weighs something in the year / all-time windows.
export const ESTIMATED_PLAY_SECONDS = 210
export function playSeconds(row: { duration?: number | null }): number {
  const d = row.duration
  return typeof d === 'number' && d > 0 ? d : ESTIMATED_PLAY_SECONDS
}

function keyOf(row: HistoryRow, dim: ChartDimension): {
  id: string
  title: string
  subtitle: string | null
  ratingKey: string | null
  thumb: string | null
} {
  if (dim === 'artists') {
    return {
      id: row.grandparent_title || `artist:${row.grandparent_rating_key}`,
      title: row.grandparent_title,
      subtitle: null,
      ratingKey: row.grandparent_rating_key ? String(row.grandparent_rating_key) : null,
      // history rows have no artist thumb — resolved via get_metadata later
      thumb: null
    }
  }
  if (dim === 'albums') {
    return {
      id: String(row.parent_rating_key || `${row.grandparent_title}//${row.parent_title}`),
      title: row.parent_title,
      subtitle: row.grandparent_title || null,
      ratingKey: row.parent_rating_key ? String(row.parent_rating_key) : null,
      thumb: row.thumb || null
    }
  }
  // tracks: album cover (row.thumb), navigate to the album (parent rating key)
  return {
    id: String(row.rating_key || `${row.grandparent_title}//${row.title}`),
    title: row.title,
    subtitle: row.grandparent_title || null,
    ratingKey: row.parent_rating_key ? String(row.parent_rating_key) : null,
    thumb: row.thumb || null
  }
}

// Artists have no thumb in history; resolve real artist art via get_metadata,
// cached for the process. Cleared with the other Tautulli caches on reconfig.
const artistThumbCache = new Map<string, string | null>()
async function artistThumb(ratingKey: string): Promise<string | null> {
  const hit = artistThumbCache.get(ratingKey)
  if (hit !== undefined) return hit
  try {
    const m = await call<{ thumb?: string }>('get_metadata', { rating_key: ratingKey })
    const t = m?.thumb || null
    artistThumbCache.set(ratingKey, t)
    return t
  } catch {
    artistThumbCache.set(ratingKey, null)
    return null
  }
}

export async function getTopChart(args: {
  userIds: number[]
  window: ChartWindow
  dimension: ChartDimension
  limit: number
}): Promise<ChartResult> {
  const { userIds, window, dimension } = args
  const limit = Math.max(1, Math.min(args.limit || 25, 100))
  const histories = await Promise.all(userIds.map((id) => userTrackHistory(id, window)))

  const tally = new Map<
    string,
    { plays: number; seconds: number; title: string; subtitle: string | null; ratingKey: string | null; thumb: string | null }
  >()
  for (const rows of histories) {
    for (const row of rows) {
      const k = keyOf(row, dimension)
      if (!k.title) continue
      const secs = playSeconds(row)
      const cur = tally.get(k.id)
      if (cur) {
        cur.plays += 1
        cur.seconds += secs
      } else {
        tally.set(k.id, { plays: 1, seconds: secs, title: k.title, subtitle: k.subtitle, ratingKey: k.ratingKey, thumb: k.thumb })
      }
    }
  }

  // Rank by time listened, not play count: play counts crown whoever has the
  // shortest tracks (a 60-piece Schumann set outranks a week of one album).
  const entries: ChartEntry[] = [...tally.values()]
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
    .slice(0, limit)
    .map((e, i) => ({
      rank: i + 1,
      title: e.title,
      subtitle: e.subtitle,
      plays: e.plays,
      seconds: e.seconds,
      ratingKey: e.ratingKey,
      thumb: e.thumb
    }))

  // Fill real artist art for the (already-trimmed) top entries.
  if (dimension === 'artists') {
    await Promise.all(
      entries.map(async (e) => {
        if (e.ratingKey) e.thumb = await artistThumb(e.ratingKey)
      })
    )
  }

  return { dimension, window, userIds, entries }
}
