import type { MbCanonicalRelease } from '../../../shared/tagger'
import type { MbReleaseCandidate } from '../../../shared/plex'

// One deep module covering the four picker flows in the app: inbox match,
// cover picker, manual album→MB match, and slskd release pick. Each caller
// holds its own ReleaseMatcher instance on plexState so they can coexist
// (the cover picker is frequently opened mid-inbox flow). The matcher's
// job ends when `release` is populated — post-pick actions (load reconciler
// preview / fetch covers / persist override / kick off download) belong to
// the caller, which uses an orchestrator method to drive matcher + tail.
//
// All search hits the same /tagger MB search endpoint; the matcher does
// NOT discriminate by kind. If a caller needs a different search source,
// it should reach past the matcher rather than be threaded through it.
export class ReleaseMatcher {
  query = $state<{ artist: string; title: string }>({ artist: '', title: '' })
  candidates = $state<MbReleaseCandidate[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  release = $state<MbCanonicalRelease | null>(null)
  releaseLoading = $state(false)
  // mbid of the candidate currently being loaded — lets the UI surface a
  // per-row "loading…" indicator instead of disabling everything.
  releaseLoadingMbid = $state<string | null>(null)
  releaseError = $state<string | null>(null)

  // Bumped on every search/pick to cancel inflight responses if the user
  // changed query / picked a different candidate before the previous
  // request returned.
  private searchSeq = 0
  private pickSeq = 0

  // Reset everything and (optionally) seed the query for a fresh open.
  // Use this when a NEW matching session starts (folder opened, cover
  // picker invoked on a different album, etc.).
  open(hint?: { artist?: string; title?: string }): void {
    this.searchSeq++
    this.pickSeq++
    this.query = { artist: hint?.artist ?? '', title: hint?.title ?? '' }
    this.candidates = []
    this.loading = false
    this.error = null
    this.release = null
    this.releaseLoading = false
    this.releaseLoadingMbid = null
    this.releaseError = null
  }

  setQuery(artist: string, title: string): void {
    this.query = { artist, title }
  }

  async runSearch(): Promise<void> {
    const { artist, title } = this.query
    if (!artist && !title) {
      this.candidates = []
      return
    }
    const seq = ++this.searchSeq
    this.loading = true
    this.error = null
    try {
      const results = await window.cratedigger.plex.searchReleaseCandidates({
        artist,
        title
      })
      if (seq !== this.searchSeq) return
      this.candidates = results
    } catch (err) {
      if (seq !== this.searchSeq) return
      this.error = err instanceof Error ? err.message : String(err)
      this.candidates = []
    } finally {
      if (seq === this.searchSeq) this.loading = false
    }
  }

  // Fetch the full canonical release for the given MBID. Caller waits on
  // this; on success, `this.release` is populated and the caller can read
  // it and proceed with post-pick work.
  async pick(mbid: string): Promise<void> {
    const seq = ++this.pickSeq
    this.releaseLoading = true
    this.releaseLoadingMbid = mbid
    this.releaseError = null
    this.release = null
    try {
      const release = await window.cratedigger.tagger.getRelease({ mbid })
      if (seq !== this.pickSeq) return
      this.release = release
    } catch (err) {
      if (seq !== this.pickSeq) return
      this.releaseError = err instanceof Error ? err.message : String(err)
    } finally {
      if (seq === this.pickSeq) {
        this.releaseLoading = false
        this.releaseLoadingMbid = null
      }
    }
  }

  // User wants to drop the current release pick without abandoning the
  // candidate list — "change release." Keeps query/candidates so they can
  // pick a different one from the same search.
  clearRelease(): void {
    this.pickSeq++
    this.release = null
    this.releaseLoading = false
    this.releaseLoadingMbid = null
    this.releaseError = null
  }
}
