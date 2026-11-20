/*
 * Hands-free inbox import for Soulseek acquisitions.
 *
 * Every acquisition already carries the MusicBrainz release it was matched
 * against at search time. Once reconcileAcquisitions marks a job 'downloaded'
 * with every file landed, there is usually nothing left for a human to do in
 * the Inbox: the tagger's reconciler will map files to tracks the same way the
 * search matcher did. So this module closes the loop — preview the apply, and
 * when the tagger reports a clean reconcile (file/track counts match, no
 * engine disagreement), commit it: tag, move into the library, refresh Plex.
 *
 * Anything short of clean is left exactly where it was — status 'downloaded',
 * folder in the Inbox for the manual flow — with the reason recorded on the
 * job (autoImportOutcome: 'needs-review'). The automation must never guess:
 * a wrong commit moves mistagged files into the library.
 *
 * Driven two ways: the renderer's 2.5s downloads poll (slskd:list-downloads,
 * which only runs while the soulseek screen is open) and a main-process timer
 * (startAutoImportLoop) so downloads that finish while the user is anywhere
 * else in the app — or nowhere near it — still get imported.
 */
import type { AcquisitionJob } from '../shared/acquisition.js'
import { getValue, setValue, getSlskdUrl, getTaggerUrl } from './store.js'
import { listInbox, getInboxFolder, applyRelease, deleteInboxFiles } from './tagger.js'
import { recordImport, reconcileAcquisitions } from './acquisitions.js'
import { listDownloads, removeDownload } from './slskd.js'
import { librarySnapshot } from './library-snapshot.js'
import { describeDuplicatePlan, planDuplicateDrops } from '../shared/inbox-dupes.js'

/** ~1 min of 2.5s polls: NFS + slskd's incomplete→downloads move can lag a
 *  few seconds after the transfer reports Succeeded, but not this long. */
const MAX_FOLDER_WAIT_ATTEMPTS = 24

/** Transient tagger/MB failures (503s, timeouts) re-queue the job for a later
 *  sweep this many times before giving up to manual review. */
const MAX_TRANSIENT_RETRIES = 5

/** A job that finished downloading this long ago isn't waiting on NFS lag —
 *  if its folder isn't in the inbox now, it never will be (someone imported
 *  or deleted it by hand). Resolve it on the first look instead of spending
 *  the folder-wait budget. */
const STALE_JOB_MS = 10 * 60_000

function leaf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/**
 * "Obviously complete": every enqueued file (audio and artwork alike) landed,
 * we know which MB release this is and how many tracks it should have, and the
 * auto-importer hasn't already taken it. A job with even one failed file stays
 * manual — partial folders are exactly what the Inbox review exists for.
 */
export function eligibleForAutoImport(job: AcquisitionJob): boolean {
  return (
    job.status === 'downloaded' &&
    job.releaseMbid !== null &&
    job.expectedTrackCount !== null &&
    job.files.length > 0 &&
    job.files.every((f) => f.status === 'downloaded') &&
    !job.autoImportAt
  )
}

function patchJob(id: string, patch: Partial<AcquisitionJob>): AcquisitionJob | null {
  const jobs = getValue('acquisitionJobs')
  const job = jobs.find((j) => j.id === id)
  if (!job) return null
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() }
  setValue('acquisitionJobs', jobs.map((j) => (j.id === id ? next : j)))
  return next
}

function needsReview(id: string, note: string): void {
  patchJob(id, {
    status: 'downloaded',
    autoImportOutcome: 'needs-review',
    autoImportNote: note
  })
}

/** After a committed import the slskd transfer records are dead history —
 *  same best-effort cleanup the manual Inbox flow does post-apply. */
async function cleanupSlskdDownloads(username: string, folderLeaf: string): Promise<void> {
  try {
    const dl = await listDownloads()
    for (const user of dl.users) {
      if (user.username !== username) continue
      for (const dir of user.directories) {
        if (leaf(dir.directory) !== folderLeaf) continue
        for (const file of dir.files) {
          try {
            await removeDownload(username, file.id)
          } catch {
            // best-effort: a single stuck record is not worth failing over
          }
        }
      }
    }
  } catch {
    // slskd unreachable — the records will still be there for manual cleanup
  }
}

/**
 * The downloaded folder is not in the inbox and won't be. If the album is
 * already in the library the job is done — imported by hand before the
 * automation looked. Otherwise leave it for review with the reason.
 */
