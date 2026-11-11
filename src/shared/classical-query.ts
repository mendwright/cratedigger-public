// Classical albums arrive as "Performer - Composer: Work, Op. 12 & …" (that's
// how Spotify and the history list name them). Soulseek and RED file the same
// record as "Grieg - Lyric Pieces (Andsnes)" or "Andsnes - Grieg Lyric Pieces",
// and Soulseek only returns paths containing EVERY search word, so the full
// title ("Leif Ove Andsnes Grieg: Lyric Pieces") finds almost nothing.
//
// classicalParts() pulls out the pieces that actually appear in folder names:
// performer surname, composer surname and the two or three words that name the
// work. Pure, process-agnostic (used by main's search and the renderer's RED
// button).

export interface ClassicalParts {
  performer: string
  performerKey: string // surname, or the whole name for ensembles/choirs
  composer: string
  composerKey: string // surname
  work: string // title with the composer prefix removed
  workWords: string[] // the significant words of the work, max 3
}

// Words that never help find a folder: catalog/opus noise, keys, filler.
const NOISE = new Set(
  (
    'the and of a an in for with no nos nr op opp opus bwv kv k d hob rv hwv wwv sz l vol volume ' +
    'book books part parts major minor flat sharp in complete selected collection essential ' +
    'greatest works edition remastered live recording recordings disc cd'
  ).split(' ')
)

// Ensembles keep their whole name ("Quatuor Ébène", "The English Concert");
// a person is searched by surname ("Andsnes").
const ENSEMBLE =
  /\b(quartet|quatuor|quartett|trio|ensemble|orchestra|orchestre|orchester|philharmoni\w*|symphony|choir|chor|chorus|consort|concert|singers|players|soloists|academy|band)\b/i

function surname(name: string): string {
  const n = name.trim()
  if (!n) return ''
  if (ENSEMBLE.test(n)) return n.replace(/^the\s+/i, '')
  // "Bach, Johann Sebastian" → Bach
  if (n.includes(',')) return n.split(',')[0].trim()
  const parts = n.split(/\s+/)
  return parts[parts.length - 1]
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function significantWords(work: string, skip: string[]): string[] {
  const skipSet = new Set(skip.map(fold))
  const out: string[] = []
  const cleaned = work.replace(/\([^)]*\)|\[[^\]]*\]|"[^"]*"/g, ' ')
  for (const raw of cleaned.split(/[^\p{L}\p{N}'’-]+/u)) {
    const w = raw.replace(/^['’-]+|['’-]+$/g, '')
    if (w.length < 2) continue
    const f = fold(w)
    if (NOISE.has(f) || skipSet.has(f) || /^\d+[a-z]?$/.test(f) || /^[ivxlc]+$/.test(f)) continue
    if (out.some((o) => fold(o) === f)) continue
    out.push(w)
    if (out.length === 3) break
  }
  return out
}

/** Pull performer / composer / work out of a classical "Artist - Album" pair,
 *  or null when it doesn't look like one (no "Composer:" prefix that differs
 *  from the artist). */
export function classicalParts(artist: string, album: string): ClassicalParts | null {
  const m = /^\s*([^:]{2,40}?)\s*[:.]\s+(.+)$/.exec(album)
  if (!m) return null
  const composer = m[1].trim()
  const work = m[2].trim()
  // "Satie: …" by Satie, or a band's "Live: …" album — not a classical pair.
  if (!work || fold(composer) === fold(artist.trim())) return null
  if (/^(live|vol|volume|part|disc|cd|the)\b/i.test(composer)) return null
  // Composer prefixes are one to four words, no digits.
  if (/\d/.test(composer) || composer.split(/\s+/).length > 4) return null
  const performerKey = surname(artist)
  const composerKey = surname(composer)
  if (!performerKey || !composerKey) return null
  // Artist is the composer ("Erik Satie" / "Satie: …"): no performer to add.
  if (fold(performerKey) === fold(composerKey)) return null
  const workWords = significantWords(work, [composerKey, ...performerKey.split(/\s+/)])
  if (workWords.length === 0) return null
  return { performer: artist.trim(), performerKey, composer, composerKey, work, workWords }
}

/** Soulseek queries to try, most specific first. Every word must appear in a
 *  share's path, so each one is short. */
export function classicalSearchQueries(p: ClassicalParts): string[] {
  const work2 = p.workWords.slice(0, 2).join(' ')
  const q = [
    `${p.performerKey} ${p.composerKey} ${work2}`,
    `${p.performerKey} ${work2}`,
    `${p.composerKey} ${p.workWords.join(' ')}`
  ]
  return [...new Set(q.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))]
}

/** What a human would type into RED / a tracker search: performer + composer. */
export function classicalTrackerQuery(p: ClassicalParts): string {
  return `${p.performerKey} ${p.composerKey} ${p.workWords.slice(0, 2).join(' ')}`.trim()
}
