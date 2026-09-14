import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { createInterface } from 'node:readline'
import receiverSource from './pi-player/receiver.mjs?raw'
import { getTrackStreamUrl } from './plex/library.js'
import { plexFetch } from './plex/http.js'
import { plexHeaders } from './plex/headers.js'
import { getValue } from './store.js'
import type { PiPlayerStatus, PiQueueTrack, RadioStar, ServerContext } from '../shared/plex.js'

const execFileAsync = promisify(execFile)

// The living-room HiFiBerry Pi, reachable via the user's existing SSH alias
// (key auth, no password). Personal build only — ipc.ts gates registration.
export const PI_HOST = 'pi-dac-living-room'
const REMOTE_DIR = '.cache/cratedigger-pi-player'
const REMOTE_PATH = `${REMOTE_DIR}/receiver.mjs`

// The sxm-proxy bridge (aiosxm) that fronts the household SiriusXM
// subscription. Comes from Settings → "SiriusXM proxy URL"; empty means the
// SXM stations are unavailable. Never hard-code the host here — this file
// ships in the public snapshot.
function sxmProxy(): string {
  const base = getValue('sxmProxyUrl').trim().replace(/\/$/, '')
  if (!base) throw new Error('SiriusXM proxy URL is not set (Settings → SiriusXM proxy URL)')
  return base
}

// Two station shapes: 'live' is one continuous stream URL; 'queue' is a
// SiriusXM Xtra channel, which is a rolling queue of individual track streams
// (the proxy rewrites each track's playlist/key) that we top up as it plays.
type StationDef =
  | { title: string; kind: 'live'; url: string; viaSxmProxy?: true }
  | { title: string; kind: 'queue'; entityType: string; entityId: string }

const RADIO_STATIONS: Record<string, StationDef> = {
  // KEXP's published 160 kbps AAC stream; Radio Paradise Main FLAC.
  kexp: { title: 'KEXP', kind: 'live', url: 'https://kexp.streamguys1.com/kexp160.aac' },
  paradise: {
    title: 'Radio Paradise Main',
    kind: 'live',
    url: 'https://stream.radioparadise.com/flacm'
  },
  // SiriusXM channels via the household sxm-proxy bridge (aiosxm + the
  // subscription; 256k AAC, decrypted by the proxy). `url` is a path under
  // the proxy, resolved by liveUrl() at play time.
  'sxm-xmu': {
    title: 'SiriusXMU',
    kind: 'live',
    url: '/stream/channel-linear/f49737db-bea3-0c13-9834-b879fb1894c4/playlist.m3u8',
    viaSxmProxy: true
  },
  'sxm-indie': {
    title: 'Indie 1.0',
    kind: 'queue',
    entityType: 'channel-xtra',
    entityId: 'abfb5780-324f-1219-48c2-c8c2445c17bd'
  }
}
export type PiRadioStation = keyof typeof RADIO_STATIONS

function liveUrl(def: Extract<StationDef, { kind: 'live' }>): string {
  return def.viaSxmProxy ? sxmProxy() + def.url : def.url
}

interface ReceiverState {
  state: 'playing' | 'paused' | 'stopped' | 'buffering'
  source: 'plex' | 'radio' | 'radio-queue' | null
  index: number | null
  current: { title: string; artist: string; album?: string; ratingKey: string } | null
  seconds: number | null
  duration: number | null
  volume: number
  streamTitle: string | null
  error: string | null
}

interface Session {
  child: ChildProcessByStdio<Writable, Readable, null>
  // One request in flight at a time; the receiver answers in order.
  chain: Promise<unknown>
  pending: ((line: string) => void) | null
}

let session: Session | null = null

// ---------------------------------------------------------------------------
// Timeline reporting — tells Plex what the Pi is playing, the same way a real
// client does (POST /:/timeline every 10s). This is what lights up PMS
// sessions, the living-room kiosk, Tautulli/charts, and played-status
// scrobbling for direct Pi playback, which otherwise happens outside Plex.
// ---------------------------------------------------------------------------

