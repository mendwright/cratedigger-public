// Cratedigger Pi receiver — one SSH session owns mpv; EOF restores Plexamp.
// Deployed by src/main/pi-player.ts (bundled via ?raw import, scp'd on
// connect). Speaks JSON lines on stdin/stdout: one response per request, in
// order. Never logs URLs or mpv output — Plex media URLs carry credentials.
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  mkdtempSync, mkdirSync, rmSync, createReadStream, createWriteStream, statSync, existsSync,
  renameSync, readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createConnection, createServer as createNetServer } from 'node:net'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

const silent = process.argv.includes('--silent')
const dir = mkdtempSync(`${tmpdir()}/cratedigger-pi-player-`)
const socketPath = `${dir}/mpv.sock`
// gapless-audio=yes (not weak): keep the ALSA device open across format
// changes and convert, instead of reopening it — a reopen is an audible dip.
// Opening a Plex file URL costs 0.5–1.6s (measured), so seams are only
// silent when mpv prefetches the next entry — and that trigger fires once
// the CURRENT file is fully read. Read it all, early: readahead far beyond
// track length, byte cap sized for hi-res FLAC (Pi has 4GB; ~2.4GB free).
// live_start_index=-2: live HLS (SiriusXM via sxm-proxy) joins ~20s from the
// live edge instead of the top of the DVR window — otherwise the audio runs
// minutes behind the now-playing feed. No effect on files or icy streams.
const mpv = spawn('mpv', ['--no-config', '--idle=yes', '--vid=no', '--terminal=no',
  '--volume=30', '--gapless-audio=yes', '--prefetch-playlist=yes',
  '--demuxer-lavf-o=live_start_index=-2',
  '--cache=yes', '--demuxer-readahead-secs=1800', '--demuxer-max-bytes=700MiB',
  `--input-ipc-server=${socketPath}`,
  ...(silent ? ['--ao=null'] : ['--audio-device=alsa/plughw:CARD=Pro,DEV=0'])
], { stdio: 'ignore' })
let fatal = null
mpv.on('error', () => { fatal = 'mpv could not start; install mpv on the Pi' })
let ipc, nextId = 0, queue = [], source = null, closing = false
const pending = new Map(), events = [], restore = []
const systemctl = (...args) => execFileSync('sudo', ['-n', 'systemctl', ...args], { stdio: 'pipe' })

// ---------------------------------------------------------------------------
// Warm cache — mpv's --prefetch-playlist arms exactly once per track (when
// the current file is fully read) and NOTHING re-arms it after a playlist
// edit (verified on mpv 0.40: no IPC command clears its stale internal
// prefetch). So the first seam after any queue edit cold-opens the next Plex
// URL: an audible ~0.5s dip. Fix: pre-download the next CACHE_AHEAD tracks to
// local disk and hand mpv loopback URLs — a cold open against a complete
// local file is tens of ms, and playback survives a network blip too.
// mpv playlist entries are /t/<ratingKey> on this proxy; complete files are
// served range-aware from the cache, anything else streams through to Plex.
// Applies to Plex track queues only — live radio and HLS pass untouched.
// ---------------------------------------------------------------------------
const CACHE_AHEAD = 10
const CACHE_CAP = 1200 * 1024 * 1024 // shm is ~half of the Pi's 4GB
const FILE_CAP = 400 * 1024 * 1024 // a single file bigger than this streams direct
const cacheDir = mkdtempSync(`${existsSync('/dev/shm') ? '/dev/shm' : tmpdir()}/cratedigger-cache-`)
const cached = new Map() // ratingKey -> { path, size }
let inflight = null // { key, controller }
let playlistPos = -1
let proxyPort = 0
const fileKey = (ratingKey) => String(ratingKey).replace(/[^\w.-]/g, '_')
const trackFor = (ratingKey) => queue.find((t) => t.ratingKey === ratingKey)

const proxy = createServer(async (req, res) => {
  const m = /^\/t\/([^/]+)$/.exec(req.url ?? '')
  const track = m ? trackFor(decodeURIComponent(m[1])) : null
  if (!track) { res.writeHead(404); res.end(); return }
  const hit = cached.get(track.ratingKey)
  try {
    if (hit) serveFile(req, res, hit)
    else await passthrough(req, res, track.url)
  } catch {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  }
})
proxy.on('error', () => { proxyPort = 0 })
proxy.listen(0, '127.0.0.1', () => { proxyPort = proxy.address()?.port ?? 0 })

