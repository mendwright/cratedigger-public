// Pure presentation helpers shared by the album-detail and now-playing
// screens. Both render the same album body; keeping these in one place means
// the play-count estimate, credit grouping, summary tokenizer, and the
// little formatters can't drift between the two views.
import type { AlbumCredits, AlbumDetail, AlbumMediaInfo, PlexAlbum, PlexTrack } from '../../../../shared/plex'
import { albumSourceRoot } from '../../../../shared/duplicates'
import { fmtBitrate, fmtMs, fmtSize } from '../format'

// Kept as a re-export so existing album-view consumers don't churn; the
// implementation lives in the shared formatters module.
export { fmtMs as formatDuration } from '../format'

export function formatArtists(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, ', ')
    .replace(/[\r\n\t]+/g, ', ')
    .replace(/\s*[;/|]\s*/g, ', ')
    .replace(/\s+feat\.?\s+/gi, ', ')
    .replace(/\s+ft\.?\s+/gi, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type SummaryToken =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; mbid: string; name: string }

// Linkify any band-member name that appears in the album summary so the
// reader can click straight through to that person's entity page.
export function tokenizeSummary(
  summary: string,
  members: { mbid: string; name: string }[]
): SummaryToken[] {
  if (members.length === 0 || !summary) return [{ type: 'text', text: summary }]
  const byName = new Map<string, { mbid: string; name: string }>()
  for (const m of members) byName.set(m.name.toLowerCase(), m)
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length)
  const pattern = new RegExp(`\\b(?:${sorted.map((m) => escapeRegex(m.name)).join('|')})\\b`, 'gi')
  const out: SummaryToken[] = []
  let last = 0
  for (const match of summary.matchAll(pattern)) {
    const idx = match.index ?? 0
    if (idx > last) out.push({ type: 'text', text: summary.slice(last, idx) })
    const hit = byName.get(match[0].toLowerCase())
    if (hit) out.push({ type: 'link', text: match[0], mbid: hit.mbid, name: hit.name })
    else out.push({ type: 'text', text: match[0] })
    last = idx + match[0].length
  }
  if (last < summary.length) out.push({ type: 'text', text: summary.slice(last) })
  return out
}

export type GroupedCredit = {
  role: string
  label: string
  people: Map<string, string>
  // mbid → the album's track titles this person holds the role on, in album
  // order — only for people credited on *some* tracks. Album-wide credits
  // (release-level, or every track) carry no entry. This is what tells you
  // Roky Erickson wrote "You're Gonna Miss Me" and not the other fourteen.
  onTracks: Map<string, string[]>
}

function roleRank(role: string): number {
  const order = [
    'composer',
    'writer',
    'lyricist',
    'vocal',
    'performer',
    'instrument',
    'producer',
    'mix',
    'engineer',
    'mastering'
  ]
  const i = order.indexOf(role)
  return i === -1 ? 99 : i
}

// Collapse release-level + per-track credits into one row per (role,
// instrument), de-duping people by MBID. One "guitar" row, one "drums" row —
// not a bloated combined row.
export function groupCredits(credits: AlbumCredits | null, tracks: PlexTrack[] = []): GroupedCredit[] {
  if (!credits) return []
  const groups = new Map<string, GroupedCredit>()
  // (group key, mbid) → track rating keys the person is credited on
  const trackSets = new Map<string, Map<string, Set<string>>>()
  const add = (role: string, instrument: string | null, mbid: string, name: string, trackKey: string | null): void => {
    const key = instrument ? `${role}::${instrument}` : role
    const label = instrument ?? role
    let g = groups.get(key)
    if (!g) {
      g = { role, label, people: new Map(), onTracks: new Map() }
      groups.set(key, g)
    }
    if (!g.people.has(mbid)) g.people.set(mbid, name)
    if (trackKey) {
      let perPerson = trackSets.get(key)
      if (!perPerson) trackSets.set(key, (perPerson = new Map()))
      let set = perPerson.get(mbid)
      if (!set) perPerson.set(mbid, (set = new Set()))
      set.add(trackKey)
    }
  }
  for (const r of credits.releaseLevel) add(r.role, null, r.person.mbid, r.person.name, null)
  for (const [trackKey, list] of Object.entries(credits.byTrack)) {
    for (const c of list) add(c.role, c.instrument, c.person.mbid, c.person.name, trackKey)
  }

  // Album order for the annotations; fall back to the credits' own track keys
  // when the caller has no track list (then nobody is "partial" — there's no
  // total to compare against, so annotations stay off).
  const order = new Map(tracks.map((t, i) => [t.ratingKey, { i, title: t.title }]))
  const total = tracks.length
  if (total > 0) {
    for (const [key, perPerson] of trackSets) {
      const g = groups.get(key)
      if (!g) continue
      for (const [mbid, set] of perPerson) {
        if (set.size >= total) continue
        const titles = [...set]
          .map((rk) => order.get(rk))
          .filter((t): t is { i: number; title: string } => !!t)
          .sort((a, b) => a.i - b.i)
          .map((t) => t.title)
        if (titles.length > 0) g.onTracks.set(mbid, titles)
      }
    }
  }
  return [...groups.values()].sort((a, b) => {
    const rank = roleRank(a.role) - roleRank(b.role)
    if (rank !== 0) return rank
    return a.label.localeCompare(b.label)
  })
}

