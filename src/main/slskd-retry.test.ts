import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module reaches Electron for the "we retried" broadcast and slskd.ts for
// the transfer list; the sweep itself takes the list, the retry and the clock as
// injectable deps, so stub the imports away and drive it directly.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./slskd.js', () => ({
  listDownloads: vi.fn(),
  retryDownload: vi.fn()
}))
vi.mock('./store.js', () => ({ getSlskdUrl: vi.fn(() => 'http://slskd.test:5030') }))

import {
  MAX_AUTO_RETRIES,
  _resetAutoRetryStateForTests,
  isRetryableFailure,
  sweepFailedDownloads
} from './slskd-retry.js'
import type { SlskdDownloads } from '../shared/slskd.js'

const MINUTE = 60_000

function downloads(
  files: { username?: string; id: string; filename: string; state: string; size?: number }[]
): SlskdDownloads {
  const byUser = new Map<string, typeof files>()
  for (const f of files) {
    const u = f.username ?? 'alice'
    byUser.set(u, [...(byUser.get(u) ?? []), f])
  }
  return {
    users: [...byUser].map(([username, fs]) => ({
      username,
      directories: [
        {
          directory: 'Music\\Album',
          files: fs.map((f) => ({
            id: f.id,
            filename: f.filename,
            state: f.state,
            percent: 0,
            size: f.size ?? 100,
            bytesTransferred: 0,
            averageSpeed: 0,
            startedAt: null,
            endedAt: null
          }))
        }
      ],
      totalFiles: fs.length,
      inProgressFiles: 0,
      completedFiles: 0,
      erroredFiles: fs.length
    })),
    totals: { files: files.length, inProgress: 0, completed: 0, errored: files.length, queued: 0 }
  }
}

/** A clock the tests move by hand, plus a sweep bound to it. */
function harness(retry: (...args: unknown[]) => Promise<void> = async () => {}) {
  let clock = 1_000_000
  const spy = vi.fn(retry)
  return {
    retry: spy,
    advance: (ms: number): void => {
      clock += ms
    },
    sweep: (dl: SlskdDownloads) =>
      sweepFailedDownloads({ list: async () => dl, retry: spy, gapMs: 0, now: () => clock })
  }
}

const errored = (id = 'a', filename = 'Music\\Album\\01.flac'): SlskdDownloads =>
  downloads([{ id, filename, state: 'Completed, Errored' }])

beforeEach(() => {
  _resetAutoRetryStateForTests()
})

describe('isRetryableFailure', () => {
  it('retries the transient failures', () => {
    expect(isRetryableFailure('Completed, Errored')).toBe(true)
    expect(isRetryableFailure('Completed, TimedOut')).toBe(true)
  })

  it('leaves user-cancelled and peer-rejected transfers alone', () => {
    expect(isRetryableFailure('Completed, Cancelled')).toBe(false)
    expect(isRetryableFailure('Completed, Rejected')).toBe(false)
  })

  it('ignores healthy states', () => {
    expect(isRetryableFailure('InProgress')).toBe(false)
    expect(isRetryableFailure('Queued, Remotely')).toBe(false)
    expect(isRetryableFailure('Completed, Succeeded')).toBe(false)
  })
})

describe('sweepFailedDownloads', () => {
  it('re-posts each failed file on first sight and leaves healthy ones alone', async () => {
    const h = harness()
    const result = await h.sweep(
      downloads([
        { id: 'a', filename: 'Music\\Album\\01.flac', state: 'Completed, Errored' },
        { id: 'b', filename: 'Music\\Album\\02.flac', state: 'Completed, Succeeded' },
        { id: 'c', filename: 'Music\\Album\\03.flac', state: 'Completed, TimedOut', size: 42 }
      ])
    )
    expect(result).toEqual({ retried: 2, waiting: 0, exhausted: 0, errors: 0 })
    expect(h.retry.mock.calls).toEqual([
      ['alice', 'a', 'Music\\Album\\01.flac', 100],
      ['alice', 'c', 'Music\\Album\\03.flac', 42]
    ])
  })

  it('spaces the three asks out and then stops for good', async () => {
    expect(MAX_AUTO_RETRIES).toBe(3)
    const h = harness()

    expect((await h.sweep(errored())).retried).toBe(1) // ask 1, immediate

    h.advance(MINUTE)
    expect(await h.sweep(errored())).toMatchObject({ retried: 0, waiting: 1 })

    h.advance(9 * MINUTE) // 10 min after ask 1
    expect((await h.sweep(errored())).retried).toBe(1) // ask 2

    h.advance(20 * MINUTE)
    expect(await h.sweep(errored())).toMatchObject({ retried: 0, waiting: 1 })

    h.advance(25 * MINUTE) // 45 min after ask 2
    expect((await h.sweep(errored())).retried).toBe(1) // ask 3

    h.advance(24 * 60 * MINUTE) // a day later: budget spent, hands off
    expect(await h.sweep(errored())).toMatchObject({ retried: 0, exhausted: 1 })
    expect(h.retry).toHaveBeenCalledTimes(3)
  })

  it('keys the budget by filename, not slskd id', async () => {
    const h = harness()
    expect((await h.sweep(errored('a'))).retried).toBe(1)
    // A retry removes the old entry and re-POSTs, so slskd hands back a fresh
    // id — the budget must still be spent for the same file.
    h.advance(MINUTE)
    expect(await h.sweep(errored('brand-new-id'))).toMatchObject({ retried: 0, waiting: 1 })
    expect(h.retry).toHaveBeenCalledTimes(1)
  })

  it('tracks the same filename from different uploaders separately', async () => {
    const h = harness()
    const result = await h.sweep(
      downloads([
        { username: 'alice', id: 'a', filename: 'Music\\Album\\01.flac', state: 'Completed, Errored' },
        { username: 'bob', id: 'b', filename: 'Music\\Album\\01.flac', state: 'Completed, Errored' }
      ])
    )
    expect(result.retried).toBe(2)
    expect(h.retry).toHaveBeenCalledTimes(2)
  })

  it('spends the attempt when slskd refuses the retry, then waits out the backoff', async () => {
    const h = harness(async () => {
      throw new Error('slskd unreachable')
    })
    expect(await h.sweep(errored())).toEqual({ retried: 0, waiting: 0, exhausted: 0, errors: 1 })

    h.advance(MINUTE)
    expect(await h.sweep(errored())).toMatchObject({ waiting: 1, errors: 0 })

    h.advance(10 * MINUTE)
    expect(await h.sweep(errored())).toMatchObject({ errors: 1 })
    expect(h.retry).toHaveBeenCalledTimes(2)
  })

  it('forgets a file once it succeeds, so a later re-grab gets a full budget', async () => {
    const h = harness()
    await h.sweep(errored())
    await h.sweep(downloads([{ id: 'a', filename: 'Music\\Album\\01.flac', state: 'Completed, Succeeded' }]))
    h.advance(MINUTE)
    expect((await h.sweep(errored())).retried).toBe(1)
  })

  it('is a no-op when nothing failed', async () => {
    const h = harness()
    const result = await h.sweep(
      downloads([{ id: 'a', filename: 'Music\\Album\\01.flac', state: 'InProgress' }])
    )
    expect(result).toEqual({ retried: 0, waiting: 0, exhausted: 0, errors: 0 })
    expect(h.retry).not.toHaveBeenCalled()
  })
})
