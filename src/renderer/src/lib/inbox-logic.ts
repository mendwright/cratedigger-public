// Pure decision logic for the inbox reconciler table (InboxView.svelte).
// Params in, value out — no plexState reads — so the apply-gating rules are
// unit-testable. The companion seeding helper (decisionsFromPreview) lives on
// inbox-controller.svelte.ts next to the apply flow that consumes it.
import type {
  InboxFile,
  InboxFolder,
  MbCanonicalRelease,
  MbCanonicalTrack,
  PreviewResponse,
  ReconciledRow,
  RowDecision
} from '../../../shared/tagger'

function normalizeCredit(value: string | null | undefined): string {
  let normalized = (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // MusicBrainz separates credited performers with punctuation while file
    // tags often join them with "&" or "and". The connector is not identity.
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  // MusicBrainz uses the orchestra's current canonical name even on releases
  // recorded before a rename; period-authentic file tags often use the old
  // name. Keep these identity aliases explicit so the safety guard remains
  // strict for genuinely different ensembles.
  const historicalAliases: Array<[string, string]> = [
    ['minneapolis symphony orchestra', 'minnesota orchestra'],
    // Common typo in the downloaded BIS Beethoven cycle.
    ['osmo vanksa', 'osmo vanska']
  ]
  for (const [historical, current] of historicalAliases) {
    normalized = normalized.replaceAll(historical, current)
  }
  return normalized
}

// Scene rips stamp the uploader's handle into albumartist ("PMEDIA",
// "RARBG"). That's provenance graffiti, not a performer credit — treating it
// as evidence blocks releases whose real artist tags match fine.
const SCENE_UPLOADER_TAGS = new Set(['pmedia', 'rarbg', 'glodls', 'yts'])

function isSceneUploaderTag(value: string): boolean {
  return SCENE_UPLOADER_TAGS.has(normalizeCredit(value))
}

function rawTagValues(file: InboxFile, key: string): string[] {
  const raw = file.raw_tags ?? {}
  const entry = Object.entries(raw).find(([k]) => k.toLowerCase() === key)
  return entry?.[1] ?? []
}

function creditEntities(value: string): string[] {
  return value
    .split(/[|;]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function fallbackCreditEntities(value: string): string[] {
  return value
    .split(/[|;,&]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function nameTokens(value: string): string[] {
  return normalizeCredit(value).split(' ').filter(Boolean)
}

// File tags often carry a person's name sort-first ("Da Vila Martinho",
// "Vila, Martinho da") where MusicBrainz credits the natural order
// ("Martinho da Vila"). The same words in a different order are the same
// person, so this is identity, not a different performance.
function isReorderedName(left: string, right: string): boolean {
  const a = nameTokens(left)
  const b = nameTokens(right)
  if (a.length < 2 || a.length !== b.length) return false
  return [...a].sort().join(' ') === [...b].sort().join(' ')
}

function matchesReleaseEntity(credit: string, releaseEntities: string[]): boolean {
  return releaseEntities.some((entity) => isReorderedName(credit, entity))
}

function sameCreditedName(left: string, right: string): boolean {
  const a = normalizeCredit(left)
  const b = normalizeCredit(right)
  return (
    a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`) || isReorderedName(a, b)
  )
}

function releaseContainsCredit(credit: string, releaseCredit: string): boolean {
  const normalized = normalizeCredit(credit)
  if (normalized.length < 4) return true
  if (releaseCredit.includes(normalized)) return true

  // Classical file tags commonly abbreviate and reverse conductor names:
  // "Fischer I." is the same credit as MusicBrainz's "Iván Fischer".
  const parts = normalized.split(' ')
  if (parts.length !== 2) return false
  const initialIndex = parts.findIndex((part) => part.length === 1)
  if (initialIndex < 0) return false
  const initial = parts[initialIndex]
  const surname = parts[initialIndex === 0 ? 1 : 0]
  if (surname.length < 3) return false
  const releaseParts = releaseCredit.split(' ')
  for (let i = 0; i < releaseParts.length - 1; i++) {
    const first = releaseParts[i]
    const second = releaseParts[i + 1]
    if (
      (first === surname && second.startsWith(initial)) ||
      (first.startsWith(initial) && second === surname)
    ) {
      return true
    }
  }
  return false
}

/**
 * Strong performance credits embedded in the files must appear in the
 * MusicBrainz release credit. This prevents a same-work/same-track-count
 * release by a different conductor or orchestra from being applied.
 */
export function performanceConflict(
  folder: InboxFolder | null,
  release: MbCanonicalRelease | null
): string | null {
  if (!folder || !release) return null

  const strong = new Set<string>()
  for (const file of folder.files) {
    for (const key of ['conductor', 'orchestra']) {
      for (const value of rawTagValues(file, key)) {
        // PMEDIA rips stamp the uploader name into conductor too.
        for (const credit of creditEntities(value)) {
          if (!isSceneUploaderTag(credit)) strong.add(credit)
        }
      }
    }
  }

  const releaseAlbumartist = release.albumartist ?? ''
  const releaseCredit = normalizeCredit(releaseAlbumartist)
  const releaseEntities = fallbackCreditEntities(releaseAlbumartist)
  if (strong.size > 0) {
    const missing = [...strong].filter((credit) => {
      return (
        !releaseContainsCredit(credit, releaseCredit) &&
        !matchesReleaseEntity(credit, releaseEntities)
      )
    })
    if (missing.length === 0) return null
    return `Performance mismatch: files say ${missing.join(' / ')}, but this release credits ${releaseAlbumartist}.`
  }

  // Some downloads omit dedicated classical tags. Their unanimous album or
  // track artist is weaker evidence: MusicBrainz may reorder those credits,
  // omit a conductor, or credit only the composer. Block only when none of
  // the credited entities appear on the release. Exact conductor/orchestra
  // tags above remain strict.
  const unanimous = (key: 'albumartist' | 'artist'): string | null => {
    const values = folder.files
      .map((file) => file.tags[key]?.trim())
      .filter((value): value is string => !!value && !isSceneUploaderTag(value))
    if (values.length === 0) return null
    const first = normalizeCredit(values[0])
    return values.every((value) => normalizeCredit(value) === first)
      ? values[0]
      : null
  }
  const performer = unanimous('albumartist') ?? unanimous('artist')
  if (!performer) return null

  const composer = folder.files.find((f) => f.tags.composer)?.tags.composer?.trim()
  if (composer && sameCreditedName(performer, composer)) return null

  const releaseComposer = releaseAlbumartist.split(';')[0]?.trim()
  const performerEntities = fallbackCreditEntities(performer)
  if (
    performerEntities.length === 1 &&
    releaseComposer &&
    sameCreditedName(performerEntities[0], releaseComposer)
  ) {
    return null
  }

  const normalizedPerformer = normalizeCredit(performer)
  if (releaseCredit.includes(normalizedPerformer)) return null
  const creditedEntity = performerEntities.some((credit) => {
    const normalized = normalizeCredit(credit)
    return normalized.length >= 4 && releaseCredit.includes(normalized)
  })
  if (creditedEntity) return null
  if (matchesReleaseEntity(performer, releaseEntities)) return null
  if (performerEntities.some((credit) => matchesReleaseEntity(credit, releaseEntities)))
    return null
  return `Performance mismatch: files say ${performer}, but this release credits ${releaseAlbumartist}.`
}

function normalizedTrackStem(name: string): string {
  const dot = name.lastIndexOf('.')
  let stem = dot >= 0 ? name.slice(0, dot) : name
  stem = stem.replace(/(?:_\d{6,}|\s*\(\d+\)|-\d{1,3})$/, '')
  return stem.trim().toLowerCase()
}

function extensionRank(name: string): number {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  switch (ext) {
    case '.flac':
    case '.wav':
    case '.aiff':
    case '.aif':
      return 100
    case '.m4a':
      return 70
    case '.opus':
    case '.ogg':
      return 50
    case '.mp3':
      return 40
    default:
      return 0
  }
}

/** Same named track in multiple formats: keep the highest-fidelity format. */
export function lowerQualityCopies(files: InboxFile[]): InboxFile[] {
  const groups = new Map<string, InboxFile[]>()
  for (const file of files) {
    const key = normalizedTrackStem(file.name)
    const bucket = groups.get(key)
    if (bucket) bucket.push(file)
    else groups.set(key, [file])
  }

  const result: InboxFile[] = []
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    const bestRank = Math.max(...bucket.map((file) => extensionRank(file.name)))
    const formats = new Set(
      bucket.map((file) => file.name.slice(file.name.lastIndexOf('.')).toLowerCase())
    )
    if (formats.size < 2) continue
    result.push(...bucket.filter((file) => extensionRank(file.name) < bestRank))
  }
  return result
}

/** Missing positions inferred from TRACKNUMBER values such as "3" or "3/7". */
export function missingTrackNumbers(files: InboxFile[]): number[] {
  const present = new Set<number>()
  let expected = 0
  for (const file of files) {
    const value = file.tags.tracknumber
    if (!value) continue
    const match = value.match(/^(\d+)(?:\s*\/\s*(\d+))?/)
    if (!match) continue
    const track = Number(match[1])
    const total = match[2] ? Number(match[2]) : 0
    if (track > 0) present.add(track)
    expected = Math.max(expected, track, total)
  }
  if (present.size < 2 || expected === 0) return []
  return Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !present.has(n))
}

/** The decision a row falls back to when the user hasn't chosen: the
 *  reconciler's default pick, or null for "manual" rows. */
export function defaultDecision(row: ReconciledRow): RowDecision | null {
  if (row.default_choice === 'matcher' && row.matcher_pick) return row.matcher_pick.track_index
  if (row.default_choice === 'acoustid' && row.acoustid_pick) return row.acoustid_pick.track_index
  return null
}

/** What the user has currently chosen for a row — their explicit decision,
 *  else the row's default, else null (unresolved). */
export function decisionForRow(
  row: ReconciledRow,
  decisions: Record<string, RowDecision>
): RowDecision | null {
  const d = decisions[row.path]
  if (d !== undefined) return d
  return defaultDecision(row)
}

/** The MB track a row currently maps to, or null when skipped/unresolved. */
export function trackForRow(
  row: ReconciledRow,
  decisions: Record<string, RowDecision>,
  release: MbCanonicalRelease | null
): MbCanonicalTrack | null {
  const d = decisionForRow(row, decisions)
  if (typeof d !== 'number') return null
  return release?.tracks[d - 1] ?? null
}

/**
 * Count overrides — rows where the user chose something other than the
 * reconciler's default. Surfaced in the apply button label so the user sees
 * how much of the assignment is "their" choice.
 */
export function countOverrides(
  preview: PreviewResponse | null,
  decisions: Record<string, RowDecision>
): number {
  if (!preview) return 0
  let n = 0
  for (const r of preview.rows) {
    const d = decisions[r.path]
    if (d === undefined) continue
    if (d !== defaultDecision(r)) n++
  }
  return n
}

/** MusicBrainz track positions currently claimed by more than one file. */
export function duplicateTrackNumbers(
  preview: PreviewResponse | null,
  decisions: Record<string, RowDecision>
): number[] {
  if (!preview) return []
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const row of preview.rows) {
    const decision = decisionForRow(row, decisions)
    if (typeof decision !== 'number') continue
    if (seen.has(decision)) duplicates.add(decision)
    seen.add(decision)
  }
  return [...duplicates].sort((a, b) => a - b)
}

/**
 * Apply is ready when every row has a usable choice (a unique track index or
 * "skip"), not just the ones the reconciler defaulted. "manual" rows with no
 * explicit decision and duplicate track assignments both block apply. No
 * preview at all blocks apply — this gates a destructive file move.
 */
export function isReadyToApply(
  preview: PreviewResponse | null,
  decisions: Record<string, RowDecision>
): boolean {
  if (!preview) return false
  if (preview.file_count !== preview.total_tracks) return false
  if (duplicateTrackNumbers(preview, decisions).length > 0) return false
  for (const r of preview.rows) {
    const decision = decisionForRow(r, decisions)
    if (decision === null) return false
  }
  return true
}
