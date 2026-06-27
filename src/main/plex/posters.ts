import type { PlexPoster, ServerContext } from '../../shared/plex.js'
import { parseImageDims, shortSide, type ImageDims } from '../../shared/image-dims.js'
import { plexFetch } from './http.js'
import { plexHeaders } from './headers.js'

// Plex album poster management — the only write surface the Art Fixer touches.
// Uses plexHeaders (full client-identity headers) like cast.ts — Plex 401s the
// poster PUT/POST writes when only a bare X-Plex-Token is sent, even though the
// GET list is fine without the device headers. See HANDOFF §3 for the API
// mechanics and the gotchas baked in below.

function headers(ctx: ServerContext): Record<string, string> {
  return plexHeaders(ctx.token)
}

interface RawPhoto {
  key?: string
  ratingKey?: string
  provider?: string
  selected?: boolean | number | string
  thumb?: string
}

interface PostersContainer {
  MediaContainer: {
    size?: number
    Metadata?: RawPhoto[]
  }
}

// Pure mapping of the /posters JSON into our shape. Exported for unit testing
// (Plex's `selected` arrives as 1/0, "1"/"0", or a boolean across versions).
export function parsePostersResponse(json: PostersContainer): PlexPoster[] {
  const rows = json?.MediaContainer?.Metadata ?? []
  const out: PlexPoster[] = []
  for (const p of rows) {
    const ratingKey = p.ratingKey ?? ''
    const key = p.key ?? ''
    if (!ratingKey && !key) continue
    out.push({
      key,
      ratingKey: ratingKey || key,
      provider: p.provider ?? 'unknown',
      selected: p.selected === true || p.selected === 1 || p.selected === '1'
    })
  }
  return out
}

export async function listAlbumPosters(ctx: ServerContext, rk: string): Promise<PlexPoster[]> {
  const url = `${ctx.baseUrl}/library/metadata/${rk}/posters`
  const res = await plexFetch(url, { headers: headers(ctx) })
  if (!res.ok) throw new Error(`posters list failed: ${res.status}`)
  const json = (await res.json()) as PostersContainer
  return parsePostersResponse(json)
}

/**
 * Select an existing poster option.
 *
 * `posterRatingKey` MUST be the Photo's `ratingKey` (`metadata://posters/<hash>`),
 * not its `key`. Passing the `key` returns HTTP 200 but is a silent no-op — the
 * selection doesn't move (HANDOFF §3b). Verify by re-GETting if in doubt.
 */
export async function selectAlbumPoster(
  ctx: ServerContext,
  rk: string,
  posterRatingKey: string
): Promise<void> {
  const url = `${ctx.baseUrl}/library/metadata/${rk}/poster?url=${encodeURIComponent(posterRatingKey)}`
  const res = await plexFetch(url, { method: 'PUT', headers: headers(ctx) })
  if (res.status === 401) throw new Error('poster select failed: 401 — add a Plex admin token in Settings (or sign in as the server owner) to edit cover art')
  if (!res.ok) throw new Error(`poster select failed: ${res.status}`)
}

/**
 * Add a remote cover and select it. Plex downloads the image, adds it as a
 * `local` poster, and auto-selects it (HANDOFF §3c). Confirm by re-GETting and
 * measuring the now-selected one.
 */
export async function uploadAlbumPoster(
  ctx: ServerContext,
  rk: string,
  remoteUrl: string
): Promise<void> {
  const url = `${ctx.baseUrl}/library/metadata/${rk}/posters?url=${encodeURIComponent(remoteUrl)}`
  const res = await plexFetch(url, { method: 'POST', headers: headers(ctx) })
  // A 401 here means the signed-in Plex account can read but not edit this
  // server's library — sign in as the server owner/admin.
  if (res.status === 401) throw new Error('poster upload failed: 401 — add a Plex admin token in Settings (or sign in as the server owner) to edit cover art')
  if (!res.ok) throw new Error(`poster upload failed: ${res.status}`)
}

export interface MeasuredImage extends ImageDims {
  short: number
}

const PREFIX_BYTES = 131_072 // 128 KB — comfortably past any container header

// Read at most `max` bytes off the response body, then cancel the stream so we
// never pull a full multi-MB image just to read its header. Falls back to a
// bounded arrayBuffer slice when the body isn't a readable stream (test stubs).
async function readPrefix(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length > max ? buf.subarray(0, max) : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/**
 * Measure an image's native dimensions by range-fetching its header bytes.
 * `token` is sent as X-Plex-Token for Plex-hosted URLs and harmlessly ignored
 * by external CDNs (Deezer/iTunes/CAA). Returns null on any failure so callers
 * can skip an unmeasurable poster rather than abort a whole scan.
 */
export async function measureImage(url: string, token?: string): Promise<MeasuredImage | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const h: Record<string, string> = { Range: `bytes=0-${PREFIX_BYTES - 1}`, Accept: 'image/*' }
    if (token) h['X-Plex-Token'] = token
    const res = await fetch(url, { headers: h, signal: ctrl.signal })
    // 206 = range honoured; 200 = server ignored Range and is streaming the
    // whole file (readPrefix still stops early). Anything else is a miss.
    if (!res.ok && res.status !== 206) return null
    const prefix = await readPrefix(res, PREFIX_BYTES)
    const dims = parseImageDims(prefix)
    if (!dims) return null
    return { ...dims, short: shortSide(dims) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
