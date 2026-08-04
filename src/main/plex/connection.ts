import type {
  PlayerContext,
  PlexResource,
  PlexResourceConnection,
  ServerContext
} from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { listResources } from './resources.js'
import { getAuthToken } from '../store.js'

const contextCache = new Map<string, ServerContext>()
const playerCache = new Map<string, PlayerContext>()
const PROBE_TIMEOUT_MS = 2500

export function clearServerContextCache(): void {
  contextCache.clear()
  playerCache.clear()
}

// Drop one player's cached connection so the next resolvePlayerContext re-lists
// resources and re-probes. Called when a request to the player fails (e.g. the
// timeline poll): a Pi that picked up a new DHCP lease mid-session would
// otherwise stay pinned to its dead address until the app restarts, silently
// wedging the Now Playing bar even though the player is happily playing.
export function invalidatePlayerContext(playerId: string): void {
  playerCache.delete(playerId)
}

export async function resolveServerContext(serverId: string): Promise<ServerContext> {
  const cached = contextCache.get(serverId)
  if (cached) return cached

  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')

  const resources = await listResources(token)
  const server = resources.find((r) => r.clientIdentifier === serverId)
  if (!server) throw new Error(`Server ${serverId} not found on this account`)
  if (!server.accessToken) throw new Error(`No access token for ${server.name}`)

  const baseUrl = await pickConnection(server)
  if (!baseUrl) throw new Error(`No reachable connection for ${server.name}`)

  const ctx: ServerContext = {
    id: server.clientIdentifier,
    name: server.name,
    baseUrl,
    token: server.accessToken
  }
  contextCache.set(serverId, ctx)
  return ctx
}

async function pickConnection(server: PlexResource): Promise<string | null> {
  const ranked = [...server.connections].sort(scoreConnection)
  // Two passes: first startup probes can all fail before DNS/Wi-Fi settle, so
  // if nothing answers, wait briefly and try once more before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const conn of ranked) {
      if (await probe(conn.uri)) return conn.uri.replace(/\/$/, '')
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 750))
  }
  return null
}

export async function resolvePlayerContext(playerId: string): Promise<PlayerContext> {
  const cached = playerCache.get(playerId)
  if (cached) return cached

  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')

  const resources = await listResources(token)
  const player = resources.find((r) => r.clientIdentifier === playerId)
  if (!player) throw new Error(`Player ${playerId} not found on this account`)

  const baseUrl = await pickPlayerConnection(player)
  if (!baseUrl) throw new Error(`No reachable connection for ${player.name}`)

  const ctx: PlayerContext = {
    id: player.clientIdentifier,
    name: player.name,
    product: player.product,
    baseUrl,
    token: player.accessToken ?? token
  }
  playerCache.set(playerId, ctx)
  return ctx
}

async function pickPlayerConnection(player: PlexResource): Promise<string | null> {
  // Players are LAN-first targets. Prefer local over remote; prefer http over
  // https for mixed-cert home setups. Probe /identity (unauth) so we fall
  // through to the next-ranked connection when Plex's top pick is stale —
  // happens when a Pi's LAN IP changes or it's only reachable via a
  // *.plex.direct hostname that doesn't resolve from this Mac.
  const ranked = [...player.connections].sort((a, b) => rankPlayer(a) - rankPlayer(b))
  const tried: string[] = []
  for (const conn of ranked) {
    if (await probe(conn.uri)) return conn.uri.replace(/\/$/, '')
    tried.push(conn.uri)
  }
  console.warn(`[plex] no reachable connection for player ${player.name}; tried:`, tried)
  return null
}

function rankPlayer(c: PlexResourceConnection): number {
  if (c.local && c.protocol === 'http') return 0
  if (c.local) return 1
  if (!c.relay) return 2
  return 3
}

function scoreConnection(a: PlexResourceConnection, b: PlexResourceConnection): number {
  return rank(a) - rank(b)
}

function rank(c: PlexResourceConnection): number {
  if (c.local && c.protocol === 'https') return 0
  if (c.local) return 1
  if (c.protocol === 'https' && !c.relay) return 2
  if (!c.relay) return 3
  return 4
}

async function probe(uri: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${uri.replace(/\/$/, '')}/identity`, {
      headers: plexHeaders(),
      signal: ctrl.signal
    })
    // Any HTTP response — including 401/404 — proves the host is reachable.
    // Plexamp targets require auth on /identity and would return 401; if we
    // gated on res.ok (2xx) we'd reject every working Plexamp player.
    return res.status > 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
