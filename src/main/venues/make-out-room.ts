import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId, splitArtists } from './types.js'

// The Make Out Room's own site is a Weebly blog whose "Events" page only
// carries ~2 weeks of posts. The calendar page (`/calendar.html`) is an
// iframe onto CalendarWiz, which holds the full booking months out — so we
// read CalendarWiz directly and keep venue.url for human-facing links.
//
// CalendarWiz bounces a browser through a JS/meta-refresh handshake before it
// will render; passing `jsenabled=1` up front skips it and returns the month
// grid on the first request. `op=cal&month=&year=` is the month navigation
// their own prev/next arrows use.
//
// Each event is a div carrying `data-etimestamp` (unix seconds, venue-local
// start) and an anchor whose text is the whole listing, tilde-delimited:
//   "MEGA X (Tokyo) + NEUTRALS + SAD EYES KILL ~ $15 ~ 7:00pm - 10:00pm"
// The first tilde chunk is the bill; everything after is price/time/blurb.
//
// Page is served as ISO-8859-1.

const CAL_BASE = 'https://www.calendarwiz.com/calendars/calendar.php'
const CAL_ID = 'makeoutroom'
const MONTHS_AHEAD = 2
const TZ = 'America/Los_Angeles'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

const EVENT_RE =
  /data-etimestamp="(\d+)"[^>]*data-event_id="(\d+)"[\s\S]{0,4000}?<div class="cw-e-a"><a[^>]*>([\s\S]*?)<\/a>/g

function monthUrl(month: number, year: number): string {
  return (
    `${CAL_BASE}?crd=${CAL_ID}&cid%5B%5D=all&op=cal` +
    `&month=${month}&year=${year}&jsenabled=1&winh=800&winw=1200&inifr=true`
  )
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/[​ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ISO_IN_TZ = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function isoFromEpoch(seconds: number): string {
  return ISO_IN_TZ.format(new Date(seconds * 1000))
}

// Where the bill stops and the logistics start, for the listings that run
// price/door-time straight on without a tilde ("The DOGS + FREAK ACCIDENT
// 6:30pm - 9:30pm").
const LOGISTICS_RE =
  /\s(?:\$|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b|doors\b|tickets?\b|presales?\b|https?:)/i

// Reduce a listing line to just the bill. Everything after the first tilde is
// price/door-time/blurb; what's left still picks up presenter and host
// framing ("Talent Moat presents:", "… @ The Make Out Room hosted by …") and
// hometown tags, none of which should reach the library matcher.
export function billingFromListing(listing: string): string {
  const first = listing.split('~')[0] ?? ''
  const cut = LOGISTICS_RE.exec(first)
  return (cut ? first.slice(0, cut.index) : first)
    .replace(/^.{0,40}?\bpresents?:?\s+/i, '')
    .replace(/\s*[@]\s.*$/, '')
    .replace(/\s+hosted by\s.*$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// "downy + RIP ROOM" / "A w/ B" / "A, B, C" all appear here. splitArtists
// covers everything but "+", which the Make Out Room uses more than any other
// separator — so split on that first and let splitArtists finish each part.
export function billToActs(billing: string): string[] {
  return billing
    .split(/\s*\+\s*/)
    .flatMap((part) => {
      const { headliner, supports } = splitArtists(part)
      return [headliner, ...supports]
    })
    .map((a) =>
      a
        // "w/ Special Guest MARK EITZEL" survives splitArtists as
        // "Special Guest MARK EITZEL"; the honorific isn't the act.
        .replace(/^(?:with\s+)?(?:very\s+)?special\s+guests?\s*:?\s*/i, '')
        .replace(/^host(?:ed by)?\s+/i, '')
        .replace(/^[\s.,:&-]+|[\s.,:&-]+$/g, '')
    )
    .filter(Boolean)
}

export const makeOutRoomAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const now = new Date()
    const pages: string[] = []
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const res = await fetch(monthUrl(d.getMonth() + 1, d.getFullYear()), {
        headers: { 'User-Agent': UA, Accept: 'text/html' }
      })
      if (!res.ok) throw new Error(`Make Out Room ${res.status}`)
      const buf = await res.arrayBuffer()
      pages.push(new TextDecoder('iso-8859-1').decode(buf))
    }
    return parseMakeOutRoomCalendar(pages, venue)
  }
}

export function parseMakeOutRoomCalendar(pages: string[], venue: Venue): VenueShow[] {
  const today = todayIso()
  const out: VenueShow[] = []
  const seen = new Set<string>()

  for (const html of pages) {
    EVENT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = EVENT_RE.exec(html)) !== null) {
      const epoch = parseInt(m[1], 10)
      if (!Number.isFinite(epoch)) continue
      const isoDate = isoFromEpoch(epoch)
      if (isoDate < today) continue

      const listing = stripTags(m[3])
      const acts = billToActs(billingFromListing(listing))
      if (acts.length === 0) continue

      const headliner = acts[0]
      const id = makeEventId(venue.id, isoDate, headliner)
      if (seen.has(id)) continue
      seen.add(id)

      out.push({
        id,
        venueId: venue.id,
        artistName: headliner,
        supportArtists: acts.slice(1),
        date: isoDate,
        url: venue.url
      })
    }
  }
  return out
}

function todayIso(): string {
  return ISO_IN_TZ.format(new Date())
}
