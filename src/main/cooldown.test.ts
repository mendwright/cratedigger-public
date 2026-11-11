import { describe, expect, it } from 'vitest'
import { Cooldown, retryAfterMs } from './cooldown'

describe('Cooldown', () => {
  it('is inactive until tripped, then expires after the default window', () => {
    let now = 1_000_000
    const c = new Cooldown(60_000, 600_000, () => now)
    expect(c.active()).toBe(false)
    c.trip()
    expect(c.active()).toBe(true)
    now += 59_999
    expect(c.active()).toBe(true)
    now += 1
    expect(c.active()).toBe(false)
  })

  it('honors an explicit wait, clamped to the max', () => {
    let now = 0
    const c = new Cooldown(60_000, 120_000, () => now)
    c.trip(10_000)
    now = 10_000
    expect(c.active()).toBe(false)
    c.trip(10 * 60_000) // way over max
    now += 120_000
    expect(c.active()).toBe(false)
  })

  it('never shortens an active cooldown', () => {
    let now = 0
    const c = new Cooldown(60_000, 600_000, () => now)
    c.trip(300_000)
    c.trip(5_000)
    now = 200_000
    expect(c.active()).toBe(true)
  })

  it('reset clears it', () => {
    const c = new Cooldown(60_000, 600_000, () => 0)
    c.trip()
    c.reset()
    expect(c.active()).toBe(false)
  })
})

describe('retryAfterMs', () => {
  it('parses seconds and HTTP dates', () => {
    expect(retryAfterMs('30')).toBe(30_000)
    expect(retryAfterMs(new Date(90_000).toUTCString(), 30_000)).toBe(60_000)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs('soon')).toBeNull()
  })
})
