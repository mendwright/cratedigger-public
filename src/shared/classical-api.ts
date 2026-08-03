export type ClassicalEntityKind =
  | 'composer'
  | 'work'
  | 'performer'
  | 'ensemble'
  | 'recording'
  | 'release'

export interface ClassicalCatalogStats {
  composers: number
  works: number
  recordings: number
  releases: number
  ownedReleases: number
  pendingReview: number
}

export interface ClassicalEntitySummary {
  id: string
  kind: ClassicalEntityKind
  title: string
  subtitle: string | null
  period: string | null
  genre: string | null
  ownedCount: number
  imageUrl: string | null
  externalIds: Record<string, string>
}

export interface ClassicalHome {
  generatedAt: string
  sourceVersion: string | null
  stats: ClassicalCatalogStats
  featuredComposers: ClassicalEntitySummary[]
  ownedComposers: ClassicalEntitySummary[]
  periods: Array<{ name: string; count: number }>
  genres: Array<{ name: string; count: number }>
}

export interface ClassicalSearchArgs {
  query: string
  kinds?: ClassicalEntityKind[]
  owned?: boolean | null
  period?: string | null
  genre?: string | null
  cursor?: string | null
  limit?: number
}

export interface ClassicalSearchPage {
  items: ClassicalEntitySummary[]
  nextCursor: string | null
  total: number
}

export interface ClassicalOwnedAlbumInput {
  plexServerId: string | null
  ratingKey: string
  title: string
  artist: string
  year: number | null
  thumb: string | null
  candidate: boolean
}

export interface ClassicalWorkSummary extends ClassicalEntitySummary {
  catalogueNumber: string | null
  parentWorkId: string | null
  movementCount: number
  recordingCount: number
  releaseRatingKeys: string[]
}

export interface ClassicalComposerDetail extends ClassicalEntitySummary {
  birth: string | null
  death: string | null
  aliases: string[]
  works: ClassicalWorkSummary[]
}

export interface ClassicalCreditSummary {
  agent: ClassicalEntitySummary
  role: string
  instrument: string | null
  character: string | null
}

export interface ClassicalOwnedReleaseSummary extends ClassicalEntitySummary {
  plexServerId: string | null
  plexRatingKey: string
  year: number | null
  thumb: string | null
  credits: ClassicalCreditSummary[]
}

export interface ClassicalAgentDetail extends ClassicalEntitySummary {
  aliases: string[]
  roles: string[]
  releases: ClassicalOwnedReleaseSummary[]
  works: ClassicalWorkSummary[]
}

export interface ClassicalReleaseDetail extends ClassicalOwnedReleaseSummary {
  program: Array<{
    work: ClassicalWorkSummary
    composers: ClassicalEntitySummary[]
    trackKeys: string[]
  }>
}

export interface ClassicalRecordingDetail extends ClassicalEntitySummary {
  musicBrainzId: string | null
  durationMs: number | null
  matchMethod: string | null
  confidence: string | null
  work: ClassicalWorkSummary | null
  releases: ClassicalOwnedReleaseSummary[]
  credits: ClassicalCreditSummary[]
}

export interface ClassicalWorkDetail extends ClassicalWorkSummary {
  composers: ClassicalEntitySummary[]
  children: ClassicalWorkSummary[]
  parents: ClassicalWorkSummary[]
  releases: ClassicalOwnedReleaseSummary[]
}

export type ClassicalSyncPhase = 'idle' | 'seeding' | 'importing' | 'enriching' | 'paused' | 'error'

export interface ClassicalSyncStatus {
  phase: ClassicalSyncPhase
  usable: boolean
  completed: number
  total: number
  current: string | null
  pending: number
  failed: number
  lastOpenOpusRefresh: string | null
  lastLibrarySync: string | null
  error: string | null
}

export type ClassicalCorrectionCommand =
  | { kind: 'merge-entities'; winnerId: string; loserId: string }
  | { kind: 'map-recording-work'; recordingId: string; workId: string }
  | { kind: 'preferred-title'; entityId: string; title: string }
  | { kind: 'accept-candidate'; candidateId: string }
  | { kind: 'dismiss-candidate'; candidateId: string }

export interface ClassicalCorrection {
  id: string
  command: ClassicalCorrectionCommand
  createdAt: string
  undoneAt: string | null
}

export interface ClassicalCorrectionDocument {
  version: 1
  exportedAt: string
  corrections: ClassicalCorrection[]
}

export interface ClassicalReviewCandidate {
  id: string
  kind: 'entity-match' | 'work-match' | 'recording-match' | 'role-conflict'
  subject: ClassicalEntitySummary
  candidate: ClassicalEntitySummary | null
  confidence: number
  evidence: string[]
  createdAt: string
}
