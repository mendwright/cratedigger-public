import type { MbReleaseCandidate, PlexAlbum } from '../../../shared/plex'

type PlexApi = Window['cratedigger']['plex']
import type {
  ApplyResult,
  InboxFile,
  InboxFolder,
  MbCanonicalRelease,
  PrefingerprintResponse,
  PreviewResponse,
  RowDecision,
  TaggerHealth
} from '../../../shared/tagger'
import { isValidMbid, mbidFromGuid } from '../../../shared/guid'
import { ReleaseMatcher } from './release-matcher.svelte'
import { performanceConflict } from './inbox-logic'
import type { Session } from './plex-state.svelte'

type TaggerApi = Window['cratedigger']['tagger']

/** Pre-flight completeness check for an inbox folder. Pure summary of what
 *  searchReleaseCandidates + pickBestCandidate would say, surfaced as a pill
 *  in the inbox list so the user can see "this folder has the right number
 *  of tracks for MB's idea of the album" without opening it. */
export type FolderCompleteness = {
  status: 'scanning' | 'complete' | 'incomplete' | 'unknown' | 'error'
  audioCount: number
  expectedCount: number | null
  bestMbid: string | null
  error?: string
}

/**
 * Rank MB release candidates for an inbox folder: exact track count and, when
 * file credits exist, at least one matching artist/performance credit qualify;
 * among those prefer US > worldwide > other country, Official status, no
 * disambiguation, then earliest date (original beats reissue), then lex mbid.
 * Pure; exported for testing.
 */
export function pickBestCandidate(
  candidates: MbReleaseCandidate[],
  fileCount: number,
  sourceCredits = ''
): MbReleaseCandidate | null {
  if (candidates.length === 0) return null
  const exact = candidates.filter((c) => c.trackCount === fileCount)
  if (exact.length === 0) return null
  const creditParts = sourceCredits
    .split(/[|;]/)
    .map((part) => normalizeCreditName(part))
    .filter((part) => part.length >= 4)
  // Track count only proves that an album has the same shape. When files
  // carry artist/performance credits, require at least one of them to agree
  // before auto-picking; unrelated six-track albums must remain choices.
  const creditMatched = creditParts.length > 0
    ? exact.filter((c) => {
        const candidateCredit = normalizeCreditName(c.artistName ?? '')
        return creditParts.some(
          (part) => candidateCredit.includes(part) || part.includes(candidateCredit)
        )
      })
    : exact
  if (creditMatched.length === 0) return null
  const score = (c: MbReleaseCandidate): number => {
    let s = 0
    const candidateCredit = normalizeCreditName(c.artistName ?? '')
    s += creditParts.filter((part) => candidateCredit.includes(part)).length * 500
    if (c.country === 'US') s += 100
    else if (c.country === 'XW') s += 40
    else if (c.country) s += 10
    if (c.status === 'Official') s += 25
    else if (!c.status) s += 5
    if (!c.disambiguation) s += 5
    return s
  }
  const ranked = [...creditMatched].sort((a, b) => score(b) - score(a))
  const topScore = score(ranked[0])
  const tied = ranked.filter((c) => score(c) === topScore)
  if (tied.length === 1) return tied[0]
  // Break score ties: earliest release date wins (original beats reissue),
  // then lex mbid for a deterministic fallback when dates also match.
  const sorted = [...tied].sort((a, b) => {
    const ad = a.date ?? '9999-99-99'
    const bd = b.date ?? '9999-99-99'
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.mbid < b.mbid ? -1 : a.mbid > b.mbid ? 1 : 0
  })
  return sorted[0]
}

function normalizeCreditName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The unanimous value of a tag across a folder's files, else the first
 *  non-empty value, else null. Pure; exported for testing. */
export function guessCommonTag(
  folder: InboxFolder,
  key: 'artist' | 'albumartist' | 'composer' | 'album'
): string | null {
  const vals = folder.files
    .map((f) => f.tags[key] ?? f.raw_tags?.[key]?.[0] ?? null)
    .filter((v): v is string => !!v)
  if (vals.length === 0) return null
  const first = vals[0]
  return vals.every((v) => v === first) ? first : first
}

