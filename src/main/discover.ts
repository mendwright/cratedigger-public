import { PUBLIC_BUILD } from '../shared/build-flags.js'
import type { DiscoverDepth, DiscoverList, NewsFeed } from '../shared/discover.js'
import { getAccountInfo, getActiveAccountId, getTaggerApiKey, getTaggerUrl } from './store.js'
import { librarySnapshot } from './library-snapshot.js'

// Discover + artist news from the tagger (service/app/discover.py, news.py).
// Private, tailnet-only like listening history: no tagger / off the tailnet /
// no history for this account → null, and the screen says so.

function profile(): string | null {
  const id = getActiveAccountId()
  return (id && getAccountInfo(id)?.username) || null
}

async function tagger<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (PUBLIC_BUILD) return null
  const base = getTaggerUrl().replace(/\/$/, '')
  const key = getTaggerApiKey()
  if (!base || !key) return null
  let r: Response
  try {
    r = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    return null
  }
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`tagger ${path.split('?')[0]}: HTTP ${r.status}`)
  return (await r.json()) as T
}

function libKey(name: string): string {
  const k = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return k.startsWith('the ') ? k.slice(4) : k
}

export async function discoverList(depth: DiscoverDepth): Promise<DiscoverList | null> {
  const who = profile()
  if (!who) return null
  const doc = await tagger<DiscoverList>(`/discover/${encodeURIComponent(who)}?depth=${depth}&limit=120`)
  if (!doc) return null
  // The tagger filters against Plex already; this catches anything added
  // since its six-hour artist cache, using the album list this Mac holds.
  try {
    const owned = new Set((await librarySnapshot.allAlbums()).map((a) => libKey(a.artist)))
    doc.picks = doc.picks.filter((p) => !owned.has(libKey(p.artist)))
  } catch {
    // no snapshot yet — the tagger's filter stands
  }
  return doc
}

export async function discoverHide(artist: string, hide: boolean): Promise<void> {
  const who = profile()
  if (!who) return
  await tagger(`/discover/${encodeURIComponent(who)}/hide`, { method: 'POST', body: JSON.stringify({ artist, hide }) })
}

export async function discoverRebuild(): Promise<boolean> {
  const who = profile()
  if (!who) return false
  const r = await tagger<{ started: boolean }>(`/discover/${encodeURIComponent(who)}/rebuild`, { method: 'POST' })
  return !!r?.started
}

export async function newsFeed(): Promise<NewsFeed | null> {
  return await tagger<NewsFeed>('/news?limit=300')
}
