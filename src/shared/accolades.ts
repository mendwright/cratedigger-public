// Critics' picks — "hype stickers" on album covers. The tagger collects them
// (service/app/accolades.py: Pitchfork Best New, Stereogum Album of the Week,
// Andrew Sacher's weekly picks); this module matches them to albums by
// artist + title and ranks them in Jay's trust order.

import { compactTitle } from './title-match'

export type AccoladeSource = 'sacher' | 'stereogum' | 'pitchfork'
export type AccoladeKind = 'great' | 'year-end' | 'aotw' | 'best-new' | 'best-new-reissue'

export interface Accolade {
  source: AccoladeSource
  kind: AccoladeKind
  artist: string
  title: string
  /** YYYY-MM-DD, or '' when the source didn't say. */
  date: string
  url?: string
  score?: number
  /** Position on a ranked year-end list. */
  rank?: number
}

/** Trust order: earlier sources outrank later ones on a cover. */
export const ACCOLADE_SOURCES: readonly AccoladeSource[] = ['sacher', 'stereogum', 'pitchfork']

export const ACCOLADE_SOURCE_NAMES: Record<AccoladeSource, string> = {
  sacher: 'Andrew Sacher',
  stereogum: 'Stereogum',
  pitchfork: 'Pitchfork'
}

/** Two-to-six letters for the sticker itself. */
export function stickerText(a: Accolade): string {
  switch (a.kind) {
    case 'great':
      return 'SACHER'
    case 'year-end':
      return a.rank != null ? `#${a.rank}` : 'BEST OF'
    case 'aotw':
      return 'AOTW'
    case 'best-new':
      return 'BNM'
    case 'best-new-reissue':
      return 'BNR'
  }
}

/** Full label for tooltips and the album page. */
export function accoladeLabel(a: Accolade): string {
  switch (a.kind) {
    case 'great':
      return 'Andrew Sacher pick'
    case 'year-end': {
      const y = a.date.slice(0, 4)
      return `Sacher era BV best of ${y}${a.rank != null ? ` · #${a.rank}` : ''}`
    }
    case 'aotw':
      return 'Stereogum Album of the Week'
    case 'best-new':
      return a.score != null ? `Pitchfork Best New Music · ${a.score.toFixed(1)}` : 'Pitchfork Best New Music'
    case 'best-new-reissue':
      return a.score != null ? `Pitchfork Best New Reissue · ${a.score.toFixed(1)}` : 'Pitchfork Best New Reissue'
  }
}

// Compact keys, same family as the library matcher. A name that is only
// punctuation (the band "@") compacts to nothing, so keep it as itself.
function key(s: string): string {
  return compactTitle(s) || s.trim().toLowerCase()
}

function artistKeys(artist: string): string[] {
  const whole = key(artist.replace(/^the\s+/i, ''))
  // Pitchfork lists splits/collabs as "A / B"; index each side too so the
  // record shows up on both artists' pages.
  const parts = artist.includes(' / ')
    ? artist.split(' / ').map((p) => key(p.replace(/^the\s+/i, '')))
    : []
  return [...new Set([whole, ...parts])].filter(Boolean)
}

function titleKey(title: string): string {
  // "cantu of the sower EP" vs "cantu of the sower"; editions are already
  // dropped by compactTitle's parenthetical strip.
  return key(title.replace(/\s+(ep|lp)$/i, ''))
}

export class AccoladeIndex {
  private readonly byKey = new Map<string, Accolade[]>()

  constructor(entries: readonly Accolade[], enabled: readonly AccoladeSource[] = ACCOLADE_SOURCES) {
    const on = new Set(enabled)
    for (const e of entries) {
      if (!on.has(e.source)) continue
      const t = titleKey(e.title)
      for (const a of artistKeys(e.artist)) {
        const k = `${a}|${t}`
        const list = this.byKey.get(k)
        if (!list) this.byKey.set(k, [e])
        else if (!list.some((x) => x.source === e.source && x.kind === e.kind)) list.push(e)
      }
    }
    for (const list of this.byKey.values()) list.sort(compareAccolades)
  }

  get size(): number {
    return this.byKey.size
  }

  /** Picks for this album, best-trusted first. Empty when none. */
  lookup(artist: string, title: string): Accolade[] {
    const t = titleKey(title)
    for (const a of artistKeys(artist)) {
      const hit = this.byKey.get(`${a}|${t}`)
      if (hit) return hit
    }
    return EMPTY
  }
}

const EMPTY: Accolade[] = []

function compareAccolades(a: Accolade, b: Accolade): number {
  const r = ACCOLADE_SOURCES.indexOf(a.source) - ACCOLADE_SOURCES.indexOf(b.source)
  if (r !== 0) return r
  // Same source twice (BNM + BNR): the newer review first.
  return (b.date || '').localeCompare(a.date || '')
}

// --- critics' shelves -------------------------------------------------------
// Automatic crates in the library sidebar: one per source plus "all". They
// live only in Cratedigger (never written to Plex) and fill themselves from
// the same index the stickers use.

export type PicksShelf = 'all' | AccoladeSource

export const PICKS_SHELVES: readonly PicksShelf[] = ['all', ...ACCOLADE_SOURCES]

export function picksShelfName(shelf: PicksShelf): string {
  return shelf === 'all' ? 'All picks' : ACCOLADE_SOURCE_NAMES[shelf]
}

/** The album's picks that belong on this shelf (already source-filtered by the index). */
export function picksOnShelf(picks: readonly Accolade[], shelf: PicksShelf): Accolade[] {
  return shelf === 'all' ? [...picks] : picks.filter((p) => p.source === shelf)
}

/** Newest pick date for this shelf, '' when none of its picks are dated. */
export function shelfPickDate(picks: readonly Accolade[], shelf: PicksShelf): string {
  let best = ''
  for (const p of picksOnShelf(picks, shelf)) if (p.date > best) best = p.date
  return best
}

/** Newest pick first; undated last; ties keep their incoming order. */
export function sortByPickDate<T>(items: readonly T[], dateOf: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, d: dateOf(item) }))
    .sort((a, b) => {
      if (a.d !== b.d) {
        if (!a.d) return 1
        if (!b.d) return -1
        return a.d < b.d ? 1 : -1
      }
      return a.i - b.i
    })
    .map((x) => x.item)
}
