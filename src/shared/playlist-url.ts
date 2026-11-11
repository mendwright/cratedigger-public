import type { SpotifyTrack } from './spotify'
import type { ParsedPlaylist } from './playlist-file'

// "Paste a playlist" — the one-box import path. The box accepts three things:
//   1. A Spotify playlist link/URI. Read via open.spotify.com's embed page,
//      whose server-rendered JSON carries the track list without any API
//      credential (the Web API itself is Premium-gated since Feb 2026). The
//      embed caps at 100 tracks; longer lists need an Exportify CSV.
//   2. An Apple Music playlist link. The web page embeds the whole track
//      list as serialized server data — no token needed.
//   3. Plain text, one song per line as `Artist - Title` (same first-dash
//      rule as the Soulseek paste box).
// The HTML parsers are pure (string in, playlist out) so they test without
// the network; the fetch lives in main.

export type PastedSource = 'spotify' | 'apple' | 'text'

export interface PastedPlaylist extends ParsedPlaylist {
  source: PastedSource
  /** Canonical URL for link sources — the re-import key, so a later paste of
   *  the same list (trailing `?si=` and all) refills the same Plex playlist. */
  url: string | null
  /** The source holds more tracks than the page exposed (Spotify's 100-cap). */
  truncated: boolean
}

export type PasteKind =
  | { kind: 'spotify'; id: string; url: string }
  | { kind: 'apple'; storefront: string; id: string; url: string }
  | { kind: 'text'; tracks: SpotifyTrack[] }
  | { kind: 'empty' }

const SPOTIFY_URL = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{10,})/i
const SPOTIFY_URI = /^spotify:playlist:([A-Za-z0-9]{10,})$/i
const APPLE_URL = /music\.apple\.com\/([a-z]{2})\/playlist\/(?:[^/?#]+\/)?(pl\.[A-Za-z0-9._-]+)/i

export function spotifyEmbedUrl(id: string): string {
  return `https://open.spotify.com/embed/playlist/${id}`
}

export function spotifyPlaylistUrl(id: string): string {
  return `https://open.spotify.com/playlist/${id}`
}

export function applePlaylistUrl(storefront: string, id: string): string {
  return `https://music.apple.com/${storefront.toLowerCase()}/playlist/${id}`
}

/** Work out what the user pasted. A link anywhere in the text wins (people
 *  paste "check this out https://open.spotify.com/…"); otherwise the whole
 *  thing is read as song lines. */
export function classifyPaste(text: string): PasteKind {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'empty' }
  const uri = SPOTIFY_URI.exec(trimmed)
  if (uri) return { kind: 'spotify', id: uri[1], url: spotifyPlaylistUrl(uri[1]) }
  const sp = SPOTIFY_URL.exec(trimmed)
  if (sp) return { kind: 'spotify', id: sp[1], url: spotifyPlaylistUrl(sp[1]) }
  const am = APPLE_URL.exec(trimmed)
  if (am) {
    return {
      kind: 'apple',
      storefront: am[1].toLowerCase(),
      id: am[2],
      url: applePlaylistUrl(am[1], am[2])
    }
  }
  const tracks = parseTrackLines(trimmed)
  return tracks.length > 0 ? { kind: 'text', tracks } : { kind: 'empty' }
}

/**
 * `Artist - Title` lines → tracks. Accepts hyphen / en-dash / em-dash with
 * space on both sides, or "Artist- Title" (sloppy paste). The lazy left side
 * picks the FIRST separator so dashes inside the title survive. Leading
 * list numbering ("1.", "12)", "-", "•") and a trailing "3:45" duration are
 * shaved off — both are common when a tracklist is copied off a web page.
 * Lines with no separator are skipped rather than guessed at.
 */
export function parseTrackLines(text: string): SpotifyTrack[] {
  const STRICT = /^(.+?)\s+[-–—]\s+(.+)$/
  const LOOSE = /^(.+?)[-–—]\s+(.+)$/
  const tracks: SpotifyTrack[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    line = line.replace(/^(?:\d{1,3}[.):]?|[-•*·])\s+/, '')
    line = line.replace(/\s+\(?\d{1,2}:\d{2}\)?$/, '')
    const m = STRICT.exec(line) ?? LOOSE.exec(line)
    if (!m) continue
    const artist = m[1].trim()
    const title = m[2].trim()
    if (!artist || !title) continue
    tracks.push({ artist, title, album: '', durationMs: null, isLocal: false })
  }
  return tracks
}

