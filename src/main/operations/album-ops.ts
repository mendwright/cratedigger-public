/**
 * Orchestration logic for album-level operations that were previously embedded
 * as anonymous closures inside registerIpc(). Extracted here so they can be
 * unit-tested without spinning up an Electron IPC environment.
 */

import { getAlbumDetail, getAlbumTrackFiles } from '../plex/library.js'
import { invalidateAlbumCredits } from '../musicbrainz.js'
import { appendDeletedAlbum } from '../store.js'
import { deleteMusicAlbum } from '../tagger.js'
import { firstMbid } from '../../shared/guid.js'
import type { ServerContext } from '../../shared/plex.js'
import type { DeletedAlbum } from '../../shared/plex.js'

// ---------------------------------------------------------------------------
// Shared utility
// ---------------------------------------------------------------------------

/**
 * Smallest directory that contains every file in `paths`. Used to find the
 * album's source folder on the tagger NFS mount given Plex's per-track paths.
 * Walks segment-by-segment until they diverge — handles single-folder albums
 * (single dir) and multi-disc albums (the parent of the disc subdirs).
 */
export function commonParentDir(paths: string[]): string | null {
  if (paths.length === 0) return null
  const segs = paths.map((p) => p.split('/'))
  // Filename is always the last segment, so cap at the shortest path's
  // length-1 to never include a filename in the prefix.
  const maxLen = Math.min(...segs.map((s) => s.length)) - 1
  let i = 0
  for (; i < maxLen; i++) {
    const head = segs[0][i]
    if (!segs.every((s) => s[i] === head)) break
  }
  if (i === 0) return null
  return segs[0].slice(0, i).join('/')
}

// ---------------------------------------------------------------------------
// deleteAlbum
// ---------------------------------------------------------------------------

export interface DeleteAlbumArgs {
  serverId: string
  ratingKey: string
  reason: string | null
}

/**
 * Gather track files, build a DeletedAlbum record, unlink files via the
 * tagger service, validate the response, append to the deleted-albums log,
 * and invalidate the credits cache.
 *
 * Returns the DeletedAlbum entry on success; throws on any failure.
 */
export async function deleteAlbum(
  ctx: ServerContext,
  args: DeleteAlbumArgs
): Promise<DeletedAlbum> {
  const [detail, files] = await Promise.all([
    getAlbumDetail(ctx, args.ratingKey),
    getAlbumTrackFiles(ctx, args.ratingKey)
  ])
  if (files.length === 0) throw new Error('No track files found for album')
  const mbid = firstMbid(detail.guids)
  const entry: DeletedAlbum = {
    deletedAt: Date.now(),
    ratingKey: detail.album.ratingKey,
    title: detail.album.title,
    artist: detail.album.artist,
    year: detail.album.year,
    mbid,
    plexTrackCount: detail.tracks.length,
    trackTitles: detail.tracks.map((t) => t.title),
    reason: args.reason
  }
  const result = await deleteMusicAlbum(files)
  console.log('[plex:delete-album] tagger response:', {
    rk: args.ratingKey,
    requested: files.length,
    deleted: result.deleted.length,
    missing: result.missing.length,
    errors: result.errors.length,
    plex: result.plex,
    firstError: result.errors[0] ?? null,
    samplePath: files[0] ?? null,
    firstMissing: result.missing[0] ?? null
  })
  // Hardened: tagger returns ok:true with empty `deleted` when it can't
  // resolve any of the host paths Plex gave us (NFS mount mismatch, host_root
  // misconfig, perms). It marks them all "missing" because the mapped
  // container path doesn't exist — but the files are still there from
  // Plex's POV. Any zero-deleted outcome is a failure; never optimistically
  // remove the row.
  if (!result.ok || result.errors.length > 0) {
    const first = result.errors[0]
    const msg = first
      ? `${first.path}: ${first.error}`
      : 'tagger delete failed'
    throw new Error(`Album delete failed: ${msg}`)
  }
  if (result.deleted.length === 0) {
    // The tagger unlinked nothing. Two causes it can't tell apart on its own:
    // (a) the files are genuinely gone — the user deleted them on disk before
    // clicking, so the album SHOULD be removed; or (b) the tagger's mount /
    // prefix is misconfigured and the files are still there, in which case we
    // must NOT optimistically drop the row. Disambiguate by asking Plex: the
    // tagger already triggered a scan + emptyTrash, so if Plex has lost the
    // album the files really were gone. Only then treat the delete as having
    // succeeded — otherwise surface the mount-misconfig error as before.
    const gone = result.plex?.ok ? await albumGoneFromPlex(ctx, args.ratingKey) : false
    if (!gone) {
      throw new Error(
        `Album delete failed: tagger unlinked 0 of ${files.length} files (${result.missing.length} reported missing). Likely a path mapping or NFS mount issue — check tagger host_root config.`
      )
    }
    // Files were already gone and Plex has dropped the album: record it and
    // fall through to the same bookkeeping as a normal delete.
    appendDeletedAlbum(entry)
    await invalidateAlbumCredits(args.ratingKey)
    return entry
  }
  if (result.plex && !result.plex.ok) {
    throw new Error(
      `Files unlinked but Plex refresh failed: ${result.plex.reason ?? 'unknown'}`
    )
  }
  appendDeletedAlbum(entry)
  await invalidateAlbumCredits(args.ratingKey)
  return entry
}

/**
 * After a delete the tagger triggers a Plex scan + emptyTrash. Poll Plex to
 * confirm the album is actually gone — used to distinguish "files were already
 * deleted on disk" (album disappears) from "tagger mount misconfigured" (files
 * still present, album stays). "Gone" = the album's metadata 404s or it no
 * longer lists any track files. Polls briefly to ride out emptyTrash latency;
 * returns false (treat as failure) if the album is still there when we give up.
 */
async function albumGoneFromPlex(ctx: ServerContext, ratingKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const remaining = await getAlbumTrackFiles(ctx, ratingKey)
      if (remaining.length === 0) return true
    } catch {
      // Metadata fetch failed (typically 404) — the album record is gone.
      return true
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

