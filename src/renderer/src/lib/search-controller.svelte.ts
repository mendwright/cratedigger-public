import type { SearchResults } from '../../../shared/plex'

/**
 * Dependencies injected by PlexState. Keeping the IPC call and the
 * server/section context behind this seam means the controller's debounce +
 * request-sequence-guard logic can be exercised with a stub — no
 * window.cratedigger, no live Plex server.
 */
export interface SearchDeps {
  /** Current { serverId, sectionKey }, or null when not signed in / no section. */
  context: () => { serverId: string; sectionKey: string } | null
  /** The library-search IPC call. */
  search: (args: { serverId: string; sectionKey: string; query: string }) => Promise<SearchResults>
  /** Debounce window in ms (default 250). */
  debounceMs?: number
}

/**
 * Owns the library search box: query text, debounced fetch, and a
 * request-sequence guard so a slow earlier response can't clobber a newer one.
 * Extracted from PlexState as a deep module — small interface
 * ({ query, results, loading, error } + setQuery / clear), all the timing and
 * race logic localized here.
 */
export class SearchController {
  query = $state('')
  results = $state<SearchResults | null>(null)
  loading = $state(false)
  error = $state<string | null>(null)

  #deps: SearchDeps
  #debounceMs: number
  #timer: ReturnType<typeof setTimeout> | null = null
  #seq = 0

  constructor(deps: SearchDeps) {
    this.#deps = deps
    this.#debounceMs = deps.debounceMs ?? 250
  }

  setQuery(q: string): void {
    this.query = q
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    const trimmed = q.trim()
    if (!trimmed) {
      this.results = null
      this.loading = false
      this.error = null
      return
    }
    this.loading = true
    this.error = null
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.#run(trimmed)
    }, this.#debounceMs)
  }

  clear(): void {
    this.query = ''
    this.results = null
    this.error = null
    this.loading = false
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  async #run(query: string): Promise<void> {
    const ctx = this.#deps.context()
    if (!ctx) return
    const seq = ++this.#seq
    try {
      const results = await this.#deps.search({ ...ctx, query })
      if (seq !== this.#seq) return
      this.results = results
      this.error = null
    } catch (err) {
      if (seq !== this.#seq) return
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      if (seq === this.#seq) this.loading = false
    }
  }
}
