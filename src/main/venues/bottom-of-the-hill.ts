import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId } from './types.js'

// Bottom of the Hill's calendar is hand-typed HTML that's barely changed in
// ~20 years. We exploit two extremely stable conventions:
//   1. Each event row has an `<a name="YYYYMMDD">` anchor — that's the
//      authoritative date.
//   2. Each band name is wrapped in `<…class="band">…</…>` in billing order
//      (headliner first, opener last — confirmed in their own listings
//      header).
//
// Listed encoding is ISO-8859-1; we decode explicitly so the occasional
// curly-quote / umlaut survives.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

const VENUE_ANCHOR_RE = /<a[^>]*\bname="(\d{8})"/gi
const BAND_RE = /<[^>]*\bclass="band"[^>]*>([\s\S]*?)<\//g
const TICKET_LINK_RE = /href="(https?:\/\/[^"]*\/stubmatic\/event\d{8}\.html)"/i

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function isoFromCompact(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export const bottomOfTheHillAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const res = await fetch(venue.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' }
    })
    if (!res.ok) {
      throw new Error(`Bottom of the Hill ${res.status}`)
    }
    const buf = await res.arrayBuffer()
    const html = new TextDecoder('iso-8859-1').decode(buf)
    return parseBothCalendar(html, venue)
  }
}

export function parseBothCalendar(html: string, venue: Venue): VenueShow[] {
  // Split the document at each date anchor — anchor → next-anchor (or EOF)
  // is one event's region. Cheaper than parsing the whole DOM.
  const anchors: { date: string; start: number }[] = []
  let m: RegExpExecArray | null
  VENUE_ANCHOR_RE.lastIndex = 0
  while ((m = VENUE_ANCHOR_RE.exec(html)) !== null) {
    anchors.push({ date: m[1], start: m.index })
  }
  if (anchors.length === 0) return []

  const today = todayIso()
  const out: VenueShow[] = []
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].start
    const end = i + 1 < anchors.length ? anchors[i + 1].start : html.length
    const region = html.slice(start, end)
    const isoDate = isoFromCompact(anchors[i].date)
    if (isoDate < today) continue

    const bands: string[] = []
    BAND_RE.lastIndex = 0
    let bm: RegExpExecArray | null
    while ((bm = BAND_RE.exec(region)) !== null) {
      const name = stripTags(bm[1])
      if (name) bands.push(name)
    }
    if (bands.length === 0) continue

    const ticketLink = TICKET_LINK_RE.exec(region)
    const url = ticketLink ? ticketLink[1] : `${venue.url}#${anchors[i].date}`

    const headliner = bands[0]
    out.push({
      id: makeEventId(venue.id, isoDate, headliner),
      venueId: venue.id,
      artistName: headliner,
      supportArtists: bands.slice(1),
      date: isoDate,
      url
    })
  }
  return out
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
