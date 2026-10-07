import type { Venue, VenueId, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId } from './types.js'
import { getTicketmasterApiKey } from '../store.js'

// Ticketmaster Discovery API — free key, 5000 req/day, real terms of service.
// Used for the 7 Live Nation–owned venues in the registry. TM is the literal
// source of truth for ticket inventory at these rooms; this isn't scraping,
// it's their public API.
//
// Per-venue TM venue ids were looked up via `/discovery/v2/venues.json?keyword=…`
// once and baked in below. If a venue is renamed or sold, swap the id (a
// rebuild via the venues endpoint takes seconds with the API key in hand).

const TM_VENUE_IDS: Partial<Record<VenueId, string>> = {
  fillmore: 'KovZpZAE6eeA',
  billgraham: 'KovZpaKope',
  masonic: 'KovZpZAJ6nlA',
  regency: 'KovZpZAEet6A',
  // GAMH moved to the seetickets-cal adapter (its TM feed missed most of the
  // calendar); id kept out of the map deliberately.
  warfield: 'KovZpZAJe6lA',
  augusthall: 'KovZ917ALXF',
  castro: 'KovZpaF_me'
}

// TM Discovery's free key permits ~5 req/sec; the renderer fires all 8
// TM venues in parallel via Promise.all, which reliably trips the limit
// (Masonic surfaces a clean 429; Fillmore/Castro sometimes return 200 with
// an empty events array, which is worse — silent data loss). A module-
// scoped pacing slot serializes every TM fetch through one gate with a
// 250ms gap, well under the published limit.
const GAP_MS = 250
let nextSlot = 0

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const delay = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + GAP_MS
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => fn().then(resolve, reject), delay)
  })
}

interface TmAttraction {
  name?: string
}
interface TmEvent {
  id?: string
  name?: string
  url?: string
  dates?: { start?: { localDate?: string } }
  _embedded?: { attractions?: TmAttraction[] }
}
interface TmResponse {
  _embedded?: { events?: TmEvent[] }
}

export const ticketmasterAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const tmVenueId = TM_VENUE_IDS[venue.id]
    if (!tmVenueId) {
      throw new Error(`No Ticketmaster venue id for ${venue.name}`)
    }
    const apiKey = getTicketmasterApiKey()
    if (!apiKey) {
      throw new Error('Ticketmaster API key not set — add it in Settings')
    }
    const url =
      `https://app.ticketmaster.com/discovery/v2/events.json` +
      `?venueId=${encodeURIComponent(tmVenueId)}` +
      `&size=200&sort=date,asc` +
      `&apikey=${encodeURIComponent(apiKey)}`
    const res = await paced(() =>
      fetch(url, { headers: { Accept: 'application/json' } })
    )
    if (res.status === 401) {
      throw new Error('Ticketmaster API key rejected (401)')
    }
    if (res.status === 429) {
      throw new Error('Ticketmaster rate limit hit')
    }
    if (!res.ok) {
      throw new Error(`Ticketmaster ${res.status}`)
    }
    const data = (await res.json()) as TmResponse
    const events = data._embedded?.events ?? []
    const out: VenueShow[] = []
    // TM Discovery returns the same artist/date combo as multiple rows for
    // presale, general-onsale, accessible-seating, and multi-night passes
    // (e.g. Belle & Sebastian's two-night "If You're Feeling Sinister +
    // Tigermilk" at the Masonic shows up as 3+ rows on the same date).
    // Dedup by TM's own event id — keep the FIRST occurrence, since rows
    // are sorted by date and the canonical event consistently appears
    // before its presale variants.
    const seenTmIds = new Set<string>()
    const seenComposite = new Set<string>()
    for (const e of events) {
      const date = e.dates?.start?.localDate
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const attractions = e._embedded?.attractions ?? []
      const named = attractions.map((a) => a.name).filter((n): n is string => !!n)
      const headliner = named[0] ?? e.name ?? ''
      if (!headliner) continue

      // Dedup defense in depth: skip on TM event id collision (rare —
      // would mean TM duplicated their own id) AND on our composite
      // (venue:date:artist) so the renderer's keyed each-block never sees
      // a duplicate.
      if (e.id && seenTmIds.has(e.id)) continue
      const composite = makeEventId(venue.id, date, headliner)
      if (seenComposite.has(composite)) continue
      if (e.id) seenTmIds.add(e.id)
      seenComposite.add(composite)

      out.push({
        id: composite,
        venueId: venue.id,
        artistName: headliner,
        supportArtists: named.slice(1),
        date,
        url: e.url ?? venue.url
      })
    }
    console.log(`[tm] ${venue.name}: raw=${events.length} kept=${out.length}`)
    return out
  }
}