/** Keep a near-complete embedded release when the files' embedded track IDs
 * prove they are a subset of it. This distinguishes a genuinely partial album
 * from a standalone disc incorrectly tagged with a huge parent box-set MBID. */
export function embeddedReleaseFitsFolder(
  folder: InboxFolder,
  release: MbCanonicalRelease
): boolean {
  if (release.tracks.length === folder.file_count) return true
  if (release.tracks.length < folder.file_count) return false
  if (folder.file_count / release.tracks.length < 0.75) return false

  const embeddedTrackIds = folder.files
    .map((file) => file.tags.musicbrainz_trackid?.trim().toLowerCase())
    .filter((id): id is string => !!id)
  if (embeddedTrackIds.length < Math.ceil(folder.file_count * 0.8)) return false
  const releaseTrackIds = new Set(
    release.tracks.flatMap((track) =>
      [track.track_mbid, track.recording_mbid]
        .filter((id): id is string => !!id)
        .map((id) => id.toLowerCase())
    )
  )
  return embeddedTrackIds.every((id) => releaseTrackIds.has(id))
}

/** Composer is the useful classical search key; performer credits are fallbacks. */
export function guessSearchArtist(folder: InboxFolder): string {
  const composer = guessCommonTag(folder, 'composer')
  const albumArtist = guessCommonTag(folder, 'albumartist')
  const artist = guessCommonTag(folder, 'artist')
  const hasClassicalCredits = folder.files.some((file) =>
    Object.keys(file.raw_tags ?? {}).some((key) =>
      ['conductor', 'orchestra'].includes(key.toLocaleLowerCase())
    )
  )
  // COMPOSER is useful for classical searches, but ordinary band releases
  // also carry songwriter tags. If album artist and track artist unanimously
  // identify the same act, that direct release credit outranks COMPOSER.
  const samePerformingAct =
    albumArtist && artist && normalizeCreditName(albumArtist) === normalizeCreditName(artist)
  const credit =
    composer && (hasClassicalCredits || !samePerformingAct)
      ? composer
      : (albumArtist ?? artist ?? composer ?? '')
  // Classical downloads commonly stuff the complete credit into one field.
  // MusicBrainz's quoted artist search expects one credited entity.
  return credit.split(/[|;]/)[0]?.trim() ?? ''
}

export function folderPerformanceCredits(folder: InboxFolder): string {
  const values = folder.files.flatMap((file) => [
    file.tags.artist,
    file.tags.albumartist,
    file.tags.composer,
    ...(file.raw_tags?.conductor ?? []),
    ...(file.raw_tags?.orchestra ?? [])
  ])
  return [...new Set(values.filter((value): value is string => !!value))].join(' | ')
}

/** A release ID is authoritative only when every file carries the same one.
 *  Some taggers write foreign integer ids into the MusicBrainz fields
 *  (MUSICBRAINZ_ALBUMID=1064174); anything that isn't a UUID is junk, not a
 *  hint — auto-picking it just throws a raw MB 400 at the user. */
export function unanimousReleaseMbid(folder: InboxFolder): string | null {
  if (folder.files.length === 0) return null
  const ids = folder.files.map(
    (file) => file.tags.musicbrainz_albumid ?? file.raw_tags?.musicbrainz_albumid?.[0] ?? null
  )
  const first = ids[0]
  return first && isValidMbid(first) && ids.every((id) => id === first) ? first : null
}

/** Seed per-file track decisions from a reconciler preview's default choices.
 *  "manual" rows are left unassigned (user must pick). Pure; exported for testing. */
export function decisionsFromPreview(preview: PreviewResponse): Record<string, RowDecision> {
  const out: Record<string, RowDecision> = {}
  for (const r of preview.rows) {
    if (r.default_choice === 'matcher' && r.matcher_pick) {
      out[r.path] = r.matcher_pick.track_index
    } else if (r.default_choice === 'acoustid' && r.acoustid_pick) {
      out[r.path] = r.acoustid_pick.track_index
    }
    // default_choice === "manual" leaves the row unassigned; user must pick a
    // track from the dropdown before commit.
  }
  return out
}

