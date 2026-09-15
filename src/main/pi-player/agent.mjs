// Cratedigger Pi kiosk agent — the always-on half of the wall-kiosk bridge.
// Runs on the Pi as systemd unit `cratedigger-kiosk-agent`, polling the kiosk
// server's command mailbox (/api/direct-cmds) so the kiosk works with every
// Mac asleep: a radio pill tap spawns the receiver right here and tunes it;
// pause/skip/volume reach whichever receiver is running (Mac-cast or
// agent-spawned) over its control socket. Deployed alongside receiver.mjs by
// src/main/pi-player.ts on every cast; the service survives via systemd.
//
// Config (owned by the box, NOT rewritten by the app — the app's own settings
// may hold Mac-only hostnames the Pi can't resolve):
//   ~/.cache/cratedigger-pi-player/agent-config.json
//   { "kioskUrl": "http://…:8843", "sxmProxyUrl": "http://…:8860" }
import { spawn, execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

const DIR = `${process.env.HOME}/.cache/cratedigger-pi-player`
const RECEIVER = `${DIR}/receiver.mjs`
const CONTROL = `${DIR}/control.sock`
const CONFIG = `${DIR}/agent-config.json`
const POLL_MS = 2_500
// Cold-start volume for a pill tap with nothing playing. Gentle on purpose —
// 30 "blasted" the living room on a quiet morning (2026-09-15); a kiosk tap
// should never startle whoever is standing there.
const DEFAULT_APP_VOLUME = 15

// Mirrors RADIO_STATIONS in src/main/pi-player.ts — keep in sync. SiriusXM
// paths resolve against the config's sxmProxyUrl at play time.
const STATIONS = {
  kexp: { title: 'KEXP', kind: 'live', url: 'https://kexp.streamguys1.com/kexp160.aac' },
  paradise: { title: 'Radio Paradise Main', kind: 'live', url: 'https://stream.radioparadise.com/flacm' },
  'sxm-xmu': {
    title: 'SiriusXMU',
    kind: 'live',
    sxmPath: '/stream/channel-linear/f49737db-bea3-0c13-9834-b879fb1894c4/playlist.m3u8'
  },
  'sxm-indie': {
    title: 'Indie 1.0',
    kind: 'queue',
    entityType: 'channel-xtra',
    entityId: 'abfb5780-324f-1219-48c2-c8c2445c17bd'
  }
}

function config() {
  try {
    const c = JSON.parse(readFileSync(CONFIG, 'utf8'))
    return {
      kioskUrl: String(c.kioskUrl ?? '').trim().replace(/\/$/, ''),
      sxmProxyUrl: String(c.sxmProxyUrl ?? '').trim().replace(/\/$/, '')
    }
  } catch {
    return { kioskUrl: '', sxmProxyUrl: '' }
  }
}

// Same perceptual curve as the app (mpv softvol is linear amplitude).
const appVolumeToMpv = (v) => Math.round(100 * Math.sqrt(Math.max(0, Math.min(100, v)) / 100))
const mpvVolumeToApp = (v) => {
  const r = Math.max(0, Math.min(100, v ?? 0)) / 100
  return Math.round(100 * r * r)
}

// One JSON-line request/response over the receiver's control socket.
// null = no receiver listening; a thrown error = receiver said no.
function sendCtl(request, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const sock = createConnection(CONTROL)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('receiver timed out')) }, timeoutMs)
    sock.once('error', () => { clearTimeout(timer); resolve(null) })
    sock.once('connect', () => {
      createInterface({ input: sock }).once('line', (line) => {
        clearTimeout(timer)
        sock.end()
        try {
          const r = JSON.parse(line)
          if (r.ok) resolve(r.state ?? {})
          else reject(new Error(r.error ?? 'receiver command failed'))
        } catch {
          reject(new Error('bad receiver response'))
        }
      })
      sock.write(JSON.stringify(request) + '\n')
    })
  })
}

const execFileAsync = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, () => resolve()))

