import { describe, expect, it, vi } from 'vitest'
import { BackgroundJobRunner } from './background-job.js'

// Minimal progress shape mirroring the real jobs (warmer / radar / label
// index): a running flag, counters, and a last-error slot.
interface TestProgress {
  running: boolean
  done: number
  total: number
  lastError: string | null
}

const INITIAL: TestProgress = { running: false, done: 0, total: 0, lastError: null }

function makeRunner(): {
  job: BackgroundJobRunner<TestProgress>
  broadcasts: TestProgress[]
} {
  const broadcasts: TestProgress[] = []
  const job = new BackgroundJobRunner<TestProgress>(INITIAL, (p) => broadcasts.push(p))
  return { job, broadcasts }
}

// A manually-released gate so tests can hold a body mid-flight.
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((r) => {
    open = r
  })
  return { promise, open }
}

describe('BackgroundJobRunner', () => {
  it('runs the body between a start patch and a finish patch', async () => {
    const { job, broadcasts } = makeRunner()
    const result = await job.run(
      { done: 0, total: 3 },
      async () => {
        job.update({ done: 3 })
        return 'snapshot'
      },
      { lastError: null }
    )
    expect(result).toBe('snapshot')
    // Sequence: start (running flips on) → body update → finish (running off).
    expect(broadcasts).toEqual([
      { running: true, done: 0, total: 3, lastError: null },
      { running: true, done: 3, total: 3, lastError: null },
      { running: false, done: 3, total: 3, lastError: null }
    ])
    expect(job.getProgress().running).toBe(false)
  })

  it('start is idempotent: a second run while in flight resolves undefined without touching progress', async () => {
    const { job, broadcasts } = makeRunner()
    const hold = gate()
    const first = job.run({ total: 1 }, async () => {
      await hold.promise
      return 'first'
    })
    const before = broadcasts.length
    const second = await job.run({ total: 99 }, async () => 'second')
    expect(second).toBeUndefined()
    expect(broadcasts.length).toBe(before) // no start patch broadcast for the no-op
    expect(job.getProgress().total).toBe(1)

    hold.open()
    await expect(first).resolves.toBe('first')
  })

  it('stop is a no-op when idle — a stale stop cannot poison the next run', async () => {
    const { job } = makeRunner()
    job.stop()
    let sawCancel: boolean | null = null
    await job.run({}, async () => {
      sawCancel = job.cancelled
    })
    expect(sawCancel).toBe(false)
  })

  it('stop mid-loop sets the cancel flag the loop polls, and resets it after the run', async () => {
    const { job } = makeRunner()
    const hold = gate()
    let processed = 0
    const run = job.run({ done: 0, total: 5 }, async () => {
      for (let i = 0; i < 5; i++) {
        if (job.cancelled) break
        await hold.promise // first item blocks; stop() arrives while we wait
        processed++
        job.update({ done: job.progress.done + 1 })
      }
    })
    job.stop()
    expect(job.cancelled).toBe(true)
    hold.open()
    await run
    // Item 0 was already past the check when stop landed; items 1-4 were skipped.
    expect(processed).toBe(1)
    expect(job.cancelled).toBe(false) // flag cleared for the next run
    expect(job.getProgress().running).toBe(false)
  })

  it('a thrown body still applies the finish patch, resets state, and propagates the error', async () => {
    const { job, broadcasts } = makeRunner()
    await expect(
      job.run(
        { done: 0 },
        async () => {
          throw new Error('boom')
        },
        { lastError: 'boom' }
      )
    ).rejects.toThrow('boom')
    expect(job.getProgress()).toEqual({
      running: false,
      done: 0,
      total: 0,
      lastError: 'boom'
    })
    expect(broadcasts.at(-1)?.running).toBe(false)

    // The failed run must not wedge the runner — a fresh run still starts.
    const again = await job.run({ done: 0, lastError: null }, async () => 'recovered')
    expect(again).toBe('recovered')
  })

  it('update merges patches and broadcasts every change', async () => {
    const { job, broadcasts } = makeRunner()
    const seen = vi.fn()
    await job.run({ done: 0, total: 2 }, async () => {
      job.update({ done: 1 })
      seen(job.progress.done)
      job.update({ done: 2, lastError: 'x: failed' })
      seen(job.progress.done)
    })
    expect(seen).toHaveBeenNthCalledWith(1, 1)
    expect(seen).toHaveBeenNthCalledWith(2, 2)
    expect(broadcasts.map((b) => b.done)).toEqual([0, 1, 2, 2])
    expect(job.getProgress().lastError).toBe('x: failed')
  })
})
