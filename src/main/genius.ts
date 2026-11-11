import type { LyricsResult } from '../shared/plex.js'
import { getGeniusClientId, getGeniusClientSecret } from './store.js'

// Genius is the best lyrics source for hip-hop — including the underground/new
// releases LRCLIB tends to miss. Its API deliberately omits lyrics text, so the
// flow is: find the song page URL (official /search with client_credentials
// when API creds are configured, unauthenticated public site search otherwise)
// → scrape the lyrics out of the page HTML. No synced lyrics (Genius is plain
// text only), but the UI doesn't render synced lyrics anyway.

const API = 'https://api.genius.com'

// Genius blocks requests with a thin/absent User-Agent (returns an empty body),
// so the page fetch sends a real browser UA.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// client_credentials tokens are effectively permanent, so cache in memory and
// only re-mint on a 401 (token revoked) or first use.
let cachedToken: string | null = null

interface GeniusHit {
  result?: {
    title?: string
    url?: string
    primary_artist?: { name?: string }
  }
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

async function mintToken(): Promise<string | null> {
  const clientId = getGeniusClientId()
  const clientSecret = getGeniusClientSecret()
  if (!clientId || !clientSecret) return null
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  })
  try {
    const res = await fetchWithTimeout(
      `${API}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      },
      10_000
    )
    if (!res.ok) return null
    const json = (await res.json()) as { access_token?: string }
    return json.access_token ?? null
  } catch {
    return null
  }
}

async function getToken(forceRefresh = false): Promise<string | null> {
  if (cachedToken && !forceRefresh) return cachedToken
  cachedToken = await mintToken()
  return cachedToken
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // U+0300–U+036F combining marks
    .replace(/[’'`]/g, '')
    .replace(/\([^)]*\)/g, '') // drop "(feat. …)", "(remix)" etc.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Pick the hit whose title matches the track — guards against returning lyrics
// for a different song when the exact track isn't on Genius.
function pickHit(hits: GeniusHit[], title: string): string | null {
  const want = normalize(title)
  if (!want) return null
  for (const h of hits) {
    const t = h.result?.title
    const url = h.result?.url
    if (!t || !url) continue
    const got = normalize(t)
    if (got === want || got.includes(want) || want.includes(got)) return url
  }
  return null
}

async function searchSongUrl(
  artist: string,
  title: string,
  token: string
): Promise<string | null> {
  const params = new URLSearchParams({ q: `${artist} ${title}`.trim() })
  const res = await fetchWithTimeout(
    `${API}/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    10_000
  )
  if (res.status === 401) throw new Error('genius-401')
  if (!res.ok) return null
  const json = (await res.json()) as { response?: { hits?: GeniusHit[] } }
  return pickHit(json.response?.hits ?? [], title)
}

// Genius's public site search — the same backend the genius.com search box
// uses. Unauthenticated, so lyrics work out of the box with no API client
// configured. Hits are grouped into typed sections ("top_hit", "song",
// "artist", …); non-song hits lack result.title/url and pickHit skips them.
// Throws on transport/HTTP errors so the caller treats those as
// non-definitive; returns null only on a clean "no matching song".
async function publicSearchSongUrl(artist: string, title: string): Promise<string | null> {
  const params = new URLSearchParams({ per_page: '5', q: `${artist} ${title}`.trim() })
  const res = await fetchWithTimeout(
    `https://genius.com/api/search/multi?${params.toString()}`,
    { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } },
    10_000
  )
  if (!res.ok) throw new Error(`genius public search ${res.status}`)
  const json = (await res.json()) as {
    response?: { sections?: { type?: string; hits?: GeniusHit[] }[] }
  }
  const hits = (json.response?.sections ?? [])
    .filter((s) => s.type === 'song' || s.type === 'top_hit')
    .flatMap((s) => s.hits ?? [])
  return pickHit(hits, title)
}

