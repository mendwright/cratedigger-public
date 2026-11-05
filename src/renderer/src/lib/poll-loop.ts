/**
 * Outcome of one poll tick, reported by the tick body:
 *   - 'ok'    — the poll landed; reschedule at the normal cadence.
 *   - 'error' — the poll failed; back off exponentially (first retry stays at
 *               the normal cadence — see the comment in {@link PollLoop.run}).
 *   - 'skip'  — preconditions absent (no player / session / target). The loop
 *               stalls — no reschedule — until start() or a foreground
 *               force-poll revives it.
 */
export type PollTickResult = 'ok' | 'error' | 'skip'

export interface PollLoopOptions {
  /** The tick body. The loop owns *when* it runs; the body owns *what* it does. */
  tick: () => Promise<PollTickResult>
  /** Cadence between successful polls. */
  intervalMs?: number
  /** Cap on the exponential backoff. */
  maxDelayMs?: number
  /** Keep-alive cadence while the document is hidden (no tick is run). */
  hiddenIntervalMs?: number
  /** Give up on a tick that hasn't settled by then and keep the loop alive. */
  watchdogMs?: number
}

/**
 * The timing machine behind PlaybackController's timeline poll, extracted so
 * the cadence/backoff/visibility policy is testable on its own: a fixed
 * cadence while polls succeed, exponential backoff (2500·2^(n−1), capped)
 * while they fail, a slow keep-alive while the document is hidden, and an
 * immediate force-poll when the window is foregrounded.
 *
 * Plain class, no runes — callers observe poll *results* through whatever
 * state the tick body writes, not through the loop itself.
 */
export class PollLoop {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private failures = 0
  private visibilityHandler: (() => void) | null = null

  private readonly tick: () => Promise<PollTickResult>
  private readonly intervalMs: number
  private readonly maxDelayMs: number
  private readonly hiddenIntervalMs: number
  private readonly watchdogMs: number

  constructor(opts: PollLoopOptions) {
    this.tick = opts.tick
    this.intervalMs = opts.intervalMs ?? 2500
    this.maxDelayMs = opts.maxDelayMs ?? 30000
    this.hiddenIntervalMs = opts.hiddenIntervalMs ?? 3000
    this.watchdogMs = opts.watchdogMs ?? 15000
  }

  start(): void {
    if (this.timer !== null) return
    if (this.visibilityHandler === null && typeof document !== 'undefined') {
      this.visibilityHandler = (): void => {
        // Foregrounded: poll *now* so the current track shows immediately. Don't
        // gate on the timer being null — while hidden the loop keeps a slow
        // keep-alive timer pending, so it's never null here. Gating on it
        // meant foregrounding waited out the remaining slice of that cycle
        // (~half its length on average) before the bar/page caught up.
        // schedule() clears the pending timer first, so forcing a 0ms poll is
        // safe. This also revives a loop that stalled on a 'skip' tick.
        if (!document.hidden) {
          this.failures = 0
          this.schedule(0)
        }
      }
      document.addEventListener('visibilitychange', this.visibilityHandler)
    }
    this.failures = 0
    this.schedule(0)
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.failures = 0
    if (this.visibilityHandler !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  /**
   * Run one tick now, applying the full policy (overlap drop, hidden
   * keep-alive, reschedule). Manual "poll soon" call sites route through here
   * so an out-of-band poll folds into the loop instead of racing it.
   */
  async run(): Promise<void> {
    if (this.inFlight) return
    if (typeof document !== 'undefined' && document.hidden) {
      // Backgrounded: skip the network poll but keep the loop alive so it
      // resumes on its own. The primary fast-resume path is the
      // visibilitychange force-poll above; this is the backstop for when that
      // transition is missed (or when macOS/Electron reports the window
      // occluded while it's actually viewable). Keep the backstop tight — 10s
      // here meant a track that auto-advanced lagged up to 10s (avg ~5s)
      // before the bar/page caught up.
      this.schedule(this.hiddenIntervalMs)
      return
    }
    this.inFlight = true
    let result: PollTickResult
    let watchdog: ReturnType<typeof setTimeout> | null = null
    try {
      // The overlap guard above means a tick that never settles would kill the
      // loop outright — inFlight stays true, every future run() (including the
      // visibilitychange force-poll) returns immediately, and nothing but a
      // page reload revives it. The tick body's own network deadlines should
      // make that impossible, but this loop is the Now Playing bar's heartbeat;
      // give up on a zombie tick and keep beating. If the zombie settles later
      // its result is simply dropped (any stale state write it makes is
      // corrected by the next tick).
      result = await Promise.race([
        this.tick().catch((): PollTickResult => 'error'),
        new Promise<PollTickResult>((resolve) => {
          watchdog = setTimeout(() => resolve('error'), this.watchdogMs)
        })
      ])
    } finally {
      if (watchdog !== null) clearTimeout(watchdog)
      this.inFlight = false
    }
    if (result === 'skip') return
    if (result === 'ok') {
      this.failures = 0
      this.schedule(this.intervalMs)
    } else {
      this.failures += 1
      // 2.5s, 5s, 10s, 20s, 30s cap — don't hammer an offline player, but keep
      // the *first* retry at the normal cadence. A lone failure is usually a
      // transient poll timeout while Plexamp transitions tracks; backing off to
      // 5s on that first miss added ~2.5s to natural-advance catch-up for no
      // benefit. Only escalate once misses actually repeat.
      this.schedule(Math.min(this.intervalMs * Math.pow(2, this.failures - 1), this.maxDelayMs))
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delayMs)
  }
}
