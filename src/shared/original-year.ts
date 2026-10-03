// "Original release year" — the year an album was *first* released, taken from
// the MusicBrainz release-group first-release-date. Distinct from the "edition"
// year Plex stores (a 2005 reissue of a 1984 album carries year 2005). Cratedigger
// displays, sorts, and buckets albums by this original year so reissues file
// under their true date.
//
// Pure, process-agnostic logic — no Electron, no fs. The persistent index that
// holds the ratingKey → original-year map (and feeds it from the album-credits
// cache + the library warmer) lives in src/main/original-years.ts and leans on
// these functions. Both are exercised through original-year.test.ts.

// Parse a MusicBrainz date — "1984", "1984-06-04", "" or null/undefined — into a
// 4-digit year. Returns null for anything without a usable leading year so the
// caller falls back to Plex's edition year rather than rendering "NaN".
export function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null
  const year = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(year) && year > 0 ? year : null
}

// A MusicBrainz date with at least month precision ("1984-06", "1984-06-04"),
// or null for a bare year / anything unparseable — a bare year says nothing
// about where in the year an album falls.
export function preciseDate(date: string | null | undefined): string | null {
  return date && /^\d{4}-\d{2}(-\d{2})?$/.test(date) && yearFromDate(date) ? date : null
}

// The shape every album-year consumer already speaks: a ratingKey and a (Plex)
// year, plus the optional day-precision release date. Kept structural so
// PlexAlbum and any lighter projection both satisfy it.
export interface HasAlbumYear {
  ratingKey: string
  year: number | null
  releaseDate?: string | null
}

// What the index knows about an album: the raw MusicBrainz first-release date
// (string — "1984", "1984-06-04"), a bare year (number — a user override, or an
// entry written before full dates were kept), or null ("MusicBrainz had no
// usable date").
export type OriginalDateEntry = string | number | null

// Overlay known original dates onto a list of albums *in place*: where the
// index knows an album's original year, that becomes its `year`, and a precise
// MB date becomes its `releaseDate`. A ratingKey absent from the index, or
// recorded as null, keeps its Plex year and date. When the year moves but we
// have no precise MB date, Plex's date belongs to another edition (a 2005
// reissue's date on a 1984 record), so `releaseDate` is cleared rather than
// left contradicting the year. Returns the same array so callers can chain.
// This is the single seam through which a 2005 reissue becomes 1984 — and a
// bare-year "2026-01-01" becomes the real release day — for every reader.
export function applyOriginalYears<T extends HasAlbumYear>(
  albums: T[],
  index: ReadonlyMap<string, OriginalDateEntry>
): T[] {
  for (const album of albums) {
    const entry = index.get(album.ratingKey)
    if (entry === undefined || entry === null) continue
    const year = typeof entry === 'number' ? entry : yearFromDate(entry)
    if (year === null) continue
    album.year = year
    const precise = typeof entry === 'string' ? preciseDate(entry) : null
    if (precise) album.releaseDate = precise
    else if (album.releaseDate && yearFromDate(album.releaseDate) !== year) album.releaseDate = null
  }
  return albums
}