function serveFile(req, res, hit) {
  const { size } = hit
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let start = 0, end = size - 1, status = 200
  if (r && (r[1] || r[2])) {
    start = r[1] ? parseInt(r[1], 10) : Math.max(0, size - parseInt(r[2], 10))
    end = r[1] && r[2] ? Math.min(parseInt(r[2], 10), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    status = 206
  }
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  res.writeHead(status, headers)
  createReadStream(hit.path, { start, end }).pipe(res)
}

async function passthrough(req, res, url) {
  const controller = new AbortController()
  req.on('close', () => controller.abort())
  const headers = {}
  if (req.headers.range) headers.Range = req.headers.range
  const up = await fetch(url, { headers, signal: controller.signal })
  const out = {}
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(name)
    if (v) out[name] = v
  }
  res.writeHead(up.status, out)
  if (up.body) await pipeline(Readable.fromWeb(up.body), res).catch(() => {})
  else res.end()
}

function wantedKeys() {
  if (source !== 'plex') return []
  const from = Math.max(0, playlistPos + 1)
  return queue.slice(from, from + CACHE_AHEAD).map((t) => t.ratingKey)
}

// One download at a time, next-track-first; evicts what playback has left
// behind. Re-kicked on every queue change and track advance.
async function prefetchTick() {
  if (inflight || closing) return
  const wanted = wantedKeys()
  const keep = new Set([...wanted, queue[playlistPos]?.ratingKey, queue[playlistPos - 1]?.ratingKey])
  for (const [key, hit] of cached) {
    if (!keep.has(key)) {
      try { rmSync(hit.path, { force: true }) } catch {}
      cached.delete(key)
    }
  }
  const nextKey = wanted.find((k) => !cached.has(k))
  const track = nextKey ? trackFor(nextKey) : null
  if (!track) return
  const controller = new AbortController()
  inflight = { key: nextKey, controller }
  const tmp = `${cacheDir}/${fileKey(nextKey)}.part`
  try {
    const res = await fetch(track.url, { signal: controller.signal })
    if (!res.ok || !res.body) return
    const length = Number(res.headers.get('content-length') ?? 0)
    const used = [...cached.values()].reduce((sum, hit) => sum + hit.size, 0)
    if (length > FILE_CAP || used + (length || 80e6) > CACHE_CAP) return
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    const final = `${cacheDir}/${fileKey(nextKey)}`
    renameSync(tmp, final)
    cached.set(nextKey, { path: final, size: statSync(final).size })
  } catch {
    try { rmSync(tmp, { force: true }) } catch {}
  } finally {
    inflight = null
    if (!closing) setTimeout(() => void prefetchTick(), 100)
  }
}

// A queue change can strand the in-flight download (e.g. a skip far ahead) —
// abort it so the wanted track downloads instead.
function kickPrefetch() {
  if (inflight && !wantedKeys().includes(inflight.key)) inflight.controller.abort()
  void prefetchTick()
}

const mpvUrl = (track) =>
  source === 'plex' && proxyPort
    ? `http://127.0.0.1:${proxyPort}/t/${encodeURIComponent(track.ratingKey)}`
    : track.url

// ---------------------------------------------------------------------------
// Self-reporting — the receiver, not the app, tells Plex (Plex queues) and
// the kiosk server (radio) what's playing. The app hands a report config
// down with each queue command; from then on the wall screen, Tautulli, and
// scrobbles keep flowing even while the Mac that cast this sleeps. All posts
// are best-effort — a miss just delays the kiosk by one tick.
// ---------------------------------------------------------------------------
const REPORT_MS = 10_000
// The kiosk URL in a cast's report comes from the Mac's settings, which can
// hold a private hostname only the Mac can resolve (the Pi has no route to
// that name, so radio state silently never reached the kiosk).
// agent-config.json is written for this box, so when it names a kiosk URL,
// that one wins over whatever the cast handed down.
const boxKioskUrl = (() => {
  try {
    const c = JSON.parse(readFileSync(
      `${process.env.HOME}/.cache/cratedigger-pi-player/agent-config.json`, 'utf8'))
    return String(c.kioskUrl ?? '').trim().replace(/\/$/, '')
  } catch { return '' }
})()
let plexReport = null   // { baseUrl, headers, playQueueId }
let radioReport = null  // { kioskUrl, station }
let lastTimeline = null // { ratingKey, timeMs, durationMs, playQueueItemID }
let reporting = false
// Mid-load mpv is briefly idle; a report tick landing there (the playlist-pos
// observer fires during loadTracks) posts a phantom 'stopped'. Gate it out.
let loadingQueue = false

