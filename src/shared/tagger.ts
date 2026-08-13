export interface InboxFileTags {
  title: string | null
  artist: string | null
  albumartist: string | null
  composer: string | null
  album: string | null
  tracknumber: string | null
  discnumber: string | null
  date: string | null
  musicbrainz_albumid: string | null
  musicbrainz_trackid: string | null
}

export interface InboxFile {
  path: string
  name: string
  size: number
  ext: string
  read_error: string | null
  duration_ms: number | null
  tags: InboxFileTags
  raw_tags?: Record<string, string[]>
}

export interface InboxFolder {
  folder: string
  path: string
  file_count: number
  files: InboxFile[]
}

export interface MbCanonicalTrack {
  disc: number
  track: number
  title: string
  artist: string
  recording_mbid: string
  track_mbid: string
  length_ms: number | null
}

export interface MbCanonicalRelease {
  album: string
  albumartist: string
  albumartist_ids: string[]
  release_mbid: string
  releasegroup_mbid: string
  date: string
  country: string
  status: string
  total_discs: number
  tracks: MbCanonicalTrack[]
}

export interface ApplyMove {
  src: string
  dst: string
  track?: MbCanonicalTrack
}

export interface MatchPlanEntry {
  src: string
  track_index: number
  track_title: string
  cost: number
  file_duration_ms: number | null
  track_duration_ms: number | null
  confident: boolean
}

export interface AcousticDisagreement {
  path: string
  proposed_track_index: number
  proposed_title: string
  proposed_recording_mbid: string
  acoustid_recording_mbids: string[]
  acoustid_score: number
  lookup_error: string | null
}

export interface VerificationResult {
  skipped: boolean
  reason: string | null
  warnings: string[]
  checked: number
  agreed: number
  disagreements: AcousticDisagreement[]
}

export interface ApplyOk {
  ok: true
  mode?: 'commit'
  dry_run?: boolean
  album: string
  albumartist: string
  release_mbid?: string
  moves?: { src: string; dst: string }[]
  moved?: { src: string; dst: string }[]
  match_plan?: MatchPlanEntry[]
  verification?: VerificationResult
  plex?: { ok: boolean; reason?: string; scoped?: boolean }
}

export interface ApplyConflict {
  ok: false
  mode?: 'commit'
  reason: string
  conflicts: { src: string; dst: string }[]
  would_move: { src: string; dst: string }[]
}

export type ApplyResult = ApplyOk | ApplyConflict

// /apply (and /music/retag) can return EITHER a commit result OR a preview
// body. The preview body comes back in two cases: explicit mode="preview",
// OR mode="commit" with no decisions when the reconciler isn't clean
// (server refuses with the preview so renderer can pop the picker without
// a second round trip).
export type ApplyOrPreviewResult = ApplyResult | PreviewResponse

// Per-file row in a reconciler preview. Each file gets a matcher pick
// (Hungarian over duration+title+tracknumber) and/or an AcoustID pick
// (fingerprint → recording MBID → release slot). One of them may be null
// — matcher refused, or AcoustID had no usable hit in this release.
export interface MatcherPick {
  track_index: number
  title: string
  cost: number
  confident: boolean
}

export interface AcoustidPick {
  track_index: number
  title: string
  recording_mbid: string
  score: number
}

export interface ReconciledRow {
  path: string
  name: string
  duration_ms: number | null
  matcher_pick: MatcherPick | null
  acoustid_pick: AcoustidPick | null
  // Both engines picked the same slot. Used by the picker UI to highlight
  // matching cells.
  agree: boolean
  // Both engines picked AND picked DIFFERENT slots. The only state that
  // warrants user review — counts toward "N disagree" in the UI. A row
  // where only one engine has an opinion is NOT a disagreement.
  disagree: boolean
  // The file already carried this exact release + recording/release-track
  // MusicBrainz identity. This outranks a conflicting AcoustID lookup.
  embedded_match?: boolean
  // Default the renderer should pre-select. "matcher" / "acoustid" use the
  // respective pick's track_index; "manual" leaves the row unassigned and
  // the user must pick a track from the dropdown.
  default_choice: 'matcher' | 'acoustid' | 'manual'
  acoustid_lookup_error?: string | null
}

