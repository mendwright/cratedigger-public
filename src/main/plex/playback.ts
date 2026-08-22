import type {
  MusicTimeline,
  PlayerContext,
  PlayerState,
  ServerContext
} from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { plexFetch } from './http.js'

// The timeline poll is a LAN long-poll against Plexamp with wait=0 — it should
// answer in well under a second. The default 15s plexFetch budget is for slow
// PMS library calls; applied here it froze the Now Playing bar for the full 15s
// whenever Plexamp held the connection open through a natural track transition.
// Cap both the poll and its follow-up metadata fetch tight so a stalled poll
// recovers on the next 2.5s tick instead of wedging the bar.
const TIMELINE_TIMEOUT_MS = 4000

let commandCounter = 1000

function nextCommandId(): number {
  return ++commandCounter
}

function playerRequestInit(player: PlayerContext, accept = 'application/xml'): RequestInit {
  return {
    headers: {
      ...plexHeaders(player.token),
      Accept: accept,
      'X-Plex-Target-Client-Identifier': player.id
    }
  }
}

interface RawMetadata {
  ratingKey: string
  title?: string
  grandparentTitle?: string
  parentTitle?: string
  parentRatingKey?: string
  parentThumb?: string
  thumb?: string
  duration?: number
}

interface MetadataResponse {
  MediaContainer: {
    Metadata?: RawMetadata[]
  }
}

function coerceState(raw: string | undefined): PlayerState | null {
  if (raw === 'playing' || raw === 'paused' || raw === 'buffering' || raw === 'stopped') return raw
  return null
}

function extractTimelineAttr(xml: string, type: string, attr: string): string | undefined {
  // Find <Timeline ... type="music" ... /> then pull attr="value" out of it.
  const elRe = new RegExp(`<Timeline\\b[^>]*\\btype="${type}"[^>]*/?>`, 'i')
  const el = xml.match(elRe)?.[0]
  if (!el) return undefined
  const attrRe = new RegExp(`\\b${attr}="([^"]*)"`, 'i')
  return el.match(attrRe)?.[1]
}

// plexFetch's timeout only guards the connection/header phase — its abort
// timer is disarmed the moment the response starts. A wedged player that
// accepts the request and then stalls mid-body would hang the `.text()` read
// forever, and upstream that unresolved IPC permanently freezes the
// renderer's timeline poll loop (Now Playing bar gone until a reload). One
// deadline spanning fetch AND body read closes the gap.
async function fetchTextWithDeadline(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(
    () => ctrl.abort(new DOMException('timeout', 'TimeoutError')),
    timeoutMs
  )
  try {
    const res = await plexFetch(url, { ...init, signal: ctrl.signal }, timeoutMs)
    return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' }
  } finally {
    clearTimeout(timer)
  }
}

export async function getMusicTimelineForPlayer(
  server: ServerContext,
  player: PlayerContext
): Promise<MusicTimeline | null> {
  const pollUrl = new URL(`${player.baseUrl}/player/timeline/poll`)
  pollUrl.searchParams.set('wait', '0')
  pollUrl.searchParams.set('commandID', String(nextCommandId()))
  const pollRes = await fetchTextWithDeadline(
    pollUrl,
    playerRequestInit(player),
    TIMELINE_TIMEOUT_MS
  )
  if (!pollRes.ok) throw new Error(`Timeline poll failed: ${pollRes.status}`)
  const xml = pollRes.text

  const state = coerceState(extractTimelineAttr(xml, 'music', 'state'))
  if (!state || state === 'stopped') return null
  const ratingKey = extractTimelineAttr(xml, 'music', 'ratingKey')
  if (!ratingKey) return null

  const timeRaw = extractTimelineAttr(xml, 'music', 'time')
  const durationRaw = extractTimelineAttr(xml, 'music', 'duration')
  const pqRaw = extractTimelineAttr(xml, 'music', 'playQueueID')
  const machineId = extractTimelineAttr(xml, 'music', 'machineIdentifier')
  const volumeRaw = extractTimelineAttr(xml, 'music', 'volume')

  const time = timeRaw ? Number(timeRaw) : 0
  const duration = durationRaw ? Number(durationRaw) : 0
  const playQueueID = pqRaw ? Number(pqRaw) : null
  const volumeNum = volumeRaw ? Number(volumeRaw) : NaN
  const volume = Number.isFinite(volumeNum)
    ? Math.max(0, Math.min(100, Math.round(volumeNum)))
    : null

  // Track may live on a server other than our currently-selected one. Only
  // fetch metadata when it matches; otherwise return a partial timeline.
  let meta: RawMetadata | null = null
  if (!machineId || machineId === server.id) {
    try {
      const metaRes = await fetchTextWithDeadline(
        `${server.baseUrl}/library/metadata/${ratingKey}`,
        { headers: plexHeaders(server.token) },
        TIMELINE_TIMEOUT_MS
      )
      if (metaRes.ok) {
        const json = JSON.parse(metaRes.text) as MetadataResponse
        meta = json.MediaContainer.Metadata?.[0] ?? null
      }
    } catch {
      meta = null
    }
  }

  return {
    state,
    time,
    duration: meta?.duration ?? duration,
    title: meta?.title ?? '',
    artist: meta?.grandparentTitle ?? '',
    album: meta?.parentTitle ?? '',
    ratingKey,
    albumRatingKey: meta?.parentRatingKey ?? null,
    thumb: meta?.parentThumb ?? meta?.thumb ?? null,
    playQueueID,
    volume
  }
}

async function sendCommand(player: PlayerContext, path: string, extra: Record<string, string> = {}): Promise<void> {
  const url = new URL(`${player.baseUrl}${path}`)
  url.searchParams.set('commandID', String(nextCommandId()))
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  const res = await plexFetch(url, playerRequestInit(player))
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
}

export function pause(player: PlayerContext): Promise<void> {
  return sendCommand(player, '/player/playback/pause', { type: 'music' })
}

export function resume(player: PlayerContext): Promise<void> {
  return sendCommand(player, '/player/playback/play', { type: 'music' })
}

export function skipNext(player: PlayerContext): Promise<void> {
  return sendCommand(player, '/player/playback/skipNext', { type: 'music' })
}

export function skipPrevious(player: PlayerContext): Promise<void> {
  return sendCommand(player, '/player/playback/skipPrevious', { type: 'music' })
}

export function seekTo(player: PlayerContext, offsetMs: number): Promise<void> {
  return sendCommand(player, '/player/playback/seekTo', {
    type: 'music',
    offset: String(Math.max(0, Math.round(offsetMs)))
  })
}

export function setVolume(player: PlayerContext, volume: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)))
  return sendCommand(player, '/player/playback/setParameters', {
    type: 'music',
    volume: String(clamped)
  })
}

export function skipToQueueItem(
  player: PlayerContext,
  playQueueItemId: number
): Promise<void> {
  return sendCommand(player, '/player/playback/skipTo', {
    type: 'music',
    playQueueItemID: String(playQueueItemId)
  })
}
