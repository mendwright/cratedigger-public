/*
 * Name-based duplicate detection for an inbox folder.
 *
 * Two shapes of duplicate show up in Soulseek downloads often enough to
 * handle without fingerprinting:
 *
 *  1. slskd collision suffix. Ask for the same folder twice (two grabs from
 *     the same peer, or a retry after the first landed) and slskd keeps both,
 *     naming the second `<stem>_<ticks><ext>` — an 18-digit .NET tick count.
 *     "03 - Blue Side of Lonesome_639249152648615758.flac" beside
 *     "03 - Blue Side of Lonesome.flac" is that. The un-suffixed twin is the
 *     keeper; if there is no twin the suffixed file is the only copy and stays.
 *
 *  2. Same track in two encodings. Peers who share "01 Drinkin' Thing.flac"
 *     and "01 Drinkin' Thing.opus" side by side get both enqueued when the
 *     whole folder is grabbed. Keep the best encoding of each stem.
 *
 * Everything else — different filename conventions for the same audio, a
 * bonus disc, alternate takes — is not a name-level duplicate and is left for
 * the AcoustID dedupe or the human.
 */

export interface DupeCandidateFile {
  path: string
  name: string
  ext: string
}

export interface DuplicateDrop {
  path: string
  /** The file it duplicates. */
  keeps: string
  reason: 'slskd-suffix' | 'lesser-encoding'
}

export interface DuplicatePlan {
  drop: DuplicateDrop[]
  keep: string[]
}

const SLSKD_SUFFIX = /^(.*)_(\d{12,})$/

// Higher wins. Lossless first; among lossy, the usual quality ordering.
// `.m4a` is ambiguous (ALAC or AAC) — ranked as lossy so a FLAC beside it
// wins, but above the small-codec formats.
const ENCODING_RANK: Record<string, number> = {
  '.flac': 100,
  '.wav': 95,
  '.aiff': 95,
  '.aif': 95,
  '.ape': 90,
  '.wv': 90,
  '.tta': 85,
  '.m4a': 60,
  '.mp3': 50,
  '.ogg': 40,
  '.opus': 40,
  '.aac': 35,
  '.wma': 20
}

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : ''
}

function stemOf(name: string, ext: string): string {
  return ext && name.toLowerCase().endsWith(ext.toLowerCase())
    ? name.slice(0, name.length - ext.length)
    : name
}

/**
 * Decide which files in a folder are redundant copies of another file in the
 * same directory. Pure; the caller deletes. Only audio extensions the tagger
 * would import are considered for the encoding rule; the suffix rule applies
 * to any file (a doubled cover.jpg is just as redundant).
 */
export function planDuplicateDrops(files: DupeCandidateFile[]): DuplicatePlan {
  const byDir = new Map<string, DupeCandidateFile[]>()
  for (const f of files) {
    const dir = dirOf(f.path)
    const list = byDir.get(dir)
    if (list) list.push(f)
    else byDir.set(dir, [f])
  }

  const drop: DuplicateDrop[] = []
  const dropped = new Set<string>()

  for (const list of byDir.values()) {
    // Rule 1: slskd collision suffix with the un-suffixed twin present.
    const byName = new Map(list.map((f) => [f.name.toLowerCase(), f]))
    for (const f of list) {
      const ext = f.ext.toLowerCase()
      const stem = stemOf(f.name, f.ext)
      const m = SLSKD_SUFFIX.exec(stem)
      if (!m) continue
      const twin = byName.get(`${m[1]}${ext}`.toLowerCase())
      if (!twin || twin.path === f.path) continue
      drop.push({ path: f.path, keeps: twin.path, reason: 'slskd-suffix' })
      dropped.add(f.path)
    }

    // Rule 2: same stem, several encodings — keep the best-ranked one.
    const byStem = new Map<string, DupeCandidateFile[]>()
    for (const f of list) {
      if (dropped.has(f.path)) continue
      const ext = f.ext.toLowerCase()
      if (!(ext in ENCODING_RANK)) continue
      const stem = stemOf(f.name, f.ext).toLowerCase()
      const group = byStem.get(stem)
      if (group) group.push(f)
      else byStem.set(stem, [f])
    }
    for (const group of byStem.values()) {
      if (group.length < 2) continue
      const ranked = [...group].sort(
        (a, b) =>
          ENCODING_RANK[b.ext.toLowerCase()] - ENCODING_RANK[a.ext.toLowerCase()] ||
          a.path.localeCompare(b.path)
      )
      const keeper = ranked[0]
      for (const f of ranked.slice(1)) {
        drop.push({ path: f.path, keeps: keeper.path, reason: 'lesser-encoding' })
        dropped.add(f.path)
      }
    }
  }

  return {
    drop,
    keep: files.filter((f) => !dropped.has(f.path)).map((f) => f.path)
  }
}

/** One-line summary for a job note or toast. */
export function describeDuplicatePlan(plan: DuplicatePlan): string {
  const suffix = plan.drop.filter((d) => d.reason === 'slskd-suffix').length
  const enc = plan.drop.filter((d) => d.reason === 'lesser-encoding').length
  const bits: string[] = []
  if (suffix > 0) bits.push(`${suffix} slskd re-download cop${suffix === 1 ? 'y' : 'ies'}`)
  if (enc > 0) bits.push(`${enc} lesser-encoding twin${enc === 1 ? '' : 's'}`)
  return bits.join(', ')
}