export interface PreviewResponse {
  ok: true
  mode: 'preview'
  album: string
  albumartist: string
  release_mbid: string
  total_tracks: number
  file_count: number
  rows: ReconciledRow[]
  // True when file/track counts match, no engines actively disagree, and
  // every row has a usable default. A single-engine row can therefore be
  // clean; automatic commit separately requires row.agree on every track.
  clean: boolean
  warnings: string[]
}

// Per-file user decision sent back with the commit. Either a 1-based
// track index in the release tracklist, or "skip" to leave the file
// untagged in the folder.
export type RowDecision = number | 'skip'

export interface ApplyRequest {
  folder: string
  mbid: string
  // "preview" returns a PreviewResponse, no writes. "commit" applies a
  // decisions map (omit decisions when the preview was clean — server
  // re-derives the auto mapping). Default on the server is "commit" for
  // back-compat with the old request shape.
  mode?: 'preview' | 'commit'
  decisions?: Record<string, RowDecision>
  // file_to_track is the legacy way to commit an explicit mapping; new
  // callers should use decisions. Server accepts both.
  file_to_track?: Record<string, number>
  refresh_plex?: boolean
  dry_run?: boolean
}

// Used by /music/retag — same shape as /apply but takes N library directories
// (not a single inbox folder). Tagger walks each, retags every audio file with
// the canonical MB metadata, moves to the beets path, prunes empty source dirs.
// Same preview/commit + decisions flow as ApplyRequest.
export interface RetagRequest {
  source_paths: string[]
  mbid: string
  mode?: 'preview' | 'commit'
  decisions?: Record<string, RowDecision>
  file_to_track?: Record<string, number>
  refresh_plex?: boolean
  dry_run?: boolean
}

export interface PrefingerprintRequest {
  name: string
}

export interface PrefingerprintResponse {
  ok: boolean
  file_count: number
  fingerprinted: number
  cached: number
  errors: { path: string; error: string }[]
}

export interface AcousticIdentification {
  path: string
  recording_mbids: string[]
  score: number
  error: string | null
}

export interface TaggerHealth {
  ok: boolean
  music_root: string
  inbox_root: string
  host_music_root: string
  host_inbox_root: string
  music_root_exists: boolean
  inbox_root_exists: boolean
  plex_configured: boolean
}

// Per-file evidence row from /audit/music — the file claims to be a given
// MB track (via embedded musicbrainz_trackid or title fallback) but the
// actual audio duration is far from MB's length for that claimed track.
export interface AuditItem {
  path: string
  claimed_title: string | null
  claimed_tracknumber: string | null
  claimed_track_duration_ms: number
  actual_file_duration_ms: number
  duration_delta_ms: number
  match_method: 'recording_mbid' | 'releasetrack_mbid' | 'title_exact' | 'no_match'
}

// One audited album's proposed remap from the Hungarian matcher — keyed by
// absolute file path, value is the track the matcher thinks the file actually
// is (with cost; lower is better, < 0.10 means high confidence).
export interface AuditProposedMappingEntry {
  track_index: number
  title: string
  track: number
  cost: number
}

export interface AuditFinding {
  album: string
  albumartist: string
  release_mbid: string
  // file_count_drift: file count != MB track count; matcher can't run.
  // duration_mismatch: at least one file's audio duration disagrees with
  // the MB track it's tagged as. proposed_mapping present, retag-able.
  issue: 'file_count_drift' | 'duration_mismatch'
  file_count: number
  track_count: number
  mismatched_file_count?: number
  matcher_confident?: boolean
  max_match_cost?: number
  items: AuditItem[]
  files?: string[]
  proposed_mapping?: Record<string, AuditProposedMappingEntry>
}

export interface AuditResponse {
  ok: boolean
  reason?: string
  music_root?: string
  scanned_albums?: number
  flagged_albums?: number
  mb_fetch_failures?: string[]
  findings?: AuditFinding[]
}
