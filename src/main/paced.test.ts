import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaced } from './paced.js'

const GAP = 1100

describe('createPaced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the first call immediately (no artificial startup delay)', async () => {
    const paced = createPaced(GAP)
    const fn = vi.fn(async () => 'a')
    const p = paced(fn)
    // Only microtasks should be needed — no timer wait on the first call
    // (lastAt starts at 0, so the gap has long since elapsed).
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe('a')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('enforces the minimum gap between consecutive calls', async () => {
    const paced = createPaced(GAP)
    const startedAt: number[] = []
    const t0 = Date.now()
    const make = () =>
      paced(async () => {
        startedAt.push(Date.now() - t0)
      })
    const p1 = make()
    const p2 = make()
    await vi.advanceTimersByTimeAsync(0)
    expect(startedAt).toEqual([0]) // second call still waiting on the gap

    // Just before the gap elapses, still only one execution.
    await vi.advanceTimersByTimeAsync(GAP - 1)
    expect(startedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([p1, p2])
    expect(startedAt).toEqual([0, GAP])
  })

  it('measures the gap from the end of the previous call, not its start', async () => {
    const paced = createPaced(GAP)
    const startedAt: number[] = []
    const t0 = Date.now()
    const p1 = paced(async () => {
      startedAt.push(Date.now() - t0)
      // Slow call: takes 500ms.
      await new Promise((r) => setTimeout(r, 500))
    })
    const p2 = paced(async () => {
      startedAt.push(Date.now() - t0)
    })
    await vi.runAllTimersAsync()
    await Promise.all([p1, p2])
    // Second starts GAP after the first *finished* (500 + 1100), not after it started.
    expect(startedAt).toEqual([0, 500 + GAP])
  })

  it('preserves FIFO ordering across many queued calls', async () => {
    const paced = createPaced(GAP)
    const order: number[] = []
    const ps = [1, 2, 3, 4].map((n) =>
      paced(async () => {
        order.push(n)
        return n
      })
    )
    await vi.runAllTimersAsync()
    const results = await Promise.all(ps)
    expect(order).toEqual([1, 2, 3, 4])
    expect(results).toEqual([1, 2, 3, 4])
  })

  it('a rejected call does not wedge the queue', async () => {
    const paced = createPaced(GAP)
    const boom = paced(async () => {
      throw new Error('boom')
    })
    boom.catch(() => undefined) // observed below; avoid unhandled-rejection noise
    const after = paced(async () => 'still alive')

    await vi.runAllTimersAsync()
    await expect(boom).rejects.toThrow('boom')
    await expect(after).resolves.toBe('still alive')
  })

  it('a rejected call still counts toward pacing for the next call', async () => {
    const paced = createPaced(GAP)
    const startedAt: number[] = []
    const t0 = Date.now()
    const boom = paced(async () => {
      startedAt.push(Date.now() - t0)
      throw new Error('boom')
    })
    boom.catch(() => undefined)
    const ok = paced(async () => {
      startedAt.push(Date.now() - t0)
    })
    await vi.runAllTimersAsync()
    await ok
    expect(startedAt).toEqual([0, GAP])
  })
})
