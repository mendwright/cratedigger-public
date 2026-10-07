import { describe, it, expect } from 'vitest'
import { parseLrc, activeLrcIndex } from './lrc'

describe('parseLrc', () => {
  it('parses basic timestamped lines in order', () => {
    const lines = parseLrc('[00:12.00]First line\n[00:05.50]Earlier line\n[01:02.30]Later line')
    expect(lines).toEqual([
      { timeMs: 5500, text: 'Earlier line' },
      { timeMs: 12000, text: 'First line' },
      { timeMs: 62300, text: 'Later line' }
    ])
  })

  it('expands multiple timestamps on one line (chorus repeats)', () => {
    const lines = parseLrc('[00:10.00][01:10.00]Chorus text')
    expect(lines).toEqual([
      { timeMs: 10000, text: 'Chorus text' },
      { timeMs: 70000, text: 'Chorus text' }
    ])
  })

  it('skips metadata tags and untimestamped lines', () => {
    const lines = parseLrc('[ar:Vince Staples]\n[ti:Norf Norf]\nplain text line\n[00:01.00]Real line')
    expect(lines).toEqual([{ timeMs: 1000, text: 'Real line' }])
  })

  it('keeps empty-text lines as instrumental gaps', () => {
    const lines = parseLrc('[00:01.00]Words\n[00:05.00]\n[00:09.00]More words')
    expect(lines.map((l) => l.text)).toEqual(['Words', '', 'More words'])
  })

  it('does not split on brackets inside the lyric text', () => {
    const lines = parseLrc('[00:01.00]He said [laughs] and left')
    expect(lines).toEqual([{ timeMs: 1000, text: 'He said [laughs] and left' }])
  })

  it('handles fractional-part variants', () => {
    expect(parseLrc('[00:01.5]x')[0].timeMs).toBe(1500)
    expect(parseLrc('[00:01.50]x')[0].timeMs).toBe(1500)
    expect(parseLrc('[00:01.500]x')[0].timeMs).toBe(1500)
    expect(parseLrc('[00:01]x')[0].timeMs).toBe(1000)
    expect(parseLrc('[00:01:50]x')[0].timeMs).toBe(1500)
  })

  it('returns empty for plain (unsynced) text', () => {
    expect(parseLrc('just some words\nacross lines')).toEqual([])
  })
})

describe('activeLrcIndex', () => {
  const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:20.00]c')

  it('is -1 before the first line', () => {
    expect(activeLrcIndex(lines, 0)).toBe(-1)
    expect(activeLrcIndex(lines, 4999)).toBe(-1)
  })

  it('activates a line exactly at its timestamp', () => {
    expect(activeLrcIndex(lines, 5000)).toBe(0)
    expect(activeLrcIndex(lines, 10000)).toBe(1)
  })

  it('holds the line until the next one starts', () => {
    expect(activeLrcIndex(lines, 9999)).toBe(0)
    expect(activeLrcIndex(lines, 19999)).toBe(1)
  })

  it('sticks on the last line past the end', () => {
    expect(activeLrcIndex(lines, 120000)).toBe(2)
  })

  it('handles empty input', () => {
    expect(activeLrcIndex([], 1000)).toBe(-1)
  })
})
