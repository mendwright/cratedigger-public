import type { Venue, VenueShow } from '../../shared/plex.js'
import type { VenueAdapter } from './types.js'
import { bottomOfTheHillAdapter } from './bottom-of-the-hill.js'
import { seeticketsListAdapter, seeticketsCalAdapter } from './seetickets.js'
import { squarespaceAdapter } from './squarespace.js'
import { ticketmasterAdapter } from './ticketmaster.js'
import { ticketwebAdapter } from './ticketweb.js'
import { VENUES } from './registry.js'

// Adapter dispatch. Each entry binds a registry `adapter` tag to an
// implementation; unimplemented entries surface a friendly per-venue
// error in the renderer (not a hard fail of the whole batch).
const ADAPTERS: Partial<Record<Venue['adapter'], VenueAdapter>> = {
  bottomofthehill: bottomOfTheHillAdapter,
  'seetickets-list': seeticketsListAdapter,
  'seetickets-cal': seeticketsCalAdapter,
  squarespace: squarespaceAdapter,
  ticketmaster: ticketmasterAdapter,
  ticketweb: ticketwebAdapter
}

export async function fetchVenueShows(venueId: string): Promise<VenueShow[]> {
  const venue = VENUES.find((v) => v.id === venueId)
  if (!venue) throw new Error(`Unknown venue: ${venueId}`)
  const adapter = ADAPTERS[venue.adapter]
  if (!adapter) {
    throw new Error(`No adapter yet for ${venue.name} (${venue.adapter})`)
  }
  return adapter.fetchShows(venue)
}

export function listVenues(): Venue[] {
  return VENUES
}
