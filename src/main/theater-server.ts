// Living-room theater server. A tiny LAN HTTP server (private builds only)
// that serves a self-contained synced-lyrics page — blurred-cover backdrop,
// active-line highlight, TV-sized type — for a named Plex player. The living
// room Pi runs a Chromium kiosk pointed at `http://<this mac>:9334/?player=
// pi-dac-living-room` and mirrors whatever that Plexamp is playing.
//
// Everything rides existing main-process plumbing: player/server resolution
// (plex/connection.ts), the companion timeline poll (plex/playback.ts), the
// LRCLIB→Genius lyrics chain with its disk cache (lyrics.ts), and the cover
// transcode fetch (transcode-fetch.ts). The page polls /state every 2.5s —
// the same cadence as the app's own Now Playing poll — and runs a local
// smooth clock between polls, mirroring TheaterMode.svelte.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { LyricsResult, MusicTimeline } from '../shared/plex.js'
import { PUBLIC_BUILD } from '../shared/build-flags.js'
import { getValue, getAuthToken } from './store.js'
import {
  resolveServerContext,
  resolvePlayerContext,
  invalidatePlayerContext
} from './plex/connection.js'
import { getMusicTimelineForPlayer } from './plex/playback.js'
import { listPlayers } from './plex/resources.js'
import { getTrackLyrics } from './lyrics.js'
import { fetchTranscodeWithRetry } from './transcode-fetch.js'

export const THEATER_SERVER_PORT = 9334

// Player-name → clientIdentifier lookups hit plex.tv; cache the roster so the
// 2.5s /state poll doesn't re-list resources every tick.
const PLAYER_ROSTER_TTL_MS = 60_000
let rosterAt = 0
let roster: { name: string; id: string }[] = []

async function playerRoster(): Promise<{ name: string; id: string }[]> {
  if (Date.now() - rosterAt < PLAYER_ROSTER_TTL_MS) return roster
  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')
  const players = await listPlayers(token)
  roster = players.map((p) => ({ name: p.name, id: p.clientIdentifier }))
  rosterAt = Date.now()
  return roster
}

async function playerIdByName(name: string): Promise<string | null> {
  const want = name.trim().toLowerCase()
  const found = (await playerRoster()).find((p) => p.name.toLowerCase() === want)
  if (found) return found.id
  // Maybe the roster is stale (player registered since we cached) — retry once.
  rosterAt = 0
  return (await playerRoster()).find((p) => p.name.toLowerCase() === want)?.id ?? null
}

// Lyrics for the page. getTrackLyrics disk-caches, but a cold Genius fallback
// can run 8–17s — far longer than the poll interval — so dedupe in-flight
// fetches per track and answer "pending" instead of blocking /state.
const lyricsDone = new Map<string, LyricsResult | null>()
const lyricsInFlight = new Map<string, Promise<void>>()