const REPORT_INTERVAL_MS = 10_000

interface Reporter {
  server: ServerContext
  tracks: PiQueueTrack[]
  playQueueId: number | null
  timer: ReturnType<typeof setInterval> | null
  last: { ratingKey: string; timeMs: number; durationMs: number } | null
}

let reporter: Reporter | null = null

async function postTimeline(
  r: Reporter,
  state: 'playing' | 'paused' | 'buffering' | 'stopped',
  ratingKey: string,
  timeMs: number,
  durationMs: number,
  playQueueItemID?: number
): Promise<void> {
  const params = new URLSearchParams({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    state,
    time: String(Math.max(0, Math.round(timeMs))),
    duration: String(Math.max(0, Math.round(durationMs)))
  })
  if (r.playQueueId !== null) params.set('playQueueID', String(r.playQueueId))
  if (playQueueItemID !== undefined) params.set('playQueueItemID', String(playQueueItemID))
  // Distinct client identity so PMS shows this as its own player (the kiosk
  // and Tautulli display the device name), not as the desktop app.
  const headers = plexHeaders(r.server.token)
  headers['X-Plex-Client-Identifier'] = `${headers['X-Plex-Client-Identifier']}-pi-living-room`
  headers['X-Plex-Device-Name'] = PI_PLAYER_REPORT_NAME
  try {
    await plexFetch(`${r.server.baseUrl}/:/timeline?${params.toString()}`, { headers })
  } catch {
    // Best-effort — a missed report just delays the kiosk by one tick.
  }
}

async function reportTick(): Promise<void> {
  const r = reporter
  const s = session
  if (!r || !s || s.child.exitCode !== null) return
  try {
    const st = await send(s, { action: 'status' })
    if (st.source !== 'plex') {
      stopReporter(true)
      return
    }
    const track =
      r.tracks.find((t) => t.ratingKey === st.ratingKey) ??
      (st.index !== null ? r.tracks[st.index] : undefined)
    if (!track || st.state === 'stopped') {
      if (r.last) {
        void postTimeline(r, 'stopped', r.last.ratingKey, r.last.timeMs, r.last.durationMs)
        r.last = null
      }
      return
    }
    const timeMs = (st.seconds ?? 0) * 1000
    const durationMs = st.duration !== null ? st.duration * 1000 : track.duration
    r.last = { ratingKey: track.ratingKey, timeMs, durationMs }
    void postTimeline(r, st.state, track.ratingKey, timeMs, durationMs, track.playQueueItemID)
  } catch {
    // Receiver busy or briefly gone — the next tick catches up.
  }
}

function startReporter(server: ServerContext, tracks: PiQueueTrack[], playQueueId: number): void {
  stopReporter(false)
  reporter = {
    server,
    tracks,
    playQueueId,
    timer: setInterval(() => void reportTick(), REPORT_INTERVAL_MS),
    last: null
  }
  // First report quickly so the kiosk follows a cast within seconds.
  setTimeout(() => void reportTick(), 1500)
}

function stopReporter(reportStopped: boolean): void {
  const r = reporter
  reporter = null
  if (!r) return
  if (r.timer) clearInterval(r.timer)
  if (reportStopped && r.last) {
    void postTimeline(r, 'stopped', r.last.ratingKey, r.last.timeMs, r.last.durationMs)
  }
}

// ---------------------------------------------------------------------------
// Kiosk command mailbox — the wall kiosk's transport buttons can't reach the
// Pi receiver (no listener there, by design), so the kiosk server queues them
// and we poll them down over the same URL Cratedigger already pushes themes
// to, executing on our SSH session. Polled only while a Plex queue is playing.
// ---------------------------------------------------------------------------

const KIOSK_CMD_POLL_MS = 2_500
let kioskCmdTimer: ReturnType<typeof setInterval> | null = null
let kioskCmdBusy = false
// The app's last-known slider volume (app scale) — what a kiosk-started radio
// session opens at, since the renderer isn't necessarily involved.
let lastAppVolume = 30

