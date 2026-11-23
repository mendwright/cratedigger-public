import { describe, it, expect } from 'vitest'
import { PlayReporter, type PlaySample } from './play-reporter'

function harness() {
  let now = 0
  const posts: PlaySample[] = []
  const timers: { at: number; fn: () => void; live: boolean }[] = []
  const schedule = (fn: () => void, ms: number) => {
    const t = { at: now + ms, fn, live: true }
    timers.push(t)
    return { cancel: () => { t.live = false } }
  }
  const r = new PlayReporter(async (s) => { posts.push(s) }, () => now, schedule)
  const tick = (ms: number) => {
    now += ms
    for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn() }
  }
  const s = (ratingKey: string, state: PlaySample['state'], timeMs: number, durationMs = 200_000): PlaySample =>
    ({ ratingKey, state, timeMs, durationMs })
  return { r, posts, s, tick }
}

describe('PlayReporter', () => {
  it('posts on start, every 10s while playing, and not in between', () => {
    const { r, posts, s, tick } = harness()
    r.observe(s('1', 'playing', 0))
    tick(1000); r.observe(s('1', 'playing', 1000))
    tick(9000); r.observe(s('1', 'playing', 10_000))
    expect(posts.map((p) => p.timeMs)).toEqual([0, 10_000])
  })

  it('reports a pause once it has held, then the resume', () => {
    const { r, posts, s, tick } = harness()
    r.observe(s('1', 'playing', 0))
    tick(2000); r.observe(s('1', 'paused', 2000))
    expect(posts.map((p) => p.state)).toEqual(['playing'])
    tick(1500)
    tick(5000); r.observe(s('1', 'playing', 2000))
    expect(posts.map((p) => p.state)).toEqual(['playing', 'paused', 'playing'])
  })

  it('swallows the momentary pause a seek produces', () => {
    const { r, posts, s, tick } = harness()
    r.observe(s('1', 'playing', 0))
    tick(3000); r.observe(s('1', 'paused', 150_000)) // seek blip past halfway
    tick(10); r.observe(s('1', 'playing', 150_000))
    tick(5000)
    expect(posts.map((p) => [p.state, p.timeMs])).toEqual([['playing', 0], ['playing', 150_000]])
  })

  it('closes the old track when the track changes', () => {
    const { r, posts, s, tick } = harness()
    r.observe(s('1', 'playing', 0))
    tick(4000); r.observe(s('1', 'playing', 4000))
    r.observe(s('2', 'playing', 0))
    expect(posts).toEqual([
      s('1', 'playing', 0),
      s('1', 'stopped', 4000),
      s('2', 'playing', 0)
    ])
  })

  it('treats paused-at-the-end as a finished track and closes it once', () => {
    const { r, posts, s } = harness()
    r.observe(s('1', 'playing', 0))
    r.observe(s('1', 'paused', 199_800))
    r.observe(s('2', 'stopped', 0)) // next track loading
    r.observe(s('2', 'playing', 0))
    expect(posts.map((p) => [p.ratingKey, p.state, p.timeMs])).toEqual([
      ['1', 'playing', 0],
      ['1', 'stopped', 199_800],
      ['2', 'playing', 0]
    ])
  })

  it('closes the session when playback is cleared', () => {
    const { r, posts, s } = harness()
    r.observe(s('1', 'playing', 0))
    r.observe(null)
    r.observe(null)
    expect(posts.map((p) => p.state)).toEqual(['playing', 'stopped'])
  })

  it('does not open a session for a track that never started', () => {
    const { r, posts, s } = harness()
    r.observe(s('1', 'stopped', 0))
    r.observe(s('1', 'paused', 0))
    r.observe(null)
    expect(posts).toEqual([])
  })

  it('survives a post that rejects', async () => {
    const r = new PlayReporter(() => Promise.reject(new Error('offline')))
    expect(() => r.observe({ ratingKey: '1', state: 'playing', timeMs: 0, durationMs: 1 })).not.toThrow()
  })
})
