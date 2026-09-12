// Cratedigger Pi receiver — one SSH session owns mpv; EOF restores Plexamp.
// Deployed by src/main/pi-player.ts (bundled via ?raw import, scp'd on
// connect). Speaks JSON lines on stdin/stdout: one response per request, in
// order. Never logs URLs or mpv output — Plex media URLs carry credentials.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
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
    const message = JSON.parse(line)
    const waiter = pending.get(message.request_id)
    if (waiter) {
      clearTimeout(waiter.timer)
      pending.delete(message.request_id)
      if (message.error === 'success') waiter.resolve(message.data)
      else waiter.reject(new Error(`mpv: ${message.error}`))
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
  for (const track of queue) await command('loadfile', track.url, 'append')
  await command('set_property', 'pause', false)
  await command('playlist-play-index', Math.min(Math.max(0, startIndex ?? 0), queue.length - 1))
}

// Replace the queue around whatever is playing (a Plex-side queue edit).
// The common case — radio continuation appending the next album — must NOT
// rebuild the playlist: a rebuild discards mpv's prefetch of the upcoming
// entry, and the resulting cold open is an audible ~1.5s dip at the album
// boundary. Pure appends just extend the playlist. Anything else (removals,
// reorders) does the clear+move dance: playlist-clear keeps only the current
// entry, append the rest in new order, one playlist-move slots current in.
async function refreshTracks(tracks) {
  if (tracks.length >= queue.length &&
      queue.every((t, i) => t.ratingKey === tracks[i].ratingKey)) {
    for (const track of tracks.slice(queue.length)) {
      await command('loadfile', track.url, 'append')
    }
    queue = tracks
    return
  }
  const pos = await command('get_property', 'playlist-pos').catch(() => -1)
  const currentKey = pos >= 0 ? queue[pos]?.ratingKey : null
  const k = currentKey ? tracks.findIndex(t => t.ratingKey === currentKey) : -1
  if (k < 0) { await loadTracks(tracks, 0); return }
  await command('playlist-clear')
  for (const track of tracks) {
    if (track.ratingKey !== currentKey) await command('loadfile', track.url, 'append')
  }
  // Current sits at 0; the entry that should follow it is at k+1 (mpv's
  // move-target index refers to the pre-move list).
  if (k + 1 <= tracks.length - 1) await command('playlist-move', 0, k + 1)
  queue = tracks
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
    input: p['audio-params'], output: p['audio-out-params'], recentEvents: [...events],
    outputDevice: silent ? 'silent bench' : 'HiFiBerry Pro', temporarilyStopped: [...restore] }
}

async function handle(request) {
  if (fatal) throw new Error(fatal)
  switch (request.action) {
    case 'queue':
      checkTracks(request.tracks)
      source = request.source
      await loadTracks(request.tracks, request.startIndex, request.volume)
      break
    case 'refresh':
      checkTracks(request.tracks)
      // 'radio-queue' = a track-queue station (SiriusXM Xtra): the app tops
      // it up with upcoming tracks the same way Plex queue edits append.
      if (source !== 'plex' && source !== 'radio-queue') throw new Error('Only a track queue can be refreshed')
      await refreshTracks(request.tracks)
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

async function cleanup() {
  if (closing) return
  closing = true
  mpv.kill('SIGTERM')
  await Promise.race([new Promise(resolve => mpv.once('exit', resolve)), delay(2000)])
  if (mpv.exitCode === null && mpv.signalCode === null) mpv.kill('SIGKILL')
  ipc?.destroy()
  // Plexamp's start hook itself restarts shairport; restore Plexamp first.
  for (const service of restore) {
    try { systemctl('start', service) } catch { process.stderr.write(`Could not restore ${service}; run sudo systemctl start ${service}\n`) }
  }
  rmSync(dir, { recursive: true, force: true })
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, async () => { await cleanup(); process.exit(0) })
}
try {
  await connect()
  process.stdout.write(JSON.stringify({ ready: true }) + '\n')
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const request = JSON.parse(line)
      if (request.action === 'quit') break
      process.stdout.write(JSON.stringify({ ok: true, state: await handle(request) }) + '\n')
    } catch (error) {
      // Never include submitted URLs or mpv logs: Plex URLs contain credentials.
      process.stdout.write(JSON.stringify({ ok: false, error: error.message.startsWith('mpv:')
        ? error.message : error.message }) + '\n')
    }
  }
} finally { await cleanup() }
