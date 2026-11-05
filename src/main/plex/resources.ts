import type { PlexResource } from '../../shared/plex.js'
import { plexHeaders } from './headers.js'

const PLEX_API = 'https://plex.tv/api/v2'

export async function listResources(token: string): Promise<PlexResource[]> {
  const url = `${PLEX_API}/resources?includeHttps=1&includeRelay=1`
  const res = await fetch(url, { headers: plexHeaders(token) })
  if (!res.ok) throw new Error(`Plex resources fetch failed: ${res.status}`)
  return (await res.json()) as PlexResource[]
}

export async function listServers(token: string): Promise<PlexResource[]> {
  const all = await listResources(token)
  return dedupeByName(all.filter((r) => splitProvides(r.provides).includes('server')))
}

export async function listPlayers(token: string): Promise<PlexResource[]> {
  const all = await listResources(token)
  return dedupeByName(all.filter((r) => splitProvides(r.provides).includes('player')))
}

function splitProvides(provides: string): string[] {
  return provides.split(',').map((s) => s.trim())
}

// Plex accounts accumulate stale device registrations (reinstalls, container
// recreations, beta builds). Collapse same-name entries down to the most
// recently-seen one.
function dedupeByName(resources: PlexResource[]): PlexResource[] {
  const best = new Map<string, PlexResource>()
  for (const r of resources) {
    const prev = best.get(r.name)
    if (!prev || seenAt(r) > seenAt(prev)) best.set(r.name, r)
  }
  return [...best.values()]
}

function seenAt(r: PlexResource): number {
  if (!r.lastSeenAt) return 0
  const t = Date.parse(r.lastSeenAt)
  return Number.isNaN(t) ? 0 : t
}
