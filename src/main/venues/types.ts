import type { Venue, VenueShow } from '../../shared/plex.js'

export interface VenueAdapter {
  // Fetch upcoming shows for `venue`. Returning [] is normal (no shows
  // scheduled). Throwing is a real failure (network, parse error) — the
  // caller surfaces it per-venue without killing the whole batch.
  fetchShows(venue: Venue): Promise<VenueShow[]>
}

// Build the composite event id used for dedupe + hide-this-show.
export function makeEventId(
  venueId: string,
  date: string,
  artistName: string
): string {
  return `${venueId}:${date}:${artistName.toLowerCase().replace(/\s+/g, '-')}`
}

// Adapters parse "Headliner with Opener" / "A / B / C" / "A, B, C" forms
// into headliner + ordered supports. Centralized so all adapters split the
// same way.
export function splitArtists(billing: string): { headliner: string; supports: string[] } {
  if (!billing) return { headliner: '', supports: [] }
  // Strip presenter prefixes that show up in some listings.
  const cleaned = billing
    .replace(/^\s*(an evening with|live in concert|presents?:?)\s+/i, '')
    .trim()
  // Common delimiters, in order of decreasing confidence.
  const parts = cleaned
    .split(/\s+(?:with|w\/|featuring|feat\.?|ft\.?)\s+|\s*[/,]\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return { headliner: cleaned, supports: [] }
  return { headliner: parts[0], supports: parts.slice(1) }
}

// Parse a free-text date string into ISO YYYY-MM-DD. Falls back to null for
// anything we can't recognize — the caller should drop the row.
export function parseDate(s: string, hintYear?: number): string | null {
  if (!s) return null
  const trimmed = s.trim()
  // 2026-05-22
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // May 22, 2026 / May 22 2026 / May 22
  const longForm = /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(trimmed)
  if (longForm) {
    const month = MONTH_MAP[longForm[1].slice(0, 3).toLowerCase()]
    if (month) {
      const day = longForm[2].padStart(2, '0')
      const year = longForm[3] ?? String(hintYear ?? new Date().getFullYear())
      return `${year}-${month}-${day}`
    }
  }
  // 5/22/2026 or 5/22
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(trimmed)
  if (slash) {
    const month = slash[1].padStart(2, '0')
    const day = slash[2].padStart(2, '0')
    let year = slash[3] ?? String(hintYear ?? new Date().getFullYear())
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  // Last-resort: Date.parse
  const ms = Date.parse(trimmed)
  if (!Number.isNaN(ms)) {
    const d = new Date(ms)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
}
