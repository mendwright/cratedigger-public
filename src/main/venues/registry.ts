import type { Venue, VenueId } from '../../shared/plex.js'

// Hand-picked SF Bay venues. Coordinates lifted from each venue's published
// address; used by the renderer for distance hints (not for filtering — every
// venue here is by definition in scope).
//
// `adapter` binds a venue to its parsing strategy. Multiple venues can share
// an adapter (Ticketmaster: 7 Live Nation rooms; Squarespace: Parkside +
// Knockout). The adapter resolves the venue id internally to pick whatever
// per-venue parameter it needs (e.g. Ticketmaster venueId, calendar slug).
export const VENUES: Venue[] = [
  {
    id: 'bottomofthehill',
    name: 'Bottom of the Hill',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7656,
    longitude: -122.3974,
    url: 'https://www.bottomofthehill.com/calendar.html',
    adapter: 'bottomofthehill'
  },
  {
    id: 'theeparkside',
    name: 'Thee Parkside',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7657,
    longitude: -122.3984,
    url: 'https://www.theeparkside.com',
    // Squarespace events block renders client-side only — static fetch
    // returns 0 events. Routes through the webview to get the rendered DOM.
    adapter: 'webview'
  },
  {
    id: 'knockout',
    name: 'The Knockout',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7464,
    longitude: -122.4189,
    // Squarespace events collection lives at /events-2-1 (not /calendar);
    // ?format=json-pretty against this URL returns ~40 upcoming.
    url: 'https://theknockoutsf.com/events-2-1',
    adapter: 'squarespace'
  },
  {
    id: 'independent',
    name: 'The Independent',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7763,
    longitude: -122.4378,
    url: 'https://www.theindependentsf.com/',
    adapter: 'ticketweb'
  },
  {
    id: 'chapel',
    name: 'The Chapel',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7607,
    longitude: -122.4216,
    // /calendar/ is the full multi-month calendar view; the homepage only
    // shows a 6-event hero carousel.
    url: 'https://thechapelsf.com/calendar/',
    adapter: 'seetickets-cal'
  },
  {
    id: 'cafedunord',
    name: 'Cafe du Nord',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7656,
    longitude: -122.4314,
    url: 'https://cafedunord.com/',
    adapter: 'ticketweb'
  },
  {
    id: 'swedishamerican',
    name: 'Swedish American Hall',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7656,
    longitude: -122.4314,
    // SAH shares operators (and a Ticketweb listing) with Cafe du Nord —
    // both rooms' events render on the CDN homepage with a per-row venue
    // label. The ticketweb adapter filters by venue.name.
    url: 'https://cafedunord.com/',
    adapter: 'ticketweb'
  },
  {
    id: 'rickshaw',
    name: 'Rickshaw Stop',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7770,
    longitude: -122.4222,
    url: 'https://rickshawstop.com/',
    adapter: 'seetickets-list'
  },
  {
    id: 'brickandmortar',
    name: 'Brick & Mortar Music Hall',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7689,
    longitude: -122.4198,
    url: 'https://www.brickandmortarmusic.com/',
    adapter: 'ticketweb'
  },
  {
    id: 'augusthall',
    name: 'August Hall',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7867,
    longitude: -122.4101,
    url: 'https://www.augusthallsf.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'fillmore',
    name: 'The Fillmore',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7841,
    longitude: -122.4329,
    url: 'https://www.thefillmore.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'masonic',
    name: 'The Masonic',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7913,
    longitude: -122.4128,
    url: 'https://www.sfmasonic.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'regency',
    name: 'The Regency Ballroom',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7866,
    longitude: -122.4218,
    url: 'https://www.theregencyballroom.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'billgraham',
    name: 'Bill Graham Civic Auditorium',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7785,
    longitude: -122.4170,
    url: 'https://www.billgrahamcivicauditorium.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'gamh',
    name: 'Great American Music Hall',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7853,
    longitude: -122.4174,
    url: 'https://www.gamh.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'warfield',
    name: 'The Warfield',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7825,
    longitude: -122.4090,
    url: 'https://www.thewarfieldtheatre.com/',
    adapter: 'ticketmaster'
  },
  {
    id: 'castro',
    name: 'The Castro Theatre',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7619,
    longitude: -122.4351,
    url: 'https://www.castrotheatre.com/',
    // Castro is now operated by Another Planet Entertainment; their concert
    // bookings appear on Ticketmaster (venue id KovZpaF_me). Film & opera
    // bookings on Frameline/Eventbrite are out of scope.
    adapter: 'ticketmaster'
  },
  // Starline Social Club: domain dead (NXDOMAIN, TheStarLine.com is listed
  // for sale at domains.atom.com). Venue appears permanently closed; their
  // Instagram is still up but there's no calendar to scrape. Left out of
  // the registry entirely so it doesn't show up as a "broken adapter" row.
  {
    id: 'sfjazz',
    name: 'SFJAZZ Center',
    city: 'San Francisco',
    region: 'CA',
    latitude: 37.7775,
    longitude: -122.4232,
    url: 'https://www.sfjazz.org/calendar/',
    // Cloudflare-protected — must route through the renderer webview to
    // bypass bot detection.
    adapter: 'webview'
  },
  {
    id: 'freight',
    name: 'The Freight & Salvage',
    city: 'Berkeley',
    region: 'CA',
    latitude: 37.8704,
    longitude: -122.2682,
    url: 'https://thefreight.org/calendar/',
    adapter: 'webview'
  },
  {
    id: 'storkclub',
    name: 'Thee Stork Club',
    city: 'Oakland',
    region: 'CA',
    latitude: 37.8126,
    longitude: -122.2680,
    // 2330 Telegraph Ave. Reopened post-2022 as "Thee Stork Club" (their own
    // tagline: it's not 'The Stork Club'). storkcluboakland.com is a parked
    // lander — theestorkclub.com is the live site. WordPress + the same
    // SeeTickets plugin as The Chapel, in calendar mode with single-quoted
    // attrs and the full bill comma-packed into each aria-label (both handled
    // in the adapter).
    url: 'https://theestorkclub.com/calendar/',
    adapter: 'seetickets-cal'
  }
]

export const VENUE_BY_ID: Record<VenueId, Venue> = Object.fromEntries(
  VENUES.map((v) => [v.id, v])
) as Record<VenueId, Venue>

export function getVenue(id: VenueId): Venue {
  const v = VENUE_BY_ID[id]
  if (!v) throw new Error(`Unknown venue id: ${id}`)
  return v
}
