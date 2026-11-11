// Studio badges: "recorded by Albini" and friends. The people are a short
// hand-picked list (Settings → studio badges); their albums come from the
// MusicBrainz credits Cratedigger already caches for the library, so there is
// nothing to scrape. Only behind-the-board roles count — a songwriting credit
// or band membership alone doesn't make it "an Albini record".

export const DEFAULT_STUDIO_PEOPLE: readonly string[] = [
  'Steve Albini',
  'Rudy Van Gelder',
  'Martin Hannett',
  'Conny Plank',
  'Rick Rubin',
  'Kevin Shields',
  'Adam Selzer'
]

export type StudioHow = 'recorded' | 'produced' | 'mixed'

const RECORDED = new Set(['recording', 'engineer', 'recording engineer', 'audio'])
const PRODUCED = new Set(['producer', 'production'])
const MIXED = new Set(['mix', 'mixer'])

/** The strongest board role in a person's credits on one album, or null. */
export function studioHow(roles: readonly { role: string }[]): StudioHow | null {
  let produced = false
  let mixed = false
  for (const { role } of roles) {
    const r = role.toLowerCase()
    if (RECORDED.has(r)) return 'recorded'
    if (PRODUCED.has(r)) produced = true
    else if (MIXED.has(r)) mixed = true
  }
  return produced ? 'produced' : mixed ? 'mixed' : null
}

export function studioLabel(how: StudioHow, name: string): string {
  return `${how === 'recorded' ? 'Recorded' : how === 'produced' ? 'Produced' : 'Mixed'} by ${name}`
}

/** Case/accent-insensitive name key ("Rudy van Gelder" = "Rudy Van Gelder"). */
export function personNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Clean a user-typed list: trimmed, non-empty, first spelling of each name wins. */
export function cleanStudioPeople(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const n = raw.trim()
    const k = personNameKey(n)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

/** One configured person and their board credits in the library. */
export interface StudioPerson {
  /** The name as configured in Settings. */
  name: string
  /** MusicBrainz artist id with the most board credits (for the credits page). */
  mbid: string | null
  /** plexRatingKey → strongest board role on that album. */
  albums: Record<string, StudioHow>
}
