// A "back off for a while" switch for an upstream that's telling us it's
// overloaded (429 / 5xx / timeouts). While active, callers skip the service
// entirely instead of paying a round-trip (or a 10s timeout) per request.
// Clock is injectable so tests don't need fake timers.
export class Cooldown {
  #until = 0
  #now: () => number

  constructor(
    private readonly defaultMs: number,
    private readonly maxMs: number,
    now: () => number = Date.now
  ) {
    this.#now = now
  }

  active(): boolean {
    return this.#now() < this.#until
  }

  /** Start (or extend) the cooldown. `ms` — e.g. from a Retry-After header —
   *  is clamped to [1s, maxMs]; omitted or invalid falls back to defaultMs. */
  trip(ms?: number | null): void {
    const wait =
      typeof ms === 'number' && Number.isFinite(ms) && ms > 0
        ? Math.min(Math.max(ms, 1000), this.maxMs)
        : this.defaultMs
    this.#until = Math.max(this.#until, this.#now() + wait)
  }

  reset(): void {
    this.#until = 0
  }
}

/** Parse a Retry-After header (delta-seconds or HTTP date) into ms. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return secs * 1000
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : at - now
}