async function resolveMissingFolder(job: AcquisitionJob, attempts: number): Promise<void> {
  const inLibrary = await librarySnapshot.findAlbum(job.artist, job.album).catch(() => null)
  const at = new Date().toISOString()
  if (inLibrary) {
    patchJob(job.id, {
      status: 'completed',
      completedAt: at,
      autoImportAt: at,
      autoImportAttempts: attempts,
      autoImportOutcome: 'in-library',
      autoImportNote: 'already in the library — imported by hand'
    })
    return
  }
  patchJob(job.id, {
    autoImportAt: at,
    autoImportAttempts: attempts,
    autoImportOutcome: 'needs-review',
    autoImportNote: 'downloaded, but the folder never appeared in the tagger inbox'
  })
}

async function autoImportJob(job: AcquisitionJob): Promise<void> {
  const folderLeaf = leaf(job.folder)
  const mbid = job.releaseMbid
  if (!mbid) return

  // The tagger sees slskd's download dir as /inbox; the local folder is named
  // after the remote folder's leaf. If it hasn't shown up yet, wait a few
  // polls (NFS lag) before giving up to manual.
  let inboxFolder
  try {
    const folders = await listInbox()
    inboxFolder = folders.find((f) => f.folder === folderLeaf)
  } catch (err) {
    // tagger unreachable — retry on a later sweep, don't burn attempts
    console.warn('[auto-import] inbox listing failed:', err instanceof Error ? err.message : err)
    return
  }
  if (!inboxFolder) {
    const attempts = (job.autoImportAttempts ?? 0) + 1
    const stale = Date.now() - Date.parse(job.updatedAt) > STALE_JOB_MS
    if (attempts >= MAX_FOLDER_WAIT_ATTEMPTS || stale) {
      await resolveMissingFolder(job, attempts)
    } else {
      patchJob(job.id, { autoImportAttempts: attempts })
    }
    return
  }

  // Two grabs of the same folder, or a peer sharing FLAC and Opus side by
  // side, leave provably redundant files that would fail the count check.
  // Drop them first so the reconcile sees one file per track. Only the
  // name-level rules apply here (see inbox-dupes.ts) — anything subtler is
  // for the AcoustID dedupe or the human.
  let dedupeNote: string | null = null
  const plan = planDuplicateDrops(inboxFolder.files)
  if (plan.drop.length > 0) {
    try {
      const deleted = await deleteInboxFiles(inboxFolder.folder, plan.drop.map((d) => d.path))
      if (deleted.deleted.length > 0) {
        dedupeNote = `dropped ${describeDuplicatePlan(plan)}`
        inboxFolder = await getInboxFolder(inboxFolder.folder)
      }
    } catch (err) {
      console.warn('[auto-import] dedupe failed:', err instanceof Error ? err.message : err)
    }
  }
  const withDedupe = (note: string | null): string | null =>
    dedupeNote && note ? `${dedupeNote}; ${note}` : dedupeNote ?? note
  const reviewNote = (note: string): string => withDedupe(note) ?? note

  // Take the job before the long tagger/MB calls so overlapping sweeps (or an
  // app restart mid-import) can't run the same folder twice.
  const taken = patchJob(job.id, {
    status: 'processing',
    autoImportAt: new Date().toISOString(),
    autoImportAttempts: job.autoImportAttempts ?? 0
  })
  if (!taken) return

  try {
    const preview = await applyRelease({
      folder: inboxFolder.path,
      mbid,
      mode: 'preview',
      refresh_plex: false
    })
    if (!preview.ok) {
      needsReview(job.id, reviewNote(preview.reason || 'tagger refused the preview'))
      return
    }
    if (preview.mode !== 'preview') {
      // Server treated our preview as a commit (legacy default). It has
      // already moved files, so record it rather than pretend it didn't.
      recordImport(inboxFolder.path, mbid, preview)
      patchJob(job.id, { autoImportOutcome: 'imported', autoImportNote: dedupeNote })
      void cleanupSlskdDownloads(job.username, folderLeaf)
      return
    }
    if (!preview.clean || preview.file_count !== preview.total_tracks) {
      const bits: string[] = []
      if (preview.file_count !== preview.total_tracks) {
        bits.push(`${preview.file_count} files for a ${preview.total_tracks}-track release`)
      }
      const disagree = preview.rows.filter((r) => r.disagree).length
      if (disagree > 0) bits.push(`matcher and AcoustID disagree on ${disagree}`)
      needsReview(job.id, reviewNote(bits.join('; ') || 'reconcile was not clean'))
      return
    }

    // Clean preview: commit without decisions — the server re-derives the
    // same auto mapping it just previewed.
    const result = await applyRelease({
      folder: inboxFolder.path,
      mbid,
      mode: 'commit',
      refresh_plex: true
    })
    if (!result.ok) {
      needsReview(job.id, reviewNote(result.reason || 'tagger refused the commit'))
      return
    }
    if (result.mode === 'preview') {
      needsReview(job.id, reviewNote('reconcile turned dirty between preview and commit'))
      return
    }
    recordImport(inboxFolder.path, mbid, result)
    patchJob(job.id, {
      autoImportOutcome: 'imported',
      autoImportNote: withDedupe(
        result.plex && result.plex.ok === false ? 'imported, but the Plex refresh failed' : null
      )
    })
    void cleanupSlskdDownloads(job.username, folderLeaf)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // A busy MusicBrainz (503s), a wedged tagger, or a network blip is not a
    // verdict on the folder — put the job back for a later sweep instead of
    // condemning it to manual review. Bounded by the shared attempts counter
    // so a persistently failing folder still lands in needs-review.
    const transient = /503|timed? ?out|busy|fetch failed|ECONN|network|aborted/i.test(msg)
    const attempts = (job.autoImportAttempts ?? 0) + 1
    if (transient && attempts < MAX_TRANSIENT_RETRIES) {
      patchJob(job.id, {
        status: 'downloaded',
        autoImportAt: null,
        autoImportAttempts: attempts
      })
    } else {
      needsReview(job.id, reviewNote(msg))
    }
  }
}