export interface InboxDeps {
  flashToast: (kind: 'ok' | 'err', text: string) => void
  session: () => Session | null
  ensureAllAlbums: () => Promise<PlexAlbum[]>
  /** Best-effort slskd cleanup after a successful apply/merge (Slice-1 seam). */
  removeSlskdDownloadsForFolder: (folderName: string) => void
  /** Tagger IPC. Defaults to the live bridge; tests pass a stub. */
  tagger?: TaggerApi
  /** Plex IPC — only used for MB release-candidate search in the completeness
   *  scan. Defaults to the live bridge; tests stub it. */
  plex?: PlexApi
}

/**
 * The slskd-download inbox / tagger flow, extracted from PlexState. Owns the
 * inbox {@link folders} list + service {@link health}, the open-folder detail
 * ({@link openFolder} + the MB {@link matcher} (a shared ReleaseMatcher) +
 * background {@link fingerprint}), and the pick→preview→apply reconciler
 * ({@link match}). Components read `plexState.inbox.*`.
 *
 * Flow: pick a slskd inbox folder → MB-match (auto-picks a confident candidate)
 * → reconciler preview (matcher + AcoustID side-by-side) → commit, which writes
 * tags + moves files into the library and (best-effort) clears the matching
 * slskd download. An inflow guard routes files into an existing Plex album when
 * one already carries the picked release MBID.
 *
 * openInbox/closeInbox stay on PlexState (view flip) and call {@link activate} /
 * {@link clearOpenFolder}.
 */
export class InboxController {
  folders = $state<InboxFolder[]>([])
  loading = $state(false)
  error = $state<string | null>(null)
  health = $state<TaggerHealth | null>(null)
  openFolder = $state<InboxFolder | null>(null)
  // Picker state (query, candidates, release, ...) lives on this matcher.
  // `match` (below) holds only the post-pick state — reconciler preview,
  // decisions, commit progress, existing-album guard.
  matcher = new ReleaseMatcher()
  match = $state<{
    folderPath: string
    preview: PreviewResponse | null
    decisions: Record<string, RowDecision>
    matchHint: string | null
    applying: boolean
    applyError: string | null
    result: ApplyResult | null
    existingAlbum: PlexAlbum | null
  } | null>(null)
  // Per-folder fingerprint status. Keyed by folder path so reopening a
  // previously-fingerprinted folder shows "ready" instantly.
  fingerprint = $state<{
    folderPath: string
    status: 'running' | 'ready' | 'error'
    error: string | null
    summary: PrefingerprintResponse | null
  } | null>(null)

  // Pre-flight completeness map: folder path → status pill data. Filled in
  // the background after refresh(); keyed by folder path so reopening or
  // refreshing the list keeps any matches we already resolved. Cleared on
  // refresh start so stale results from a folder that was deleted don't
  // ghost. Surfaced in the inbox list as a green/amber pill.
  completeness = $state<Record<string, FolderCompleteness>>({})
  completenessScanning = $state(false)
  // Bumped on each refresh; an in-flight scan checks this so a refresh
  // mid-scan abandons its remaining lookups cleanly.
  #scanGen = 0

  #deps: InboxDeps
  #tagger: TaggerApi
  #plex: PlexApi

