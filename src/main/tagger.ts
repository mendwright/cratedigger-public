import { getTaggerUrl, getTaggerApiKey } from './store.js'
import type {
  ApplyOrPreviewResult,
  ApplyRequest,
  AuditResponse,
  InboxFolder,
  MbCanonicalRelease,
  PrefingerprintResponse,
  RetagRequest,
  TaggerHealth
} from '../shared/tagger.js'
import type { AcousticIdentification } from '../shared/tagger.js'

function base(): string {
  return getTaggerUrl().replace(/\/$/, '')
}

function authHeaders(): Record<string, string> {
  const key = getTaggerApiKey()
  return key ? { 'X-API-Key': key } : {}
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base()}${path}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`tagger ${path}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {})
  })
  if (!r.ok) throw new Error(`tagger ${path}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

export function taggerHealth(): Promise<TaggerHealth> {
  return getJson<TaggerHealth>('/health')
}

export async function listInbox(): Promise<InboxFolder[]> {
  const r = await getJson<{ folders: InboxFolder[] }>('/inbox')
  return r.folders
}

export function getInboxFolder(name: string): Promise<InboxFolder> {
  return getJson<InboxFolder>(`/inbox/${encodeURIComponent(name)}`)
}

export function getMbRelease(mbid: string): Promise<MbCanonicalRelease> {
  return getJson<MbCanonicalRelease>(`/mb/release/${encodeURIComponent(mbid)}`)
}

export function applyRelease(req: ApplyRequest): Promise<ApplyOrPreviewResult> {
  return postJson<ApplyOrPreviewResult>('/apply', req)
}

export function retagAlbums(req: RetagRequest): Promise<ApplyOrPreviewResult> {
  return postJson<ApplyOrPreviewResult>('/music/retag', req)
}

export function prefingerprintInbox(name: string): Promise<PrefingerprintResponse> {
  return postJson<PrefingerprintResponse>(
    `/inbox/${encodeURIComponent(name)}/prefingerprint`,
    {}
  )
}

/** Read-only identification of library audio. The service validates every
 * path against its configured Plex/music roots before opening it. */
export function identifyMusicFiles(paths: string[]): Promise<AcousticIdentification[]> {
  return postJson<{ results: AcousticIdentification[] }>('/acoustic/identify', { paths })
    .then((r) => r.results)
}

// Walks /music, returns each album where on-disk audio durations disagree
// with the MB tracks the files are tagged as. Heavy — one MB lookup per
// unique release MBID, deduped by the service. Caller surfaces a progress
// hint while it runs.
export function auditMusic(): Promise<AuditResponse> {
  return getJson<AuditResponse>('/audit/music')
}

export function refreshPlex(): Promise<{ ok: boolean; reason?: string; scoped?: boolean }> {
  return postJson<{ ok: boolean; reason?: string; scoped?: boolean }>('/plex/refresh', {})
}

export async function deleteInboxFolder(name: string): Promise<{ ok: boolean; deleted: string }> {
  const r = await fetch(`${base()}/inbox/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeaders()
  })
  if (!r.ok) throw new Error(`tagger delete /inbox/${name}: ${r.status} ${await r.text()}`)
  return (await r.json()) as { ok: boolean; deleted: string }
}

export interface ApplySingleResult {
  ok: boolean
  dst: string
  plex?: { ok: boolean; reason?: string }
}

// File ONE track into the Singles bin (album="Singles" per artist) — for
// playlist-gap grabs that shouldn't become 1-track albums in the crate.
export function applySingle(args: {
  folderName: string
  filename: string
  artist: string
  title: string
  recordingMbid?: string | null
}): Promise<ApplySingleResult> {
  return postJson<ApplySingleResult>(
    `/inbox/${encodeURIComponent(args.folderName)}/apply-single`,
    {
      filename: args.filename,
      artist: args.artist,
      title: args.title,
      recording_mbid: args.recordingMbid ?? null
    }
  )
}

export interface DeleteFilesResult {
  ok: boolean
  deleted: string[]
  missing: string[]
  errors: { path: string; error: string }[]
}

export function deleteInboxFiles(name: string, paths: string[]): Promise<DeleteFilesResult> {
  return postJson<DeleteFilesResult>(
    `/inbox/${encodeURIComponent(name)}/delete-files`,
    { paths }
  )
}

export interface AcousticDedupeGroup {
  recording_mbid: string
  keep: string
  drop: string[]
  scores: Record<string, number>
}

export interface AcousticDedupeResult {
  folder: string
  file_count: number
  groups: AcousticDedupeGroup[]
  to_delete: string[]
  to_keep: string[]
  unfingerprinted: string[]
}

export function acousticDedupeInbox(name: string): Promise<AcousticDedupeResult> {
  return postJson<AcousticDedupeResult>(
    `/inbox/${encodeURIComponent(name)}/acoustic-dedupe`,
    {}
  )
}

export interface DeleteAlbumFilesResult {
  ok: boolean
  deleted: string[]
  missing: string[]
  errors: { path: string; error: string }[]
  pruned_dirs: string[]
  plex?: { ok: boolean; reason?: string; scoped?: boolean; path?: string | null }
}

export function deleteMusicAlbum(
  paths: string[],
  refreshPlex = true
): Promise<DeleteAlbumFilesResult> {
  return postJson<DeleteAlbumFilesResult>('/music/delete-album', {
    paths,
    refresh_plex: refreshPlex
  })
}
