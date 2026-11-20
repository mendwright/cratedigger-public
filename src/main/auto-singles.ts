/*
 * Hands-free filing for playlist-gap grabs.
 *
 * "Queue all songs" on an imported playlist enqueues one Soulseek file per
 * missing track and registers each as a PendingSingle. This loop watches
 * slskd for those transfers to finish, finds the landed file in the tagger
 * inbox, and files it into the Singles bin via apply-single — the same call
 * the inbox's "single" button makes, with the playlist's own artist/title as
 * the tags so the next import matches it. Each filing is broadcast so the
 * renderer can refill the playlist.
 *
 * Deliberately narrow: a single is one file with a known destination. There
 * is no reconcile to get wrong, so unlike album auto-import there is no
 * "needs review" state — a single either lands or fails with a reason.
 */
import { BrowserWindow } from 'electron'
import type { PendingSingle, SingleFiledEvent } from '../shared/singles.js'
import { getValue, setValue, getSlskdUrl, getTaggerUrl } from './store.js'
import { listInbox, applySingle } from './tagger.js'
import { listDownloads, removeDownload } from './slskd.js'

/** ~2 min of 15s sweeps — NFS + slskd's incomplete→downloads move can lag,
 *  but a finished file that never shows up was moved or deleted by hand. */
const MAX_INBOX_ATTEMPTS = 8
/** A queued single nobody has heard from in this long is abandoned — the
 *  peer never came back. Keeps the pending list from growing forever. */
const STALE_QUEUED_MS = 3 * 24 * 60 * 60_000
/** Cap on the persisted log; filed/failed records fall off the back. */
const MAX_RECORDS = 500

function leaf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function remoteDir(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function broadcastFiled(payload: SingleFiledEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('singles:filed', payload)
  }
}

function patch(id: string, p: Partial<PendingSingle>): void {
  const now = new Date().toISOString()
  setValue(
    'pendingSingles',
    getValue('pendingSingles').map((s) => (s.id === id ? { ...s, ...p, updatedAt: now } : s))
  )
}

/** Register a freshly enqueued gap grab. Re-queuing the same remote file for
 *  the same playlist replaces the old record rather than doubling it. */
export function trackSingle(args: {
  playlistId: string
  artist: string
  title: string
  username: string
  filename: string
  size: number
}): PendingSingle {
  const now = new Date().toISOString()
  const rec: PendingSingle = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...args,
    status: 'queued',
    note: null,
    queuedAt: now,
    updatedAt: now,
    filedAt: null
  }
  const rest = getValue('pendingSingles').filter(
    (s) =>
      !(
        s.playlistId === args.playlistId &&
        s.username === args.username &&
        s.filename === args.filename &&
        s.status === 'queued'
      )
  )
  const settled = rest.filter((s) => s.status !== 'queued')
  const queued = rest.filter((s) => s.status === 'queued')
  // Trim settled history first so live records are never dropped.
  const keepSettled = Math.max(0, MAX_RECORDS - queued.length - 1)
  setValue('pendingSingles', [...settled.slice(-keepSettled), ...queued, rec])
  return rec
}

export function listSingles(): PendingSingle[] {
  return getValue('pendingSingles')
}

/** Drop settled records for a playlist (the report was removed) — queued
 *  ones keep going; their file is already on its way. */
export function forgetSinglesFor(playlistId: string): void {
  setValue(
    'pendingSingles',
    getValue('pendingSingles').filter((s) => s.playlistId !== playlistId || s.status === 'queued')
  )
}

type TransferState = { state: string; id: string }

function transferMap(
  downloads: Awaited<ReturnType<typeof listDownloads>>
): Map<string, TransferState> {
  const m = new Map<string, TransferState>()
  for (const user of downloads.users) {
    for (const dir of user.directories) {
      for (const f of dir.files) m.set(`${user.username}\0${f.filename}`, { state: f.state, id: f.id })
    }
  }
  return m
}