interface KioskCmd {
  action: 'play' | 'pause' | 'next' | 'prev' | 'volume' | 'radio'
  value?: number | string
}

async function kioskCmdTick(): Promise<void> {
  if (kioskCmdBusy) return
  const base = getValue('kioskUrl').trim().replace(/\/$/, '')
  if (!base) return
  // Radio can start from a cold kiosk tap (no session yet); everything else
  // needs the session, so skip the fetch entirely when idle with none.
  kioskCmdBusy = true
  try {
    // While a session is live, report the app-scale volume on the same poll —
    // a direct session's PMS timeline has no volume, so the kiosk (and the
    // Hayes dashboard reading it) would otherwise show none.
    const vol = session && session.child.exitCode === null ? `?volume=${lastAppVolume}` : ''
    const res = await fetch(`${base}/api/direct-cmds${vol}`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return
    const cmds = (await res.json()) as KioskCmd[]
    for (const cmd of cmds) {
      try {
        if (cmd.action === 'radio' && typeof cmd.value === 'string' && cmd.value in RADIO_STATIONS) {
          await piPlayRadio(cmd.value as PiRadioStation, lastAppVolume)
        } else if (cmd.action === 'volume' && typeof cmd.value === 'number') {
          await piSetVolume(cmd.value)
        } else if (['play', 'pause', 'next', 'prev'].includes(cmd.action)) {
          await piTransport(cmd.action as 'play' | 'pause' | 'next' | 'prev')
        }
      } catch {
        // e.g. transport with no session — drop the command, not the batch.
      }
    }
  } catch {
    // Kiosk off or unreachable — normal away-from-home case.
  } finally {
    kioskCmdBusy = false
  }
}

/** App-lifetime kiosk bridge (personal build): lets the wall kiosk start
 *  radio from idle and control whatever the Pi is playing. */
export function startKioskCmdPoll(): void {
  if (kioskCmdTimer !== null) return
  kioskCmdTimer = setInterval(() => void kioskCmdTick(), KIOSK_CMD_POLL_MS)
}

function stopKioskCmdPoll(): void {
  if (kioskCmdTimer !== null) {
    clearInterval(kioskCmdTimer)
    kioskCmdTimer = null
  }
}

// ---------------------------------------------------------------------------
// Radio state push — live radio has no Plex session for the kiosk to see, so
// while radio plays we POST station + stream metadata to the kiosk server,
// which serves it to both screens (and chases lyrics for it).
// ---------------------------------------------------------------------------

let radioPushTimer: ReturnType<typeof setInterval> | null = null
let radioStation: PiRadioStation | null = null

async function radioPushTick(): Promise<void> {
  const base = getValue('kioskUrl').trim().replace(/\/$/, '')
  const s = session
  if (!radioStation || !s || s.child.exitCode !== null) return
  try {
    const st = await send(s, { action: 'status' })
    if (st.source !== 'radio') {
      stopRadioPush(true)
      return
    }
    // Track-queue station: keep the receiver's playlist topped up — fetch
    // the channel's next tracks when fewer than 3 remain, appending only
    // (the receiver's append path preserves gapless prefetch).
    if (xtraQueue && st.index !== null && xtraQueue.entries.length - st.index <= 3) {
      const def = RADIO_STATIONS[xtraQueue.station]
      if (def.kind === 'queue') {
        const fresh = (await fetchXtraTracks(def)).filter((e) => !xtraQueue!.seen.has(e.ratingKey))
        if (fresh.length) {
          for (const e of fresh) xtraQueue.seen.add(e.ratingKey)
          xtraQueue.entries = [...xtraQueue.entries, ...fresh]
          await send(s, { action: 'refresh', tracks: xtraQueue.entries })
        }
      }
    }
    if (!base) return
    // Queue stations carry per-track metadata; live streams carry icy text.
    const entry =
      xtraQueue && st.ratingKey
        ? xtraQueue.entries.find((e) => e.ratingKey === st.ratingKey)
        : undefined
    await fetch(`${base}/api/radio-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        station: radioStation,
        streamTitle: entry ? `${entry.artist} - ${entry.title}` : (st.streamTitle ?? ''),
        songArtist: entry?.artist,
        songTitle: entry?.title,
        state: st.state,
        volume: st.volume
      })
    })
  } catch {
    // Kiosk or receiver briefly unreachable — next tick catches up.
  }
}

function startRadioPush(station: PiRadioStation): void {
  stopRadioPush(false)
  radioStation = station
  radioPushTimer = setInterval(() => void radioPushTick(), REPORT_INTERVAL_MS)
  setTimeout(() => void radioPushTick(), 1500)
}

// NB: does NOT clear xtraQueue — startRadioPush calls this first, and the
// queue driver's state must survive that. Paths that truly end radio
// (loading a Plex queue, quitting the session) clear xtraQueue themselves.
function stopRadioPush(tellKiosk: boolean): void {
  const station = radioStation
  radioStation = null
  if (radioPushTimer !== null) {
    clearInterval(radioPushTimer)
    radioPushTimer = null
  }
  if (tellKiosk && station) {
    const base = getValue('kioskUrl').trim().replace(/\/$/, '')
    if (base) {
      void fetch(`${base}/api/radio-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ station, streamTitle: '', state: 'stopped', volume: null })
      }).catch(() => {})
    }
  }
}

