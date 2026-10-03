import { describe, it, expect } from 'vitest'
import { fmtMs, fmtLen, fmtSize, fmtBitrate, fmtSpeed, fmtIsoDate, fmtMbDate } from './format'

describe('fmtMs', () => {
  it('formats m:ss with zero-padded seconds', () => {
    expect(fmtMs(61_000)).toBe('1:01')
    expect(fmtMs(225_000)).toBe('3:45')
  })

  it('rounds to the nearest second', () => {
    expect(fmtMs(59_600)).toBe('1:00')
  })

  it('returns empty for null and 0', () => {
    expect(fmtMs(null)).toBe('')
    expect(fmtMs(0)).toBe('')
  })

  it('handles durations over an hour as minutes', () => {
    expect(fmtMs(3_600_000)).toBe('60:00')
  })
})

describe('fmtLen', () => {
  it('formats seconds as m:ss, flooring fractions', () => {
    expect(fmtLen(61)).toBe('1:01')
    expect(fmtLen(125.9)).toBe('2:05')
  })

  it('returns empty for null and 0', () => {
    expect(fmtLen(null)).toBe('')
    expect(fmtLen(0)).toBe('')
  })
})

describe('fmtSize', () => {
  it('picks units at binary boundaries', () => {
    expect(fmtSize(512)).toBe('512 B')
    expect(fmtSize(1024)).toBe('1 KB')
    expect(fmtSize(1024 * 1024)).toBe('1.0 MB')
    expect(fmtSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })

  it('formats a real 0 as "0 B" but null as empty', () => {
    expect(fmtSize(0)).toBe('0 B')
    expect(fmtSize(null)).toBe('')
  })

  it('just-below-boundary values stay in the smaller unit', () => {
    expect(fmtSize(1023)).toBe('1023 B')
    expect(fmtSize(1024 * 1024 - 1)).toBe('1024 KB')
  })
})

describe('fmtBitrate', () => {
  it('uses kbps below 1000 and Mbps at or above', () => {
    expect(fmtBitrate(320)).toBe('320 kbps')
    expect(fmtBitrate(999)).toBe('999 kbps')
    expect(fmtBitrate(1000)).toBe('1.0 Mbps')
    expect(fmtBitrate(1411)).toBe('1.4 Mbps')
  })

  it('returns empty for null and 0', () => {
    expect(fmtBitrate(null)).toBe('')
    expect(fmtBitrate(0)).toBe('')
  })
})

describe('fmtSpeed', () => {
  it('picks units at binary boundaries', () => {
    expect(fmtSpeed(512)).toBe('512 B/s')
    expect(fmtSpeed(1024)).toBe('1 KB/s')
    expect(fmtSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s')
  })

  it('formats 0 as a real speed', () => {
    expect(fmtSpeed(0)).toBe('0 B/s')
  })
})

describe('fmtIsoDate', () => {
  it('renders a unix-millis timestamp as YYYY-MM-DD', () => {
    expect(fmtIsoDate(Date.UTC(2026, 5, 9, 12, 0, 0))).toBe('2026-06-09')
  })
})

describe('fmtMbDate', () => {
  it('renders full, month, and year precision as given', () => {
    expect(fmtMbDate('2026-08-14')).toBe('Aug 14, 2026')
    expect(fmtMbDate('2026-08')).toBe('Aug 2026')
    expect(fmtMbDate('2026')).toBe('2026')
  })

  it('returns unparseable input as-is', () => {
    expect(fmtMbDate('soon')).toBe('soon')
    expect(fmtMbDate('')).toBe('')
  })
})