let sweeping = false
let loopTimer: ReturnType<typeof setInterval> | null = null

/**
 * Background driver: every 15s, when slskd + tagger are configured and there
 * is anything to move forward (transfers still downloading, or downloaded jobs
 * the sweep can take), reconcile against slskd and sweep. Idle when there
 * isn't — the tick is two store reads.
 */
export function startAutoImportLoop(): void {
  if (loopTimer) return
  // Recover jobs the previous run left mid-import (app quit between taking the
  // job and recording the result): put them back for another pass. If the
  // commit actually landed before the quit, the folder is gone from the inbox,
  // so the retry resolves to needs-review instead of double-applying.
  const jobs = getValue('acquisitionJobs')
  if (jobs.some((j) => j.status === 'processing' && j.autoImportAt)) {
    setValue(
      'acquisitionJobs',
      jobs.map((j) =>
        j.status === 'processing' && j.autoImportAt
          ? { ...j, status: 'downloaded' as const, autoImportAt: null }
          : j
      )
    )
  }
  loopTimer = setInterval(() => void autoImportTick(), 15_000)
}

async function autoImportTick(): Promise<void> {
  if (!getSlskdUrl() || !getTaggerUrl()) return
  const jobs = getValue('acquisitionJobs')
  const downloading = jobs.some((j) => ['enqueueing', 'downloading'].includes(j.status))
  const importable = jobs.some(eligibleForAutoImport)
  if (!downloading && !importable) return
  if (downloading) {
    try {
      reconcileAcquisitions(await listDownloads())
    } catch {
      return // slskd unreachable — try again next tick
    }
  }
  sweepAutoImports()
}

/**
 * Fire-and-forget: called after every downloads reconcile. Serial on purpose —
 * each import is a couple of tagger calls (an MB fetch can take 20s cold), and
 * one at a time keeps the tagger and MB rate limits honest.
 */
export function sweepAutoImports(): void {
  if (sweeping) return
  const eligible = getValue('acquisitionJobs').filter(eligibleForAutoImport)
  if (eligible.length === 0) return
  sweeping = true
  console.log(`[auto-import] sweeping ${eligible.length} downloaded acquisition(s)`)
  void (async () => {
    try {
      for (const job of eligible) {
        await autoImportJob(job)
        const after = getValue('acquisitionJobs').find((j) => j.id === job.id)
        if (after?.autoImportOutcome) {
          console.log(
            `[auto-import] ${after.artist} — ${after.album}: ${after.autoImportOutcome}` +
              (after.autoImportNote ? ` (${after.autoImportNote})` : '')
          )
        }
      }
    } finally {
      sweeping = false
    }
  })()
}
