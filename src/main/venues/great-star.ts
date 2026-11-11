import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId, parseDate, splitArtists } from './types.js'

// Great Star Theater (Chinatown) — a static, hand-built "What's Playing" page.
// Upcoming events are `<a class="event-list-item … category-music …">` cards
// (past events use `event-list-card`, so they never match). Most of the
// calendar is circus, cabaret, opera and film; we keep only cards tagged
// `category-music`. Each card links straight to its ticket page (Ticket
// Tailor, or the promoter's Eventbrite for outside bookings like Throwin'
// Bo's).
//
// Dates are free text: "February 23, 2027", "January 7 - 9, 2027",
// "September 25 & 26, 2026", "April 30 - May 2, 2026". We emit the first
// night only.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

const CARD_RE = /<a\s+href="([^"]*)"\s+class="event-list-item\b([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
const TITLE_RE = /<h3>([\s\S]*?)<\/h3>/i
const DATE_RE = /class="event-time">([^<]*)</i

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

/** "January 7 - 9, 2027" → "2027-01-07". Takes the first month/day and the
 *  last 4-digit year in the string (a range can span a year boundary only in
 *  theory; the venue has never listed one). */
export function parseGreatStarDate(text: string): string | null {
  const year = /(\d{4})(?!.*\d{4})/.exec(text)?.[1]
  const start = /^\s*([A-Za-z]+)\s+(\d{1,2})(?!\d)/.exec(text)
  if (!year || !start) return null
  return parseDate(`${start[1]} ${start[2]}, ${year}`)
}

export function parseGreatStarPage(html: string, venue: Venue): VenueShow[] {
  const out: VenueShow[] = []
  for (const m of html.matchAll(CARD_RE)) {
    const [, href, classes, body] = m
    if (!/\bcategory-music\b/.test(classes)) continue
    const rawTitle = TITLE_RE.exec(body)?.[1]
    const rawDate = DATE_RE.exec(body)?.[1]
    if (!rawTitle || !rawDate) continue
    const date = parseGreatStarDate(stripTags(rawDate))
    if (!date) continue
    // "@ (Presented by Throwin' Bo's)" → "@"
    const bill = stripTags(rawTitle).replace(/\s*\([^)]*\)/g, '').trim()
    const { headliner, supports } = splitArtists(bill)
    if (!headliner) continue
    out.push({
      id: makeEventId(venue.id, date, headliner),
      venueId: venue.id,
      artistName: headliner,
      supportArtists: supports,
      date,
      url: href ? decodeHtmlEntities(href) : venue.url
    })
  }
  return out
}

export const greatStarAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const res = await fetch(venue.url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`Great Star ${res.status}`)
    return parseGreatStarPage(await res.text(), venue)
  }
}
