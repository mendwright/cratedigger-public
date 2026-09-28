import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { createInterface } from 'node:readline'
import receiverSource from './pi-player/receiver.mjs?raw'
import agentSource from './pi-player/agent.mjs?raw'
import ctlSource from './pi-player/ctl.mjs?raw'
import { getTrackStreamUrl } from './plex/library.js'
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
  playQueueId?: number | null
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
// Reporting — the RECEIVER tells Plex what the Pi is playing (POST /:/timeline
// every 10s, like a real client) and pushes radio state to the kiosk server.
// That's what lights up PMS sessions, the living-room kiosk, Tautulli/charts,
// and played-status scrobbling for direct playback. It used to run here, but
// then the screen (and scrobbles) died whenever this Mac slept while the Pi
// played on — so we just hand the receiver a config with each queue and it
// reports for itself.
// ---------------------------------------------------------------------------

function plexReportConfig(
  server: ServerContext,
  playQueueId: number
): { baseUrl: string; headers: Record<string, string>; playQueueId: number } {
  // Distinct client identity so PMS shows this as its own player (the kiosk
  // and Tautulli display the device name), not as the desktop app.
  const headers = plexHeaders(server.token)
  headers['X-Plex-Client-Identifier'] = `${headers['X-Plex-Client-Identifier']}-pi-living-room`
  headers['X-Plex-Device-Name'] = PI_PLAYER_REPORT_NAME
  return { baseUrl: server.baseUrl, headers, playQueueId }
}

// ---------------------------------------------------------------------------
// Kiosk command mailbox — consumed on the Pi itself, not here. The always-on
// kiosk agent (pi-player/agent.mjs, systemd unit `cratedigger-kiosk-agent`)
// polls the kiosk server's /api/direct-cmds and executes radio starts and
// transport locally, so the wall kiosk works with every Mac asleep. This
// process just keeps the agent's code fresh on each cast (deployAndSpawn).
// The Mac used to poll the mailbox itself — that made every kiosk tap depend
// on a Mac being awake, which is exactly what Mary shouldn't need.
// ---------------------------------------------------------------------------

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
    playQueueId: s.playQueueId ?? null,
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
  const localAgent = join(app.getPath('temp'), 'cratedigger-pi-agent.mjs')
  const localCtl = join(app.getPath('temp'), 'cratedigger-pi-ctl.mjs')
  await writeFile(local, receiverSource, 'utf8')
  await writeFile(localAgent, agentSource, 'utf8')
  await writeFile(localCtl, ctlSource, 'utf8')
  // A receiver already running here is always stale: this process has no
  // session, so it's an orphan from a killed app (or another Mac's dead
  // session) still holding the DAC — a fresh mpv can't open ALSA past it,
  // and Now Playing shows nothing while it plays on. SIGTERM runs its
  // cleanup (Plexamp restored), then we take over. The second pkill sweeps
  // mpvs whose receiver died WITHOUT cleanup — one of those held the DAC for
  // a whole silent morning (2026-09-15).
  await execFileAsync(
    'ssh',
    // [r]eceiver / c[r]atedigger: the brackets keep pkill's own ssh command
    // line from matching the patterns (it would kill this very connection).
    [PI_HOST, `pkill -f '[r]eceiver.mjs' && sleep 2; ` +
      `pkill -f 'c[r]atedigger-pi-player-.*mpv.sock' && sleep 1; ` +
      `mkdir -p ${REMOTE_DIR} && chmod 700 ${REMOTE_DIR}`],
    { timeout: 15000 }
  )
  await execFileAsync('scp', ['-q', local, `${PI_HOST}:${REMOTE_PATH}`], { timeout: 15000 })
  // Keep the kiosk agent's code current too; the unit only restarts if it's
  // installed and running (a Pi without the service just skips this).
  await execFileAsync('scp', ['-q', localAgent, `${PI_HOST}:${REMOTE_DIR}/agent.mjs`], {
    timeout: 15000
  })
  await execFileAsync('scp', ['-q', localCtl, `${PI_HOST}:${REMOTE_DIR}/ctl.mjs`], {
    timeout: 15000
  })
  void execFileAsync(
    'ssh',
    [PI_HOST, 'sudo -n systemctl try-restart cratedigger-kiosk-agent 2>/dev/null || true'],
    { timeout: 15000 }
  ).catch(() => {})
  // The receiver belongs to the Pi, never to this SSH connection. Start it
  // detached with no inherited pipes, just like the resident kiosk agent.
  await execFileAsync('ssh', [PI_HOST,
    `node -e 'require("node:child_process").spawn(process.execPath, ["${REMOTE_PATH}", "--no-stdin"], { detached: true, stdio: "ignore" }).unref()'`
  ], { timeout: 15000 })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const attached = await attachOnce(true)
    if (attached) return attached
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Pi receiver startup timed out')
}

