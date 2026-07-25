import { afterEach, describe, expect, it, vi } from 'vitest'

// posters.ts imports headers.js, which pulls in electron + electron-store. The
// functions under test (parsePostersResponse, measureImage) don't touch
// headers, so stub it to keep this a pure unit test.
vi.mock('./headers.js', () => ({ plexHeaders: () => ({}) }))

import { parsePostersResponse, measureImage } from './posters'

describe('parsePostersResponse', () => {
  it('maps photos and normalises the various `selected` encodings', () => {
    const out = parsePostersResponse({
      MediaContainer: {
        Metadata: [
          { ratingKey: 'metadata://posters/aaa', key: '/library/.../file?url=x', provider: 'local', selected: 1 },
          { ratingKey: 'metadata://posters/bbb', provider: 'fanarttv', selected: '1' },
          { ratingKey: 'metadata://posters/ccc', provider: 'embedded', selected: false },
          { ratingKey: 'metadata://posters/ddd', provider: 'caa' } // selected absent
        ]
      }
    })
    expect(out).toEqual([
      { key: '/library/.../file?url=x', ratingKey: 'metadata://posters/aaa', provider: 'local', selected: true },
      { key: '', ratingKey: 'metadata://posters/bbb', provider: 'fanarttv', selected: true },
      { key: '', ratingKey: 'metadata://posters/ccc', provider: 'embedded', selected: false },
      { key: '', ratingKey: 'metadata://posters/ddd', provider: 'caa', selected: false }
    ])
  })

  it('falls back ratingKey ← key for uncached remote options', () => {
    const out = parsePostersResponse({
      MediaContainer: { Metadata: [{ key: 'https://assets.fanart.tv/x.jpg', provider: 'fanarttv' }] }
    })
    expect(out[0].ratingKey).toBe('https://assets.fanart.tv/x.jpg')
  })

  it('drops rows with neither key nor ratingKey, and tolerates an empty container', () => {
    expect(parsePostersResponse({ MediaContainer: { Metadata: [{ provider: 'local' }] } })).toEqual([])
    expect(parsePostersResponse({ MediaContainer: {} })).toEqual([])
  })
})

// Minimal valid JPEG: SOI + SOF0 carrying 1000×1200.
function jpeg(width: number, height: number): Uint8Array {
  const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff]
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, ...be16(17), 0x08, ...be16(height), ...be16(width), ...new Array(10).fill(0)
  ])
}

describe('measureImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads native dimensions and the short side off the header bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jpeg(1000, 1200), { status: 206 })))
    expect(await measureImage('https://cdn.example/cover.jpg')).toEqual({
      width: 1000,
      height: 1200,
      short: 1000
    })
  })

  it('returns null on a non-OK, non-206 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    expect(await measureImage('https://cdn.example/missing.jpg')).toBeNull()
  })

  it('returns null when the bytes are not a recognised image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 })))
    expect(await measureImage('https://cdn.example/garbage')).toBeNull()
  })

  it('swallows fetch errors and returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await measureImage('https://cdn.example/x.jpg')).toBeNull()
  })
})