// Non-default release-group / release type chips ("EP", "Live", "Deluxe
// edition", "JP", "Bootleg") — "Album"/"Official" are the assumed defaults.
export function editionChips(credits: AlbumCredits | null): string[] {
  if (!credits) return []
  const chips: string[] = []
  const seen = new Set<string>()
  const push = (v: string | null | undefined): void => {
    if (!v) return
    const key = v.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    chips.push(v)
  }
  if (credits.primaryType && credits.primaryType !== 'Album') push(credits.primaryType)
  for (const t of credits.secondaryTypes ?? []) push(t)
  push(credits.releaseDisambiguation ?? null)
  if (credits.releaseStatus && credits.releaseStatus !== 'Official') push(credits.releaseStatus)
  // Release country (e.g. MusicBrainz's "XW" worldwide code) is low-signal noise
  // for this user's library — deliberately not surfaced as a chip.
  return chips
}

function fmtRelative(unixSeconds: number | null): string {
  if (!unixSeconds) return ''
  const d = new Date(unixSeconds * 1000)
  const daysAgo = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`
  if (daysAgo < 30) return `${Math.floor(daysAgo / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}


function yearOf(date: string | null): number | null {
  if (!date) return null
  return Number.parseInt(date.slice(0, 4), 10) || null
}

/**
 * MusicBrainz dates come in three widths — YYYY, YYYY-MM, YYYY-MM-DD — and we
 * render exactly as much as we were given. Parsed as UTC parts rather than
 * `new Date(str)` so a west-of-Greenwich clock can't roll the day backwards.
 */
function fmtReleaseDate(date: string | null): string | null {
  if (!date) return null
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date)
  if (!m) return null
  const [, y, mo, d] = m
  if (!mo) return y
  const month = new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC'
  })
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`
}

/**
 * The facts table under the cover on album detail: a key/value block rather
 * than the `·`-joined stats sentence, so released / label / format / added /
 * plays each sit on their own line and scan at a glance.
 *
 * Catalogue number is deliberately absent — Plex exposes the label as
 * `studio` but carries no catalogue number, and fetching one from MB just to
 * fill this row isn't worth a request per album open.
 */
export function albumFacts(
  detail: AlbumDetail,
  mediaInfo: AlbumMediaInfo | null,
  originalYear: number | null,
  originalDate: string | null = null
): { key: string; value: string }[] {
  const a = detail.album
  const rows: { key: string; value: string }[] = []

  const year = originalYear ?? a.year
  if (year) {
    // A reissue shows both: the music's year, then the pressing you own.
    const reissue = originalYear && a.year && a.year !== originalYear ? ` · ${a.year} edition` : ''
    // MusicBrainz often knows the day, so show it. Only when the date agrees
    // with the year we're displaying — a manual year override must not be
    // contradicted by the MB release-group date it replaced.
    const full = fmtReleaseDate(originalDate)
    const shown = full && yearOf(originalDate) === year ? full : `${year}`
    rows.push({ key: 'released', value: `${shown}${reissue}` })
  }
  if (a.studio) rows.push({ key: 'label', value: a.studio })

  if (mediaInfo) {
    const codec = mediaInfo.codec?.toUpperCase()
    const rate = fmtBitrate(mediaInfo.avgBitrate)
    const size = mediaInfo.totalSize ? fmtSize(mediaInfo.totalSize) : ''
    // Size rides along on the format row rather than taking its own — it's
    // the least-consulted fact here, but dropping it outright would lose
    // something the old stats line showed.
    const fmt = [codec, rate, size].filter(Boolean).join(' · ')
    if (fmt) rows.push({ key: 'format', value: fmt })
    // Which mount the files came from (main vs the slskd inbox) — load-bearing
    // for triage, so it keeps a row of its own.
    const root = albumSourceRoot(mediaInfo.samplePath)
    if (root) rows.push({ key: 'source', value: `/${root}` })
  }

  if (a.addedAt) {
    rows.push({
      key: 'added',
      value: new Date(a.addedAt * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    })
  }

  // Plex can know when you last played an album without a usable per-album
  // play count (and vice versa), so either one alone earns the row — gating on
  // the count meant albums you'd demonstrably played showed nothing here.
  const trackCount = detail.tracks.length || a.trackCount || 0
  const spins =
    a.viewCount && a.viewCount > 0 && trackCount > 0
      ? Math.max(1, Math.round(a.viewCount / trackCount))
      : 0
  const last = a.lastViewedAt ? fmtRelative(a.lastViewedAt) : ''
  if (spins > 0 || last) {
    const count = spins > 0 ? `${spins}${spins === 1 ? ' play' : ' plays'}` : ''
    rows.push({ key: 'plays', value: [count, last].filter(Boolean).join(' · ') || '—' })
  }

  return rows
}

// Artist discography strip: filter the full library to releases by the same artist,
// sorted by year. Prefers artistRatingKey match, falls back to artist name.
export function getDiscography(
  detail: AlbumDetail | null,
  allAlbums: PlexAlbum[] | null
): PlexAlbum[] {
  if (!detail || !allAlbums) return []
  const targetArtist = detail.album.artist
  const targetRk = detail.album.artistRatingKey
  return allAlbums
    .filter((a) => {
      if (targetRk && a.artistRatingKey && a.artistRatingKey === targetRk) return true
      return a.artist === targetArtist
    })
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
}
