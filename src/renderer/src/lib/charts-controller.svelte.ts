import type {
  ChartUser,
  ChartResult,
  ChartWindow,
  ChartDimension,
  TautulliConfig
} from '../../../shared/charts'
import { yearBounds, type HistorySummary } from '../../../shared/listening-history'

type ChartsApi = Window['cratedigger']['charts']
type HistoryApi = Pick<Window['cratedigger']['history'], 'summary' | 'top'>

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Owns the Charts screen's state: the Tautulli connection config, the set of
// listeners (users) and which are included, the active window/dimension, and
// the fetched ranking. View orchestration (openCharts/closeCharts) stays on
// PlexState; this just loads and shapes the data. Deps are injected so it can
// be unit-tested without a real preload bridge.
export class ChartsController {
  #api: ChartsApi
  #history: HistoryApi | null

  config = $state<TautulliConfig>({ url: '', apiKey: '' })
  configured = $derived(!!this.config.url && !!this.config.apiKey)

  users = $state<ChartUser[]>([])
  // Included user ids. Empty selection renders nothing (rather than "all").
  selected = $state<Set<number>>(new Set())

  window = $state<ChartWindow>('month')
  dimension = $state<ChartDimension>('artists')

  result = $state<ChartResult | null>(null)
  loading = $state(false)
  error = $state<string | null>(null)
  // True once the first load attempt has finished (so the screen can tell
  // "still loading" from "loaded but empty").
  ready = $state(false)

  // "Your years": the signed-in person's whole listening history (Last.fm
  // export + Plex log, merged on the tagger), charted one calendar year at a
  // time. null = no history for this account, so the mode stays hidden.
  history = $state<HistorySummary | null>(null)
  mode = $state<'recent' | 'years'>('recent')
  // Selected calendar year in "years" mode; null = the whole history.
  year = $state<number | null>(null)

  #configLoaded = false
  #historyLoaded = false

  constructor(deps?: { api?: ChartsApi; history?: HistoryApi | null }) {
    this.#api = deps?.api ?? window.cratedigger.charts
    this.#history = deps?.history !== undefined ? deps.history : (window.cratedigger.history ?? null)
  }

  // Called when the Charts view opens. Loads config (for Settings display),
  // then the user list, then the first ranking. Works whether the data comes
  // from live Tautulli (owner) or the published snapshot (friends) — the main
  // process decides the source; this just renders whatever comes back.
  async activate(): Promise<void> {
    this.error = null
    this.loading = true
    try {
      await this.#ensureConfig()
      await Promise.all([this.users.length === 0 ? this.loadUsers() : null, this.#ensureHistory()])
    } catch (e) {
      this.error = msg(e)
    }
    await this.load()
    this.ready = true
  }

  async #ensureHistory(): Promise<void> {
    if (this.#historyLoaded || !this.#history) return
    try {
      this.history = await this.#history.summary()
      this.#historyLoaded = true
    } catch {
      // History is a bonus; Charts works without it.
      this.history = null
    }
    if (!this.history && this.mode === 'years') this.mode = 'recent'
  }

  async #ensureConfig(): Promise<void> {
    if (this.#configLoaded) return
    try {
      this.config = await this.#api.getConfig()
      this.#configLoaded = true
    } catch (e) {
      this.error = msg(e)
    }
  }

  async loadUsers(): Promise<void> {
    try {
      this.users = await this.#api.users()
      // Default to everyone selected on first load.
      if (this.selected.size === 0) {
        this.selected = new Set(this.users.map((u) => u.userId))
      }
    } catch (e) {
      this.error = msg(e)
    }
  }

  async load(): Promise<void> {
    if (this.mode === 'years' && this.#history) {
      await this.#loadYear(this.#history)
      return
    }
    if (this.selected.size === 0) {
      this.result = null
      this.loading = false
      return
    }
    this.loading = true
    this.error = null
    try {
      this.result = await this.#api.top({
        userIds: [...this.selected],
        window: this.window,
        dimension: this.dimension,
        limit: 50
      })
    } catch (e) {
      this.error = msg(e)
      this.result = null
    } finally {
      this.loading = false
    }
  }

  async #loadYear(api: HistoryApi): Promise<void> {
    this.loading = true
    this.error = null
    const bounds = this.year != null ? yearBounds(this.year) : null
    const dimension = this.dimension
    const year = this.year
    try {
      const entries = await api.top({
        dimension,
        start: bounds?.start ?? null,
        end: bounds?.end ?? null,
        limit: 50
      })
      // A newer pick landed while this was in flight — drop the stale answer.
      if (this.mode !== 'years' || this.year !== year || this.dimension !== dimension) return
      this.result = entries ? { dimension, window: 'all', userIds: [], entries } : null
      if (!entries) this.error = 'Your listening history is not reachable right now.'
    } catch (e) {
      this.error = msg(e)
      this.result = null
    } finally {
      this.loading = false
    }
  }

  setMode(mode: 'recent' | 'years'): void {
    if (mode === this.mode || (mode === 'years' && !this.history)) return
    this.mode = mode
    this.result = null
    void this.load()
  }

  setYear(year: number | null): void {
    if (year === this.year && this.mode === 'years') return
    this.year = year
    this.mode = 'years'
    void this.load()
  }

  // True when the chart is the combined "everyone" view. The chips read this
  // to light up the `everyone` pill instead of every name at once.
  get allSelected(): boolean {
    return this.users.length > 0 && this.users.every((u) => this.selected.has(u.userId))
  }

  // Modifier-click: add or remove one person to compare a few listeners
  // side by side. Removing the last one falls back to everyone rather than
  // leaving an empty, resultless chart.
  toggleUser(id: number): void {
    const next = new Set(this.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size === 0) {
      this.selectAll()
      return
    }
    this.selected = next
    void this.load()
  }

  onlyUser(id: number): void {
    this.selected = new Set([id])
    void this.load()
  }

  selectAll(): void {
    this.selected = new Set(this.users.map((u) => u.userId))
    void this.load()
  }

  setWindow(w: ChartWindow): void {
    if (w === this.window && this.mode === 'recent') return
    this.window = w
    this.mode = 'recent'
    void this.load()
  }

  setDimension(d: ChartDimension): void {
    if (d === this.dimension) return
    this.dimension = d
    void this.load()
  }

  async saveConfig(url: string, apiKey: string): Promise<void> {
    const cfg = { url: url.trim(), apiKey: apiKey.trim() }
    await this.#api.setConfig(cfg)
    this.config = cfg
    this.#configLoaded = true
    // Config changed — drop derived data so the next openCharts reloads from
    // scratch. Don't fetch here: saving Settings shouldn't block on Tautulli.
    this.users = []
    this.selected = new Set()
    this.result = null
  }
}