function lyricsFor(tl: MusicTimeline): { lyrics: LyricsResult | null; pending: boolean } {
  const key = tl.ratingKey
  if (lyricsDone.has(key)) return { lyrics: lyricsDone.get(key) ?? null, pending: false }
  if (!lyricsInFlight.has(key)) {
    if (lyricsDone.size > 100) lyricsDone.clear()
    const p = getTrackLyrics({
      artist: tl.artist,
      title: tl.title,
      album: tl.album,
      durationMs: tl.duration || null
    })
      .then((r) => {
        lyricsDone.set(key, r)
      })
      .catch(() => {
        // Leave uncached — a later poll retries (matches renderer semantics
        // where 'error' entries are retryable).
      })
      .finally(() => {
        lyricsInFlight.delete(key)
      })
    lyricsInFlight.set(key, p)
  }
  return { lyrics: null, pending: true }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function handleState(res: ServerResponse, playerName: string): Promise<void> {
  const serverId = getValue('preferredServerId')
  if (!serverId) return sendJson(res, 200, { error: 'No Plex server selected in Cratedigger' })

  const playerId = await playerIdByName(playerName)
  if (!playerId) return sendJson(res, 200, { error: `Player “${playerName}” not found` })

  const [server, player] = await Promise.all([
    resolveServerContext(serverId),
    resolvePlayerContext(playerId)
  ])

  let timeline: MusicTimeline | null
  try {
    timeline = await getMusicTimelineForPlayer(server, player)
  } catch (err) {
    // Same recovery as PlaybackController: a Pi on a fresh DHCP lease keeps a
    // dead cached address until we drop it.
    invalidatePlayerContext(playerId)
    throw err
  }

  if (!timeline) return sendJson(res, 200, { timeline: null })

  const { lyrics, pending } = lyricsFor(timeline)
  sendJson(res, 200, {
    timeline,
    lyrics,
    lyricsPending: pending,
    cover: timeline.thumb
      ? `/cover?path=${encodeURIComponent(timeline.thumb)}&size=1200`
      : null
  })
}

async function handleCover(res: ServerResponse, url: URL): Promise<void> {
  const path = url.searchParams.get('path')
  if (!path || !path.startsWith('/')) {
    res.writeHead(400).end('bad path')
    return
  }
  const serverId = getValue('preferredServerId')
  if (!serverId) {
    res.writeHead(404).end('no server')
    return
  }
  const ctx = await resolveServerContext(serverId)
  const size = Math.max(32, Math.min(2000, parseInt(url.searchParams.get('size') ?? '1200', 10) || 1200))
  const innerUrl = `${ctx.baseUrl}${path}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
  const upstream =
    `${ctx.baseUrl}/photo/:/transcode?width=${size}&height=${size}` +
    `&minSize=1&upscale=1&url=${encodeURIComponent(innerUrl)}`
  const img = await fetchTranscodeWithRetry(upstream, ctx.token)
  if (!img.ok) {
    res.writeHead(502).end('cover fetch failed')
    return
  }
  const buf = Buffer.from(await img.arrayBuffer())
  res.writeHead(200, {
    'Content-Type': img.headers.get('content-type') ?? 'image/jpeg',
    // Covers are immutable per thumb path — let the kiosk cache them.
    'Cache-Control': 'max-age=86400'
  })
  res.end(buf)
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(PAGE_HTML)
    return
  }
  if (url.pathname === '/players') {
    sendJson(res, 200, { players: (await playerRoster()).map((p) => p.name) })
    return
  }
  if (url.pathname === '/state') {
    const player = url.searchParams.get('player')
    if (!player) return sendJson(res, 400, { error: 'missing player param' })
    await handleState(res, player)
    return
  }
  if (url.pathname === '/cover') {
    await handleCover(res, url)
    return
  }
  res.writeHead(404).end('not found')
}

let started = false

export function startTheaterServer(): void {
  if (PUBLIC_BUILD || started) return
  started = true
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) sendJson(res, 503, { error: msg })
      else res.end()
    })
  })
  // Dev + installed app can both be running; don't crash on a taken port.
  server.on('error', (err) => {
    console.warn('[theater-server] not started:', err.message)
  })
  server.listen(THEATER_SERVER_PORT, '0.0.0.0', () => {
    console.log(`[theater-server] listening on :${THEATER_SERVER_PORT}`)
  })
}

// The page itself: one self-contained HTML string, no build step, styled after
// TheaterMode.svelte but tuned for a 10-foot TV read (bigger type, no hover
// affordances, cursor hidden, auto-scroll always on).
const PAGE_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cratedigger Theater</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: #0c0b0d;
    color: #fff;
    font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
    overflow: hidden;
    cursor: none;
  }
  .backdrop {
    position: absolute; inset: -8%;
    width: 116%; height: 116%;
    object-fit: cover;
    filter: blur(64px) saturate(1.15) brightness(0.42);
    transform: scale(1.05);
    transition: opacity 600ms ease;
  }
  .scrim {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 30% 40%, rgba(12,11,13,0) 0%, rgba(12,11,13,0.55) 100%),
      linear-gradient(to bottom, rgba(12,11,13,0.25), rgba(12,11,13,0.65));
  }
  .stage {
    position: relative; z-index: 1;
    height: 100vh;
    display: grid;
    grid-template-columns: minmax(280px, 42%) minmax(0, 1fr);
    gap: clamp(2rem, 5vw, 5rem);
    align-items: center;
    padding: 4vh clamp(2rem, 5vw, 5rem);
  }
  .cover-side { display: flex; justify-content: center; }
  .cover {
    width: 100%;
    max-width: min(38vw, 70vh);
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 18px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08);
  }
  .info-side {
    display: flex; flex-direction: column; gap: 2vh;
    min-width: 0; height: 88vh; justify-content: center;
  }
  .track-title {
    font-size: clamp(1.8rem, 3.4vw, 3.2rem);
    font-weight: 650; line-height: 1.15;
    color: rgba(255,255,255,0.96);
    text-wrap: balance;
  }
  .track-sub {
    margin-top: 0.5rem;
    font-size: clamp(1rem, 1.6vw, 1.4rem);
    color: rgba(255,255,255,0.55);
  }
  .lyrics {
    flex: 0 1 auto; min-height: 0;
    overflow-y: auto;
    padding: 1.5rem 1.5rem 1.5rem 0;
    mask-image: linear-gradient(to bottom, transparent 0, #000 3rem, #000 calc(100% - 3rem), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 3rem, #000 calc(100% - 3rem), transparent 100%);
    scrollbar-width: none;
  }
  .lyrics::-webkit-scrollbar { display: none; }
  .lyric-line {
    font-size: clamp(1.3rem, 2.4vw, 2.1rem);
    font-weight: 550; line-height: 1.5;
    padding: 0.3rem 0;
    color: rgba(255,255,255,0.34);
    transition: color 300ms ease, transform 300ms ease;
    transform-origin: left center;
  }
  .lyric-line.past { color: rgba(255,255,255,0.22); }
  .lyric-line.active { color: rgba(255,255,255,0.98); transform: scale(1.03); }
  .plain-lyrics {
    font-size: clamp(1.1rem, 1.8vw, 1.5rem);
    line-height: 1.7;
    color: rgba(255,255,255,0.72);
    white-space: pre-wrap;
  }
  .note {
    font-size: clamp(1rem, 1.5vw, 1.3rem);
    color: rgba(255,255,255,0.4);
    font-style: italic;
  }
  .idle {
    position: absolute; inset: 0; z-index: 2;
    display: none;
    flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem;
    background: #0c0b0d;
  }
  .idle.show { display: flex; }
  .idle .word { font-size: 1.4rem; letter-spacing: 0.35em; text-transform: uppercase; color: rgba(255,255,255,0.28); }
  .idle .sub { font-size: 1rem; color: rgba(255,255,255,0.18); }
  .picker { position: absolute; inset: 0; z-index: 3; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 1.2rem; background: #0c0b0d; cursor: auto; }
  .picker.show { display: flex; }
  .picker a { color: rgba(255,255,255,0.85); font-size: 1.4rem; text-decoration: none; padding: 0.6rem 1.4rem; border: 1px solid rgba(255,255,255,0.15); border-radius: 999px; }
</style>
</head>
<body>
  <img class="backdrop" id="backdrop" alt="" style="opacity:0">
  <div class="scrim"></div>
  <div class="stage" id="stage" style="visibility:hidden">
    <div class="cover-side"><img class="cover" id="cover" alt=""></div>
    <div class="info-side">
      <div>
        <div class="track-title" id="title"></div>
        <div class="track-sub" id="sub"></div>
      </div>
      <div class="lyrics" id="lyrics"></div>
    </div>
  </div>
  <div class="idle show" id="idle">
    <div class="word">Cratedigger</div>
    <div class="sub" id="idleSub">connecting…</div>
  </div>
  <div class="picker" id="picker"></div>
<script>
(() => {
  'use strict'
  const params = new URLSearchParams(location.search)
  const playerName = params.get('player')

  // No player in the URL: show a one-time picker of known players.
  if (!playerName) {
    const picker = document.getElementById('picker')
    picker.classList.add('show')
    document.body.style.cursor = 'auto'
    fetch('/players').then((r) => r.json()).then((j) => {
      picker.innerHTML = ''
      for (const name of j.players ?? []) {
        const a = document.createElement('a')
        a.href = '/?player=' + encodeURIComponent(name)
        a.textContent = name
        picker.appendChild(a)
      }
      if (!picker.children.length) picker.textContent = 'no players found'
    }).catch(() => { picker.textContent = 'Cratedigger unreachable' })
    return
  }

  // --- LRC parsing: browser-side copy of src/shared/lrc.ts (keep in sync) ---
  const TS_RE = /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g
  function parseLrc(raw) {
    const out = []
    for (const line of raw.split(/\\r?\\n/)) {
      TS_RE.lastIndex = 0
      const stamps = []
      let m, lastEnd = 0
      while ((m = TS_RE.exec(line)) !== null) {
        if (m.index !== lastEnd) break
        const frac = m[3] ?? ''
        stamps.push(Number(m[1]) * 60000 + Number(m[2]) * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0))
        lastEnd = TS_RE.lastIndex
      }
      if (!stamps.length) continue
      const text = line.slice(lastEnd).trim()
      for (const t of stamps) out.push({ timeMs: t, text })
    }
    out.sort((a, b) => a.timeMs - b.timeMs)
    return out
  }
  function activeLrcIndex(lines, timeMs) {
    let lo = 0, hi = lines.length - 1, ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (lines[mid].timeMs <= timeMs) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }

  const el = {
    stage: document.getElementById('stage'),
    idle: document.getElementById('idle'),
    idleSub: document.getElementById('idleSub'),
    backdrop: document.getElementById('backdrop'),
    cover: document.getElementById('cover'),
    title: document.getElementById('title'),
    sub: document.getElementById('sub'),
    lyrics: document.getElementById('lyrics')
  }

  let tl = null            // last timeline from /state
  let lines = []           // parsed synced lines
  let plain = null         // plain-lyrics text when no synced version exists
  let renderedKey = null   // ratingKey the lyrics pane was last built for
  let renderedKind = null  // 'synced' | 'plain' | 'note'
  let activeIdx = -1
  let coverUrl = null
  // Smooth clock between polls — same anchor/re-anchor scheme as TheaterMode.
  let baseTime = 0, baseAt = 0, baseKey = null

  function showIdle(msg) {
    el.idleSub.textContent = msg
    el.idle.classList.add('show')
    el.stage.style.visibility = 'hidden'
  }
  function showStage() {
    el.idle.classList.remove('show')
    el.stage.style.visibility = 'visible'
  }

  function setNote(text) {
    el.lyrics.innerHTML = ''
    const d = document.createElement('div')
    d.className = 'note'
    d.textContent = text
    el.lyrics.appendChild(d)
    renderedKind = 'note'
  }

  function renderLyrics(state) {
    const key = tl.ratingKey
    const ly = state.lyrics
    if (ly && ly.syncedLyrics) {
      if (renderedKey === key && renderedKind === 'synced') return
      lines = parseLrc(ly.syncedLyrics)
      plain = null
      el.lyrics.innerHTML = ''
      lines.forEach((line, i) => {
        const d = document.createElement('div')
        d.className = 'lyric-line'
        d.dataset.idx = String(i)
        d.textContent = line.text || '♪'
        el.lyrics.appendChild(d)
      })
      el.lyrics.scrollTop = 0
      activeIdx = -1
      renderedKind = 'synced'
    } else if (ly && ly.plainLyrics) {
      if (renderedKey === key && renderedKind === 'plain') return
      lines = []
      plain = ly.plainLyrics
      el.lyrics.innerHTML = ''
      const pre = document.createElement('div')
      pre.className = 'plain-lyrics'
      pre.textContent = plain
      el.lyrics.appendChild(pre)
      el.lyrics.scrollTop = 0
      renderedKind = 'plain'
    } else {
      lines = []; plain = null
      const note = ly && ly.instrumental ? 'instrumental'
        : state.lyricsPending ? 'finding lyrics…'
        : 'no lyrics found'
      if (renderedKey === key && renderedKind === 'note' && el.lyrics.textContent === note) return
      setNote(note)
    }
    renderedKey = key
  }

  function applyState(state) {
    if (state.error) { tl = null; showIdle(state.error); return }
    tl = state.timeline
    if (!tl) { showIdle('nothing playing'); return }
    showStage()

    el.title.textContent = tl.title || '—'
    el.sub.textContent = tl.artist + (tl.album ? ' · ' + tl.album : '')

    if (state.cover !== coverUrl) {
      coverUrl = state.cover
      if (coverUrl) {
        el.cover.src = coverUrl
        el.backdrop.src = coverUrl
        el.backdrop.style.opacity = '1'
      } else {
        el.cover.removeAttribute('src')
        el.backdrop.style.opacity = '0'
      }
    }

    // Re-anchor the smooth clock on track change or real drift (seek, pause).
    if (tl.ratingKey !== baseKey) {
      baseKey = tl.ratingKey
      baseTime = tl.time
      baseAt = performance.now()
    } else {
      const projected = baseTime + (performance.now() - baseAt)
      if (tl.state !== 'playing' || Math.abs(projected - tl.time) > 1500) {
        baseTime = tl.time
        baseAt = performance.now()
      }
    }

    renderLyrics(state)
  }

  function liveTime() {
    if (!tl) return 0
    if (tl.state !== 'playing') return baseTime
    return Math.min(tl.duration || Infinity, baseTime + (performance.now() - baseAt))
  }

  // 250ms tick drives the active-line highlight and auto-scroll; plain lyrics
  // creep proportionally to track position so long texts stay readable
  // without any input device.
  setInterval(() => {
    if (!tl) return
    const t = liveTime()
    if (lines.length > 0) {
      const idx = activeLrcIndex(lines, t)
      if (idx !== activeIdx) {
        activeIdx = idx
        const kids = el.lyrics.children
        for (let i = 0; i < kids.length; i++) {
          kids[i].classList.toggle('active', i === idx)
          kids[i].classList.toggle('past', i < idx)
        }
        if (idx >= 0 && kids[idx]) kids[idx].scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    } else if (plain && tl.duration > 0) {
      const ratio = Math.max(0, Math.min(1, t / tl.duration))
      el.lyrics.scrollTop = ratio * (el.lyrics.scrollHeight - el.lyrics.clientHeight)
    }
  }, 250)

  async function poll() {
    try {
      const r = await fetch('/state?player=' + encodeURIComponent(playerName))
      applyState(await r.json())
    } catch {
      tl = null
      showIdle('Cratedigger offline — retrying')
    }
  }
  poll()
  setInterval(poll, 2500)
})()
</script>
</body>
</html>
`
