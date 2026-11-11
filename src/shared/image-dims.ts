// Pure image-dimension parsing from the leading bytes of a file. We never have
// width/height handed to us by Plex's posters API (see HANDOFF §3a), so to rank
// a cover by resolution we fetch the first chunk of the image and read the
// dimensions straight out of the container header — no decoding, no deps.
//
// Supports the three formats album art actually ships as: JPEG (Deezer, iTunes,
// most CAA), PNG (some CAA / embedded), and GIF (rare, but cheap to cover).
// Returns null for anything unrecognised or truncated so callers can fall back.

export interface ImageDims {
  width: number
  height: number
}

export function parseImageDims(bytes: Uint8Array): ImageDims | null {
  return parsePng(bytes) ?? parseGif(bytes) ?? parseJpeg(bytes)
}

/** Shorter side — the dimension the low-res threshold is measured against. */
export function shortSide(dims: ImageDims): number {
  return Math.min(dims.width, dims.height)
}

function read32be(b: Uint8Array, o: number): number {
  // Multiply the high byte rather than `<< 24` to stay in unsigned range.
  return b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
}

// PNG: 8-byte signature, then the IHDR chunk must come first — its payload
// opens with 32-bit big-endian width then height (at byte offsets 16 and 20).
function parsePng(b: Uint8Array): ImageDims | null {
  if (b.length < 24) return null
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let k = 0; k < 8; k++) if (b[k] !== SIG[k]) return null
  // "IHDR" at offset 12 confirms the first chunk is the header.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
  return { width: read32be(b, 16), height: read32be(b, 20) }
}

// GIF: "GIF87a"/"GIF89a", then the logical-screen width/height as 16-bit
// little-endian values at offsets 6 and 8.
function parseGif(b: Uint8Array): ImageDims | null {
  if (b.length < 10) return null
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return null
  if ((b[4] !== 0x37 && b[4] !== 0x39) || b[5] !== 0x61) return null
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
}

// JPEG: SOI (FF D8) then a chain of marker segments. Walk them, skipping each
// segment by its declared length, until we hit a Start-Of-Frame marker (C0–CF,
// excluding the non-frame markers C4/C8/CC) whose payload carries height then
// width as 16-bit big-endian after a one-byte sample-precision field.
function parseJpeg(b: Uint8Array): ImageDims | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i++ // resync to the next marker prefix
      continue
    }
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++ // run of 0xff fill bytes between segments
      continue
    }
    i += 2
    // Standalone markers (SOI/EOI, the restart markers, TEM) carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (i + 1 >= b.length) return null
    const len = (b[i] << 8) | b[i + 1]
    if (len < 2) return null
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (i + 6 >= b.length) return null
      // payload: [precision][height hi][height lo][width hi][width lo]
      const height = (b[i + 3] << 8) | b[i + 4]
      const width = (b[i + 5] << 8) | b[i + 6]
      return { width, height }
    }
    i += len // length includes its own 2 bytes → jumps to the next marker
  }
  return null
}
