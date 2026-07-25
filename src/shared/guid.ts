// Canonical MBID / Plex GUID parsing. All regexes and extraction helpers
// in one place — shared between main and renderer with no dependencies.
//
// Strict UUID body everywhere: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
// (was a mix of strict and loose [0-9a-f-]{36} across the codebase — the loose
// variant accepted malformed UUIDs).

const RAW_MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MBID_GUID_RE = /^mbid:\/\/(?:(release|release-group|artist)\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * Type guard: true if the string is a valid MBID (strict 8-4-4-4-12 UUID).
 */
export function isValidMbid(s: string | null | undefined): s is string {
  return !!s && RAW_MBID_RE.test(s)
}

/**
 * Parse a Plex GUID (mbid://release/UUID etc.) into its entity type and MBID.
 * Returns null if the format doesn't match. Defaults entity to 'release'
 * when no explicit tag is present.
 */
export function extractMbidFromGuid(
  guid: string
): { entity: 'release' | 'release-group' | 'artist'; mbid: string } | null {
  const m = MBID_GUID_RE.exec(guid)
  if (!m) return null
  const entity = (m[1] ?? 'release') as 'release' | 'release-group' | 'artist'
  return { entity, mbid: m[2].toLowerCase() }
}

/**
 * Convenience: extract just the MBID from a Plex GUID (no entity info).
 */
export function mbidFromGuid(guid: string): string | null {
  const m = MBID_GUID_RE.exec(guid)
  return m ? m[2].toLowerCase() : null
}

/**
 * Scan an array of Plex GUIDs and return the first MBID found.
 */
export function firstMbid(guids: string[]): string | null {
  for (const g of guids) {
    const m = mbidFromGuid(g)
    if (m) return m
  }
  return null
}

/**
 * Split an array of Plex GUIDs into release and release-group MBIDs.
 * Returns the first MBID found for each entity type.
 */
export function splitAlbumMbids(
  guids: string[]
): { release: string | null; releaseGroup: string | null } {
  let release: string | null = null
  let releaseGroup: string | null = null
  for (const g of guids) {
    const parsed = extractMbidFromGuid(g)
    if (!parsed) continue
    if (parsed.entity === 'release' && !release) release = parsed.mbid
    else if (parsed.entity === 'release-group' && !releaseGroup) releaseGroup = parsed.mbid
  }
  return { release, releaseGroup }
}
