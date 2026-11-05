import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId, parseDate } from './types.js'

// See Tickets WordPress plugin scraper. The plugin renders events in two
// modes:
//   - List mode (Rickshaw Stop): each event wrapped in
//     .seetickets-list-event-container with structured <p> children.
//   - Calendar mode (The Chapel): events laid out in a TD grid, with
//     per-event aria-labels of the form "Buy Tickets for NAME on Mon DD".
//
// The ticketing partner the plugin links to varies — Chapel → seetickets.us,
// Rickshaw → eventim.us — but the rendered DOM is identical regardless,
// because the plugin is the same.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url: string, venueName: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' }
  })
  if (!res.ok) {
    throw new Error(`See Tickets ${res.status} for ${venueName}`)
  }
  return res.text()
}

// ------- List mode (Rickshaw) -------

const LIST_BLOCK_RE =
  /<div[^>]*class="[^"]*seetickets-list-event-container[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*seetickets-list-event-container|<div[^>]*class="[^"]*seetickets-list-view-pagination|$)/g

function parseListMode(html: string, venue: Venue): VenueShow[] {
  const out: VenueShow[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  LIST_BLOCK_RE.lastIndex = 0
  while ((m = LIST_BLOCK_RE.exec(html)) !== null) {
    const block = m[1]
    // Title: <p class="fs-XX bold mb-XX title"><a>HEADLINER</a></p>
    const title = /<p[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      block
    )
    if (!title) continue
    const headliner = stripTags(title[2])
    if (!headliner) continue

    // Date: <p class="fs-XX bold mt-XX date">Thu May 21</p>
    const dateRaw = /<p[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const dateText = dateRaw ? stripTags(dateRaw[1]) : ''
    // Strip leading day-of-week if present ("Thu May 21" → "May 21")
    const stripped = dateText.replace(/^[A-Z][a-z]{2}\s+/, '').trim()
    const date = parseDate(stripped)
    if (!date) continue

    // Supports: <p class="fs-XX supporting-talent">Supporting Talent: A, B</p>
    const sup = /<p[^>]*class="[^"]*\bsupporting-talent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const supports: string[] = []
    if (sup) {
      const text = stripTags(sup[1]).replace(/^Supporting Talent:\s*/i, '')
      for (const name of text.split(/\s*,\s*/)) {
        if (name) supports.push(name)
      }
    }

    const id = makeEventId(venue.id, date, headliner)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      venueId: venue.id,
      artistName: headliner,
      supportArtists: supports,
      date,
      url: title[1]
    })
  }
  return out
}

// ------- Calendar mode (Chapel) -------

// The header is `<span class="bold">May</span> 2026` — gives us year context.
const CAL_HEADER_RE =
  /seetickets-calendar-year-month-container[\s\S]*?<span[^>]*>([A-Za-z]+)<\/span>\s*(\d{4})/

// Each event has a Buy Tickets button with aria-label "Buy Tickets for NAME
// on Mon DD". Attribute quoting varies by theme — The Chapel's WP theme emits
// double quotes, Thee Stork Club's emits single — so accept either.
const ARIA_RE =
  /<a[^>]*href=["']([^"']+)["'][^>]*aria-label=["']Buy Tickets for ([^"']+?) on ([A-Za-z]+)\s+(\d{1,2})["']/g

function parseCalendarMode(html: string, venue: Venue): VenueShow[] {
  const header = CAL_HEADER_RE.exec(html)
  const headerYear = header ? parseInt(header[2], 10) : new Date().getFullYear()
  const headerMonthName = header ? header[1] : ''
  const headerMonthIdx = MONTHS.indexOf(headerMonthName.slice(0, 3))

  const out: VenueShow[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  ARIA_RE.lastIndex = 0
  while ((m = ARIA_RE.exec(html)) !== null) {
    const url = m[1]
    const fullBill = decodeEntities(m[2]).trim()
    const monthName = m[3].slice(0, 3)
    const day = parseInt(m[4], 10)
    const monthIdx = MONTHS.indexOf(monthName)
    if (monthIdx < 0 || day < 1 || day > 31) continue
    // Roll year forward if the event month wraps past the header month.
    let year = headerYear
    if (headerMonthIdx >= 0 && monthIdx < headerMonthIdx) year += 1
    const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // Some venues (Thee Stork Club) pack the whole bill into the label,
    // comma-separated: "Buy Tickets for A, B, C on Jun 12". First name is
    // the headliner; the rest are supports — splitting keeps each act
    // individually matchable against the library. (A band name containing a
    // comma loses; the plugin's own formatting is comma-delimited, so a
    // packed bill is the far more common case.)
    const bill = fullBill.split(/\s*,\s*/).filter(Boolean)
    const name = bill[0] ?? fullBill
    if (!name) continue
    const supports: string[] = bill.slice(1)

    // Other venues (The Chapel) keep supports out of the label and render a
    // `supporting-talent` paragraph in the surrounding event block; scan a
    // window before this match for it.
    const back = html.slice(Math.max(0, m.index - 2500), m.index)
    const sup = /<p[^>]*class="[^"]*\bsupporting-talent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(back)
    if (sup) {
      const text = stripTags(sup[1]).replace(/^Supporting Talent:\s*/i, '')
      for (const s of text.split(/\s*,\s*/)) {
        if (s && !supports.includes(s)) supports.push(s)
      }
    }

    const id = makeEventId(venue.id, date, name)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      venueId: venue.id,
      artistName: name,
      supportArtists: supports,
      date,
      url
    })
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ------- Public adapters -------

export const seeticketsListAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const html = await fetchHtml(venue.url, venue.name)
    return parseListMode(html, venue)
  }
}

export const seeticketsCalAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const html = await fetchHtml(venue.url, venue.name)
    return parseCalendarMode(html, venue)
  }
}

// Exported for tests.
export { parseListMode, parseCalendarMode }
