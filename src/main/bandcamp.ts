import type { LyricsResult } from '../shared/plex.js'

// Bandcamp is the last lyrics fallback. Its catalogue is especially useful for
// new independent releases that have artist-supplied lyrics but have not yet
// reached LRCLIB or Genius.

const SEARCH_API = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic'
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

interface BandcampSearchResult {
  type?: string
  name?: string
  band_name?: string
  album_name?: string
  item_url_path?: string
}

interface BandcampRecording {
  '@type'?: string | string[]
  name?: string
  byArtist?: { name?: string }
  inAlbum?: { name?: string }
  recordingOf?: { lyrics?: { text?: string } }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function selectBandcampTrack(
  results: BandcampSearchResult[],
  artist: string,
  title: string,
  album: string
): string | null {
  const wantArtist = normalize(artist)
  const wantTitle = normalize(title)
  const wantAlbum = normalize(album)
  const matches = results.filter(
    (r) =>
      r.type === 't' &&
      !!r.item_url_path &&
      normalize(r.band_name ?? '') === wantArtist &&
      normalize(r.name ?? '') === wantTitle
  )
  const albumMatch = matches.find((r) => normalize(r.album_name ?? '') === wantAlbum)
  return albumMatch?.item_url_path ?? matches[0]?.item_url_path ?? null
}

function isMusicRecording(value: BandcampRecording): boolean {
  const type = value['@type']
  return type === 'MusicRecording' || (Array.isArray(type) && type.includes('MusicRecording'))
}

export function extractBandcampLyrics(
  html: string,
  artist: string,
  title: string,
  album: string
): string | null | undefined {
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  let sawStructuredData = false
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]) as BandcampRecording | BandcampRecording[]
      const records = Array.isArray(parsed) ? parsed : [parsed]
      sawStructuredData = true
      for (const record of records) {
        if (!isMusicRecording(record)) continue
        if (normalize(record.name ?? '') !== normalize(title)) continue
        if (normalize(record.byArtist?.name ?? '') !== normalize(artist)) continue
        const pageAlbum = normalize(record.inAlbum?.name ?? '')
        if (pageAlbum && pageAlbum !== normalize(album)) continue
        const text = record.recordingOf?.lyrics?.text?.trim()
        return text || null
      }
    } catch {
      // A page can contain unrelated JSON-LD blocks; keep looking.
    }
  }
  // undefined distinguishes a bot/challenge or malformed page from a valid
  // Bandcamp page that simply has no matching lyrics.
  return sawStructuredData ? null : undefined
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function getBandcampLyrics(args: {
  artist: string
  title: string
  album: string
}): Promise<{ ok: boolean; value: LyricsResult | null }> {
  let searchResponse: Response
  try {
    searchResponse = await fetchWithTimeout(
      SEARCH_API,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA
        },
        body: JSON.stringify({
          fan_id: null,
          full_page: true,
          search_filter: 't',
          search_text: `${args.artist} ${args.title}`.trim()
        })
      },
      10_000
    )
  } catch {
    return { ok: false, value: null }
  }
  if (!searchResponse.ok) return { ok: false, value: null }

  let results: BandcampSearchResult[]
  try {
    const json = (await searchResponse.json()) as {
      auto?: { results?: BandcampSearchResult[] }
    }
    results = json.auto?.results ?? []
  } catch {
    return { ok: false, value: null }
  }

  const url = selectBandcampTrack(results, args.artist, args.title, args.album)
  if (!url) return { ok: true, value: null }

  try {
    const page = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } }, 10_000)
    if (!page.ok) return { ok: false, value: null }
    const text = extractBandcampLyrics(await page.text(), args.artist, args.title, args.album)
    if (text === undefined) return { ok: false, value: null }
    if (!text) return { ok: true, value: null }
    return {
      ok: true,
      value: {
        plainLyrics: text,
        syncedLyrics: null,
        instrumental: false,
        source: 'bandcamp',
        url
      }
    }
  } catch {
    return { ok: false, value: null }
  }
}
