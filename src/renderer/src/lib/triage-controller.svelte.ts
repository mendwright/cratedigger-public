import type { PlexAlbum } from '../../../shared/plex'
import type { AuditFinding } from '../../../shared/tagger'
import { mbidFromGuid } from '../../../shared/guid'

type PlexApi = Window['cratedigger']['plex']
type TaggerApi = Window['cratedigger']['tagger']

type TriageFlag = 'no-year' | 'no-cover' | 'tracks-mismatch'

export interface TriageDeps {
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Ensure the full library is loaded (used by {@link TriageController.load}). */
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Current full-library snapshot, read synchronously by the MB track-count scan. */
  getAllAlbums: () => PlexAlbum[]
  /** Kick the duplicate-quality media scan when entering duplicates mode. The
   *  media-info subsystem (cache + scan) lives on MediaInfoController — this is
   *  the hook. */
  ensureDuplicatesMediaScan: () => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
  /** Tagger IPC. Defaults to the live bridge; tests pass a stub. */
  tagger?: TaggerApi
}

/**
 * Library triage, extracted from PlexState. Owns the three triage modes
 * ({@link mode}: flags / duplicates / mistagged) and their state: the flag
 * {@link filters}, the MB track-count {@link scan} + {@link mbTrackCounts} cache,
 * the {@link mistaggedScan} audit + per-album {@link mistaggedRepairs}, and the
 * persisted {@link dupDismissals} / {@link reviewedAlbums}. Components read
 * `plexState.triage.*`.
 *
 * Deliberately NOT here (stays on PlexState, injected/read directly):
 * - `deleteAlbumFromLibrary` + `deletedAlbums` — shared with AlbumDetail; mutate
 *   the core library caches.
 * - the media-info subsystem (MediaInfoController, `plexState.mediaInfo.*`) —
 *   serves album-card badges library-wide. The duplicate-quality scan is
 *   triggered via {@link TriageDeps.ensureDuplicatesMediaScan}.
 * - the pure duplicate-grouping logic — `src/shared/duplicates.ts`.
 */
export class TriageController {
  filters = $state<Set<TriageFlag>>(new Set(['no-year', 'no-cover', 'tracks-mismatch']))
  mode = $state<'flags' | 'duplicates' | 'mistagged'>('flags')
  loading = $state(false)
  error = $state<string | null>(null)

  // /audit/music findings — albums whose on-disk audio durations disagree with
  // the MB tracks they're tagged as (the merge-flow / blind-sort bug class).
  // Heavy scan; user runs it explicitly. Each finding carries a matcher-proposed
  // remap that we can one-click apply.
  mistaggedScan = $state<{
    running: boolean
    error: string | null
    scannedAt: number | null
    findings: AuditFinding[]
    scannedAlbums: number
    mbFetchFailures: string[]
  } | null>(null)
  // Per-album repair state: 'idle' | 'repairing' | 'done' | error string. Keyed
  // by the album's host path (e.g. /music/<root>/Artist/Album).
  mistaggedRepairs = $state<Record<string, 'idle' | 'repairing' | 'done' | { error: string }>>({})
  dupDismissals = $state<Set<string>>(new Set())
  reviewedAlbums = $state<Record<string, { reviewedAt: number; ignoredFlags: string[] }>>({})
  mbTrackCounts = $state<Record<string, number>>({})
  // MB track-count scan progress (flags mode); null when not running.
  // `failed` counts per-MBID lookups that threw and were skipped — surfaced in
  // the completion toast so a partial scan doesn't present itself as complete.
  scan = $state<{ running: boolean; total: number; done: number; failed: number } | null>(null)

  #deps: TriageDeps
  #plex: PlexApi
  #tagger: TaggerApi
  #scanCancel = false

  constructor(deps: TriageDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
    this.#tagger = deps.tagger ?? window.cratedigger.tagger
  }