// Genius lyrics live in one or more <div data-lyrics-container="true"> blocks
// that contain nested <div>s (inline annotation referents), so a non-greedy
// regex stops too early — we balance the div nesting by hand.
function extractContainers(html: string): string[] {
  const out: string[] = []
  const open = /<div[^>]+data-lyrics-container="true"[^>]*>/g
  const tag = /<(\/?)div\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = open.exec(html)) !== null) {
    const start = m.index + m[0].length
    let depth = 1
    tag.lastIndex = start
    let t: RegExpExecArray | null
    while (depth > 0 && (t = tag.exec(html)) !== null) {
      depth += t[1] === '/' ? -1 : 1
      if (depth === 0) {
        out.push(html.slice(start, t.index))
        open.lastIndex = tag.lastIndex
        break
      }
    }
  }
  return out
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

function cleanLyrics(raw: string): string {
  let text = decodeEntities(raw)
  // Strip Genius's header preamble ("N ContributorsTranslations…{Title} Lyrics")
  // — it ends with " Lyrics" right before the real content.
  const lyricsIdx = text.indexOf('Lyrics')
  if (lyricsIdx !== -1 && lyricsIdx < 300) text = text.slice(lyricsIdx + 'Lyrics'.length)
  // Promo string Genius injects mid-container.
  text = text.replace(/You might also like/g, '\n')
  // Trailing "…Embed" / "1.2KEmbed" artifact.
  text = text.replace(/\d*Embed\s*$/i, '')
  // Collapse 3+ blank lines.
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

type ScrapeResult = { kind: 'lyrics'; text: string } | { kind: 'instrumental' }

// Always returns a usable result or throws. A throw means "couldn't determine"
// (transport error, or a matched song page we couldn't extract) so the caller
// treats it as non-definitive and never caches a false "no lyrics".
async function scrapeLyrics(url: string): Promise<ScrapeResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } }, 10_000)
    if (!res.ok) throw new Error(`genius page ${res.status}`)
    const raw = await res.text()
    const html = raw.replace(/<br\s*\/?>/gi, '\n')
    const containers = extractContainers(html)
    if (containers.length > 0) {
      const merged = containers.map((c) => c.replace(/<[^>]+>/g, '')).join('\n')
      const lyrics = cleanLyrics(merged)
      if (lyrics.length > 0) return { kind: 'lyrics', text: lyrics }
    }
    // Genius marks instrumentals with this UI string and no lyrics container.
    if (/This song is an instrumental/i.test(raw)) return { kind: 'instrumental' }
    // No container and not flagged instrumental. Genius intermittently serves a
    // transient bot-challenge/empty page (still HTTP 200) under load — retry
    // once before giving up.
    if (attempt === 0) await new Promise((r) => setTimeout(r, 700))
  }
  // A matched song page almost always has lyrics, so an empty extraction after
  // a retry is treated as transient, not a genuine miss.
  throw new Error('genius: no lyrics extracted')
}

// Returns `{ ok, value }`: ok=false means we couldn't determine (a transport
// error somewhere) and the caller must not cache the null; ok=true with
// value=null is a genuine "Genius has no lyrics for this". API client creds
// are optional — with them we search via the official API, without them via
// the public site search.
export async function getGeniusLyrics(args: {
  artist: string
  title: string
}): Promise<{ ok: boolean; value: LyricsResult | null }> {
  let token = await getToken()
  let url: string | null
  if (!token) {
    // No creds (or mint failed) — use the unauthenticated public search.
    try {
      url = await publicSearchSongUrl(args.artist, args.title)
    } catch {
      return { ok: false, value: null } // transport error
    }
  } else {
    try {
      url = await searchSongUrl(args.artist, args.title, token)
    } catch (err) {
      if (err instanceof Error && err.message === 'genius-401') {
        // Token revoked — mint a fresh one once and retry.
        token = await getToken(true)
        if (!token) return { ok: false, value: null }
        try {
          url = await searchSongUrl(args.artist, args.title, token)
        } catch {
          return { ok: false, value: null }
        }
      } else {
        return { ok: false, value: null } // transport error
      }
    }
  }
  if (!url) return { ok: true, value: null } // searched cleanly, no matching song
  let scraped: ScrapeResult
  try {
    scraped = await scrapeLyrics(url)
  } catch {
    return { ok: false, value: null } // couldn't extract — don't cache a miss
  }
  return {
    ok: true,
    value: {
      plainLyrics: scraped.kind === 'lyrics' ? scraped.text : null,
      syncedLyrics: null,
      instrumental: scraped.kind === 'instrumental',
      source: 'genius',
      url
    }
  }
}
