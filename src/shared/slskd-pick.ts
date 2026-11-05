import type { SlskdAlbumCandidate, SlskdFile } from './slskd'
import { compactTitle, stripEditionSuffix } from './title-match'

// Auto-pick ONE file for a song-grade acquisition ("queue all songs" over a
// playlist's gaps). Pure so the choice is testable: title gate first, then
// score duration proximity, format, and uploader conditions.

export interface SinglePick {
  candidate: SlskdAlbumCandidate
  file: SlskdFile
  score: number
}

function fileTitleCompact(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const noExt = base.replace(/\.[a-z0-9]{2,5}$/i, '')
  // Strip leading track numbering: "01 - ", "1-07 ", "03. ", "12_"
  const noTrackNo = noExt.replace(/^\s*\d{1,3}\s*[-._)\s]\s*/, '')
  return compactTitle(stripEditionSuffix(noTrackNo))
}

export function scoreSingleFile(
  title: string,
  durationMs: number | null,
  candidate: SlskdAlbumCandidate,
  file: SlskdFile
): number | null {
  const want = compactTitle(stripEditionSuffix(title))
  if (!want) return null
  const got = fileTitleCompact(file.filename)
  // Title gate: the filename must contain the track title (or vice versa for
  // "Title (remastered)" wants against plain filenames).
  if (!got || !(got.includes(want) || want.includes(got))) return null

  let score = 0
  // Exact filename beats "contains" — penalizes 12" mixes/live takes whose
  // names merely embed the title.
  if (got === want) score += 2

  if (durationMs !== null && file.length !== null) {
    const gap = Math.abs(file.length * 1000 - durationMs)
    if (gap <= 5000) score += 3
    else if (gap <= 15000) score += 1
    else if (gap > 30000) score -= 3
  }

  const ext = file.extension.toLowerCase()
  if (ext === 'flac') score += 2
  else if (file.bitRate !== null && file.bitRate >= 320) score += 1

  if (candidate.hasFreeUploadSlot) score += 2
  // Small tiebreak for faster uploaders (caps at +1).
  score += Math.min(candidate.uploadSpeed / 1_000_000, 1)

  return score
}

export function pickBestSingleFile(
  title: string,
  durationMs: number | null,
  candidates: SlskdAlbumCandidate[]
): SinglePick | null {
  let best: SinglePick | null = null
  for (const c of candidates) {
    for (const f of c.files) {
      const score = scoreSingleFile(title, durationMs, c, f)
      if (score === null) continue
      if (!best || score > best.score) best = { candidate: c, file: f, score }
    }
  }
  return best
}