async function ensureSession(): Promise<Session> {
  if (session && session.child.exitCode === null) return session
  // Adopt a receiver someone else started (the kiosk agent's radio, another
  // Mac's cast) rather than tearing it down — casting into an attached
  // session just sends the new queue over the same wire.
  session = (await attachSession()) ?? (await deployAndSpawn())
  return session
}

// ---------------------------------------------------------------------------
// Attach — drive a receiver this process did NOT spawn, over its control
// socket via the ctl.mjs bridge (same JSON-line protocol as stdin). This is
// how kiosk-agent-started radio shows up — and stays controllable — in the
// app: without it, "KEXP is playing but Cratedigger can't touch it"
// (2026-09-15). The bridge exits immediately when no receiver is listening;
// failures back off so an idle Pi isn't SSH-dialed on every status poll.
// ---------------------------------------------------------------------------

const ATTACH_RETRY_MS = 30_000
let lastAttachFailAt = 0
// Status polls arrive every couple of seconds; overlapping attach attempts
// would each dial SSH. Share one in-flight attempt instead.
let attaching: Promise<Session | null> | null = null

function attachSession(): Promise<Session | null> {
  attaching ??= attachOnce().finally(() => {
    attaching = null
  })
  return attaching
}

async function attachOnce(starting = false): Promise<Session | null> {
  if (!starting && Date.now() - lastAttachFailAt < ATTACH_RETRY_MS) return null
  const child = spawn(
    'ssh',
    ['-T', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=10',
      '-o', 'ServerAliveCountMax=3', PI_HOST, `node ${REMOTE_DIR}/ctl.mjs`],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  )
  const s: Session = { child, chain: Promise.resolve(), pending: null }
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (s.pending) {
      const waiter = s.pending
      s.pending = null
      waiter(line)
    }
  })
  child.on('exit', () => {
    if (session?.child === child) session = null
    if (s.pending) {
      const waiter = s.pending
      s.pending = null
      waiter(JSON.stringify({ ok: false, error: 'Pi connection closed' }))
    }
  })
  child.on('error', () => {
    if (s.pending) {
      const waiter = s.pending
      s.pending = null
      waiter(JSON.stringify({ ok: false, error: 'Pi connection failed' }))
    }
  })
  try {
    // The probe doubles as the handshake: a receiver answers, an empty Pi
    // makes the bridge exit and the exit handler fails this send fast.
    await send(s, { action: 'status' })
    session = s
    return s
  } catch {
    child.kill()
    lastAttachFailAt = Date.now()
    return null
  }
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
  return send(s, {
    action: 'queue',
    source: 'plex',
    tracks: await buildUrls(server, tracks),
    startIndex,
    volume: appVolumeToMpv(volume),
    report: plexReportConfig(server, playQueueId)
  })
}

export async function piRefreshQueue(
  server: ServerContext,
  tracks: PiQueueTrack[]
): Promise<PiPlayerStatus> {
  const s = await ensureSession()
  return send(s, { action: 'refresh', tracks: await buildUrls(server, tracks) })
}

// The opening batch for a track-queue station. Top-up afterwards is the
// receiver's job (it appends fresh tracks itself as the queue runs down) —
// this initial fetch stays app-side only so a dead proxy fails the cast
// loudly instead of silently.
interface XtraEntry {
  ratingKey: string
  title: string
  artist: string
  album: string
  duration: number
  url: string
}

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
  const def = RADIO_STATIONS[station]
  // Radio has no Plex session for the kiosk to see, so the receiver POSTs
  // station + stream metadata to the kiosk server instead.
  const kioskUrl = getValue('kioskUrl').trim().replace(/\/$/, '')
  const report = kioskUrl ? { kioskUrl, station } : undefined
  let status: PiPlayerStatus
  if (def.kind === 'queue') {
    const entries = await fetchXtraTracks(def)
    status = await send(s, {
      action: 'queue',
      source: 'radio-queue',
      tracks: entries,
      startIndex: 0,
      volume: appVolumeToMpv(volume),
      report,
      // The receiver keeps the rolling queue topped up from the proxy.
      topUp: { proxy: sxmProxy(), entityType: def.entityType, entityId: def.entityId, title: def.title }
    })
  } else {
    status = await send(s, {
      action: 'queue',
      source: 'radio',
      tracks: [
        { title: def.title, artist: '', album: '', ratingKey: `radio:${station}`, url: liveUrl(def) }
      ],
      startIndex: 0,
      volume: appVolumeToMpv(volume),
      report
    })
  }
  return status
}

