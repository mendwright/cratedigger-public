// Pure folder-path heuristics shared by main (search scoring, browse grouping)
// and the renderer (re-searching a failed download by its remote directory).

export function splitPath(filename: string): string[] {
  return filename.split(/[\\/]/).filter(Boolean)
}

export function guessArtistAlbum(parts: string[]): {
  artist: string | null
  album: string | null
  folder: string
} {
  const folder = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '')
  const parent = parts.length >= 3 ? parts[parts.length - 3] : null
  // Common layouts:
  //   Artist/Album/01 - track.flac  → parent=Artist, folder=Album
  //   Artist - Album (year)/01 - track.flac → folder has both
  //   Various Artists/Album/…
  let artist: string | null = null
  let album: string | null = null

  const dashSplit = folder.split(/\s+-\s+/)
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim()
    album = dashSplit.slice(1).join(' - ').replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim()
  } else {
    album = folder.replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim() || null
    if (parent) artist = parent.trim()
  }
  return { artist, album, folder }
}
