import type {
  ClassicalComposerDetail,
  ClassicalAgentDetail,
  ClassicalEntityKind,
  ClassicalHome,
  ClassicalReviewCandidate,
  ClassicalSearchPage,
  ClassicalReleaseDetail,
  ClassicalSyncStatus,
  ClassicalWorkDetail
} from '../../../shared/classical-api'

export class ClassicalController {
  home = $state<ClassicalHome | null>(null)
  sync = $state<ClassicalSyncStatus | null>(null)
  results = $state<ClassicalSearchPage | null>(null)
  composer = $state<ClassicalComposerDetail | null>(null)
  work = $state<ClassicalWorkDetail | null>(null)
  agent = $state<ClassicalAgentDetail | null>(null)
  release = $state<ClassicalReleaseDetail | null>(null)
  review = $state<ClassicalReviewCandidate[]>([])
  loading = $state(false)
  error = $state<string | null>(null)
  query = $state('')
  period = $state<string | null>(null)
  genre = $state<string | null>(null)
  ownedOnly = $state(false)
  kind = $state<ClassicalEntityKind | null>(null)
  private searchSequence = 0

  async load(): Promise<void> {
    this.loading = true
    this.error = null
    try {
      const [home, sync, review] = await Promise.all([
        window.cratedigger.classical.getHome(),
        window.cratedigger.classical.getSyncStatus(),
        window.cratedigger.classical.listReviewCandidates({ limit: 50 })
      ])
      this.home = home
      this.sync = sync
      this.review = review
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  async search(reset = true): Promise<void> {
    const sequence = ++this.searchSequence
    this.loading = true
    this.error = null
    try {
      const page = await window.cratedigger.classical.search({
        query: this.query,
        kinds: this.kind ? [this.kind] : undefined,
        owned: this.ownedOnly ? true : null,
        period: this.period,
        genre: this.genre,
        cursor: reset ? null : this.results?.nextCursor,
        limit: 60
      })
      if (sequence !== this.searchSequence) return
      this.results = reset || !this.results
        ? page
        : { ...page, items: [...this.results.items, ...page.items] }
    } catch (err) {
      if (sequence === this.searchSequence) this.error = err instanceof Error ? err.message : String(err)
    } finally {
      if (sequence === this.searchSequence) this.loading = false
    }
  }

  async openComposer(id: string): Promise<void> {
    this.loading = true
    this.error = null
    try {
      this.composer = await window.cratedigger.classical.getComposer({ id })
      this.work = null
      this.agent = null
      this.release = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally { this.loading = false }
  }

  async openWork(id: string): Promise<void> {
    this.loading = true
    this.error = null
    try {
      this.work = await window.cratedigger.classical.getWork({ id })
      this.agent = null
      this.release = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally { this.loading = false }
  }

  showHome(): void {
    this.composer = null
    this.work = null
    this.agent = null
    this.release = null
  }

  showComposer(): void {
    this.work = null
  }

  async openAgent(id: string): Promise<void> {
    this.loading = true
    try {
      this.agent = await window.cratedigger.classical.getAgent({ id })
      this.composer = null; this.work = null; this.release = null
    } finally { this.loading = false }
  }

  async openRelease(id: string): Promise<void> {
    this.loading = true
    try {
      this.release = await window.cratedigger.classical.getRelease({ id })
      this.composer = null; this.work = null; this.agent = null
    } finally { this.loading = false }
  }

  async dismissCandidate(id: string): Promise<void> {
    await window.cratedigger.classical.applyCorrection({ command: { kind: 'dismiss-candidate', candidateId: id } })
    this.review = this.review.filter((candidate) => candidate.id !== id)
  }

  async acceptCandidate(id: string): Promise<void> {
    await window.cratedigger.classical.applyCorrection({ command: { kind: 'accept-candidate', candidateId: id } })
    this.review = this.review.filter((candidate) => candidate.id !== id)
    this.home = await window.cratedigger.classical.getHome()
  }

  async toggleSync(): Promise<void> {
    if (this.sync?.phase === 'paused') await window.cratedigger.classical.resumeSync()
    else await window.cratedigger.classical.pauseSync()
    this.sync = await window.cratedigger.classical.getSyncStatus()
  }

  async retrySync(): Promise<void> {
    await window.cratedigger.classical.retrySync()
    this.sync = await window.cratedigger.classical.getSyncStatus()
  }
}
