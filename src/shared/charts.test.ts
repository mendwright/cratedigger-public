import { describe, expect, it } from 'vitest'
import { formatListened } from './charts'

describe('formatListened', () => {
  it('shows minutes under an hour, never zero', () => {
    expect(formatListened(20)).toBe('1 min')
    expect(formatListened(48 * 60)).toBe('48 min')
  })
  it('shows one decimal of hours up to ten, whole hours after', () => {
    expect(formatListened(5.9 * 3600)).toBe('5.9 h')
    expect(formatListened(4 * 3600)).toBe('4 h')
    expect(formatListened(31.4 * 3600)).toBe('31 h')
  })
})
