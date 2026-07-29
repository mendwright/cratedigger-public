// Pure presentation helpers shared by the album-detail and now-playing
// screens. Both render the same album body; keeping these in one place means
// the play-count estimate, credit grouping, summary tokenizer, and the
// little formatters can't drift between the two views.
import type { AlbumCredits, AlbumDetail, AlbumMediaInfo, PlexAlbum } from '../../../../shared/plex'
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

export type GroupedCredit = { role: string; label: string; people: Map<string, string> }

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
export function groupCredits(credits: AlbumCredits | null): GroupedCredit[] {
  if (!credits) return []
  const groups = new Map<string, GroupedCredit>()
  const add = (role: string, instrument: string | null, mbid: string, name: string): void => {
    const key = instrument ? `${role}::${instrument}` : role
    const label = instrument ?? role
    let g = groups.get(key)
    if (!g) {
      g = { role, label, people: new Map() }
      groups.set(key, g)
    }
    if (!g.people.has(mbid)) g.people.set(mbid, name)
  }
  for (const r of credits.releaseLevel) add(r.role, null, r.person.mbid, r.person.name)
  for (const list of Object.values(credits.byTrack)) {
    for (const c of list) add(c.role, c.instrument, c.person.mbid, c.person.name)
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

// The "played N times · last spun X · added YYYY · FLAC · 1.3 Mbps · 522 MB"
// row. Plex reports album viewCount as the *sum* of per-track plays, so an
// 8-track album played start-to-finish once reads as 8. Divide by the track
// count and round to the nearest whole spin, floored at 1 so any play at all
// reads "played once".
export function albumStats(detail: AlbumDetail, mediaInfo: AlbumMediaInfo | null): string[] {
  const parts: string[] = []
  const a = detail.album
  const trackCount = detail.tracks.length || a.trackCount || 0
  if (a.viewCount && a.viewCount > 0 && trackCount > 0) {
    const spins = Math.max(1, Math.round(a.viewCount / trackCount))
    parts.push(spins === 1 ? 'played once' : `played ${spins} times`)
  }
  if (a.lastViewedAt) parts.push(`last spun ${fmtRelative(a.lastViewedAt)}`)
  if (a.addedAt) parts.push(`added ${new Date(a.addedAt * 1000).getFullYear()}`)
  if (mediaInfo) {
    const codec = mediaInfo.codec?.toUpperCase()
    const rate = fmtBitrate(mediaInfo.avgBitrate)
    if (codec && rate) parts.push(`${codec} · ${rate}`)
    else if (codec) parts.push(codec)
    const size = mediaInfo.totalSize ? fmtSize(mediaInfo.totalSize) : ''
    if (size) parts.push(size)
    const root = albumSourceRoot(mediaInfo.samplePath)
    if (root) parts.push(`/${root}`)
  }
  return parts
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