// Spawn the receiver detached (it must survive agent restarts) after sweeping
// strays: a receiver that died without cleanup leaves an orphan mpv holding
// the ALSA device, and every later cast is then silent (bit us 2026-09-15).
// Bracket trick: keeps the patterns from matching any wrapping shell.
async function ensureReceiver() {
  if (await sendCtl({ action: 'status' }, 8_000).catch(() => null)) return
  await execFileAsync('pkill', ['-f', '[r]eceiver.mjs'])
  await delay(2_000)
  await execFileAsync('pkill', ['-f', 'c[r]atedigger-pi-player-.*mpv.sock'])
  await delay(500)
  spawn('node', [RECEIVER, '--no-stdin'], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 60; i++) {
    await delay(500)
    if (await sendCtl({ action: 'status' }, 4_000).catch(() => null)) return
  }
  throw new Error('receiver did not come up')
}

async function fetchXtraTracks(def, proxy) {
  const res = await fetch(`${proxy}/stream/${def.entityType}/${def.entityId}/tracks`, {
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`xtra tracks ${res.status}`)
  const tracks = await res.json()
  return tracks.map((t) => ({
    ratingKey: `sxm:${t.id}`,
    title: t.title || def.title,
    artist: t.artist || '',
    album: def.title,
    duration: Math.round((t.duration || 0) * 1000),
    url: `${proxy}/stream/${def.entityType}/${def.entityId}/track/${t.id}/playlist.m3u8`
  }))
}

async function startRadio(station, cfg) {
  const def = STATIONS[station]
  if (!def) return
  if (def.kind !== 'queue' && def.sxmPath && !cfg.sxmProxyUrl) return
  // Keep whatever volume is playing; a cold start opens at the app default.
  const live = await sendCtl({ action: 'status' }, 8_000).catch(() => null)
  const volume = live?.volume ?? appVolumeToMpv(DEFAULT_APP_VOLUME)
  await ensureReceiver()
  const report = cfg.kioskUrl ? { kioskUrl: cfg.kioskUrl, station } : undefined
  if (def.kind === 'queue') {
    if (!cfg.sxmProxyUrl) return
    const tracks = await fetchXtraTracks(def, cfg.sxmProxyUrl)
    await sendCtl({
      action: 'queue', source: 'radio-queue', tracks, startIndex: 0, volume, report,
      topUp: { proxy: cfg.sxmProxyUrl, entityType: def.entityType, entityId: def.entityId, title: def.title }
    })
  } else {
    const url = def.sxmPath ? cfg.sxmProxyUrl + def.sxmPath : def.url
    await sendCtl({
      action: 'queue', source: 'radio', startIndex: 0, volume, report,
      tracks: [{ title: def.title, artist: '', album: '', ratingKey: `radio:${station}`, url }]
    })
  }
}

let busy = false
async function tick() {
  if (busy) return
  busy = true
  try {
    const cfg = config()
    if (!cfg.kioskUrl) return
    // Report the live session's volume on the same poll (app scale) — a
    // direct Plex session's timeline has no volume, so the kiosk's slider
    // would otherwise show none. No receiver → plain drain.
    const s = await sendCtl({ action: 'status' }, 4_000).catch(() => null)
    const vol = s && s.state !== 'stopped' ? `?volume=${mpvVolumeToApp(s.volume)}` : ''
    const res = await fetch(`${cfg.kioskUrl}/api/direct-cmds${vol}`, {
      signal: AbortSignal.timeout(4_000)
    })
    if (!res.ok) return
    const cmds = await res.json()
    for (const cmd of cmds) {
      try {
        if (cmd.action === 'radio' && typeof cmd.value === 'string') {
          await startRadio(cmd.value, cfg)
        } else if (cmd.action === 'volume' && Number.isFinite(cmd.value)) {
          await sendCtl({ action: 'volume', value: appVolumeToMpv(cmd.value) })
        } else if (['play', 'pause', 'next', 'prev'].includes(cmd.action)) {
          await sendCtl({ action: cmd.action })
        }
      } catch {
        // e.g. transport with no receiver — drop the command, not the batch.
      }
    }
  } catch {
    // Kiosk unreachable — just wait for the next tick.
  } finally {
    busy = false
  }
}

setInterval(() => void tick(), POLL_MS)
void tick()
