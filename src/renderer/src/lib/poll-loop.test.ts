import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PollLoop, type PollTickResult } from './poll-loop'

/** A fake `document` with a controllable hidden flag + visibilitychange bus. */
function makeDoc(opts: { hidden?: boolean } = {}) {
  const listeners = new Set<() => void>()
  return {
    hidden: opts.hidden ?? false,
    addEventListener: vi.fn((_type: string, fn: () => void) => void listeners.add(fn)),
    removeEventListener: vi.fn((_type: string, fn: () => void) => void listeners.delete(fn)),
    fireVisibilityChange(): void {
      for (const fn of [...listeners]) fn()
    },
    listenerCount(): number {
      return listeners.size
    }
  }
}

/** A tick stub that replays `results` in order (sticking on the last one). */
function makeTick(results: PollTickResult[]) {
  let i = 0
  return vi.fn(async () => results[Math.min(i++, results.length - 1)])
}

describe('PollLoop', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ticks immediately on start, then at the normal cadence while polls succeed', async () => {
    const tick = makeTick(['ok'])
    new PollLoop({ tick }).start()

    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2499)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(2500)
    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('backs off 2.5s, 5s, 10s, 20s, then caps at 30s while polls fail', async () => {
    const tick = makeTick(['error'])
    new PollLoop({ tick }).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)

    // First retry stays at the normal cadence; only repeats escalate.
    for (const delay of [2500, 5000, 10000, 20000, 30000, 30000]) {
      const before = tick.mock.calls.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(tick).toHaveBeenCalledTimes(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(tick).toHaveBeenCalledTimes(before + 1)
    }
  })

  it('a success resets the backoff to the normal cadence', async () => {
    const tick = makeTick(['error', 'error', 'ok', 'error'])
    new PollLoop({ tick }).start()
    await vi.advanceTimersByTimeAsync(0) // error → retry in 2500
    await vi.advanceTimersByTimeAsync(2500) // error → retry in 5000
    await vi.advanceTimersByTimeAsync(5000) // ok → failures reset
    expect(tick).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(2500) // normal cadence again → error
    expect(tick).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(2500) // first retry back at 2500, not 10000
    expect(tick).toHaveBeenCalledTimes(5)
  })

  it("a 'skip' tick stalls the loop without rescheduling", async () => {
    const tick = makeTick(['skip'])
    new PollLoop({ tick }).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('a thrown tick is treated as a failure, not an unhandled rejection', async () => {
    const tick = vi.fn(async () => {
      throw new Error('boom')
    })
    new PollLoop({ tick: tick as unknown as () => Promise<PollTickResult> }).start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2500) // backoff schedule still alive
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('drops a run() that overlaps an in-flight tick', async () => {
    let release!: (r: PollTickResult) => void
    const tick = vi.fn(() => new Promise<PollTickResult>((res) => (release = res)))
    const loop = new PollLoop({ tick })
    loop.start()
    await vi.advanceTimersByTimeAsync(0) // tick now in flight
    void loop.run()
    void loop.run()
    expect(tick).toHaveBeenCalledTimes(1)
    release('ok')
  })

  it('stop clears the pending timer and removes the visibilitychange listener', async () => {
    const doc = makeDoc()
    vi.stubGlobal('document', doc)
    const tick = makeTick(['ok'])
    const loop = new PollLoop({ tick })
    loop.start()
    expect(doc.listenerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)

    loop.stop()
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(doc.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tick).toHaveBeenCalledTimes(1) // no further polls

    // …and a foreground event after stop can't revive the loop.
    doc.fireVisibilityChange()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('keeps a slow keep-alive while hidden, without running the tick', async () => {
    const doc = makeDoc({ hidden: true })
    vi.stubGlobal('document', doc)
    const tick = makeTick(['ok'])
    new PollLoop({ tick }).start()

    await vi.advanceTimersByTimeAsync(0)
    expect(tick).not.toHaveBeenCalled() // skipped, rescheduled at 3000
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).not.toHaveBeenCalled() // still hidden — keep-alive only

    doc.hidden = false
    await vi.advanceTimersByTimeAsync(3000) // backstop tick finds us visible
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('foregrounding polls immediately and resets the backoff', async () => {
    const doc = makeDoc({ hidden: true })
    vi.stubGlobal('document', doc)
    const tick = makeTick(['error', 'error', 'error'])
    new PollLoop({ tick }).start()

    // Two visible failures first, so the backoff has escalated to 5s.
    doc.hidden = false
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2500)
    expect(tick).toHaveBeenCalledTimes(2)

    // Hide, then foreground: the pending backoff timer is replaced by an
    // immediate poll — no waiting out the remaining slice.
    doc.hidden = true
    doc.fireVisibilityChange()
    doc.hidden = false
    doc.fireVisibilityChange()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(3)

    // Failures were reset by the foreground path: the retry after this error
    // is back at 2500, not the escalated 10s.
    await vi.advanceTimersByTimeAsync(2500)
    expect(tick).toHaveBeenCalledTimes(4)
  })
})