// mpv softvol is linear amplitude; the app slider and the kiosk speak the
// perceptual scale — square the ratio (inverse of the app's sqrt going out).
const mpvVolumeToApp = (v) => {
  const r = Math.max(0, Math.min(100, v ?? 0)) / 100
  return Math.round(100 * r * r)
}

function postTimeline(report, state, t) {
  const params = new URLSearchParams({
    ratingKey: t.ratingKey,
    key: `/library/metadata/${t.ratingKey}`,
    state,
    time: String(Math.max(0, Math.round(t.timeMs))),
    duration: String(Math.max(0, Math.round(t.durationMs)))
  })
  if (report.playQueueId != null) params.set('playQueueID', String(report.playQueueId))
  if (t.playQueueItemID !== undefined) params.set('playQueueItemID', String(t.playQueueItemID))
  return fetch(`${report.baseUrl}/:/timeline?${params}`, {
    headers: report.headers, signal: AbortSignal.timeout(3000)
  }).catch(() => {})
}

function postRadioState(report, body) {
  return fetch(`${boxKioskUrl || report.kioskUrl}/api/radio-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({ station: report.station, ...body })
  }).catch(() => {})
}

async function reportTick() {
  if (reporting || closing || loadingQueue) return
  reporting = true
  try {
    if (source === 'plex' && plexReport) {
      const s = await status()
      const track = s.index !== null ? queue[s.index] : null
      if (!track || s.state === 'stopped') {
        // Queue played out — close the session once, then go quiet.
        if (lastTimeline) {
          const t = lastTimeline
          lastTimeline = null
          await postTimeline(plexReport, 'stopped', t)
        }
        return
      }
      const t = { ratingKey: track.ratingKey, timeMs: (s.seconds ?? 0) * 1000,
        durationMs: s.duration != null ? s.duration * 1000 : (track.duration ?? 0),
        playQueueItemID: track.playQueueItemID }
      lastTimeline = t
      await postTimeline(plexReport, s.state, t)
    } else if ((source === 'radio' || source === 'radio-queue') && radioReport) {
      const s = await status()
      // Track-queue stations carry per-track metadata; live streams icy text.
      const track = source === 'radio-queue' && s.index !== null ? queue[s.index] : null
      await postRadioState(radioReport, {
        streamTitle: track ? `${track.artist} - ${track.title}` : (s.streamTitle ?? ''),
        songArtist: track?.artist,
        songTitle: track?.title,
        state: s.state,
        volume: mpvVolumeToApp(s.volume)
      })
    }
  } catch {} finally {
    reporting = false
  }
}

// ---------------------------------------------------------------------------
// Xtra top-up — a track-queue station (SiriusXM Xtra) is a rolling queue that
// runs dry unless someone keeps fetching the channel's upcoming tracks. That
// someone is us now (it used to be the app, so a sleeping Mac starved the
// station): the app hands the proxy coordinates down with the queue command
// and we append fresh tracks whenever fewer than 3 remain. Appends only —
// refreshTracks' append path preserves gapless prefetch.
// ---------------------------------------------------------------------------
let topUp = null // { proxy, entityType, entityId, title }
let toppingUp = false

async function topUpTick() {
  const cfg = topUp
  if (!cfg || source !== 'radio-queue' || toppingUp || closing || loadingQueue) return
  if (playlistPos < 0 || queue.length - playlistPos > 3) return
  toppingUp = true
  try {
    const res = await fetch(`${cfg.proxy}/stream/${cfg.entityType}/${cfg.entityId}/tracks`, {
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) return
    const tracks = await res.json()
    // Each /tracks fetch re-tunes and can overlap what we already hold; the
    // queue is append-only for radio, so its ratingKeys are the seen-set.
    const seen = new Set(queue.map((t) => t.ratingKey))
    const fresh = tracks
      .map((t) => ({
        ratingKey: `sxm:${t.id}`,
        title: t.title || cfg.title,
        artist: t.artist || '',
        album: cfg.title,
        duration: Math.round((t.duration || 0) * 1000),
        url: `${cfg.proxy}/stream/${cfg.entityType}/${cfg.entityId}/track/${t.id}/playlist.m3u8`
      }))
      .filter((e) => !seen.has(e.ratingKey))
    // The fetch took a while — bail if the world changed under it (a new
    // queue command replaces topUp's identity).
    if (!fresh.length || topUp !== cfg || source !== 'radio-queue' || loadingQueue) return
    await refreshTracks([...queue, ...fresh])
  } catch {} finally {
    toppingUp = false
  }
}

// A new queue replaces the report config. When the source KIND changes, close
// out the old audience; a same-kind swap just carries on under the new config
// (a 'stopped' there could land late and clobber the successor's first post).
function swapReports(nextSource, report) {
  const nextPlex = nextSource === 'plex'
  if (plexReport && !nextPlex && lastTimeline) void postTimeline(plexReport, 'stopped', lastTimeline)
  if (radioReport && nextPlex) {
    void postRadioState(radioReport, { streamTitle: '', state: 'stopped', volume: null })
  }
  lastTimeline = null
  plexReport = nextPlex ? (report ?? null) : null
  radioReport = nextPlex ? null : (report ?? null)
}

function command(...command) {
  return new Promise((resolve, reject) => {
    const request_id = ++nextId
    const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('mpv timed out')) }, 8000)
    pending.set(request_id, { resolve, reject, timer })
    ipc.write(JSON.stringify({ command, request_id }) + '\n')
  })
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    if (fatal || mpv.exitCode !== null) throw new Error(fatal || 'mpv exited during startup')
    try {
      ipc = await new Promise((resolve, reject) => {
        const socket = createConnection(socketPath)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
      break
    } catch { await delay(100) }
  }
  if (!ipc) throw new Error('Could not connect to mpv')
  createInterface({ input: ipc }).on('line', line => {
    // A torn/garbled IPC line must not crash the process (see the crash
    // guards below — but better to not even trip them).
    let message
    try { message = JSON.parse(line) } catch { return }
    const waiter = pending.get(message.request_id)
    if (waiter) {
      clearTimeout(waiter.timer)
      pending.delete(message.request_id)
      if (message.error === 'success') waiter.resolve(message.data)
      else waiter.reject(new Error(`mpv: ${message.error}`))
    } else if (message.event === 'property-change' && message.name === 'playlist-pos') {
      playlistPos = typeof message.data === 'number' ? message.data : -1
      kickPrefetch()
      // Report track advances within a second, not on the next 10s tick —
      // and an advance is exactly when an Xtra queue's remainder shrinks.
      void reportTick()
      void topUpTick()
    } else if (['file-loaded', 'end-file', 'audio-reconfig'].includes(message.event)) {
      events.push({ at: new Date().toISOString(), event: message.event,
        reason: message.reason, error: message.error })
      if (events.length > 12) events.shift()
    }
  })
  ipc.on('close', () => {
    fatal = 'mpv disconnected'
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer); waiter.reject(new Error(fatal))
    }
    pending.clear()
  })
  // Track advances drive the prefetch window (the app's status poll isn't
  // guaranteed to be running).
  await command('observe_property', 1, 'playlist-pos')
}

// The PCM5122's auto-mute (21ms trigger) chatters audibly — tap-tap-tap —
// through between-song gaps: it mutes on digital silence and unmutes on any
// blip in the gap. Plexamp never trips it (its volume DSP dithers, so it
// never emits true silence); mpv plays files bit-perfect, so it does. Keep
// it off; the DAC's idle noise floor (~-112dB) is inaudible. Survives via
// this hook rather than alsactl so a reboot or driver reload can't bring it
// back. (Diagnosed 2026-09-14 — "the dip-dip-dips".)
function disableDacAutoMute() {
  for (const control of ['Auto Mute', 'Auto Mute Mono']) {
    try { execFileSync('amixer', ['-c', 'Pro', 'sset', control, 'off'], { stdio: 'pipe' }) } catch {}
  }
}

async function takeDac() {
  if (silent || restore.length) return
  for (const service of ['plexamp', 'shairport-sync']) {
    let active = false
    try { active = systemctl('is-active', service).toString().trim() === 'active' } catch {}
    if (active) { restore.push(service); systemctl('stop', service) }
  }
}

function checkTracks(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) throw new Error('Queue is empty')
  for (const track of tracks) {
    // A URL parse error would echo the URL (which carries the Plex token) —
    // swallow it into a generic message.
    let protocol = null
    try { protocol = new URL(track.url).protocol } catch {}
    if (!['http:', 'https:'].includes(protocol)) throw new Error('Only HTTP audio is supported')
  }
}

async function loadTracks(tracks, startIndex, volume) {
  await takeDac()
  await command('stop')
  await command('playlist-clear')
  if (Number.isFinite(volume)) await command('set_property', 'volume', volume)
  queue = tracks
  // Appending while idle never autostarts; playlist-play-index starts the
  // requested entry directly so a mid-album cast never blips track 1 first.
  for (const track of queue) await command('loadfile', mpvUrl(track), 'append')
  await command('set_property', 'pause', false)
  const index = Math.min(Math.max(0, startIndex ?? 0), queue.length - 1)
  await command('playlist-play-index', index)
  playlistPos = index
  kickPrefetch()
}

// Replace the queue around whatever is playing (a Plex-side queue edit).
// The common case — radio continuation appending the next album — must NOT
// rebuild the playlist: a rebuild discards mpv's prefetch of the upcoming
// entry, and the resulting cold open is an audible ~1.5s dip at the album
// boundary. Pure appends just extend the playlist. Anything else (removals,
// reorders) does the clear+move dance: playlist-clear keeps only the current
// entry, append the rest in new order, one playlist-move slots current in.
// Rebuilds still lose mpv's own prefetch — that's what the warm cache above
// is for: the cold open lands on a local file instead of a Plex URL.
async function refreshTracks(tracks) {
  if (tracks.length >= queue.length &&
      queue.every((t, i) => t.ratingKey === tracks[i].ratingKey)) {
    const fresh = tracks.slice(queue.length)
    // Reassign before the appends — the proxy resolves /t/<ratingKey> against
    // `queue`, and mpv may probe a new entry as soon as it lands.
    queue = tracks
    for (const track of fresh) {
      await command('loadfile', mpvUrl(track), 'append')
    }
    kickPrefetch()
    return
  }
  const pos = await command('get_property', 'playlist-pos').catch(() => -1)
  const currentKey = pos >= 0 ? queue[pos]?.ratingKey : null
  const k = currentKey ? tracks.findIndex(t => t.ratingKey === currentKey) : -1
  if (k < 0) { await loadTracks(tracks, 0); return }
  queue = tracks
  await command('playlist-clear')
  for (const track of tracks) {
    if (track.ratingKey !== currentKey) await command('loadfile', mpvUrl(track), 'append')
  }
  // Current sits at 0; the entry that should follow it is at k+1 (mpv's
  // move-target index refers to the pre-move list).
  if (k + 1 <= tracks.length - 1) await command('playlist-move', 0, k + 1)
  playlistPos = k
  kickPrefetch()
}

async function status() {
  const names = ['idle-active', 'pause', 'paused-for-cache', 'playlist-pos', 'time-pos',
    'duration', 'volume', 'metadata', 'audio-params', 'audio-out-params']
  const values = await Promise.all(names.map(name => command('get_property', name).catch(() => null)))
  const p = Object.fromEntries(names.map((name, i) => [name, values[i]]))
  const index = p['playlist-pos'] >= 0 ? p['playlist-pos'] : null
  const current = index !== null ? queue[index] ?? null : null
  return { source, state: fatal ? 'stopped' : p['idle-active'] ? 'stopped' : p.pause ? 'paused'
    : p['paused-for-cache'] ? 'buffering' : 'playing', error: fatal,
    current: current && { title: current.title, artist: current.artist, album: current.album, ratingKey: current.ratingKey },
    index, track: index !== null ? index + 1 : null, tracks: queue.length,
    seconds: p['time-pos'], duration: source === 'radio' ? null : p.duration, volume: p.volume,
    streamTitle: p.metadata?.['icy-title'] ?? p.metadata?.title ?? null,
    // The PMS play queue this cast reports against — lets the agent re-pull
    // the queue after a phone-side edit (mailbox refreshq) without keeping
    // its own state. Null for radio and for pre-report-config casts.
    playQueueId: plexReport?.playQueueId ?? null,
    input: p['audio-params'], output: p['audio-out-params'], recentEvents: [...events],
    cachedAhead: wantedKeys().filter((k) => cached.has(k)).length,
    outputDevice: silent ? 'silent bench' : 'HiFiBerry Pro', temporarilyStopped: [...restore] }
}

async function handle(request) {
  if (fatal) throw new Error(fatal)
  switch (request.action) {
    case 'queue':
      checkTracks(request.tracks)
      swapReports(request.source, request.report)
      source = request.source
      topUp = request.source === 'radio-queue' ? (request.topUp ?? null) : null
      loadingQueue = true
      try {
        await loadTracks(request.tracks, request.startIndex, request.volume)
      } finally {
        loadingQueue = false
      }
      break
    case 'refresh':
      checkTracks(request.tracks)
      // 'radio-queue' = a track-queue station (SiriusXM Xtra). Top-up is
      // ours now (topUpTick), but the app's refresh path stays valid.
      if (source !== 'plex' && source !== 'radio-queue') throw new Error('Only a track queue can be refreshed')
      loadingQueue = true
      try {
        await refreshTracks(request.tracks)
      } finally {
        loadingQueue = false
      }
      break
    case 'skip':
      if (!Number.isInteger(request.index) || request.index < 0 || request.index >= queue.length) throw new Error('Invalid track index')
      await command('set_property', 'pause', false)
      await command('playlist-play-index', request.index)
      break
    case 'pause': await command('set_property', 'pause', true); break
    case 'play': await command('set_property', 'pause', false); break
    case 'next': await command('playlist-next', 'weak'); break
    case 'prev': await command('playlist-prev', 'weak'); break
    case 'seek':
      if (source === 'radio') throw new Error('Live radio cannot seek')
      if (!Number.isFinite(request.seconds) || request.seconds < 0) throw new Error('Invalid position')
      await command('seek', request.seconds, 'absolute'); break
    case 'volume':
      if (!Number.isFinite(request.value) || request.value < 0 || request.value > 100) throw new Error('Volume must be 0–100')
      await command('set_property', 'volume', request.value); break
    case 'stop': await command('stop'); break
    case 'status': break
    default: throw new Error('Unknown action')
  }
  return status()
}

// ---------------------------------------------------------------------------
// Control socket — the always-on kiosk agent (agent.mjs, a systemd service)
// speaks the same JSON-line protocol here that the Mac speaks over stdin, so
// wall-kiosk taps reach whichever receiver is running even with every Mac
// asleep. Unix socket in the owner-only deploy dir; requests from both
// channels serialize through one chain (mpv command order matters mid-load).
// ---------------------------------------------------------------------------
const controlDir = `${process.env.HOME}/.cache/cratedigger-pi-player`
const controlPath = `${controlDir}/control.sock`
let handleChain = Promise.resolve()
function handleSerial(request) {
  const run = () => handle(request)
  const p = handleChain.then(run, run)
  handleChain = p.catch(() => {})
  return p
}

try { mkdirSync(controlDir, { recursive: true, mode: 0o700 }) } catch {}
try { rmSync(controlPath, { force: true }) } catch {}
const control = createNetServer((sock) => {
  sock.on('error', () => {})
  // A client may hang up mid-request (the agent's probes time out and
  // destroy); writing to that socket throws, and a throw escaping this async
  // handler kills the whole process — which is exactly how mpv got orphaned,
  // still holding the DAC, on 2026-09-15. Replies are best-effort.
  const reply = (obj) => { try { sock.write(JSON.stringify(obj) + '\n') } catch {} }
  createInterface({ input: sock }).on('line', async (line) => {
    try {
      const request = JSON.parse(line)
      if (request.action === 'quit') {
        reply({ ok: true })
        await cleanup()
        process.exit(0)
      }
      const state = await handleSerial(request)
      reply({ ok: true, state })
      if (request.action !== 'status') void reportTick()
    } catch (error) {
      // Same rule as stdin: never echo submitted URLs (Plex tokens).
      reply({ ok: false, error: error.message })
    }
  })
})
control.on('error', () => {})
control.listen(controlPath)

// One shared teardown promise: a second trigger (double SIGTERM, crash while
// closing) must WAIT for the first teardown, not sail past a `closing` guard
// and exit with mpv still alive — that stranded an orphan mpv on the DAC and
// muted every later cast (the silent morning of 2026-09-15).
let closingPromise = null
function cleanup() {
  return (closingPromise ??= doCleanup())
}

async function doCleanup() {
  closing = true
  control.close()
  try { rmSync(controlPath, { force: true }) } catch {}
  // Close out the session upstream — the Mac no longer does this for us.
  const finals = []
  if (plexReport && lastTimeline) finals.push(postTimeline(plexReport, 'stopped', lastTimeline))
  if (radioReport) {
    finals.push(postRadioState(radioReport, { streamTitle: '', state: 'stopped', volume: null }))
  }
  plexReport = null
  radioReport = null
  lastTimeline = null
  inflight?.controller.abort()
  proxy.close()
  mpv.kill('SIGTERM')
  await Promise.race([new Promise(resolve => mpv.once('exit', resolve)), delay(2000)])
  if (mpv.exitCode === null && mpv.signalCode === null) mpv.kill('SIGKILL')
  ipc?.destroy()
  // Plexamp's start hook itself restarts shairport; restore Plexamp first.
  for (const service of restore) {
    try { systemctl('start', service) } catch { process.stderr.write(`Could not restore ${service}; run sudo systemctl start ${service}\n`) }
  }
  rmSync(dir, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
  await Promise.allSettled(finals)
}
// ---------------------------------------------------------------------------
// Idle watchdog — the DAC is BORROWED, not owned. Plexamp is the resident
// living-room player (Mary casts to it); we stop it while direct audio plays
// and must hand it back promptly when we're done, not at process exit
// someday. Idle (mpv idle-active — queue played out / stopped) or paused for
// IDLE_EXIT_MS → full cleanup + exit: Plexamp restored via the existing
// restore list, and both spawn paths (kiosk agent's ensureReceiver, the
// Mac's ensureSession) respawn on demand. 1 minute is deliberate — Jay chose
// the fastest handback over pause-resume convenience (2026-09-16); a paused
// radio stream rejoins live on retune anyway. The teardown runs through
// handleChain so a cast landing at the same moment wins.
// ---------------------------------------------------------------------------
const IDLE_EXIT_MS = 60_000
let idleSince = null

async function idleState() {
  const stopped = await command('get_property', 'idle-active').catch(() => true)
  const paused = await command('get_property', 'pause').catch(() => false)
  return Boolean(stopped) || Boolean(paused)
}

async function idleWatchTick() {
  if (silent || closing) return
  if (loadingQueue || !(await idleState())) { idleSince = null; return }
  idleSince ??= Date.now()
  if (Date.now() - idleSince < IDLE_EXIT_MS) return
  const run = async () => {
    if (closing || loadingQueue || !(await idleState())) { idleSince = null; return }
    await cleanup()
    process.exit(0)
  }
  handleChain = handleChain.then(run, run)
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, async () => { await cleanup(); process.exit(0) })
}
// A crash must never strand mpv: the children outlive this process, keep the
// DAC, and every later cast is silently mute. Best-effort teardown, then die.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, async () => {
    try { await cleanup() } catch {}
    process.exit(1)
  })
}
try {
  disableDacAutoMute()
  await connect()
  setInterval(() => {
    void reportTick()
    void topUpTick()
  }, REPORT_MS)
  // A spawned-but-never-queued receiver counts as idle from birth.
  idleSince = Date.now()
  setInterval(() => void idleWatchTick(), 10_000)
  process.stdout.write(JSON.stringify({ ready: true }) + '\n')
  if (process.argv.includes('--no-stdin')) {
    // Agent-spawned (detached, no controlling pipe): the control socket is
    // the only channel, and the process must survive agent restarts — an
    // immediate stdin EOF here must not read as "quit".
    await new Promise(() => {})
  }
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const request = JSON.parse(line)
      if (request.action === 'quit') break
      process.stdout.write(JSON.stringify({ ok: true, state: await handleSerial(request) }) + '\n')
      // Pause/skip/volume should reach the kiosk now, not on the next tick.
      if (request.action !== 'status') void reportTick()
    } catch (error) {
      // Never include submitted URLs or mpv logs: Plex URLs contain credentials.
      process.stdout.write(JSON.stringify({ ok: false, error: error.message.startsWith('mpv:')
        ? error.message : error.message }) + '\n')
    }
  }
} finally {
  await cleanup()
  // The proxy's keep-alive sockets (mpv holds connections) would keep the
  // event loop alive after a clean quit — exit explicitly.
  process.exit(0)
}