function scriptJson(html: string, openTag: RegExp): unknown | null {
  const m = openTag.exec(html)
  if (!m) return null
  const start = m.index + m[0].length
  const end = html.indexOf('</script>', start)
  if (end < 0) return null
  try {
    return JSON.parse(html.slice(start, end))
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/** The Spotify embed page: `<script id="__NEXT_DATA__">` →
 *  props.pageProps.state.data.entity { name, trackList[{title, subtitle,
 *  duration}] }. subtitle is the artists comma-joined, same shape as an
 *  Exportify "Artist Name(s)" cell, so matching copes. No album field. */
export function parseSpotifyEmbedHtml(html: string, id: string): PastedPlaylist | null {
  const data = scriptJson(html, /<script[^>]*id="__NEXT_DATA__"[^>]*>/)
  const entity = (data as { props?: { pageProps?: { state?: { data?: { entity?: unknown } } } } })
    ?.props?.pageProps?.state?.data?.entity as
    | { name?: unknown; title?: unknown; trackList?: unknown }
    | undefined
  if (!entity || !Array.isArray(entity.trackList)) return null
  const tracks: SpotifyTrack[] = []
  for (const t of entity.trackList as Record<string, unknown>[]) {
    const title = str(t.title)
    const artist = str(t.subtitle)
    if (!title || !artist) continue
    tracks.push({ artist, title, album: '', durationMs: num(t.duration), isLocal: false })
  }
  if (tracks.length === 0) return null
  return {
    name: str(entity.name) || str(entity.title) || 'Spotify playlist',
    tracks,
    source: 'spotify',
    url: spotifyPlaylistUrl(id),
    // The embed never renders past 100 — a list that's exactly 100 long is
    // far more likely cut off than a coincidence.
    truncated: tracks.length >= 100
  }
}

/** The Apple Music web page: `<script id="serialized-server-data">` →
 *  { data: [ { data: { sections: [ { itemKind: 'trackLockup', items:
 *  [{ title, artistName, duration, tertiaryLinks:[{title: album}] }] } ] } } ] }.
 *  The header section's trackCount tells us whether the page held it all. */
export function parseAppleMusicHtml(
  html: string,
  storefront: string,
  id: string
): PastedPlaylist | null {
  const data = scriptJson(
    html,
    /<script[^>]*id="serialized-server-data"[^>]*>/
  ) as { data?: unknown } | null
  const pages = Array.isArray(data?.data) ? (data!.data as unknown[]) : []
  let name = ''
  let declared: number | null = null
  const tracks: SpotifyTrack[] = []
  for (const page of pages) {
    const sections = (page as { data?: { sections?: unknown } })?.data?.sections
    if (!Array.isArray(sections)) continue
    for (const section of sections as Record<string, unknown>[]) {
      const items = Array.isArray(section.items) ? (section.items as Record<string, unknown>[]) : []
      if (section.itemKind === 'containerDetailHeaderLockup' && items[0]) {
        name = name || str(items[0].title)
        declared = declared ?? num(items[0].trackCount)
      }
      if (section.itemKind !== 'trackLockup') continue
      for (const it of items) {
        const title = str(it.title)
        const artist = str(it.artistName)
        if (!title || !artist) continue
        const links = Array.isArray(it.tertiaryLinks) ? (it.tertiaryLinks as Record<string, unknown>[]) : []
        tracks.push({
          artist,
          title,
          album: str(links[0]?.title),
          durationMs: num(it.duration),
          isLocal: false
        })
      }
    }
  }
  if (tracks.length === 0) return null
  return {
    name: name || 'Apple Music playlist',
    tracks,
    source: 'apple',
    url: applePlaylistUrl(storefront, id),
    truncated: declared !== null && tracks.length < declared
  }
}
