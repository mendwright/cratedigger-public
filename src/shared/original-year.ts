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

// The shape every album-year consumer already speaks: a ratingKey and a (Plex)
// year. Kept structural so PlexAlbum and any lighter projection both satisfy it.
export interface HasAlbumYear {
  ratingKey: string
  year: number | null
}

// Overlay known original years onto a list of albums *in place*: where the index
// knows an album's original year, that becomes its `year`. A ratingKey absent
// from the index, or recorded as null ("MusicBrainz had no usable date"), keeps
// its Plex year. Mutates each album's `year`; returns the same array so callers
// can chain. This is the single seam through which a 2005 reissue becomes 1984
// for every downstream reader.
export function applyOriginalYears<T extends HasAlbumYear>(
  albums: T[],
  index: ReadonlyMap<string, number | null>
): T[] {
  for (const album of albums) {
    const original = index.get(album.ratingKey)
    if (typeof original === 'number') album.year = original
  }
  return albums
}
