export function isHttpUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length === 0) return false
  try {
    const u = new URL(input)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function isPlexAuthUrl(input: unknown): input is string {
  if (typeof input !== 'string') return false
  try {
    const u = new URL(input)
    if (u.protocol !== 'https:') return false
    return u.hostname === 'app.plex.tv' || u.hostname === 'www.plex.tv' || u.hostname === 'plex.tv'
  } catch {
    return false
  }
}

export function safeExternalHref(input: unknown): string | null {
  return isHttpUrl(input) ? input : null
}

/**
 * Redacted torrent search for an artist + album, for opening in the browser.
 * Multi-artist export strings ("Whitney;Waxahatchee") search under the
 * primary artist — RED's artist field wants one name.
 */
export function redSearchUrl(artist: string, album: string): string {
  const primary = artist.split(';')[0].trim() || artist
  return `https://redacted.sh/torrents.php?artistname=${encodeURIComponent(primary)}&groupname=${encodeURIComponent(album)}`
}
