// Shared display formatters. These were independently redefined (and had
// quietly drifted) across InboxView, Triage, SlskdSearch, NewReleases, and
// album-view/helpers — one copy each now, with the most defensive signature
// kept where the variants disagreed (null-accepting, '' for "no value").
// Call sites that want an explicit placeholder do `fmtSize(x) || '—'`.

/** Milliseconds → "m:ss". '' for null/0 (unknown duration). */
export function fmtMs(ms: number | null): string {
  if (!ms) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Seconds → "m:ss". '' for null/0. (slskd reports track lengths in seconds.) */
export function fmtLen(s: number | null): string {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

/** Bytes → "512 B" / "37 KB" / "8.4 MB" / "1.02 GB". '' for null only —
 *  a real 0 formats as "0 B" (e.g. a download with nothing transferred yet). */
export function fmtSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** kbps → "320 kbps" / "1.4 Mbps". '' for null/0 (unknown bitrate). */
export function fmtBitrate(kbps: number | null): string {
  if (!kbps) return ''
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${kbps} kbps`
}

/** Bytes/sec → "640 B/s" / "210 KB/s" / "1.3 MB/s". */
export function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

/** Unix millis timestamp → "YYYY-MM-DD" (UTC). */
export function fmtIsoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** MusicBrainz partial date (YYYY[-MM[-DD]]) → "Aug 14, 2026" / "Aug 2026" /
 *  "2026" — never invents precision the data lacks. Unparseable input is
 *  returned as-is. */
export function fmtMbDate(d: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(d)
  if (!m) return d
  const year = m[1]
  const month = m[2] ? parseInt(m[2], 10) : null
  const day = m[3] ? parseInt(m[3], 10) : null
  if (!month) return year
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (!day) return `${months[month - 1]} ${year}`
  return `${months[month - 1]} ${day}, ${year}`
}
