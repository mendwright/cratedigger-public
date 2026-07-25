import { describe, it, expect } from 'vitest'
import { parseImageDims, shortSide } from './image-dims'

function bytes(...vals: number[]): Uint8Array {
  return Uint8Array.from(vals)
}

// 16-bit big-endian splat
function be16(n: number): [number, number] {
  return [(n >> 8) & 0xff, n & 0xff]
}
function be32(n: number): [number, number, number, number] {
  return [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
function le16(n: number): [number, number] {
  return [n & 0xff, (n >> 8) & 0xff]
}

describe('parseImageDims — JPEG', () => {
  it('reads dimensions from SOF0 after an APP0 segment', () => {
    const b = bytes(
      0xff, 0xd8, // SOI
      0xff, 0xe0, ...be16(16), ...new Array(14).fill(0), // APP0 (JFIF), 14-byte payload
      0xff, 0xc0, ...be16(17), 0x08, ...be16(1200), ...be16(1000), ...new Array(10).fill(0) // SOF0
    )
    expect(parseImageDims(b)).toEqual({ width: 1000, height: 1200 })
  })

  it('skips multiple non-frame segments before the SOF', () => {
    const b = bytes(
      0xff, 0xd8,
      0xff, 0xe1, ...be16(8), 1, 2, 3, 4, 5, 6, // APP1 (EXIF-ish)
      0xff, 0xdb, ...be16(6), 9, 9, 9, 9, // DQT
      0xff, 0xc2, ...be16(17), 0x08, ...be16(640), ...be16(640), ...new Array(10).fill(0) // SOF2 (progressive)
    )
    expect(parseImageDims(b)).toEqual({ width: 640, height: 640 })
  })

  it('handles 0xff fill bytes between segments', () => {
    const b = bytes(
      0xff, 0xd8,
      0xff, 0xff, 0xff, 0xc0, ...be16(17), 0x08, ...be16(300), ...be16(450), ...new Array(10).fill(0)
    )
    expect(parseImageDims(b)).toEqual({ width: 450, height: 300 })
  })

  it('returns null when truncated before the SOF dimensions', () => {
    const b = bytes(0xff, 0xd8, 0xff, 0xc0, ...be16(17), 0x08, 0x04) // cut off mid-payload
    expect(parseImageDims(b)).toBeNull()
  })
})

describe('parseImageDims — PNG', () => {
  it('reads width/height from IHDR', () => {
    const b = bytes(
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      ...be32(13), 0x49, 0x48, 0x44, 0x52, // IHDR length + "IHDR"
      ...be32(1400), ...be32(1400), // width, height
      0x08, 0x06, 0x00, 0x00, 0x00 // bit depth, colour type, etc.
    )
    expect(parseImageDims(b)).toEqual({ width: 1400, height: 1400 })
  })

  it('reads large dimensions without sign overflow', () => {
    const b = bytes(
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...be32(13), 0x49, 0x48, 0x44, 0x52,
      ...be32(3000), ...be32(2400),
      0x08, 0x06, 0x00, 0x00, 0x00
    )
    expect(parseImageDims(b)).toEqual({ width: 3000, height: 2400 })
  })
})

describe('parseImageDims — GIF', () => {
  it('reads logical-screen size (little-endian) from GIF89a', () => {
    const b = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(500), ...le16(320), 0xf7, 0, 0)
    expect(parseImageDims(b)).toEqual({ width: 500, height: 320 })
  })
})

describe('parseImageDims — rejects', () => {
  it('returns null for unrecognised bytes', () => {
    expect(parseImageDims(bytes(0x00, 0x01, 0x02, 0x03, 0x04))).toBeNull()
  })
  it('returns null for an empty buffer', () => {
    expect(parseImageDims(new Uint8Array(0))).toBeNull()
  })
})

describe('shortSide', () => {
  it('returns the smaller dimension', () => {
    expect(shortSide({ width: 1400, height: 1200 })).toBe(1200)
    expect(shortSide({ width: 800, height: 1000 })).toBe(800)
  })
})
