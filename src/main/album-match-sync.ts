// Keeps the manual album→MB override (electron-store `albumMatches`) in
// agreement with what the tagger service just wrote into the files.
//
// Why this exists: an album can be "matched to a MusicBrainz release" two
// ways that historically didn't know about each other — the store-backed
// manual override (plex:set-album-match) and tagger-written file tags
// (tagger:retag / merge-inbox-into-album). reconcileAlbum() in
// musicbrainz.ts prioritizes manual override > Plex guid MBID > title
// search, so after a retag a stale override would keep credits pointed at
// the OLD release even though the files now carry the correct MBID.
//
// We set the override to the applied MBID even when none existed before:
// Plex's guid only updates after it re-reads the files (rescan/refresh),
// so until then the guid path in reconcileAlbum would still resolve to the
// pre-retag release. Pinning the override bridges that gap, and it can
// never disagree with the files — the tagger write IS the ground truth.
//
// Deps are injected so this stays unit-testable without pulling in
// electron-store / the MB cache (both Electron-backed at import time).

export interface AlbumMatchSyncDeps {
  getAlbumMatch: (plexRatingKey: string) => string | null
  setAlbumMatch: (plexRatingKey: string, mbReleaseMbid: string) => void
  invalidateAlbumCredits: (plexRatingKey: string) => Promise<void>
  warn?: (message: string, err: unknown) => void
}

// Called after a tagger write that touched an EXISTING Plex album (retag,
// merge-inbox-into-existing). Plain /apply creates a brand-new album with
// no ratingKey yet, so it has nothing to sync. Defensive by contract: a
// sync failure must never fail the apply/retag that already succeeded on
// disk — log and move on.
export async function syncAlbumMatchAfterTaggerWrite(
  plexRatingKey: string,
  appliedMbid: string,
  deps: AlbumMatchSyncDeps
): Promise<void> {
  const warn = deps.warn ?? ((msg, err) => console.warn(msg, err))
  try {
    if (deps.getAlbumMatch(plexRatingKey) !== appliedMbid) {
      deps.setAlbumMatch(plexRatingKey, appliedMbid)
    }
  } catch (err) {
    warn(`album-match-sync: failed to set override for ${plexRatingKey}:`, err)
  }
  try {
    // Always bust the credit cache — even when the override already agreed,
    // the files changed and the next credits fetch should re-reconcile.
    await deps.invalidateAlbumCredits(plexRatingKey)
  } catch (err) {
    warn(`album-match-sync: failed to invalidate credits for ${plexRatingKey}:`, err)
  }
}