const PI_PLAYER_REPORT_NAME = 'Living Room (direct)'

// mpv's softvol is linear amplitude — its "30" is already -10 dB, far quieter
// than 30 feels on a Plexamp-style perceptual slider. Square-root the ratio on
// the way out and square it on the way back, so the app's slider numbers land
// where the ear expects and syncVolumeFromDevice doesn't snap the slider.
function appVolumeToMpv(v: number): number {
  return Math.round(100 * Math.sqrt(Math.max(0, Math.min(100, v)) / 100))
}
function mpvVolumeToApp(v: number): number {
  const r = Math.max(0, Math.min(100, v)) / 100
  return Math.round(100 * r * r)
}

function toStatus(s: ReceiverState): PiPlayerStatus {
  return {
    state: s.state,
    // The app treats both radio shapes the same; 'radio-queue' is a receiver
    // detail (it gates refresh/seek there).
    source: s.source === 'radio-queue' ? 'radio' : s.source,
    index: s.index,
    ratingKey: s.current?.ratingKey ?? null,
    title: s.current?.title ?? null,
    artist: s.current?.artist ?? null,
    album: s.current?.album ?? null,
    seconds: s.seconds,
    duration: s.duration,
    volume: mpvVolumeToApp(s.volume ?? 0),
    streamTitle: s.streamTitle,
    error: s.error
  }
}