  // Initial data load for the Triage view. (The deleted-albums log is loaded
  // separately by PlexState's openTriage, since it lives there.)
  async load(): Promise<void> {
    this.loading = true
    this.error = null
    try {
      await Promise.all([
        this.#deps.ensureAllAlbums(),
        this.refreshDupDismissals(),
        this.refreshReviewedAlbums(),
        this.refreshMbTrackCounts()
      ])
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  toggleFilter(f: TriageFlag): void {
    const next = new Set(this.filters)
    if (next.has(f)) next.delete(f)
    else next.add(f)
    this.filters = next
  }

  setMode(mode: 'flags' | 'duplicates' | 'mistagged'): void {
    this.mode = mode
    if (mode === 'duplicates') this.#deps.ensureDuplicatesMediaScan()
  }

  // --- duplicate-group dismissals (persisted) ---

  async refreshDupDismissals(): Promise<void> {
    try {
      const list = await this.#plex.listDupDismissals()
      this.dupDismissals = new Set(list)
    } catch {
      // non-fatal
    }
  }

  async dismissDupGroup(key: string): Promise<void> {
    try {
      const list = await this.#plex.addDupDismissal({ key })
      this.dupDismissals = new Set(list)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async restoreDupGroup(key: string): Promise<void> {
    try {
      const list = await this.#plex.removeDupDismissal({ key })
      this.dupDismissals = new Set(list)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  // --- reviewed/approved albums (persisted) ---

  async refreshReviewedAlbums(): Promise<void> {
    try {
      this.reviewedAlbums = await this.#plex.listReviewedAlbums()
    } catch {
      // non-fatal
    }
  }

  async markAlbumReviewed(ratingKey: string, currentFlags: string[]): Promise<void> {
    try {
      this.reviewedAlbums = await this.#plex.setReviewedAlbum({
        ratingKey,
        ignoredFlags: currentFlags
      })
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async unmarkAlbumReviewed(ratingKey: string): Promise<void> {
    try {
      this.reviewedAlbums = await this.#plex.clearReviewedAlbum({ ratingKey })
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  // --- MB track-count scan (flags mode: tracks-mismatch) ---

  async refreshMbTrackCounts(): Promise<void> {
    try {
      this.mbTrackCounts = await this.#plex.listReleaseTrackCounts()
    } catch {
      // non-fatal; scan still runs, just without a warm cache
    }
  }

  async runScan(): Promise<void> {
    if (this.scan?.running) return
    const albums = this.#deps.getAllAlbums()
    const targets: { ratingKey: string; mbid: string }[] = []
    for (const a of albums) {
      for (const g of a.guids) {
        const mbid = mbidFromGuid(g)
        if (mbid && this.mbTrackCounts[mbid] === undefined) {
          targets.push({ ratingKey: a.ratingKey, mbid })
          break
        }
      }
    }
    if (targets.length === 0) {
      this.#deps.flashToast('ok', 'MB cache already up to date')
      return
    }
    this.#scanCancel = false
    this.scan = { running: true, total: targets.length, done: 0, failed: 0 }
    try {
      for (const t of targets) {
        if (this.#scanCancel) break
        try {
          const count = await this.#plex.getReleaseTrackCount({ mbid: t.mbid })
          this.mbTrackCounts = { ...this.mbTrackCounts, [t.mbid]: count }
        } catch {
          // skip this one; keep scanning — but count it so the completion
          // toast doesn't present a partial scan as complete
          if (this.scan) this.scan = { ...this.scan, failed: this.scan.failed + 1 }
        }
        if (this.scan) {
          this.scan = { ...this.scan, done: this.scan.done + 1 }
        }
      }
    } finally {
      if (this.scan) {
        const { failed, total } = this.scan
        this.scan = { ...this.scan, running: false }
        if (failed > 0) {
          this.#deps.flashToast(
            'err',
            `MB scan finished — ${failed} of ${total} lookup${total === 1 ? '' : 's'} failed and ${failed === 1 ? 'was' : 'were'} skipped`
          )
        }
      }
    }
  }

  cancelScan(): void {
    this.#scanCancel = true
  }

  // --- mistagged audio audit (mistagged mode) ---

  // Walk the music library and surface albums where on-disk audio doesn't match
  // the embedded tags. Heavy — runs one MB lookup per unique release MBID
  // (deduped by the service). Caller shows a "scanning…" hint; we set
  // `running: true` and clear on the same shape so error and success states are
  // consistent.
  async runMistaggedScan(): Promise<void> {
    if (this.mistaggedScan?.running) return
    this.mistaggedScan = {
      running: true,
      error: null,
      scannedAt: this.mistaggedScan?.scannedAt ?? null,
      findings: this.mistaggedScan?.findings ?? [],
      scannedAlbums: this.mistaggedScan?.scannedAlbums ?? 0,
      mbFetchFailures: this.mistaggedScan?.mbFetchFailures ?? []
    }
    try {
      const r = await this.#tagger.auditMusic()
      if (!r.ok) throw new Error(r.reason || 'audit failed')
      this.mistaggedScan = {
        running: false,
        error: null,
        scannedAt: Date.now(),
        findings: r.findings ?? [],
        scannedAlbums: r.scanned_albums ?? 0,
        mbFetchFailures: r.mb_fetch_failures ?? []
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.mistaggedScan = {
        running: false,
        error: msg,
        scannedAt: this.mistaggedScan?.scannedAt ?? null,
        findings: this.mistaggedScan?.findings ?? [],
        scannedAlbums: this.mistaggedScan?.scannedAlbums ?? 0,
        mbFetchFailures: this.mistaggedScan?.mbFetchFailures ?? []
      }
    }
  }

  // One-click repair: call /music/retag with the matcher's proposed file_to_track
  // for an audited album. Uses the host path the audit already gave us (a
  // tagger-container path under /music) as the single source. After success,
  // drop the finding from the local list so the UI reflects the fix without a
  // full re-scan.
  async repairMistaggedAlbum(finding: AuditFinding): Promise<void> {
    const mapping = finding.proposed_mapping
    if (!mapping || finding.items.length === 0) return
    // Common parent of every audited file = the album dir on disk (in
    // tagger-container terms). Walks segment-by-segment until they diverge
    // (mirrors src/main/ipc.ts's commonParentDir; small enough to duplicate
    // rather than wire across the IPC boundary).
    const filePaths = finding.items.map((i) => i.path)
    const segs = filePaths.map((p) => p.split('/'))
    const maxLen = Math.min(...segs.map((s) => s.length)) - 1
    let i = 0
    for (; i < maxLen; i++) {
      const head = segs[0][i]
      if (!segs.every((s) => s[i] === head)) break
    }
    if (i === 0) return
    const sourcePath = segs[0].slice(0, i).join('/')
    const key = sourcePath
    this.mistaggedRepairs = { ...this.mistaggedRepairs, [key]: 'repairing' }
    try {
      const fileToTrack: Record<string, number> = {}
      for (const [path, entry] of Object.entries(mapping)) {
        fileToTrack[path] = entry.track_index
      }
      // Resolve the library album so the main process can sync the manual
      // match override and bust the credit cache after the retag — files
      // mapping to different tracks can shift recording-level credits.
      const mbidLower = finding.release_mbid.toLowerCase()
      const ratingKey = this.#deps
        .getAllAlbums()
        .find((a) => a.guids.some((g) => mbidFromGuid(g) === mbidLower))?.ratingKey
      const result = await this.#tagger.retag({
        source_paths: [sourcePath],
        mbid: finding.release_mbid,
        file_to_track: fileToTrack,
        refresh_plex: true,
        dry_run: false,
        plexRatingKey: ratingKey
      })
      // Triage passes an explicit file_to_track (from the audit's matcher
      // proposal), so the server commits directly — preview-body refusal
      // shouldn't happen on this path. Treat it as an error if it does.
      if (result.ok && result.mode === 'preview') {
        this.mistaggedRepairs = {
          ...this.mistaggedRepairs,
          [key]: { error: 'service returned preview body unexpectedly' }
        }
        return
      }
      if (!result.ok) {
        const reason = result.reason || 'retag refused'
        this.mistaggedRepairs = { ...this.mistaggedRepairs, [key]: { error: reason } }
        return
      }
      this.mistaggedRepairs = { ...this.mistaggedRepairs, [key]: 'done' }
      // Drop the repaired album from the findings list so it stops showing up;
      // the user can re-run the scan to verify if they want.
      if (this.mistaggedScan) {
        this.mistaggedScan = {
          ...this.mistaggedScan,
          findings: this.mistaggedScan.findings.filter((f) => f !== finding)
        }
      }
      this.#deps.flashToast('ok', `Repaired: ${finding.albumartist} — ${finding.album}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.mistaggedRepairs = { ...this.mistaggedRepairs, [key]: { error: msg } }
    }
  }
}
