// Serialized rate limiter: every call runs FIFO through a single promise
// chain, with at least `minGapMs` between the *end* of one call and the
// *start* of the next. Extracted from musicbrainz.ts, where it enforces
// MusicBrainz's 1 req/sec unauthenticated limit (with a deliberate 1.1s gap
// for safety margin). No Electron imports — pure Node, unit-testable with
// fake timers.

export type Paced = <T>(fn: () => Promise<T>) => Promise<T>

export function createPaced(minGapMs: number): Paced {
  let queue: Promise<unknown> = Promise.resolve()
  let lastAt = 0

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const wait = Math.max(0, minGapMs - (Date.now() - lastAt))
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      try {
        return await fn()
      } finally {
        lastAt = Date.now()
      }
    }
    // `queue.then(run, run)` keeps FIFO order while making a rejected call
    // a non-event for the *next* caller; the trailing `.catch` ensures the
    // stored chain itself never carries a rejection (which would otherwise
    // surface as an unhandled rejection).
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }
}
