// LRC (synced-lyrics) parsing. LRCLIB's `syncedLyrics` field is a standard
// LRC body: `[mm:ss.xx]line text`, one or more timestamps per line, with
// optional metadata tags (`[ar:...]`, `[ti:...]`) that carry no timestamp.
// Pure and process-agnostic — rendered by the theater-mode view, unit-tested
// with vitest.

export interface LrcLine {
  timeMs: number
  text: string
}

// `[m:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` — minutes then seconds with an
// optional fractional part. Metadata tags like `[ar:Artist]` don't match
// (non-numeric) and fall out naturally.
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

// Parse an LRC body into time-ordered lines. Lines with multiple timestamps
// (choruses) are expanded into one entry per timestamp. Empty-text entries
// are kept — they mark instrumental gaps and let the active-line highlight
// go quiet instead of lingering on the previous lyric.
export function parseLrc(raw: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    TIMESTAMP_RE.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = TIMESTAMP_RE.exec(line)) !== null) {
      // Only consume timestamps in the leading run — a bracket later in the
      // lyric text (e.g. "[Chorus]") shouldn't split the line.
      if (m.index !== lastEnd) break
      const minutes = Number(m[1])
      const seconds = Number(m[2])
      const frac = m[3] ?? ''
      // ".5" = 500ms, ".50" = 500ms, ".500" = 500ms
      const fracMs = frac ? Number(frac.padEnd(3, '0')) : 0
      stamps.push(minutes * 60_000 + seconds * 1000 + fracMs)
      lastEnd = TIMESTAMP_RE.lastIndex
    }
    if (stamps.length === 0) continue
    const text = line.slice(lastEnd).trim()
    for (const timeMs of stamps) out.push({ timeMs, text })
  }
  out.sort((a, b) => a.timeMs - b.timeMs)
  return out
}

// Index of the line active at `timeMs` — the last line whose timestamp has
// passed. -1 before the first line starts.
export function activeLrcIndex(lines: LrcLine[], timeMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].timeMs <= timeMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
