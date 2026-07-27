import type {
  ChartUser,
  ChartResult,
  ChartWindow,
  ChartDimension,
  TautulliConfig
} from '../../../shared/charts'

type ChartsApi = Window['cratedigger']['charts']

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

  #configLoaded = false

  constructor(deps?: { api?: ChartsApi }) {
    this.#api = deps?.api ?? window.cratedigger.charts
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
      if (this.users.length === 0) await this.loadUsers()
    } catch (e) {
      this.error = msg(e)
    }
    await this.load()
    this.ready = true
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

  toggleUser(id: number): void {
    const next = new Set(this.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
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
    if (w === this.window) return
    this.window = w
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
