// Pure decision logic for the inbox reconciler table (InboxView.svelte).
// Params in, value out — no plexState reads — so the apply-gating rules are
// unit-testable. The companion seeding helper (decisionsFromPreview) lives on
// inbox-controller.svelte.ts next to the apply flow that consumes it.
import type {
  MbCanonicalRelease,
  MbCanonicalTrack,
  PreviewResponse,
  ReconciledRow,
  RowDecision
} from '../../../shared/tagger'

/** The decision a row falls back to when the user hasn't chosen: the
 *  reconciler's default pick, or null for "manual" rows. */
export function defaultDecision(row: ReconciledRow): RowDecision | null {
  if (row.default_choice === 'matcher' && row.matcher_pick) return row.matcher_pick.track_index
  if (row.default_choice === 'acoustid' && row.acoustid_pick) return row.acoustid_pick.track_index
  return null
}

/** What the user has currently chosen for a row — their explicit decision,
 *  else the row's default, else null (unresolved). */
export function decisionForRow(
  row: ReconciledRow,
  decisions: Record<string, RowDecision>
): RowDecision | null {
  const d = decisions[row.path]
  if (d !== undefined) return d
  return defaultDecision(row)
}

/** The MB track a row currently maps to, or null when skipped/unresolved. */
export function trackForRow(
  row: ReconciledRow,
  decisions: Record<string, RowDecision>,
  release: MbCanonicalRelease | null
): MbCanonicalTrack | null {
  const d = decisionForRow(row, decisions)
  if (typeof d !== 'number') return null
  return release?.tracks[d - 1] ?? null
}

/**
 * Count overrides — rows where the user chose something other than the
 * reconciler's default. Surfaced in the apply button label so the user sees
 * how much of the assignment is "their" choice.
 */
export function countOverrides(
  preview: PreviewResponse | null,
  decisions: Record<string, RowDecision>
): number {
  if (!preview) return 0
  let n = 0
  for (const r of preview.rows) {
    const d = decisions[r.path]
    if (d === undefined) continue
    if (d !== defaultDecision(r)) n++
  }
  return n
}

/**
 * Apply is ready when every row has a usable choice (a track index or
 * "skip"), not just the ones the reconciler defaulted. "manual" rows with no
 * explicit decision block apply. No preview at all blocks apply — this gates
 * a destructive file move.
 */
export function isReadyToApply(
  preview: PreviewResponse | null,
  decisions: Record<string, RowDecision>
): boolean {
  if (!preview) return false
  for (const r of preview.rows) {
    if (decisionForRow(r, decisions) === null) return false
  }
  return true
}
