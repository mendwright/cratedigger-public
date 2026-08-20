import { describe, it, expect } from 'vitest'
import { coverKey, retrySrc } from './cover-retry'

const SRC = 'cratedigger-plex://thumb/?path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F2&size=320'

describe('coverKey', () => {
  it('passes a proxied cover src through unchanged', () => {
    expect(coverKey(SRC)).toBe(SRC)
  })

  it('strips the retry param so attempts share an identity', () => {
    expect(coverKey(`${SRC}&retry=2`)).toBe(SRC)
  })

  it('rejects non-proxied images', () => {
    expect(coverKey('https://example.com/cover.jpg')).toBeNull()
    expect(coverKey('data:image/png;base64,AAAA')).toBeNull()
    expect(coverKey('')).toBeNull()
  })
})

describe('retrySrc', () => {
  it('appends the cache-busting attempt number', () => {
    expect(retrySrc(SRC, 1)).toBe(`${SRC}&retry=1`)
  })

  it('round-trips through coverKey', () => {
    expect(coverKey(retrySrc(SRC, 3))).toBe(SRC)
  })

  it('preserves the path param intact', () => {
    const url = new URL(retrySrc(SRC, 1))
    expect(url.searchParams.get('path')).toBe('/library/metadata/1/thumb/2')
    expect(url.searchParams.get('size')).toBe('320')
  })
})