async function deployAndSpawn(): Promise<Session> {
  const local = join(app.getPath('temp'), 'cratedigger-pi-receiver.mjs')
  await writeFile(local, receiverSource, 'utf8')
  // A receiver already running here is always stale: this process has no
  // session, so it's an orphan from a killed app (or another Mac's dead
  // session) still holding the DAC — a fresh mpv can't open ALSA past it,
  // and Now Playing shows nothing while it plays on. SIGTERM runs its
  // cleanup (Plexamp restored), then we take over.
  await execFileAsync(
    'ssh',
    // [r]eceiver: the bracket keeps pkill's own ssh command line from
    // matching the pattern (it would kill this very connection).
    [PI_HOST, `pkill -f '[r]eceiver.mjs' && sleep 2; mkdir -p ${REMOTE_DIR} && chmod 700 ${REMOTE_DIR}`],
    { timeout: 15000 }
  )
  await execFileAsync('scp', ['-q', local, `${PI_HOST}:${REMOTE_PATH}`], { timeout: 15000 })
  const child = spawn(
    'ssh',
    ['-T', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3', PI_HOST,
      `node ${REMOTE_PATH}`],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  )
  const s: Session = { child, chain: Promise.resolve(), pending: null }
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pi receiver startup timed out')), 30000)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('Pi connection ended before startup'))
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      let parsed: { ready?: boolean } | null = null
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (parsed?.ready) {
        clearTimeout(timer)
        resolve()
      } else if (s.pending) {
        const waiter = s.pending
        s.pending = null
        waiter(line)
      }
    })
  })
  child.on('exit', () => {
    if (session?.child === child) {
      session = null
      // SSH died mid-play — tell Plex and the kiosk the session ended.
      stopReporter(true)
      stopRadioPush(true)
      xtraQueue = null
    }
    if (s.pending) {
      const waiter = s.pending
      s.pending = null
      waiter(JSON.stringify({ ok: false, error: 'Pi connection closed' }))
    }
  })
  await ready
  return s
}

async function ensureSession(): Promise<Session> {
  if (session && session.child.exitCode === null) return session
  session = await deployAndSpawn()
  return session
}

async function send(s: Session, request: Record<string, unknown>): Promise<PiPlayerStatus> {
  const run = async (): Promise<PiPlayerStatus> => {
    if (s.child.exitCode !== null) throw new Error('Pi connection closed')
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (s.pending) s.pending = null
        reject(new Error('Pi receiver timed out'))
      }, 30000)
      s.pending = (l) => {
        clearTimeout(timer)
        resolve(l)
      }
      s.child.stdin.write(JSON.stringify(request) + '\n')
    })
    const result = JSON.parse(line) as { ok: boolean; error?: string; state?: ReceiverState }
    if (!result.ok || !result.state) throw new Error(result.error ?? 'Pi command failed')
    return toStatus(result.state)
  }
  const p = s.chain.then(run, run)
  s.chain = p.catch(() => {})
  return p
}

async function buildUrls(
  server: ServerContext,
  tracks: PiQueueTrack[]
): Promise<Array<PiQueueTrack & { url: string }>> {
  const urls = await Promise.all(tracks.map((t) => getTrackStreamUrl(server, t.ratingKey)))
  return tracks.map((t, i) => ({ ...t, url: urls[i] }))
}

export async function piLoadQueue(
  server: ServerContext,
  playQueueId: number,
  tracks: PiQueueTrack[],
  startIndex: number,
  volume: number
): Promise<PiPlayerStatus> {
  const s = await ensureSession()
  lastAppVolume = volume
  stopRadioPush(true)
  xtraQueue = null
  const status = await send(s, {
    action: 'queue',
    source: 'plex',
    tracks: await buildUrls(server, tracks),
    startIndex,
    volume: appVolumeToMpv(volume)
  })
  startReporter(server, tracks, playQueueId)
  return status
}

export async function piRefreshQueue(
  server: ServerContext,
  tracks: PiQueueTrack[]
): Promise<PiPlayerStatus> {
  const s = await ensureSession()
  const status = await send(s, { action: 'refresh', tracks: await buildUrls(server, tracks) })
  if (reporter) reporter.tracks = tracks
  return status
}

// State for a playing track-queue station: everything sent to the receiver
// so far (append-only refreshes need the full list) plus seen ids for dedupe
// (each /tracks fetch re-tunes and can overlap).
interface XtraEntry {
  ratingKey: string
  title: string
  artist: string
  album: string
  duration: number
  url: string
}
let xtraQueue: { station: PiRadioStation; entries: XtraEntry[]; seen: Set<string> } | null = null

