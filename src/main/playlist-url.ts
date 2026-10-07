import {
  classifyPaste,
  parseAppleMusicHtml,
  parseSpotifyEmbedHtml,
  spotifyEmbedUrl,
  type PastedPlaylist
} from '../shared/playlist-url.js'

// Resolve a pasted playlist link to its tracks by reading the service's own
// web page (see shared/playlist-url.ts for what each page carries). A plain
// browser UA is all either wants; no cookies, no tokens.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const FETCH_TIMEOUT_MS = 20_000

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return await res.text()
}

export async function fetchPastedPlaylist(text: string): Promise<PastedPlaylist> {
  const kind = classifyPaste(text)
  switch (kind.kind) {
    case 'spotify': {
      const html = await fetchHtml(spotifyEmbedUrl(kind.id))
      const parsed = parseSpotifyEmbedHtml(html, kind.id)
      if (!parsed) {
        throw new Error(
          'Spotify showed no tracks for that link — private playlists can only come in as an Exportify CSV'
        )
      }
      return parsed
    }
    case 'apple': {
      const html = await fetchHtml(kind.url)
      const parsed = parseAppleMusicHtml(html, kind.storefront, kind.id)
      if (!parsed) {
        throw new Error('Apple Music showed no tracks for that link — is the playlist public?')
      }
      return parsed
    }
    case 'text':
      return { name: '', tracks: kind.tracks, source: 'text', url: null, truncated: false }
    case 'empty':
      throw new Error('Paste a Spotify or Apple Music playlist link, or one song per line as Artist - Title')
  }
}
