import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { makeEventId, splitArtists } from './types.js'

// Squarespace events collections expose their data via `?format=json-pretty`
// on the collection's URL. We rely on `venue.url` pointing at the events
// collection page (not the homepage) — e.g. theknockoutsf.com/events-2-1
// rather than theknockoutsf.com.
//
// Some Squarespace sites render their events block client-side (homepage
// embed without a backing collection page) — those return upcoming=[] from
// this endpoint and must route through the webview adapter instead.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36'

interface SquarespaceEvent {
  id?: string
  title?: string
  fullUrl?: string
  startDate?: number  // unix ms
}
interface SquarespaceResponse {
  upcoming?: SquarespaceEvent[]
}

export const squarespaceAdapter: VenueAdapter = {
  async fetchShows(venue: Venue): Promise<VenueShow[]> {
    const url = `${venue.url}${venue.url.includes('?') ? '&' : '?'}format=json-pretty`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`Squarespace ${res.status} for ${venue.name}`)
    }
    const data = (await res.json()) as SquarespaceResponse
    const events = data.upcoming ?? []
    const out: VenueShow[] = []
    for (const e of events) {
      if (!e.startDate || !e.title) continue
      const d = new Date(e.startDate)
      const date =
        `${d.getFullYear()}-` +
        `${String(d.getMonth() + 1).padStart(2, '0')}-` +
        `${String(d.getDate()).padStart(2, '0')}`
      const { headliner, supports } = splitArtists(e.title)
      if (!headliner) continue
      const eventUrl = e.fullUrl ? absolutize(e.fullUrl, venue.url) : venue.url
      out.push({
        id: makeEventId(venue.id, date, headliner),
        venueId: venue.id,
        artistName: headliner,
        supportArtists: supports,
        date,
        url: eventUrl
      })
    }
    return out
  }
}

function absolutize(maybeRelative: string, base: string): string {
  if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) {
    return maybeRelative
  }
  try {
    return new URL(maybeRelative, base).toString()
  } catch {
    return base
  }
}