async function fileSingle(rec: PendingSingle, transferId: string | null): Promise<void> {
  let folders
  try {
    folders = await listInbox()
  } catch (err) {
    console.warn('[auto-singles] inbox listing failed:', err instanceof Error ? err.message : err)
    return // tagger unreachable — try again next sweep, don't burn attempts
  }
  const fileLeaf = leaf(rec.filename)
  const dirLeaf = remoteDir(rec.filename)
  // slskd lands the file under a folder named after the remote directory's
  // leaf; match folder AND file name so two peers' identically named rips
  // never cross.
  const folder =
    folders.find((f) => f.folder === dirLeaf && f.files.some((x) => x.name === fileLeaf)) ??
    folders.find((f) => f.files.some((x) => x.name === fileLeaf))
  const file = folder?.files.find((x) => x.name === fileLeaf)
  if (!folder || !file) {
    const attempts = (rec.inboxAttempts ?? 0) + 1
    if (attempts >= MAX_INBOX_ATTEMPTS) {
      patch(rec.id, {
        status: 'failed',
        inboxAttempts: attempts,
        note: 'downloaded, but the file never appeared in the tagger inbox'
      })
    } else {
      patch(rec.id, { inboxAttempts: attempts })
    }
    return
  }
  try {
    const result = await applySingle({
      folderName: folder.folder,
      filename: file.name,
      artist: rec.artist,
      title: rec.title,
      recordingMbid: file.tags.musicbrainz_trackid ?? null
    })
    const plexNote =
      result.plex && result.plex.ok === false ? 'filed, but the Plex refresh failed' : null
    patch(rec.id, { status: 'filed', filedAt: new Date().toISOString(), note: plexNote })
    console.log(`[auto-singles] filed ${rec.artist} — ${rec.title}`)
    broadcastFiled({ playlistId: rec.playlistId, artist: rec.artist, title: rec.title })
    if (transferId) {
      try {
        await removeDownload(rec.username, transferId)
      } catch {
        // dead transfer record — manual cleanup at worst
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Busy tagger / MB / network: not a verdict on the file. Bounded by the
    // same attempts counter so a persistently failing file still settles.
    const transient = /503|timed? ?out|busy|fetch failed|ECONN|network|aborted/i.test(msg)
    const attempts = (rec.inboxAttempts ?? 0) + 1
    if (transient && attempts < MAX_INBOX_ATTEMPTS) {
      patch(rec.id, { inboxAttempts: attempts })
    } else {
      patch(rec.id, { status: 'failed', note: msg })
    }
  }
}

let sweeping = false
let loopTimer: ReturnType<typeof setInterval> | null = null

/** One pass over the queued singles. Exported for tests; the loop calls it. */
export async function sweepSingles(now: number = Date.now()): Promise<void> {
  if (sweeping) return
  const queued = getValue('pendingSingles').filter((s) => s.status === 'queued')
  if (queued.length === 0) return
  sweeping = true
  try {
    let transfers: Map<string, TransferState>
    try {
      transfers = transferMap(await listDownloads())
    } catch {
      return // slskd unreachable — next sweep
    }
    for (const rec of queued) {
      const t = transfers.get(`${rec.username}\0${rec.filename}`)
      const state = t?.state.toLowerCase() ?? ''
      if (state.includes('succeeded')) {
        await fileSingle(rec, t?.id ?? null)
      } else if (
        state.includes('errored') ||
        state.includes('rejected') ||
        state.includes('cancelled') ||
        state.includes('timedout') ||
        state.includes('aborted')
      ) {
        patch(rec.id, { status: 'failed', note: `Soulseek transfer ${t!.state}` })
      } else if (!t && now - Date.parse(rec.queuedAt) > STALE_QUEUED_MS) {
        patch(rec.id, { status: 'failed', note: 'transfer gone from slskd' })
      } else if (!t && (rec.inboxAttempts ?? 0) > 0) {
        // We already saw it succeed and the record has since been cleared
        // from slskd (cleanup, or the folder landed late) — keep looking in
        // the inbox rather than waiting on a transfer that won't return.
        await fileSingle(rec, null)
      }
    }
  } finally {
    sweeping = false
  }
}

/** Every 15s while slskd + tagger are configured and anything is queued. */
export function startAutoSinglesLoop(): void {
  if (loopTimer) return
  loopTimer = setInterval(() => {
    if (!getSlskdUrl() || !getTaggerUrl()) return
    void sweepSingles()
  }, 15_000)
}