/** Transport / volume / skip need a live receiver — attach to one someone
 *  else started (kiosk radio) rather than failing, but never SPAWN one. */
async function requireSession(): Promise<Session> {
  if (session && session.child.exitCode === null) return session
  const s = await attachSession()
  if (!s) throw new Error('Pi player is not connected')
  return s
}

export async function piTransport(
  action: 'pause' | 'play' | 'next' | 'prev' | 'seek',
  seconds?: number
): Promise<PiPlayerStatus> {
  // The receiver reports its own state change to Plex/kiosk right away.
  return send(await requireSession(), { action, seconds })
}

export async function piSetVolume(volume: number): Promise<PiPlayerStatus> {
  return send(await requireSession(), { action: 'volume', value: appVolumeToMpv(volume) })
}

export async function piSkip(index: number): Promise<PiPlayerStatus> {
  return send(await requireSession(), { action: 'skip', index })
}

/** Poll-safe: with no session, one attach attempt per backoff window finds
 *  anything the kiosk agent started; otherwise null without an SSH dial. */
export async function piStatus(): Promise<PiPlayerStatus | null> {
  if (!session || session.child.exitCode !== null) {
    if (!(await attachSession())) return null
  }
  const status = await send(session!, { action: 'status' })
  return status ? enrichRadioStatus(status) : status
}

// Live-radio enrichment. The receiver only knows the stream, and two things
// the app knows never reach it that way: the station's display title (the
// renderer used to re-derive it from the ratingKey and only knew KEXP and
// Radio Paradise — everything else showed as "Internet radio"), and, for
// SiriusXM live channels, the current song (their HLS carries no icy text;
// the sxm-proxy's /now-playing feed has it). Cached ~15s so the 2.5s status
// poll doesn't hammer the proxy.
interface SxmNowPlaying {
  title?: string | null
  artist?: string | null
  is_ad?: boolean
  image_url?: string | null
}
let sxmNpCache: { channelId: string; at: number; np: SxmNowPlaying | null } | null = null

async function enrichRadioStatus(status: PiPlayerStatus): Promise<PiPlayerStatus> {
  if (!status.ratingKey?.startsWith('radio:')) return status
  const def = RADIO_STATIONS[status.ratingKey.slice('radio:'.length)]
  if (!def) return status
  const out: PiPlayerStatus = { ...status, station: def.title }
  if (def.kind !== 'live' || !def.viaSxmProxy) return out
  const base = getValue('sxmProxyUrl').trim().replace(/\/$/, '')
  const channelId = def.url.match(/\/stream\/[^/]+\/([^/]+)\//)?.[1]
  if (!base || !channelId) return out
  const now = Date.now()
  if (!sxmNpCache || sxmNpCache.channelId !== channelId || now - sxmNpCache.at > 15_000) {
    let np: SxmNowPlaying | null = null
    try {
      const res = await fetch(`${base}/now-playing/${channelId}`, {
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) np = (await res.json()) as SxmNowPlaying
    } catch {
      // best-effort — the screen just shows the station without a song
    }
    sxmNpCache = { channelId, at: now, np }
  }
  const np = sxmNpCache.np
  if (np?.title && !np.is_ad) {
    out.title = np.title
    out.artist = np.artist ?? ''
    out.art = np.image_url ?? null
  }
  return out
}

/** Quit the receiver — mpv dies, Plexamp and shairport-sync are restored.
 *  The receiver's own cleanup posts the final 'stopped' to Plex/kiosk. */
export async function piStopSession(): Promise<void> {
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

/** App shutdown drops only our control connection; playback lives on the Pi. */
export function disconnectPiPlayerOnQuit(): void {
  const s = session
  session = null
  if (s && s.child.exitCode === null) s.child.kill()
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
