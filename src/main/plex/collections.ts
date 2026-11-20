import type { PlexCollection, ServerContext } from '../../shared/plex.js'
import { plexHeaders } from './headers.js'
import { plexFetch } from './http.js'

// Plex collections at album grain (type=9), surfaced in the UI as "crates".
// Unlike playlists, a collection holds whole albums — Plex does NOT expand
// the ids into tracks — which is exactly the record-crate shape we want.

interface CollectionMeta {
  ratingKey?: string | number
  title?: string
  childCount?: number | string
  thumb?: string
  subtype?: string
}

function parseCollection(m: CollectionMeta): PlexCollection {
  return {
    ratingKey: String(m.ratingKey ?? ''),
    title: m.title ?? '',
    childCount: Number(m.childCount ?? 0) || 0,
    thumb: m.thumb ?? null
  }
}

async function plexJson<T>(server: ServerContext, url: URL, method = 'GET'): Promise<T> {
  const res = await plexFetch(url, { method, headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Plex ${method} ${url.pathname} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

async function plexSend(server: ServerContext, url: URL, method: string): Promise<void> {
  const res = await plexFetch(url, { method, headers: plexHeaders(server.token) })
  if (!res.ok) throw new Error(`Plex ${method} ${url.pathname} failed: ${res.status} ${await res.text()}`)
}

function metadataUri(server: ServerContext, ratingKeys: string[]): string {
  return `server://${server.id}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`
}

// PMS builds differ on whether this endpoint returns Metadata or Directory
// rows; accept either. A music section can also hold artist-grain
// collections — keep only album-grain ones (missing subtype = old server,
// assume album).
export async function listCollections(
  server: ServerContext,
  sectionKey: string
): Promise<PlexCollection[]> {
  const url = new URL(`${server.baseUrl}/library/sections/${sectionKey}/collections`)
  const json = await plexJson<{
    MediaContainer: { Metadata?: CollectionMeta[]; Directory?: CollectionMeta[] }
  }>(server, url)
  const rows = json.MediaContainer.Metadata ?? json.MediaContainer.Directory ?? []
  return rows.filter((m) => (m.subtype ?? 'album') === 'album').map(parseCollection)
}

// Creating with no albums makes an empty crate. PMS builds disagree on how
// an empty create is spelled — some accept the POST with no `uri` at all,
// others want a uri with a bare metadata path — so try the former and fall
// back to the latter.
export async function createCollection(
  server: ServerContext,
  sectionKey: string,
  title: string,
  albumRatingKeys: string[]
): Promise<PlexCollection> {
  const makeUrl = (uri: string | null): URL => {
    const url = new URL(`${server.baseUrl}/library/collections`)
    url.searchParams.set('type', '9')
    url.searchParams.set('smart', '0')
    url.searchParams.set('sectionId', sectionKey)
    url.searchParams.set('title', title)
    if (uri !== null) url.searchParams.set('uri', uri)
    return url
  }
  const attempts =
    albumRatingKeys.length > 0
      ? [makeUrl(metadataUri(server, albumRatingKeys))]
      : [makeUrl(null), makeUrl(metadataUri(server, []))]
  let lastErr: unknown = null
  for (const url of attempts) {
    try {
      const json = await plexJson<{ MediaContainer: { Metadata?: CollectionMeta[] } }>(
        server,
        url,
        'POST'
      )
      const meta = json.MediaContainer.Metadata?.[0]
      if (!meta) throw new Error('Plex returned no collection metadata on create')
      return parseCollection(meta)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function addToCollection(
  server: ServerContext,
  ratingKey: string,
  albumRatingKeys: string[]
): Promise<void> {
  const url = new URL(`${server.baseUrl}/library/collections/${ratingKey}/items`)
  url.searchParams.set('uri', metadataUri(server, albumRatingKeys))
  await plexSend(server, url, 'PUT')
}

export async function removeFromCollection(
  server: ServerContext,
  ratingKey: string,
  albumRatingKey: string
): Promise<void> {
  await plexSend(
    server,
    new URL(`${server.baseUrl}/library/collections/${ratingKey}/children/${albumRatingKey}`),
    'DELETE'
  )
}

// Deletes the collection itself — the albums in it are untouched.
export async function deleteCollection(server: ServerContext, ratingKey: string): Promise<void> {
  await plexSend(server, new URL(`${server.baseUrl}/library/collections/${ratingKey}`), 'DELETE')
}
