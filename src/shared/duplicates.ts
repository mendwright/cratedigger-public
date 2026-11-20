import type { AlbumMediaInfo, PlexAlbum } from './plex'

export interface DuplicateGroup {
  key: string
  artist: string
  title: string
  albums: PlexAlbum[]
}

/** Normalize an album into a duplicate-grouping key: lowercased artist (sans
 *  leading "the"), title with parens/brackets/edition-suffixes stripped and
 *  non-alphanumerics removed. Pure; exported for testing. */
export function dupKey(a: PlexAlbum): string {
  const artist = a.artist.toLowerCase().replace(/^the\s+/, '').trim()
  const title = a.title.toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+(remastered|deluxe|expanded|anniversary|bonus|edition|disc \d+|cd \d+)\b.*/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
  return `${artist}${title}`
}

/** Group a library into duplicate clusters (≥2 albums sharing a {@link dupKey}),
 *  each sorted by ratingKey, the groups sorted by artist then title. Pure. */
export function buildDuplicateGroups(albums: PlexAlbum[]): DuplicateGroup[] {
  const map = new Map<string, PlexAlbum[]>()
  for (const a of albums) {
    if (!a.artist || !a.title) continue
    const k = dupKey(a)
    if (!k || k === '') continue
    const bucket = map.get(k)
    if (bucket) bucket.push(a)
    else map.set(k, [a])
  }
  const groups: DuplicateGroup[] = []
  for (const [key, list] of map) {
    if (list.length < 2) continue
    groups.push({
      key,
      artist: list[0].artist,
      title: list[0].title,
      albums: [...list].sort((x, y) => x.ratingKey.localeCompare(y.ratingKey))
    })
  }
  return groups.sort((a, b) => {
    const aa = a.artist.toLowerCase().replace(/^the\s+/, '')
    const bb = b.artist.toLowerCase().replace(/^the\s+/, '')
    return aa.localeCompare(bb) || a.title.localeCompare(b.title)
  })
}

// Pull the source-tree name out of a Plex track path. When the library is
// served under `/music/<root>/...` (a common Plex/Docker mount layout), the
// second path segment is the sibling root the album lives in. Returns null
// when the path doesn't fit the expected `/music/<root>/...` shape.
export function albumSourceRoot(samplePath: string | null | undefined): string | null {
  if (!samplePath) return null
  const parts = samplePath.split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'music') return null
  return parts[1] ?? null
}

/** Choose the ratingKey of the "best" copy in a duplicate group: a redacted-tree
 *  copy always wins (curated, read-only, can't be unlinked), then higher
 *  bitrate, then more tracks, then larger size. Pure. */
export function pickBestInGroup(
  group: DuplicateGroup,
  mediaInfo: Record<string, AlbumMediaInfo>
): string | null {
  let bestKey: string | null = null
  let bestScore = -Infinity
  for (const a of group.albums) {
    const info = mediaInfo[a.ratingKey]
    const bitrate = info?.avgBitrate ?? 0
    const tracks = info?.trackCount ?? a.trackCount ?? 0
    const size = info?.totalSize ?? 0
    // Big bias toward keeping the redacted-sourced copy: it's the curated /
    // read-only tree, and the tagger can't unlink files there anyway. Score
    // dominates bitrate so a redacted MP3 still wins over a main FLAC.
    const sourceBonus = albumSourceRoot(info?.samplePath) === 'redacted' ? 1e9 : 0
    const score = sourceBonus + bitrate * 1000 + tracks * 10 + (size > 0 ? Math.log10(size) : 0)
    if (score > bestScore) {
      bestScore = score
      bestKey = a.ratingKey
    }
  }
  return bestKey
}
