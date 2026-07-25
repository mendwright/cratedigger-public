import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId } from './types.js'

// Ticketweb embed scraper. Covers Cafe du Nord, The Independent, and
// Brick & Mortar — all three embed the same Ticketweb upcoming-events
// widget on their WP homepage. The widget renders server-side, so we
// pull the homepage HTML and tease out events by their .tw-name anchors.
//
// Why the homepage and not /events/: TW renders MORE upcoming events on
// the homepage (sliders show ~40-80) than on the dedicated events page
// (truncated to 5-30). Counterintuitive but consistently true across
// the three venues.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

// Anchor each event on its <div class="tw-name"> wrapper. tw-name appears
// exactly once per event (other tw-* classes — date, image — render twice
// because TW outputs both desktop and mobile copies).
//
// The inner shape varies by venue theme:
//   CdN:  <div class="tw-name"><a><span>Name</span></a></div>
//   Ind:  <div class="tw-name"><a>Name</a></div>
//   B&M:  <div class="tw-name"><a>NAME</a></div>
// We extract from the inner <a>, optionally peeling off a wrapping <span>.
const NAME_BLOCK_RE =
  /<div[^>]*class="[^"]*\btw-name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g
const NAME_LINK_RE = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
const VENUE_LABEL_RE = /<[^>]*class="[^"]*\btw-venue\b[^"]*"[^>]*>([\s\S]*?)<\//

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

// Resolve "M.D" → "YYYY-MM-DD". TW dates omit the year; if the month is
// already past today, assume next year.
function resolveDate(md: string, today: Date): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(md.trim())
  if (!m) return null
  const month = parseInt(m[1], 10)
  const day = parseInt(m[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  let year = today.getFullYear()
  // If the target date is more than ~3 days in the past, roll to next year.
  // Past-date rows from this morning are still valid; we don't want to
  // jump them a full year forward.
  const probe = new Date(year, month - 1, day)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (probe.getTime() < todayStart.getTime() - 3 * 86_400_000) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const ticketwebAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const res = await fetch(venue.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' }
    })
    if (!res.ok) {
      throw new Error(`Ticketweb ${res.status} for ${venue.name}`)
    }
    const html = await res.text()
    const all = parseTicketweb(html, venue)

    // Most TW listings are single-room: every row's tw-venue label is the
    // same (the venue's own name, however abbreviated — Brick & Mortar's
    // page emits "Brick & Mortar" not "Brick & Mortar Music Hall"). Only
    // the CdN/SAH shared page emits multiple distinct labels. If we see
    // only one label, every row belongs here and the name-normalize match
    // can disagree without dropping the whole calendar.
    const rooms = new Set(all.map((e) => e.venueRoom).filter((r): r is string => !!r))
    if (rooms.size <= 1) return all
    return all.filter((e) =>
      e.venueRoom ? roomMatches(e.venueRoom, venue.name) : true
    )
  }
}

function roomMatches(room: string, venueName: string): boolean {
  // Substring match each direction so "Brick & Mortar" matches "Brick &
  // Mortar Music Hall" (the page omits "Music Hall") and "Cafe Du Nord"
  // matches "Cafe du Nord" (case + capitalization drift). Strict equality
  // was too brittle.
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const a = normalize(room)
  const b = normalize(venueName)
  return a === b || a.includes(b) || b.includes(a)
}

// Internal row shape: VenueShow plus the room label for post-filtering.
export interface TicketwebRow extends VenueShow {
  venueRoom?: string
}

export function parseTicketweb(html: string, venue: Venue): TicketwebRow[] {
  const today = new Date()
  const seenIds = new Set<string>()
  const out: TicketwebRow[] = []
  let m: RegExpExecArray | null
  NAME_BLOCK_RE.lastIndex = 0
  while ((m = NAME_BLOCK_RE.exec(html)) !== null) {
    const nameBlock = m[1]
    const link = NAME_LINK_RE.exec(nameBlock)
    if (!link) continue
    const eventUrl = link[1]
    const headliner = stripTags(link[2])
    if (!headliner) continue

    // The event's date span sits before the tw-name in document order.
    // Walk back up to ~3KB for the nearest tw-event-date.
    const backStart = Math.max(0, m.index - 3000)
    const back = html.slice(backStart, m.index)
    const dateMatches = [...back.matchAll(/class="[^"]*\btw-event-date\b[^"]*"[^>]*>\s*([0-9.]+)\s*</g)]
    const lastDate = dateMatches.length ? dateMatches[dateMatches.length - 1][1] : ''
    const date = resolveDate(lastDate, today)
    if (!date) continue

    // Supports: tw-attractions block after the name. Cap forward scan at
    // 4KB so we don't accidentally bleed into the next event.
    const forward = html.slice(m.index, m.index + 4000)
    const attrBlock = /<div[^>]*class="[^"]*\btw-attractions\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(forward)
    const supports: string[] = []
    if (attrBlock) {
      const spans = [...attrBlock[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
      for (const s of spans) {
        const name = stripTags(s[1])
        if (name) supports.push(name)
      }
    }

    // Optional room label — same TW listing can carry multiple rooms.
    const roomMatch = VENUE_LABEL_RE.exec(forward)
    const venueRoom = roomMatch ? stripTags(roomMatch[1]) : undefined

    const id = makeEventId(venue.id, date, headliner)
    if (seenIds.has(id)) continue
    seenIds.add(id)
    out.push({
      id,
      venueId: venue.id,
      artistName: headliner,
      supportArtists: supports,
      date,
      url: eventUrl,
      venueRoom
    })
  }
  return out
}
