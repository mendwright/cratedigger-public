import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, shell } from 'electron'
import type { SpotifyPlaylistSummary, SpotifyTrack } from '../shared/spotify.js'
import { parsePlaylistFile, uniquifyNames, type ParsedPlaylist } from '../shared/playlist-file.js'
import {
  getSpotifyClientId,
  getSpotifyRefreshToken,
  setSpotifyRefreshToken,
  getValue,
  setValue
} from './store.js'

// Spotify Web API via Authorization Code + PKCE — a "public client" flow, so
// the user's own (free) dev-app client ID is the only credential; there is no
// client secret to hold. The redirect URI is a loopback http server on a
// fixed port, which must be registered verbatim in the dev app's settings:
//   http://127.0.0.1:48219/callback
const REDIRECT_PORT = 48219
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`
const SCOPES = 'playlist-read-private playlist-read-collaborative'
const AUTH_TIMEOUT_MS = 3 * 60 * 1000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let accessToken: string | null = null
let accessTokenExpiresAt = 0
let authServer: Server | null = null

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

function adoptTokens(t: TokenResponse): void {
  accessToken = t.access_token
  accessTokenExpiresAt = Date.now() + (t.expires_in - 60) * 1000
  // Spotify rotates refresh tokens on use — always persist the newest.
  if (t.refresh_token) setSpotifyRefreshToken(t.refresh_token)
}

/**
 * Interactive connect: open the consent page in the default browser and
 * catch the redirect on a loopback server. Resolves once tokens are stored.
 */
export async function spotifyConnect(): Promise<void> {
  const clientId = getSpotifyClientId()
  if (!clientId) throw new Error('Set a Spotify client ID in settings first')

  // A previous half-finished attempt may still hold the port.
  authServer?.close()
  authServer = null

  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      authServer?.close()
      authServer = null
      reject(new Error('Spotify sign-in timed out — try connecting again'))
    }, AUTH_TIMEOUT_MS)

    authServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const err = url.searchParams.get('error')
      const gotState = url.searchParams.get('state')
      const gotCode = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        err
          ? '<body style="font-family:sans-serif">Spotify sign-in failed — you can close this tab.</body>'
          : '<body style="font-family:sans-serif">Connected — back to Cratedigger.</body>'
      )
      clearTimeout(timer)
      authServer?.close()
      authServer = null
      if (err) reject(new Error(`Spotify sign-in refused: ${err}`))
      else if (gotState !== state) reject(new Error('Spotify sign-in state mismatch'))
      else if (!gotCode) reject(new Error('Spotify redirect carried no code'))
      else resolve(gotCode)
    })
    authServer.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Could not open the sign-in listener: ${e.message}`))
    })
    authServer.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const auth = new URL('https://accounts.spotify.com/authorize')
      auth.searchParams.set('client_id', clientId)
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('redirect_uri', REDIRECT_URI)
      auth.searchParams.set('scope', SCOPES)
      auth.searchParams.set('code_challenge_method', 'S256')
      auth.searchParams.set('code_challenge', challenge)
      auth.searchParams.set('state', state)
      void shell.openExternal(auth.toString())
    })
  })

  adoptTokens(
    await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier
    })
  )
}

export function spotifyDisconnect(): void {
  accessToken = null
  accessTokenExpiresAt = 0
  setSpotifyRefreshToken('')
}

// ---------------------------------------------------------------------------
// Import folder: the renderer's <input type=file> picks are session-only (a
// dev-reload wiped 404 freshly-selected CSVs — never again). Instead the
// user points at a folder of exports once; the path persists and the panel
// re-reads it on every open, so the playlist list survives reloads.

function readImportDir(dir: string): ParsedPlaylist[] {
  const out: ParsedPlaylist[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (!/\.(csv|json)$/i.test(name)) continue
    const full = join(dir, name)
    try {
      if (statSync(full).size > 64 * 1024 * 1024) continue
      out.push(...parsePlaylistFile(readFileSync(full, 'utf8'), name))
    } catch {
      // unreadable file — skip
    }
  }
  return uniquifyNames(out)
}

export async function spotifyPickImportFolder(): Promise<{
  dir: string | null
  playlists: ParsedPlaylist[]
}> {
  const res = await dialog.showOpenDialog({
    title: 'Choose a folder of playlist exports',
    properties: ['openDirectory']
  })
  if (res.canceled || res.filePaths.length === 0) {
    return spotifyLoadImportFolder()
  }
  const dir = res.filePaths[0]
  setValue('spotifyImportDir', dir)
  return { dir, playlists: readImportDir(dir) }
}

export function spotifyLoadImportFolder(): { dir: string | null; playlists: ParsedPlaylist[] } {
  const dir = getValue('spotifyImportDir')
  if (!dir) return { dir: null, playlists: [] }
  return { dir, playlists: readImportDir(dir) }
}

export function spotifyStatus(): { configured: boolean; connected: boolean } {
  return {
    configured: getSpotifyClientId() !== '',
    connected: getSpotifyRefreshToken() !== ''
  }
}

async function ensureAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken
  const refresh = getSpotifyRefreshToken()
  if (!refresh) throw new Error('Not connected to Spotify — connect in the Playlists screen')
  const clientId = getSpotifyClientId()
  if (!clientId) throw new Error('Set a Spotify client ID in settings first')
  adoptTokens(
    await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId
    })
  )
  return accessToken!
}

async function api<T>(path: string): Promise<T> {
  const token = await ensureAccessToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 401) {
    // Token proved stale despite the local clock — force one refresh.
    accessToken = null
    const retryToken = await ensureAccessToken()
    const retry = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${retryToken}` }
    })
    if (!retry.ok) throw new Error(`Spotify API ${path} failed: ${retry.status}`)
    return (await retry.json()) as T
  }
  if (!res.ok) throw new Error(`Spotify API ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

interface Paged<T> {
  items: T[]
  next: string | null
}

interface RawPlaylist {
  id: string
  name: string
  tracks?: { total?: number }
  owner?: { display_name?: string }
}

export async function spotifyListPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const out: SpotifyPlaylistSummary[] = []
  let path: string | null = '/me/playlists?limit=50'
  while (path) {
    const page: Paged<RawPlaylist> = await api<Paged<RawPlaylist>>(path)
    for (const p of page.items) {
      if (!p) continue
      out.push({
        id: p.id,
        name: p.name,
        trackCount: p.tracks?.total ?? 0,
        owner: p.owner?.display_name ?? ''
      })
    }
    path = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null
  }
  return out
}

interface RawPlaylistItem {
  is_local?: boolean
  track: {
    name?: string
    duration_ms?: number
    artists?: { name?: string }[]
    album?: { name?: string }
  } | null
}

export async function spotifyGetPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = []
  let path: string | null =
    `/playlists/${playlistId}/tracks?limit=100&fields=next,items(is_local,track(name,duration_ms,artists(name),album(name)))`
  while (path) {
    const page: Paged<RawPlaylistItem> = await api<Paged<RawPlaylistItem>>(path)
    for (const item of page.items) {
      const t = item?.track
      if (!t || !t.name) continue // episodes / removed tracks
      out.push({
        artist: t.artists?.map((a) => a.name).filter(Boolean).join(', ') ?? '',
        title: t.name,
        album: t.album?.name ?? '',
        durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : null,
        isLocal: item.is_local === true
      })
    }
    path = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null
  }
  return out
}
