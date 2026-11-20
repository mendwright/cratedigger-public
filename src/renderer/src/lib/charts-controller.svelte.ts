import type { ChartUser, ChartResult, ChartWindow, ChartDimension, ChartEntry, TautulliConfig } from '../../../shared/charts'
import { yearBounds, type HistorySummary, type HistoryReview, type HistoryArtistStats } from '../../../shared/listening-history'
import { PUBLIC_BUILD } from '../../../shared/build-flags'

type ChartsApi = Window['cratedigger']['charts']
type HistoryApi = Window['cratedigger']['history']
const message = (e: unknown): string => e instanceof Error ? e.message : String(e)

export class ChartsController {
  #api: ChartsApi
  #history: HistoryApi | null
  #activation: Promise<void> | null = null
  #generation = 0
  #request = 0
  #drillRequest = 0
  #views = new Map<string, { result: ChartResult | null; review: HistoryReview | null }>()
  config = $state<TautulliConfig>({ url: '', apiKey: '' })
  configured = $derived(!!this.config.url && !!this.config.apiKey)
  users = $state<ChartUser[]>([])
  selected = $state<Set<number>>(new Set())
  window = $state<ChartWindow>('month')
  dimension = $state<ChartDimension>('artists')
  tab = $state<'you' | 'household'>('household')
  year = $state<number | null>(null)
  limit = $state(200)
  notInLibrary = $state(false)
  history = $state<HistorySummary | null>(null)
  result = $state<ChartResult | null>(null)
  review = $state<HistoryReview | null>(null)
  loading = $state(false)
  ready = $state(false)
  error = $state<string | null>(null)
  artist = $state<ChartEntry | null>(null)
  artistAlbums = $state<ChartEntry[]>([])
  artistTracks = $state<ChartEntry[]>([])
  artistStats = $state<HistoryArtistStats | null>(null)
  artistLoading = $state(false)
  artistError = $state<string | null>(null)
  // A year picked inside the drill-in's own timeline. Scopes the drill-in's
  // top albums/tracks to that year in place; the chart underneath and the
  // artist's lifetime stats stay as they were. null = the chart's window.
  artistYear = $state<number | null>(null)

  constructor(deps?: { api?: ChartsApi; history?: HistoryApi | null }) {
    this.#api = deps?.api ?? window.cratedigger.charts
    this.#history = PUBLIC_BUILD ? null : deps?.history !== undefined ? deps.history : window.cratedigger.history
  }

  reset(): void {
    this.#generation++
    this.#request++
    this.#activation = null
    this.#views.clear()
    this.users = []; this.selected = new Set(); this.history = null
    this.result = null; this.review = null; this.ready = false; this.loading = false
    this.tab = 'household'; this.year = null; this.notInLibrary = false; this.closeArtist()
  }

  activate(): Promise<void> {
    if (this.#activation) return this.#activation
    if (this.ready) return this.load()
    const generation = this.#generation
    this.#activation = this.#activate(generation).finally(() => {
      if (this.#generation === generation) this.#activation = null
    })
    return this.#activation
  }

