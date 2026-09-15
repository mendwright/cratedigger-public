import type { SpotifyTrack } from './spotify'

// Parse playlist files exported from Spotify — the no-API import path
// (Spotify's Feb 2026 policy change put dev-mode Web API behind Premium).
// Two formats:
//   1. Exportify CSV — one playlist per file, has durations.
//   2. Spotify data-export JSON (Privacy → Download your data) — a
//      PlaylistN.json holds many playlists; no durations (matching copes:
//      duration only tunes the score, title+artist are the gate).

export interface ParsedPlaylist {
  name: string
  tracks: SpotifyTrack[]
}

// Minimal RFC-4180 CSV: quoted fields, doubled-quote escapes, CRLF/LF rows.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // Skip blank lines rather than emitting [''].
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

// Exportify header names have drifted over the years ("Track Name" vs
// "Track name", "Artist Name(s)" …) — match on normalized substrings.
function findColumn(headers: string[], ...needles: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z ]/g, '').trim())
  for (const needle of needles) {
    const i = norm.findIndex((h) => h.includes(needle))
    if (i >= 0) return i
  }
  return -1
}

export function parseExportifyCsv(text: string, filename: string): ParsedPlaylist | null {
  const rows = parseCsv(text)
  if (rows.length < 2) return null
  const headers = rows[0]
  const titleCol = findColumn(headers, 'track name')
  const artistCol = findColumn(headers, 'artist names', 'artist name')
  const albumCol = findColumn(headers, 'album name')
  const durationCol = findColumn(headers, 'duration ms', 'track duration')
  if (titleCol < 0 || artistCol < 0) return null

  const tracks: SpotifyTrack[] = []
  for (const row of rows.slice(1)) {
    const title = row[titleCol]?.trim()
    if (!title) continue
    const rawDuration = durationCol >= 0 ? Number(row[durationCol]) : NaN
    tracks.push({
      title,
      artist: row[artistCol]?.trim() ?? '',
      album: albumCol >= 0 ? (row[albumCol]?.trim() ?? '') : '',
      durationMs: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
      isLocal: false
    })
  }
  if (tracks.length === 0) return null
  // Exportify names files after the playlist ("liked.csv", "rap_heaters.csv").
  const name = filename.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim() || 'imported playlist'
  return { name, tracks }
}

// Spotify data-export Playlist JSON shape (fields observed across dumps —
// all optional-chained since Spotify has renamed them before).
interface DumpTrack {
  trackName?: string
  artistName?: string
  albumName?: string
}
interface DumpItem {
  track?: DumpTrack | null
  localTrack?: { title?: string; artist?: string; album?: string } | null
}
interface DumpPlaylist {
  name?: string
  items?: DumpItem[]
}

export function parseSpotifyDumpJson(text: string): ParsedPlaylist[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const lists: DumpPlaylist[] = Array.isArray(parsed)
    ? (parsed as DumpPlaylist[])
    : ((parsed as { playlists?: DumpPlaylist[] })?.playlists ?? [])
  const out: ParsedPlaylist[] = []
  for (const pl of lists) {
    if (!pl || !Array.isArray(pl.items)) continue
    const tracks: SpotifyTrack[] = []
    for (const item of pl.items) {
      const t = item?.track
      if (t?.trackName) {
        tracks.push({
          title: t.trackName,
          artist: t.artistName ?? '',
          album: t.albumName ?? '',
          durationMs: null,
          isLocal: false
        })
      } else if (item?.localTrack?.title) {
        tracks.push({
          title: item.localTrack.title,
          artist: item.localTrack.artist ?? '',
          album: item.localTrack.album ?? '',
          durationMs: null,
          isLocal: true
        })
      }
    }
    if (tracks.length > 0) out.push({ name: pl.name || 'untitled', tracks })
  }
  return out
}

/**
 * Make playlist names unique — Spotify allows duplicate names ("Grieg Lyric
 * Pieces" twice), and downstream everything keys on name: Svelte each-blocks
 * crash on duplicate keys, and `file:<name>` import reports would collide.
 */
export function uniquifyNames(lists: ParsedPlaylist[]): ParsedPlaylist[] {
  const seen = new Map<string, number>()
  return lists.map((pl) => {
    const n = (seen.get(pl.name) ?? 0) + 1
    seen.set(pl.name, n)
    return n === 1 ? pl : { ...pl, name: `${pl.name} (${n})` }
  })
}

/** Route by content: JSON dumps parse as JSON; anything else tries CSV. */
export function parsePlaylistFile(text: string, filename: string): ParsedPlaylist[] {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const dumped = parseSpotifyDumpJson(text)
    if (dumped.length > 0) return dumped
  }
  const csv = parseExportifyCsv(text, filename)
  return csv ? [csv] : []
}
