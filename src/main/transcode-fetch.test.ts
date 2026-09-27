import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchTranscodeWithRetry,
  _setFetchForTests,
  TRANSCODE_RETRY_DELAYS_MS
} from './transcode-fetch'

const URL = 'https://plex.example/photo/:/transcode?width=320'
const TOKEN = 'tok'

const ok = () => new Response('jpeg-bytes', { status: 200 })
const status = (code: number) => new Response('', { status: code })

// Runs the retry loop under fake timers, flushing each backoff sleep.
async function run(promise: Promise<Response>): Promise<Response> {
  for (let i = 0; i < TRANSCODE_RETRY_DELAYS_MS.length + 1; i++) {
    await vi.advanceTimersByTimeAsync(35000)
  }
  return promise
}

describe('fetchTranscodeWithRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    _setFetchForTests((...args) => globalThis.fetch(...args))
  })

  it('returns first-try success without retrying', async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(ok())
    _setFetchForTests(stub)
    const res = await run(fetchTranscodeWithRetry(URL, TOKEN))
    expect(res.status).toBe(200)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('sends the token header', async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(ok())
    _setFetchForTests(stub)
    await run(fetchTranscodeWithRetry(URL, TOKEN))
    const init = stub.mock.calls[0][1]!
    expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe(TOKEN)
  })

  it('retries a network error and returns the eventual success', async () => {
    const stub = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ERR_ADDRESS_UNREACHABLE'))
      .mockResolvedValue(ok())
    _setFetchForTests(stub)
    const res = await run(fetchTranscodeWithRetry(URL, TOKEN))
    expect(res.status).toBe(200)
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('retries a 5xx and returns the eventual success', async () => {
    const stub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(status(502))
      .mockResolvedValue(ok())
    _setFetchForTests(stub)
    const res = await run(fetchTranscodeWithRetry(URL, TOKEN))
    expect(res.status).toBe(200)
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx — that is a real answer', async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(status(404))
    _setFetchForTests(stub)
    const res = await run(fetchTranscodeWithRetry(URL, TOKEN))
    expect(res.status).toBe(404)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries and throws the last error', async () => {
    const stub = vi.fn<typeof fetch>().mockRejectedValue(new Error('still down'))
    _setFetchForTests(stub)
    const promise = fetchTranscodeWithRetry(URL, TOKEN)
    const guarded = promise.catch((e) => e)
    for (let i = 0; i < TRANSCODE_RETRY_DELAYS_MS.length + 1; i++) {
      await vi.advanceTimersByTimeAsync(35000)
    }
    expect(await guarded).toEqual(new Error('still down'))
    expect(stub).toHaveBeenCalledTimes(1 + TRANSCODE_RETRY_DELAYS_MS.length)
  })
})
