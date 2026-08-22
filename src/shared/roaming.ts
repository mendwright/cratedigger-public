// Roaming docs: small per-user state (show marks, Listen Later) that follows
// the user across machines instead of living in one Mac's electron-store.
//
// Shape: a doc is a map of id → record, where each record carries the value
// plus when it was last written. Deleting is writing a `null` value (a
// tombstone) — absence in a doc means "no opinion", so a machine that never
// saw an item can't resurrect or erase it during a merge.
//
// Merging is symmetric last-write-wins per id. The tagger service holds the
// authoritative copy and merges on PUT with this same algorithm (mirrored in
// service/app/roaming.py — keep the two in agreement), so a machine that was
// offline for weeks can push its stale doc without clobbering anything newer.

export interface RoamingRecord<T> {
  value: T | null // null = tombstone (deleted)
  updatedAt: string // ISO timestamp of the write
}

export interface RoamingDoc<T> {
  items: Record<string, RoamingRecord<T>>
}

// Server-side doc keys. Kebab-case because they appear in URLs.
export type RoamingKey = 'show-marks' | 'listen-later'

export function emptyRoamingDoc<T>(): RoamingDoc<T> {
  return { items: {} }
}

// Tombstones only exist to out-vote stale copies on other machines; once
// every machine has synced past one it's dead weight. 60 days comfortably
// covers a Mac that sat in a drawer (or a repair shop).
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000

function winner<T>(a: RoamingRecord<T>, b: RoamingRecord<T>): RoamingRecord<T> {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  // Equal timestamps: prefer data over a tombstone; otherwise pick by JSON
  // so both sides resolve the tie identically regardless of argument order.
  if ((a.value === null) !== (b.value === null)) return a.value === null ? b : a
  return JSON.stringify(a.value) >= JSON.stringify(b.value) ? a : b
}

/** Merge two docs: union of ids, last-write-wins per id, expired tombstones
 *  dropped. Symmetric — merge(a, b) === merge(b, a) for a fixed `nowMs`. */
export function mergeRoamingDocs<T>(
  a: RoamingDoc<T>,
  b: RoamingDoc<T>,
  nowMs: number
): RoamingDoc<T> {
  const cutoff = nowMs - TOMBSTONE_TTL_MS
  const items: Record<string, RoamingRecord<T>> = {}
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const ra = a.items[id]
    const rb = b.items[id]
    const win = ra && rb ? winner(ra, rb) : (ra ?? rb)
    if (win.value === null) {
      const t = Date.parse(win.updatedAt)
      if (Number.isFinite(t) && t < cutoff) continue
    }
    items[id] = win
  }
  return { items }
}

/** The live values in a doc (tombstones skipped). */
export function roamingValues<T>(doc: RoamingDoc<T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, rec] of Object.entries(doc.items)) {
    if (rec.value !== null) out[id] = rec.value
  }
  return out
}

export function docsEqual<T>(a: RoamingDoc<T>, b: RoamingDoc<T>): boolean {
  const ka = Object.keys(a.items)
  if (ka.length !== Object.keys(b.items).length) return false
  return ka.every((id) => {
    const rb = b.items[id]
    return (
      rb !== undefined &&
      rb.updatedAt === a.items[id].updatedAt &&
      JSON.stringify(rb.value) === JSON.stringify(a.items[id].value)
    )
  })
}
