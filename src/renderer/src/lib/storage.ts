// The subset of the Web Storage API the controllers persist through. Injected
// as a dep (instead of reaching for the `localStorage` global) so unit tests
// can hand in a Map-backed fake and assert what got persisted.
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * `localStorage` when available (the renderer always has it), else an
 * in-memory fallback so non-DOM contexts don't blow up at construction time.
 */
export function safeLocalStorage(): KeyValueStorage {
  if (typeof localStorage !== 'undefined') return localStorage
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k)
  }
}
