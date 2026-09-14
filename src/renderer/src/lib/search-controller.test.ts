import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SearchResults } from '../../../shared/plex'
import { SearchController, type SearchDeps } from './search-controller.svelte'

const CTX = { serverId: 'srv-1', sectionKey: '3' }

function emptyResults(tag: string): SearchResults {
  // The tag rides along in the (unused) hubs so tests can assert *which*
  // response landed without caring about SearchResults' real shape.
  return { artists: [], albums: [], tracks: [], _tag: tag } as unknown as SearchResults
}

/** A search stub whose promises we resolve by hand, to drive race ordering. */
function deferredSearch() {
  const calls: { query: string; resolve: (r: SearchResults) => void; reject: (e: unknown) => void }[] = []
  const search: SearchDeps['search'] = ({ query }) =>
    new Promise<SearchResults>((resolve, reject) => {
      calls.push({ query, resolve, reject })
    })
  return { calls, search }
}

describe('SearchController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces: only fires after the window, once', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => CTX, search, debounceMs: 250 })

    c.setQuery('mi')
    c.setQuery('mil')
    c.setQuery('miles')
    expect(c.loading).toBe(true)
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(250)
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe('miles')
  })

  it('request-sequence guard: a slow earlier response cannot clobber a newer one', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => CTX, search, debounceMs: 0 })

    c.setQuery('first')
    await vi.advanceTimersByTimeAsync(0)
    c.setQuery('second')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)

    // Resolve the NEWER request first, then the stale one.
    calls[1].resolve(emptyResults('second'))
    calls[0].resolve(emptyResults('first'))
    await vi.runAllTimersAsync()

    expect((c.results as unknown as { _tag: string })._tag).toBe('second')
    expect(c.loading).toBe(false)
  })

  it('empty / whitespace query clears state and skips the network', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => CTX, search, debounceMs: 250 })

    c.setQuery('miles')
    c.setQuery('   ')
    expect(c.loading).toBe(false)
    expect(c.results).toBeNull()

    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
  })

  it('clear() cancels a pending debounce and resets state', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => CTX, search, debounceMs: 250 })

    c.setQuery('miles')
    c.clear()
    expect(c.query).toBe('')
    expect(c.loading).toBe(false)

    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
  })

  it('surfaces a thrown error and stops loading', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => CTX, search, debounceMs: 0 })

    c.setQuery('boom')
    await vi.advanceTimersByTimeAsync(0)
    calls[0].reject(new Error('plex down'))
    await vi.runAllTimersAsync()

    expect(c.error).toBe('plex down')
    expect(c.loading).toBe(false)
  })

  it('no-ops the network when there is no server context', async () => {
    const { calls, search } = deferredSearch()
    const c = new SearchController({ context: () => null, search, debounceMs: 0 })

    c.setQuery('miles')
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
  })
})