  constructor(deps: InboxDeps) {
    this.#deps = deps
    this.#tagger = deps.tagger ?? window.cratedigger.tagger
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  // Driven by PlexState's openInbox view-flip wrapper.
  async activate(): Promise<void> {
    void this.refreshHealth()
    await this.refresh()
  }

  // Driven by PlexState's closeInbox view-flip wrapper.
  clearOpenFolder(): void {
    this.openFolder = null
    this.match = null
  }

  async refreshHealth(): Promise<void> {
    try {
      this.health = await this.#tagger.health()
    } catch (err) {
      this.health = null
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  async refresh(): Promise<void> {
    this.loading = true
    this.error = null
    try {
      this.folders = await this.#tagger.listInbox()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
    // Kick off the completeness pre-check in the background. Each folder is
    // an MB search rate-limited at the IPC layer, so we don't have to throttle
    // ourselves — fire them all and let mb-fetch's pacer serialize.
    void this.scanCompleteness()
  }

  /**
   * Background pass that asks MB for each folder "does any release in your
   * top hits have a track count equal to this folder's audio count?" and
   * stamps a {@link FolderCompleteness} pill onto {@link completeness}. The
   * MB IPC enforces 1.1s pacing so a 30-folder inbox takes ~30s; results
   * appear progressively. Cached in-memory across the session; cleared on
   * the next refresh.
   */
  async scanCompleteness(): Promise<void> {
    const gen = ++this.#scanGen
    this.completenessScanning = true
    // Drop entries for folders that no longer exist; keep the rest so the
    // pills don't disappear on a refresh that didn't actually change anything.
    const present = new Set(this.folders.map((f) => f.path))
    const next: Record<string, FolderCompleteness> = {}
    for (const [k, v] of Object.entries(this.completeness)) {
      if (present.has(k)) next[k] = v
    }
    this.completeness = next

    // Only scan folders we haven't already resolved this session. The user
    // can force a re-scan by deleting + re-downloading or by relaunching.
    const todo: InboxFolder[] = []
    for (const f of this.folders) {
      const existing = this.completeness[f.path]
      if (!existing || existing.status === 'scanning' || existing.status === 'error') {
        todo.push(f)
      }
    }

    // Stamp every target folder as 'scanning' up front so the UI shows the
    // pending state. Resolve sequentially: queuing the entire inbox into MB's
    // global pacer can strand a user-initiated search behind minutes of
    // background work and retries.
    const seed: Record<string, FolderCompleteness> = { ...this.completeness }
    for (const f of todo) {
      const artist = guessSearchArtist(f)
      const title = guessCommonTag(f, 'album') ?? ''
      if (!artist && !title) {
        seed[f.path] = {
          status: 'unknown',
          audioCount: f.file_count,
          expectedCount: null,
          bestMbid: null
        }
        continue
      }
      seed[f.path] = {
        status: 'scanning',
        audioCount: f.file_count,
        expectedCount: null,
        bestMbid: null
      }
    }
    this.completeness = seed

    try {
      for (const f of todo) {
        if (gen !== this.#scanGen) break
        const artist = guessSearchArtist(f)
        const title = guessCommonTag(f, 'album') ?? ''
        if (!artist && !title) continue
        try {
          const candidates = await this.#plex.searchReleaseCandidates({ artist, title })
          if (gen !== this.#scanGen) break
          const best = pickBestCandidate(candidates, f.file_count, folderPerformanceCredits(f))
          const topExpected = candidates[0]?.trackCount ?? null
          this.completeness = {
            ...this.completeness,
            [f.path]: best
              ? {
                  status: 'complete',
                  audioCount: f.file_count,
                  expectedCount: best.trackCount,
                  bestMbid: best.mbid
                }
              : candidates.length === 0
                ? {
                    status: 'unknown',
                    audioCount: f.file_count,
                    expectedCount: null,
                    bestMbid: null
                  }
                : {
                    status: 'incomplete',
                    audioCount: f.file_count,
                    expectedCount: topExpected,
                    bestMbid: null
                  }
          }
        } catch (err) {
          if (gen !== this.#scanGen) break
          this.completeness = {
            ...this.completeness,
            [f.path]: {
              status: 'error',
              audioCount: f.file_count,
              expectedCount: null,
              bestMbid: null,
              error: err instanceof Error ? err.message : String(err)
            }
          }
        }
      }
    } finally {
      if (gen === this.#scanGen) this.completenessScanning = false
    }
  }

  async openFolderDetail(folder: InboxFolder): Promise<void> {
    // Foreground matching wins over the optional list-page preflight. The
    // current background request may finish, but no additional folders are
    // queued ahead of the album the user chose.
    this.#scanGen++
    this.completenessScanning = false
    this.openFolder = folder
    this.matcher.open({
      artist: guessSearchArtist(folder),
      title: guessCommonTag(folder, 'album') ?? ''
    })
    this.match = {
      folderPath: folder.path,
      preview: null,
      decisions: {},
      matchHint: null,
      applying: false,
      applyError: null,
      result: null,
      existingAlbum: null
    }
    // Background fingerprint: kick it off the moment the user opens a folder so
    // by the time they pick a release the audio is already in the AcoustID
    // cache. Fire-and-forget; UI shows pill state via `fingerprint`.
    void this.prefingerprintOpenFolder()
    // The lightweight folder list omits raw tags. Fetch the detailed view so
    // classical files can supply COMPOSER before the first MB search.
    let detailed = folder
    try {
      const fetched = await this.#tagger.getFolder({ name: folder.folder })
      if (fetched.files.length > 0) detailed = fetched
    } catch {
      // The list summary is still enough for the old performer-based fallback.
    }
    if (this.openFolder?.path !== folder.path) return
    this.openFolder = detailed
    const guessArtist = guessSearchArtist(detailed)
    const guessTitle = guessCommonTag(detailed, 'album') ?? ''
    this.matcher.open({ artist: guessArtist, title: guessTitle })
    const embeddedMbid = unanimousReleaseMbid(detailed)
    if (embeddedMbid) {
      await this.pickRelease(embeddedMbid)
      // Rips from a box set inherit the box's release MBID even when the
      // downloaded folder is one standalone album/disc. A near-complete album
      // can also legitimately be missing files, though. Embedded track IDs
      // distinguish that partial album from an unrelated parent box set.
      if (
        this.openFolder?.path === folder.path &&
        this.matcher.release &&
        !embeddedReleaseFitsFolder(detailed, this.matcher.release)
      ) {
        this.matcher.clearRelease()
        if (this.match?.folderPath === folder.path) {
          this.match = {
            ...this.match,
            preview: null,
            decisions: {},
            matchHint: null,
            result: null,
            applyError: null,
            existingAlbum: null
          }
        }
        if (guessArtist || guessTitle) await this.runMatchSearch()
      }
    } else if (guessArtist || guessTitle) {
      void this.runMatchSearch()
    }
  }

  async prefingerprintOpenFolder(): Promise<void> {
    const folder = this.openFolder
    if (!folder) return
    // If we already fingerprinted this folder in this session, don't redo the
    // work — the server-side cache covers it anyway, but skipping the
    // round-trip saves a pacing-dominated wait.
    if (
      this.fingerprint &&
      this.fingerprint.folderPath === folder.path &&
      this.fingerprint.status === 'ready'
    ) {
      return
    }
    this.fingerprint = {
      folderPath: folder.path,
      status: 'running',
      error: null,
      summary: null
    }
    try {
      const summary = await this.#tagger.prefingerprint({ name: folder.folder })
      if (this.openFolder?.path !== folder.path) return
      this.fingerprint = {
        folderPath: folder.path,
        status: 'ready',
        error: null,
        summary
      }
    } catch (err) {
      if (this.openFolder?.path !== folder.path) return
      this.fingerprint = {
        folderPath: folder.path,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        summary: null
      }
    }
  }

  closeFolderDetail(): void {
    this.openFolder = null
    this.match = null
    this.matcher.open()
  }

  async deleteFolderByName(name: string): Promise<void> {
    try {
      await this.#tagger.deleteFolder({ name })
      if (this.openFolder?.folder === name) this.closeFolderDetail()
      await this.refresh()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * File one track from the open folder into the Singles bin (a sibling
   * "Singles" Plex library) — the playlist-gap path, so a lone Tommy Tutone
   * song never becomes a 1-track album in the crate. Uses the file's own
   * tags for artist/title; the caller disables the action when they're
   * missing. Refreshes (or closes) the folder after the move.
   */
  applyingSinglePath = $state<string | null>(null)

  // Mirrors the tagger's AUDIO_EXTS — folder-list rows need to know whether
  // a 1-file folder is a single-song grab without opening it.
  static AUDIO_EXTS = new Set(['.flac', '.mp3', '.m4a', '.mp4', '.ogg', '.opus'])

  /** The lone taggable audio file of a folder, when the folder is a
   *  single-song acquisition (exactly one audio file, artist+title tags).
   *  Null for real albums or tagless strays. */
  singleCandidate(folder: InboxFolder): InboxFile | null {
    const audio = folder.files.filter((f) => InboxController.AUDIO_EXTS.has(f.ext))
    if (audio.length !== 1) return null
    const f = audio[0]
    if (!(f.tags.artist || f.tags.albumartist) || !f.tags.title) return null
    return f
  }

  // Bulk "file all singles" over the folder list. Sequential — each apply
  // is a tag-write + NFS move + (scoped) Plex refresh.
  singleBatch = $state<{ done: number; total: number; running: boolean } | null>(null)

  async applySingleFolder(folder: InboxFolder, file: InboxFile): Promise<boolean> {
    try {
      await this.#tagger.applySingle({
        folderName: folder.folder,
        filename: file.name,
        artist: (file.tags.artist || file.tags.albumartist)!,
        title: file.tags.title!,
        recordingMbid: file.tags.musicbrainz_trackid
      })
      return true
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async applySingleFromList(folder: InboxFolder): Promise<void> {
    const file = this.singleCandidate(folder)
    if (!file || this.singleBatch?.running) return
    this.applyingSinglePath = file.path
    try {
      if (await this.applySingleFolder(folder, file)) {
        this.#deps.flashToast('ok', `Filed “${file.tags.title}” to Singles`)
        this.folders = this.folders.filter((f) => f.path !== folder.path)
      }
    } finally {
      this.applyingSinglePath = null
    }
  }

  async applyAllSingles(): Promise<void> {
    if (this.singleBatch?.running) return
    const eligible = this.folders
      .map((f) => ({ folder: f, file: this.singleCandidate(f) }))
      .filter((e): e is { folder: InboxFolder; file: InboxFile } => e.file !== null)
    if (eligible.length === 0) return
    this.singleBatch = { done: 0, total: eligible.length, running: true }
    let ok = 0
    for (const e of eligible) {
      if (await this.applySingleFolder(e.folder, e.file)) {
        ok++
        this.folders = this.folders.filter((f) => f.path !== e.folder.path)
      }
      this.singleBatch = { ...this.singleBatch, done: this.singleBatch.done + 1 }
    }
    this.singleBatch = { ...this.singleBatch, running: false }
    this.#deps.flashToast(
      ok === eligible.length ? 'ok' : 'err',
      `Filed ${ok} of ${eligible.length} single${eligible.length === 1 ? '' : 's'}`
    )
    await this.refresh()
  }

  async applySingleInOpen(file: InboxFile): Promise<void> {
    const f = this.openFolder
    if (!f || this.applyingSinglePath) return
    const artist = file.tags.artist || file.tags.albumartist
    const title = file.tags.title
    if (!artist || !title) {
      this.#deps.flashToast('err', 'File has no artist/title tags — match it to a release instead')
      return
    }
    this.applyingSinglePath = file.path
    try {
      await this.#tagger.applySingle({
        folderName: f.folder,
        filename: file.name,
        artist,
        title,
        recordingMbid: file.tags.musicbrainz_trackid
      })
      this.#deps.flashToast('ok', `Filed “${title}” to Singles`)
      // The folder may have been removed entirely (it held only this file).
      try {
        this.openFolder = await this.#tagger.getFolder({ name: f.folder })
      } catch {
        this.closeFolderDetail()
        await this.refresh()
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.applyingSinglePath = null
    }
  }

  async deleteFilesInOpen(paths: string[]): Promise<void> {
    const f = this.openFolder
    if (!f || paths.length === 0) return
    try {
      await this.#tagger.deleteFiles({ name: f.folder, paths })
      const refreshed = await this.#tagger.getFolder({ name: f.folder })
      this.openFolder = refreshed
      if (this.match) {
        const stillPresent = new Set(refreshed.files.map((fi) => fi.path))
        const nextDecisions: Record<string, RowDecision> = {}
        for (const [p, d] of Object.entries(this.match.decisions)) {
          if (stillPresent.has(p)) nextDecisions[p] = d
        }
        // File set changed underfoot — the cached preview rows reference paths
        // that may no longer exist. Drop it; next pickRelease (or re-pick) will
        // recompute.
        this.match = {
          ...this.match,
          decisions: nextDecisions,
          preview: null
        }
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  setMatchQuery(artist: string, title: string): void {
    this.matcher.setQuery(artist, title)
  }

  async runMatchSearch(): Promise<void> {
    const folder = this.openFolder
    await this.matcher.runSearch()
    // Inbox-specific: if the search produced a confident best candidate and we
    // don't have a release picked yet, auto-pick it. Other matcher callers
    // (cover/manual/slskd) handle auto-pick differently or not at all — this
    // stays in the inbox orchestrator.
    if (folder && !this.matcher.release) {
      const best = pickBestCandidate(
        this.matcher.candidates,
        folder.file_count,
        folderPerformanceCredits(folder)
      )
      if (best) await this.pickRelease(best.mbid)
    }
  }

  async pickRelease(mbid: string): Promise<void> {
    const m = this.match
    const folder = this.openFolder
    if (!m || !folder) return
    // Clear inbox-side post-pick state up front so stale reconciler data
    // doesn't paint while the new release is loading.
    this.match = {
      ...m,
      preview: null,
      decisions: {},
      matchHint: null,
      result: null,
      applyError: null,
      existingAlbum: null
    }
    await this.matcher.pick(mbid)
    const release = this.matcher.release
    if (!release) return // pick failed; matcher.releaseError surfaces in UI
    if (!this.match || this.match.folderPath !== m.folderPath) return

    // Inflow guard: if a Plex album already carries this MB release MBID,
    // surface it so the user can route the inbox files into the existing album
    // instead of creating a duplicate tile.
    const existing = await this.#findAlbumByReleaseMbid(release.release_mbid)
    if (!this.match || this.match.folderPath !== m.folderPath) return

    // Run the reconciler: matcher + AcoustID side-by-side per file. Clean
    // preview = both engines agree on every slot; renderer can commit
    // immediately on click. Dirty = picker UI required.
    let preview: PreviewResponse | null = null
    let decisions: Record<string, RowDecision> = {}
    let matchHint: string | null = null
    try {
      const resp = await this.#tagger.apply({
        folder: folder.path,
        mbid: release.release_mbid,
        mode: 'preview',
        refresh_plex: false
      })
      if (resp.ok && resp.mode === 'preview') {
        preview = resp
        decisions = decisionsFromPreview(resp)
        if (!preview.clean) {
          const disagreeCount = preview.rows.filter((r) => r.disagree).length
          const unresolved = preview.rows.filter((r) => r.default_choice === 'manual').length
          const bits: string[] = []
          if (disagreeCount > 0) {
            bits.push(
              `Matcher and AcoustID disagree on ${disagreeCount} of ${preview.file_count} file${preview.file_count === 1 ? '' : 's'}`
            )
          }
          if (unresolved > 0) {
            bits.push(`${unresolved} file${unresolved === 1 ? '' : 's'} need a track pick`)
          }
          if (preview.file_count !== preview.total_tracks) {
            bits.push(
              `${preview.file_count} files vs ${preview.total_tracks} tracks in the release`
            )
          }
          matchHint =
            bits.length > 0
              ? bits.join('. ') + '. Picker below pre-selects the safer choice per row.'
              : 'Picker below pre-selects the safer choice per row.'
        }
      } else if (!resp.ok) {
        matchHint = resp.reason || 'service refused the preview'
      }
    } catch (err) {
      // Hard error (network, refusal that threw) — user has to assign manually.
      // Don't block the release pick.
      matchHint = err instanceof Error ? err.message : String(err)
    }
    if (!this.match || this.match.folderPath !== m.folderPath) return
    this.match = {
      ...this.match,
      preview,
      decisions,
      matchHint,
      result: null,
      existingAlbum: existing
    }
    // Automatic commit is allowed only when every track has positive
    // fingerprint agreement and the embedded conductor/orchestra credits fit
    // the release. A title/duration-only match is not enough for classical
    // recordings: different performances often share the exact tracklist.
    const conflict = performanceConflict(folder, release)
    const fullyFingerprintVerified =
      preview?.clean === true &&
      preview.file_count === preview.total_tracks &&
      preview.rows.every((row) => row.agree || row.embedded_match === true)
    if (fullyFingerprintVerified && !conflict && !existing) {
      void this.applyRelease()
    }
  }

  async #findAlbumByReleaseMbid(mbid: string): Promise<PlexAlbum | null> {
    try {
      const all = await this.#deps.ensureAllAlbums()
      const lower = mbid.toLowerCase()
      for (const a of all) {
        for (const g of a.guids) {
          if (mbidFromGuid(g) === lower) return a
        }
      }
    } catch {
      // non-fatal — guard simply won't show
    }
    return null
  }

  async addIntoExistingAlbum(): Promise<void> {
    const m = this.match
    const folder = this.openFolder
    const release = this.matcher.release
    if (!m || !folder || !release || !m.existingAlbum) return
    const conflict = performanceConflict(folder, release)
    if (conflict) {
      this.match = { ...m, applying: false, applyError: conflict }
      return
    }
    const session = this.#deps.session()
    if (!session?.signedIn || !session.preferredServerId) return
    const serverId = session.preferredServerId
    this.match = { ...m, applying: true, applyError: null, result: null }
    try {
      const result = await this.#tagger.mergeInboxIntoAlbum({
        serverId,
        ratingKey: m.existingAlbum.ratingKey,
        mbid: release.release_mbid,
        inboxPath: folder.path
      })
      if (result.ok) {
        // Same files-moved-but-refresh-failed shape as applyRelease: warn
        // instead of plain success, but still clean up — the merge happened.
        if (result.plex && result.plex.ok === false) {
          this.#deps.flashToast(
            'err',
            `Merged into existing album: ${result.album} — but Plex refresh failed; tracks may not appear until the next library scan`
          )
        } else {
          this.#deps.flashToast('ok', `Merged into existing album: ${result.album}`)
        }
        this.#deps.removeSlskdDownloadsForFolder(folder.folder)
        this.openFolder = null
        this.match = null
        await this.refresh()
      } else if (this.match && this.match.folderPath === m.folderPath) {
        this.match = { ...this.match, applying: false, result }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.match && this.match.folderPath === m.folderPath) {
        this.match = { ...this.match, applying: false, applyError: msg }
      }
    }
  }

  resetRelease(): void {
    const m = this.match
    if (!m) return
    this.matcher.clearRelease()
    this.match = {
      ...m,
      preview: null,
      decisions: {},
      matchHint: null,
      result: null,
      applyError: null,
      existingAlbum: null
    }
  }

  setRowDecision(path: string, decision: RowDecision | null): void {
    const m = this.match
    if (!m) return
    const next = { ...m.decisions }
    if (decision === null) delete next[path]
    else next[path] = decision
    this.match = { ...m, decisions: next, result: null, applyError: null }
  }

  async applyRelease(): Promise<void> {
    const m = this.match
    const folder = this.openFolder
    const release = this.matcher.release
    if (!m || !folder || !release) return
    const conflict = performanceConflict(folder, release)
    if (conflict) {
      this.match = { ...m, applying: false, applyError: conflict }
      return
    }
    this.match = { ...m, applying: true, applyError: null, result: null }
    try {
      const result = await this.#tagger.apply({
        folder: folder.path,
        mbid: release.release_mbid,
        mode: 'commit',
        decisions: { ...m.decisions },
        refresh_plex: true
      })
      // Two ok shapes can come back: commit-success (move on) or preview-body
      // (server refused because reconcile turned dirty after we last looked —
      // pop the picker with fresh data).
      if (result.ok && result.mode === 'preview') {
        if (this.match && this.match.folderPath === m.folderPath) {
          this.match = {
            ...this.match,
            applying: false,
            preview: result,
            decisions: decisionsFromPreview(result),
            matchHint: 'Reconcile turned dirty — pick the right track per file below.'
          }
        }
        return
      }
      if (result.ok) {
        // The service moves files first, then refreshes Plex; a failed refresh
        // still comes back ok:true with plex.ok=false. The files DID move, so
        // proceed with cleanup — but don't let the toast lie about it.
        if (result.plex && result.plex.ok === false) {
          this.#deps.flashToast(
            'err',
            `Applied: ${result.album} — but Plex refresh failed; album may not appear until the next library scan`
          )
        } else {
          this.#deps.flashToast('ok', `Applied: ${result.album}`)
        }
        this.#deps.removeSlskdDownloadsForFolder(folder.folder)
        this.openFolder = null
        this.match = null
        await this.refresh()
      } else if (this.match && this.match.folderPath === m.folderPath) {
        this.match = { ...this.match, applying: false, result }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (this.match && this.match.folderPath === m.folderPath) {
        this.match = { ...this.match, applying: false, applyError: msg }
      }
    }
  }
}
