import type { PlaylistItem } from './plex'
import type { SpotifyImportEntry, SpotifyImportReport } from './spotify'

export type ImportedPlaylistRow =
  | { kind: 'matched'; item: PlaylistItem; source: SpotifyImportEntry | null }
  | { kind: 'missing'; source: SpotifyImportEntry }

/** Project an imported source playlist onto the playable rows returned by
 * Plex. Duplicate tracks are consumed in order; user-added Plex rows that are
 * not part of the import are retained at the end. */
export function importedPlaylistRows(
  report: SpotifyImportReport | null,
  items: PlaylistItem[]
): ImportedPlaylistRow[] {
  if (!report?.entries) return items.map((item) => ({ kind: 'matched', item, source: null }))

  const byRatingKey = new Map<string, PlaylistItem[]>()
  for (const item of items) {
    const queue = byRatingKey.get(item.ratingKey) ?? []
    queue.push(item)
    byRatingKey.set(item.ratingKey, queue)
  }

  const consumed = new Set<number>()
  const rows: ImportedPlaylistRow[] = report.entries.map((source) => {
    if (source.matchedRatingKey) {
      const item = byRatingKey.get(source.matchedRatingKey)?.shift()
      if (item) {
        consumed.add(item.playlistItemID)
        return { kind: 'matched', item, source }
      }
    }
    return { kind: 'missing', source }
  })

  for (const item of items) {
    if (!consumed.has(item.playlistItemID)) rows.push({ kind: 'matched', item, source: null })
  }
  return rows
}