  async #activate(generation: number): Promise<void> {
    if (!this.ready) {
      const cached = await this.#api.cacheRead('bootstrap').catch(() => null)
      if (generation !== this.#generation) return
      if (cached) {
        this.users = cached.users ?? []
        this.selected = new Set(this.users.map(u => u.userId))
        this.history = this.#history ? cached.history ?? null : null
        this.tab = this.history ? 'you' : 'household'
        await this.#restore()
      }
    }
    const [config, users, history] = await Promise.allSettled([
      this.#api.getConfig(), this.#api.users(), this.#history?.summary() ?? Promise.resolve(null)
    ])
    if (generation !== this.#generation) return
    if (config.status === 'fulfilled') this.config = config.value
    if (users.status === 'fulfilled') {
      this.users = users.value
      if (!this.selected.size) this.selected = new Set(this.users.map(u => u.userId))
    }
    if (history.status === 'fulfilled' && history.value) {
      this.history = history.value
      if (!this.ready) this.tab = 'you'
    }
    if (!this.history) this.tab = 'household'
    void this.#api.cacheWrite('bootstrap', $state.snapshot({ users: this.users, history: this.history })).catch(() => {})
    await this.load()
    if (generation === this.#generation) this.ready = true
  }

  get bounds(): { start: number | null; end: number | null } {
    if (this.year != null) return yearBounds(this.year)
    if (this.window === 'year') return yearBounds(new Date().getFullYear())
    if (this.window === 'all') return { start: null, end: null }
    return { start: Math.floor(Date.now() / 1000) - (this.window === 'week' ? 7 : 30) * 86400, end: null }
  }
  get reviewYear(): number | null {
    return this.tab === 'you' ? this.year ?? (this.window === 'year' ? new Date().getFullYear() : null) : null
  }
  get notInLibraryActive(): boolean { return !PUBLIC_BUILD && this.dimension === 'albums' && this.notInLibrary }
  get fetchLimit(): number { return this.notInLibraryActive ? 500 : this.limit }
  get entries(): ChartEntry[] {
    const entries = this.result?.entries ?? []
    return this.notInLibraryActive ? entries.filter(entry => !entry.ratingKey) : entries
  }
  toggleNotInLibrary(): void {
    if (PUBLIC_BUILD || this.dimension !== 'albums') return
    this.notInLibrary = !this.notInLibrary
    void this.load()
  }
  #key(): string { return `${this.tab}|${this.year ?? this.window}|${this.dimension}|${[...this.selected].sort().join(',')}|${this.fetchLimit}` }
  async #restore(): Promise<void> {
    const key = this.#key()
    const generation = this.#generation
    const cached = this.#views.get(key) ?? await this.#api.cacheRead(key).catch(() => null)
    if (key !== this.#key() || generation !== this.#generation) return
    this.result = cached?.result ?? null
    this.review = cached?.review ?? null
  }
  async load(): Promise<void> {
    const request = ++this.#request
    const generation = this.#generation
    const key = this.#key()
    this.closeArtist()
    await this.#restore()
    if (request !== this.#request || generation !== this.#generation) return
    this.loading = true; this.error = null
    const bounds = this.bounds
    try {
      let result: ChartResult | null
      let review: HistoryReview | null = null
      if (this.tab === 'you' && this.#history) {
        const [entries, report] = await Promise.all([
          this.#history.top({ dimension: this.dimension, ...bounds, limit: this.fetchLimit }),
          this.reviewYear != null ? this.#history.review({ start: bounds.start!, end: bounds.end! }).catch(() => null) : Promise.resolve(null)
        ])
        if (!entries) throw new Error('Your listening history is not reachable right now.')
        result = { dimension: this.dimension, window: this.window, userIds: [], entries }
        review = report
      } else {
        result = this.selected.size ? await this.#api.top({ userIds: [...this.selected], window: this.window, dimension: this.dimension, limit: this.notInLibraryActive ? 500 : 200 }) : null
      }
      if (request !== this.#request || generation !== this.#generation) return
      this.result = result; this.review = review
      this.#views.set(key, { result, review })
      void this.#api.cacheWrite(key, $state.snapshot({ result, review })).catch(() => {})
      // Photo lookup is queued and disk-cached in main. Never block the chart.
      for (const e of this.dimension === 'artists' ? result?.entries.slice(0, 30) ?? [] : []) void this.#api.art($state.snapshot(e), this.dimension).catch(() => {})
    } catch (e) {
      if (request === this.#request && generation === this.#generation) this.error = message(e)
    } finally {
      if (request === this.#request && generation === this.#generation) this.loading = false
    }
  }
  setTab(tab: 'you' | 'household'): void {
    if (tab === this.tab || (tab === 'you' && !this.history)) return
    this.tab = tab; this.year = null; this.limit = 200; void this.load()
  }
  setYear(year: number | null): void {
    this.year = year; this.tab = 'you'; if (year === null) this.window = 'all'
    this.limit = 200; void this.load()
  }
  setWindow(w: ChartWindow): void { this.window = w; this.year = null; this.limit = 200; void this.load() }
  setDimension(d: ChartDimension): void { if (d !== this.dimension) { this.dimension = d; this.limit = 200; void this.load() } }
  showMore(): void {
    this.limit = Math.min(500, this.limit + 100)
    this.#views.set(this.#key(), { result: this.result, review: this.review })
    void this.load()
  }
  get allSelected(): boolean { return this.users.length > 0 && this.users.every(u => this.selected.has(u.userId)) }
  toggleUser(id: number): void {
    const next = new Set(this.selected); if (next.has(id)) next.delete(id); else next.add(id)
    this.selected = next.size ? next : new Set(this.users.map(u => u.userId)); void this.load()
  }
  onlyUser(id: number): void { this.selected = new Set([id]); void this.load() }
  selectAll(): void { this.selected = new Set(this.users.map(u => u.userId)); void this.load() }
  async loadUsers(): Promise<void> { this.users = await this.#api.users() }
  closeArtist(): void {
    this.#drillRequest++; this.artist = null; this.artistAlbums = []; this.artistTracks = []; this.artistStats = null; this.artistLoading = false; this.artistError = null; this.artistYear = null
  }
  /** Re-scope the open drill-in to one year (or back to the chart's window
   *  with null, or by picking the same year again). Used to call setYear,
   *  which reloaded the whole chart and threw the drill-in away. */
  async setArtistYear(year: number | null): Promise<void> {
    const entry = this.artist
    if (!entry || this.tab !== 'you' || !this.#history) return
    this.artistYear = year === this.artistYear ? null : year
    const request = ++this.#drillRequest
    const bounds = this.artistYear != null ? yearBounds(this.artistYear) : this.bounds
    this.artistLoading = true; this.artistError = null
    try {
      const args = { artist: entry.title, ...bounds }
      const [albums, tracks] = await Promise.all([
        this.#history.top({ ...args, dimension: 'albums', limit: 12 }),
        this.#history.top({ ...args, dimension: 'tracks', limit: 12 })
      ])
      if (request !== this.#drillRequest) return
      this.artistAlbums = albums ?? []; this.artistTracks = tracks ?? []
      if (!albums || !tracks) this.artistError = 'Artist history is not reachable right now.'
    } catch (e) { if (request === this.#drillRequest) this.artistError = message(e) }
    finally { if (request === this.#drillRequest) this.artistLoading = false }
  }
  async openArtist(entry: ChartEntry): Promise<void> {
    this.closeArtist(); this.artist = entry
    const request = this.#drillRequest
    this.artistLoading = true
    try {
      if (this.tab === 'household') {
        const args = { userIds: [...this.selected], window: this.window, artist: entry.title, limit: 12 }
        const [albums, tracks] = await Promise.all([
          this.#api.top({ ...args, dimension: 'albums' }), this.#api.top({ ...args, dimension: 'tracks' })
        ])
        if (request !== this.#drillRequest) return
        this.artistAlbums = albums.entries
        this.artistTracks = tracks.entries
        return
      }
      if (!this.#history) return
      const args = { artist: entry.title, ...this.bounds }
      const [albums, tracks, stats] = await Promise.all([
        this.#history.top({ ...args, dimension: 'albums', limit: 12 }),
        this.#history.top({ ...args, dimension: 'tracks', limit: 12 }), this.#history.artist(args)
      ])
      if (request !== this.#drillRequest) return
      this.artistAlbums = albums ?? []; this.artistTracks = tracks ?? []; this.artistStats = stats
      if (!albums || !tracks || !stats) this.artistError = 'Artist history is not reachable right now.'
    } catch (e) { if (request === this.#drillRequest) this.artistError = message(e) }
    finally { if (request === this.#drillRequest) this.artistLoading = false }
  }
  // From an artist page: all-time on your own history (household all-time if
  // there's no history), artists chart, with this artist's drill-in open.
  // Reuses the chart row when the artist is on it, so the photo comes along.
  async focusArtist(name: string, ratingKey: string | null = null): Promise<void> {
    if (this.history) this.tab = 'you'
    this.year = null; this.window = 'all'; this.dimension = 'artists'; this.limit = 200
    await this.load()
    const key = name.trim().toLowerCase()
    const row = this.result?.entries.find(e => e.title.trim().toLowerCase() === key)
    await this.openArtist(row ?? { rank: 0, title: name, subtitle: null, plays: 0, seconds: 0, ratingKey, thumb: null })
  }
  async saveConfig(url: string, apiKey: string): Promise<void> {
    const cfg = { url: url.trim(), apiKey: apiKey.trim() }
    await this.#api.setConfig(cfg); this.config = cfg; this.reset()
  }
}
