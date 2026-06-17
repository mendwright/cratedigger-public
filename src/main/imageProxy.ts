import { protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { resolveServerContext } from './plex/connection.js'
import { getValue } from './store.js'
import { resolveCoverFile } from './cover-store.js'

export const CRATEDIGGER_IMAGE_SCHEME = 'cratedigger-plex'
// Serves user-uploaded album covers out of userData/covers (see cover-store.ts).
export const CRATEDIGGER_COVER_SCHEME = 'cratedigger-cover'

const COVER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

const PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  bypassCSP: false
} as const

export function registerImageProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: CRATEDIGGER_IMAGE_SCHEME, privileges: PRIVILEGES },
    { scheme: CRATEDIGGER_COVER_SCHEME, privileges: PRIVILEGES }
  ])
}

// Fetch Plex image transcodes through Node's network stack (global fetch /
// undici) rather than Electron's `net.fetch`. On a multihomed machine — notably
// one running Tailscale with accept-routes on, which installs a competing
// default route — Chromium's network service intermittently binds the wrong
// source interface for LAN destinations, so a large fraction of the cover-load
// burst dies with net::ERR_ADDRESS_UNREACHABLE. Nothing re-requests a broken
// <img>, so those covers stay blank for the whole session. Node's stack honors
// the OS routing table and reaches the LAN Plex host reliably (verified: 26
// concurrent transcodes that all failed under net.fetch returned 200 here).
// plex.direct serves a publicly-valid wildcard cert, so default TLS validation
// is fine — no agent tweaks needed.
async function fetchTranscode(url: string, token: string): Promise<Response> {
  const ctrl = new AbortController()
  // 30s gives Plex's transcoder room to catch up when the library grid dumps
  // dozens of size-changed thumb requests on it at once.
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    return await fetch(url, {
      headers: { 'X-Plex-Token': token, Accept: 'image/*' },
      signal: ctrl.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export function registerImageProtocolHandler(): void {
  protocol.handle(CRATEDIGGER_IMAGE_SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      const path = url.searchParams.get('path')
      const size = url.searchParams.get('size') ?? '320'
      if (!path) return new Response('missing path', { status: 400 })

      const serverId = getValue('preferredServerId')
      if (!serverId) return new Response('no server', { status: 404 })

      const ctx = await resolveServerContext(serverId)
      const innerUrl = `${ctx.baseUrl}${path}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
      const sizeClamped = Math.max(32, Math.min(2000, parseInt(size, 10) || 320))
      const upstream =
        `${ctx.baseUrl}/photo/:/transcode?width=${sizeClamped}&height=${sizeClamped}` +
        `&minSize=1&upscale=1&url=${encodeURIComponent(innerUrl)}`

      return await fetchTranscode(upstream, ctx.token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[imgproxy] cover transcode failed:', msg)
      return new Response(msg, { status: 502 })
    }
  })

  protocol.handle(CRATEDIGGER_COVER_SCHEME, async (req) => {
    try {
      const file = new URL(req.url).searchParams.get('file')
      if (!file) return new Response('missing file', { status: 400 })
      const full = resolveCoverFile(file)
      if (!full) return new Response('bad path', { status: 400 })
      const bytes = await fs.readFile(full)
      const mime = COVER_MIME[extname(full).toLowerCase()] ?? 'application/octet-stream'
      return new Response(bytes, { headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' } })
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 404 })
    }
  })
}