async function fetchXtraTracks(def: Extract<StationDef, { kind: 'queue' }>): Promise<XtraEntry[]> {
  const proxy = sxmProxy()
  const res = await fetch(`${proxy}/stream/${def.entityType}/${def.entityId}/tracks`, {
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`${def.title} is unavailable right now (${res.status})`)
  const tracks = (await res.json()) as Array<{
    id: string
    title: string
    artist: string
    duration: number
  }>
  return tracks.map((t) => ({
    ratingKey: `sxm:${t.id}`,
    title: t.title || def.title,
    artist: t.artist || '',
    album: def.title,
    duration: Math.round((t.duration || 0) * 1000),
    url: `${proxy}/stream/${def.entityType}/${def.entityId}/track/${t.id}/playlist.m3u8`
  }))
}

export async function piPlayRadio(
  station: PiRadioStation,
  volume: number
): Promise<PiPlayerStatus> {
  const s = await ensureSession()
  stopReporter(true)
  lastAppVolume = volume
  const def = RADIO_STATIONS[station]
  let status: PiPlayerStatus
  if (def.kind === 'queue') {
    const entries = await fetchXtraTracks(def)
    xtraQueue = { station, entries, seen: new Set(entries.map((e) => e.ratingKey)) }
    status = await send(s, {
      action: 'queue',
      source: 'radio-queue',
      tracks: entries,
      startIndex: 0,
      volume: appVolumeToMpv(volume)
    })
  } else {
    xtraQueue = null
    status = await send(s, {
      action: 'queue',
      source: 'radio',
      tracks: [
        { title: def.title, artist: '', album: '', ratingKey: `radio:${station}`, url: liveUrl(def) }
      ],
      startIndex: 0,
      volume: appVolumeToMpv(volume)
    })
  }
  startRadioPush(station)
  return status
}

/** Transport / volume / skip need a live session — never auto-connect for them. */
async function requireSession(): Promise<Session> {
  if (!session || session.child.exitCode !== null) throw new Error('Pi player is not connected')
  return session
}

export async function piTransport(
  action: 'pause' | 'play' | 'next' | 'prev' | 'seek',
  seconds?: number
): Promise<PiPlayerStatus> {
  const status = await send(await requireSession(), { action, seconds })
  // Pause/skip should reach the kiosk immediately, not on the next 10s tick.
  void reportTick()
  return status
}

export async function piSetVolume(volume: number): Promise<PiPlayerStatus> {
  lastAppVolume = volume
  return send(await requireSession(), { action: 'volume', value: appVolumeToMpv(volume) })
}

export async function piSkip(index: number): Promise<PiPlayerStatus> {
  const status = await send(await requireSession(), { action: 'skip', index })
  void reportTick()
  return status
}

/** Poll-safe: returns null (no SSH dial) when no session is up. */
export async function piStatus(): Promise<PiPlayerStatus | null> {
  if (!session || session.child.exitCode !== null) return null
  return send(session, { action: 'status' })
}

/** Quit the receiver — mpv dies, Plexamp and shairport-sync are restored. */
export async function piStopSession(): Promise<void> {
  stopReporter(true)
  stopRadioPush(true)
  xtraQueue = null
  const s = session
  session = null
  if (!s || s.child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      s.child.kill('SIGTERM')
      resolve()
    }, 5000)
    s.child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    s.child.stdin.write(JSON.stringify({ action: 'quit' }) + '\n')
    s.child.stdin.end()
  })
}

/** before-quit hook: never leave the DAC without Plexamp. */
export function stopPiPlayerOnQuit(): void {
  void piStopSession()
}

// --- radio stars (stored by the kiosk server; see /api/star there) ---------

export async function piListRadioStars(): Promise<RadioStar[]> {
  const base = getValue('kioskUrl').trim().replace(/\/$/, '')
  if (!base) return []
  const res = await fetch(`${base}/api/stars`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error('Could not reach the kiosk for starred songs')
  return (await res.json()) as RadioStar[]
}

export async function piDismissRadioStar(id: string): Promise<void> {
  const base = getValue('kioskUrl').trim().replace(/\/$/, '')
  if (!base) return
  const res = await fetch(`${base}/api/star-dismiss?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error('Could not dismiss the star')
}
