/**
 * Minimal Map-based LRU. A Map iterates in insertion order, so "least
 * recently used" is simply the first key: get() and set() re-insert the entry
 * to mark it most-recent, and set() evicts from the front once over capacity.
 *
 * Session-scoped only (never persisted) — shared by the hover-prefetch /
 * back-nav album-detail cache and the entity-page cache, so navigating back
 * to something recently viewed renders instantly while a background refetch
 * freshens it.
 */
export class LruCache<K, V> {
  #map = new Map<K, V>()
  #max: number

  constructor(max: number) {
    this.#max = max
  }

  /** Read an entry and mark it most-recently-used. */
  get(key: K): V | undefined {
    const value = this.#map.get(key)
    if (value === undefined) return undefined
    this.#map.delete(key)
    this.#map.set(key, value)
    return value
  }

  /** Read without touching recency — for patching an entry in place. */
  peek(key: K): V | undefined {
    return this.#map.get(key)
  }

  /** Insert (or refresh) as most-recently-used, evicting the oldest beyond capacity. */
  set(key: K, value: V): void {
    this.#map.delete(key)
    this.#map.set(key, value)
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value
      if (oldest === undefined) break
      this.#map.delete(oldest)
    }
  }

  delete(key: K): boolean {
    return this.#map.delete(key)
  }

  clear(): void {
    this.#map.clear()
  }

  get size(): number {
    return this.#map.size
  }
}
