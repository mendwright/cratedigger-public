import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ArtFixDecision,
  ArtFixDecisionKind,
  ArtFixLogEntry,
  ContinuationMode,
  CoverOverride,
  DeletedAlbum,
  ListenLaterEntry,
  ReleaseRadarSnapshot,
  ShowMark
} from '../shared/plex.js'

// All four secrets (Plex token, slskd key, last.fm key, tagger key) are stored
// encrypted on disk. Two schemes coexist for backward compatibility:
//
//   enc:v1: → safeStorage (macOS Keychain), keyed by the *exact codesign
//     identity* that wrote it. Cratedigger originally used this, but it means
//     keys "disappear" the moment a build with a different identity reads
//     them (dev mode ↔ packaged Sideman.app ↔ packaged signed-Cratedigger).
//   enc:v2: → AES-256-GCM keyed by a per-machine random secret stored in
//     `userData/secrets.key` (0600). Survives every build switch on the same
//     machine; threat model is the user's own home dir, which is no worse
//     than the LAN service tokens already encrypted under it.
//
// Reads accept both. Writes always emit v2. migrateSecrets() at startup
// re-encrypts any v1 (or plaintext) values it can still decrypt into v2 so
// the on-disk file is always at-rest encrypted under the durable scheme.
const ENC_PREFIX_V1 = 'enc:v1:'
const ENC_PREFIX_V2 = 'enc:v2:'
const KEY_FILE_NAME = 'secrets.key'
const KEY_SIZE = 32
const NONCE_SIZE = 12
const TAG_SIZE = 16

let cachedFileKey: Buffer | null = null

function loadOrCreateFileKey(): Buffer {
  if (cachedFileKey) return cachedFileKey
  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  const keyPath = join(userData, KEY_FILE_NAME)
  if (existsSync(keyPath)) {
    const buf = readFileSync(keyPath)
    if (buf.length === KEY_SIZE) {
      cachedFileKey = buf
      return buf
    }
    console.warn(`[store] ${KEY_FILE_NAME} wrong size (${buf.length}), regenerating`)
  }
  const key = randomBytes(KEY_SIZE)
  writeFileSync(keyPath, key, { mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    // best-effort — some filesystems don't honor chmod
  }
  cachedFileKey = key
  return key
}

function encrypt(plain: string): string {
  if (!plain) return ''
  try {
    const key = loadOrCreateFileKey()
    const nonce = randomBytes(NONCE_SIZE)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ENC_PREFIX_V2 + Buffer.concat([nonce, ciphertext, tag]).toString('base64')
  } catch (err) {
    console.warn('[store] encrypt failed — storing plaintext:', err)
    return plain
  }
}

function decrypt(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX_V2)) {
    try {
      const key = loadOrCreateFileKey()
      const blob = Buffer.from(stored.slice(ENC_PREFIX_V2.length), 'base64')
      if (blob.length < NONCE_SIZE + TAG_SIZE) throw new Error('blob too short')
      const nonce = blob.subarray(0, NONCE_SIZE)
      const tag = blob.subarray(blob.length - TAG_SIZE)
      const ciphertext = blob.subarray(NONCE_SIZE, blob.length - TAG_SIZE)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch (err) {
      console.error('[store] v2 decrypt failed:', err)
      return ''
    }
  }
  if (stored.startsWith(ENC_PREFIX_V1)) {
    if (!safeStorage.isEncryptionAvailable()) return ''
    try {
      return safeStorage.decryptString(
        Buffer.from(stored.slice(ENC_PREFIX_V1.length), 'base64')
      )
    } catch {
      // v1 blob written by a different codesign identity — unrecoverable.
      return ''
    }
  }
  // Legacy plaintext (pre-encryption builds). Return as-is; migrateSecrets
  // will re-encrypt under v2 on next startup.
  return stored
}

export interface StoreSchema {
  clientIdentifier: string
  authToken: string | null
  preferredServerId: string | null
  // Paper color of the last-applied theme; read at BrowserWindow creation so
  // the window background / resize gutter matches the theme from frame one.
  windowBackground: string
  albumMatches: Record<string, string>
  // Per-album manual "original release year" override, keyed by Plex ratingKey.
  // Wins over the MusicBrainz release-group-derived year — needed for box sets /
  // "complete" compilations whose release group is genuinely newer than the
  // music (e.g. a 1957 session first compiled in 1999). Set/cleared from the
  // album page; overlaid alongside the auto index in original-years.ts.
  originalYearOverrides: Record<string, number>
  taggerUrl: string
  taggerApiKey: string
  slskdUrl: string
  slskdApiKey: string
  tautulliUrl: string
  tautulliApiKey: string
  // Optional Plex server-OWNER token, used only for Art Fixer poster writes so
  // the app can edit cover art while signed in as a read-only account (e.g. the
  // shop's account). Empty = fall back to the signed-in account's token.
  plexAdminToken: string
  deletedAlbums: DeletedAlbum[]
  mbTrackCounts: Record<string, number>
  lastfmApiKey: string
  ticketmasterApiKey: string
  // Genius API client credentials. We use the client_credentials grant to mint
  // a (long-lived) bearer token for /search, then scrape the song page for
  // lyrics — Genius's API deliberately omits lyrics text. Backup source for
  // LRCLIB, which is thin on underground/new hip-hop.
  geniusClientId: string
  geniusClientSecret: string
  dupDismissals: string[]
  reviewedAlbums: Record<string, { reviewedAt: number; ignoredFlags: string[] }>
  // Plex ratingKey → label names (fetched from MB). Empty array means "checked,
  // MB had no labels". Missing key means not yet indexed.
  albumLabels: Record<string, string[]>
  // One-slot rolling backup, written every time albumLabels is cleared so the
  // user can recover from an accidental clear. No timestamp because we only
  // keep one.
  albumLabelsBackup: Record<string, string[]>
  // User-curated alias map: variant label name → canonical name. Applied at
  // view time so the on-disk per-album label arrays stay untouched (we never
  // rewrite what MB gave us). Used to fold "New West Records LLC" into
  // "New West Records", etc.
  labelAliases: Record<string, string>
  // Legacy pre-1.1 toggle, kept in the schema so old on-disk values still
  // typecheck; migrated into `continuationMode` at startup. Don't read this
  // directly — use getContinuationMode().
  continuousPlayback: boolean
  // What happens when the music runs out: 'off' stops at the end of the
  // explicit queue, 'album-end' finishes the record then goes quiet,
  // 'radio' keeps going with auto-picked albums. Null until set or migrated
  // so the fresh-install default ('album-end') is distinguishable from a
  // migrated legacy value.
  continuationMode: ContinuationMode | null
  // Per-album cover-art overrides. When set, the renderer's thumbUrl()
  // returns this external URL instead of routing through the Plex protocol.
  coverOverrides: Record<string, CoverOverride>
  // Cached output of the last release-radar run (recently-released +
  // upcoming releases for library artists). Null until the user has run
  // the radar at least once.
  releaseRadar: ReleaseRadarSnapshot | null
  // Albums the user saved for later. Order is insertion order (most-recently
  // added stays at the end, which the renderer reverses for display).
  listenLater: ListenLaterEntry[]
  // Master toggle for "notify me when a library artist is announced at a venue."
  // Defaults on — the feature is opt-out.
  showNotificationsEnabled: boolean
  // Stable VenueShow ids we've already notified the user about (or seeded on
  // first run). Diffed on each background show-check so a given show only ever
  // pings once. Grows slowly; pruning isn't worth the complexity at this scale.
  notifiedShowIds: string[]
  // False until the first show-check has seeded `notifiedShowIds` with the
  // current matches. The seed run is silent — without this flag, the very first
  // check would notify for every already-announced show at once.
  showsNotifyBaselineSet: boolean
  // Show ids that were *recently* announced (notified or banner-surfaced), with
  // when. Unlike `notifiedShowIds` (the forever dedup set), this is what the
  // Shows screen uses to badge "just announced" rows so a notification click
  // actually lands on something findable. Pruned on read past the recency
  // window.
  recentlyNotifiedShows: { id: string; at: string }[]
  // Pinned / tickets-bought marks keyed by stable VenueShow id. Pruned on
  // read once the show date is comfortably past.
  showMarks: Record<string, ShowMark>
  // Append-only Art Fixer rollback log. Each accepted cover writes one entry
  // (before applying) carrying the prior selection, so a revert is one
  // re-select. Grows slowly; not pruned at this scale.
  artFixRollback: ArtFixLogEntry[]
  // Per-album Art Fixer decisions (accepted/skipped). Keeps the review queue
  // resumable across restarts — decided albums drop out until cleared.
  artFixProgress: Record<string, ArtFixDecision>
}

// No baked-in host defaults — the user points these at their own tagger /
// slskd instances in Settings (and they're stripped entirely from the
// public build). Empty means "unconfigured".
const DEFAULT_TAGGER_URL = ''
const DEFAULT_SLSKD_URL = ''

const DEFAULTS: StoreSchema = {
  clientIdentifier: '',
  authToken: null,
  preferredServerId: null,
  windowBackground: '#f3ead4',
  albumMatches: {},
  originalYearOverrides: {},
  taggerUrl: DEFAULT_TAGGER_URL,
  taggerApiKey: '',
  slskdUrl: DEFAULT_SLSKD_URL,
  slskdApiKey: '',
  tautulliUrl: '',
  tautulliApiKey: '',
  plexAdminToken: '',
  deletedAlbums: [],
  mbTrackCounts: {},
  lastfmApiKey: '',
  ticketmasterApiKey: '',
  geniusClientId: '',
  geniusClientSecret: '',
  dupDismissals: [],
  reviewedAlbums: {},
  albumLabels: {},
  albumLabelsBackup: {},
  labelAliases: {},
  continuousPlayback: true,
  continuationMode: null,
  coverOverrides: {},
  releaseRadar: null,
  listenLater: [],
  showNotificationsEnabled: true,
  notifiedShowIds: [],
  showsNotifyBaselineSet: false,
  recentlyNotifiedShows: [],
  showMarks: {},
  artFixRollback: [],
  artFixProgress: {}
}

const store = new Store<StoreSchema>({
  // Keep this 'jayamp' even though the product was renamed (Sideman, then
  // Cratedigger) — electron-store derives the on-disk dir from this name, so
  // changing it strands the user's auth token, preferred server, and manual
  // MB matches.
  name: 'jayamp',
  defaults: DEFAULTS
})

// ---------------------------------------------------------------------------
// Generic typed accessors.
//
// Every plain (non-encrypted) key goes through these four functions; adding a
// persisted field is now just a schema entry + a default. The encrypted
// secrets (auth token, API keys) are deliberately NOT reachable here — they
// must go through their dedicated envelope-handling functions below.
// `continuousPlayback` is also excluded: it's a legacy key migrated by
// getContinuationMode() and must never be read or written directly.
// ---------------------------------------------------------------------------

type SecretKey =
  | 'authToken'
  | 'slskdApiKey'
  | 'lastfmApiKey'
  | 'taggerApiKey'
  | 'tautulliApiKey'
  | 'ticketmasterApiKey'
  | 'geniusClientId'
  | 'geniusClientSecret'
  | 'plexAdminToken'

type PlainKey = Exclude<keyof StoreSchema, SecretKey | 'continuousPlayback'>

/** Keys whose value is a string-keyed record (the patch/delete helpers below). */
type RecordKey = {
  [K in PlainKey]: StoreSchema[K] extends Record<string, unknown> ? K : never
}[PlainKey]

export function getValue<K extends PlainKey>(key: K): StoreSchema[K] {
  const v = store.get(key) ?? DEFAULTS[key]
  // Shallow-copy containers: electron-store hands back shared references
  // (including the DEFAULTS entry itself when the key is unset), and callers
  // historically received fresh copies they could mutate freely.
  if (Array.isArray(v)) return [...v] as StoreSchema[K]
  if (v !== null && typeof v === 'object') return { ...v } as StoreSchema[K]
  return v
}

export function setValue<K extends PlainKey>(key: K, value: StoreSchema[K]): void {
  store.set(key, value)
}

export function getFromRecord<K extends RecordKey>(
  key: K,
  k: string
): StoreSchema[K][string] | null {
  const map = (store.get(key) ?? DEFAULTS[key]) as Record<string, StoreSchema[K][string]>
  return map[k] ?? null
}

export function patchRecord<K extends RecordKey>(
  key: K,
  k: string,
  value: StoreSchema[K][string]
): void {
  const map = { ...(store.get(key) ?? DEFAULTS[key]) } as Record<
    string,
    StoreSchema[K][string]
  >
  map[k] = value
  store.set(key, map as StoreSchema[K])
}

export function deleteFromRecord<K extends RecordKey>(key: K, k: string): void {
  const map = { ...(store.get(key) ?? DEFAULTS[key]) } as Record<string, unknown>
  delete map[k]
  store.set(key, map as StoreSchema[K])
}

export function getClientIdentifier(): string {
  let id = store.get('clientIdentifier')
  if (!id) {
    id = randomUUID()
    store.set('clientIdentifier', id)
  }
  return id
}

export function getAuthToken(): string | null {
  const raw = store.get('authToken')
  if (raw === null || raw === '') return null
  return decrypt(raw) || null
}

export function setAuthToken(token: string | null): void {
  store.set('authToken', token === null || token === '' ? null : encrypt(token))
}

// Manual album→MB release pin (the ManualMatchModal override). Named because
// "album match" carries domain meaning at half a dozen call sites and tests
// stub these by name.
export function getAlbumMatch(plexRatingKey: string): string | null {
  return getFromRecord('albumMatches', plexRatingKey)
}

export function setAlbumMatch(plexRatingKey: string, mbReleaseMbid: string): void {
  patchRecord('albumMatches', plexRatingKey, mbReleaseMbid)
}

export function clearAlbumMatch(plexRatingKey: string): void {
  deleteFromRecord('albumMatches', plexRatingKey)
}

export function getTaggerUrl(): string {
  return store.get('taggerUrl') || DEFAULT_TAGGER_URL
}

export function setTaggerUrl(url: string): void {
  store.set('taggerUrl', url || DEFAULT_TAGGER_URL)
}

export function getTaggerApiKey(): string {
  return decrypt(store.get('taggerApiKey') || '')
}

export function setTaggerApiKey(key: string): void {
  store.set('taggerApiKey', key ? encrypt(key) : '')
}

export function getSlskdUrl(): string {
  return store.get('slskdUrl') || DEFAULT_SLSKD_URL
}

export function setSlskdUrl(url: string): void {
  store.set('slskdUrl', url || DEFAULT_SLSKD_URL)
}

export function getSlskdApiKey(): string {
  return decrypt(store.get('slskdApiKey') || '')
}

export function setSlskdApiKey(key: string): void {
  store.set('slskdApiKey', key ? encrypt(key) : '')
}

export function getTautulliUrl(): string {
  return store.get('tautulliUrl') || ''
}

export function setTautulliUrl(url: string): void {
  store.set('tautulliUrl', url || '')
}

export function getTautulliApiKey(): string {
  return decrypt(store.get('tautulliApiKey') || '')
}

export function setTautulliApiKey(key: string): void {
  store.set('tautulliApiKey', key ? encrypt(key) : '')
}

export function getPlexAdminToken(): string {
  return decrypt(store.get('plexAdminToken') || '')
}

export function setPlexAdminToken(token: string): void {
  store.set('plexAdminToken', token ? encrypt(token.trim()) : '')
}

// Append-only deletion log — every album delete must land here first (it's
// the only record of what was pruned). Named so call sites read as intent.
export function appendDeletedAlbum(entry: DeletedAlbum): void {
  setValue('deletedAlbums', [...getValue('deletedAlbums'), entry])
}

// --- Art Fixer rollback log + review progress -----------------------------

/** Record a reversible cover change. Call BEFORE applying the new poster so a
 *  mid-write crash still leaves a revertable entry. */
export function appendArtFixLog(entry: ArtFixLogEntry): void {
  setValue('artFixRollback', [...getValue('artFixRollback'), entry])
}

export function getArtFixLog(): ArtFixLogEntry[] {
  return getValue('artFixRollback')
}

/** Remove and return the most recent log entry (drives "revert last"). Returns
 *  null when the log is empty. */
export function popArtFixLog(): ArtFixLogEntry | null {
  const log = getValue('artFixRollback')
  if (log.length === 0) return null
  const last = log[log.length - 1]
  setValue('artFixRollback', log.slice(0, -1))
  return last
}

export function getArtFixProgress(): Record<string, ArtFixDecision> {
  return getValue('artFixProgress')
}

export function setArtFixDecision(rk: string, decision: ArtFixDecisionKind): void {
  patchRecord('artFixProgress', rk, { decision, at: Date.now() })
}

/** Drop an album's decision so it returns to the work-list (used after a
 *  revert puts its art back). */
export function clearArtFixDecision(rk: string): void {
  deleteFromRecord('artFixProgress', rk)
}

export function getLastfmApiKey(): string {
  return decrypt(store.get('lastfmApiKey') || '')
}

export function setLastfmApiKey(key: string): void {
  store.set('lastfmApiKey', key ? encrypt(key) : '')
}

export function getTicketmasterApiKey(): string {
  return decrypt(store.get('ticketmasterApiKey') || '')
}

export function setTicketmasterApiKey(key: string): void {
  store.set('ticketmasterApiKey', key ? encrypt(key) : '')
}

export function getGeniusClientId(): string {
  return decrypt(store.get('geniusClientId') || '')
}

export function setGeniusClientId(id: string): void {
  store.set('geniusClientId', id ? encrypt(id) : '')
}

export function getGeniusClientSecret(): string {
  return decrypt(store.get('geniusClientSecret') || '')
}

export function setGeniusClientSecret(secret: string): void {
  store.set('geniusClientSecret', secret ? encrypt(secret) : '')
}

// At startup, upgrade every secret on disk to the durable v2 format. Anything
// in plaintext or in the old safeStorage-keyed v1 format gets re-encrypted
// under the file-key — once the user is on v2 their keys survive build
// switches forever. v1 blobs that we *can't* decrypt (different codesign
// identity from when they were written) are zeroed so a stale empty value
// doesn't pretend to be a valid key forever.
export function migrateSecrets(): void {
  const fields: (
    | 'authToken'
    | 'slskdApiKey'
    | 'lastfmApiKey'
    | 'taggerApiKey'
    | 'ticketmasterApiKey'
    | 'geniusClientId'
    | 'geniusClientSecret'
    | 'plexAdminToken'
  )[] = [
    'authToken',
    'slskdApiKey',
    'lastfmApiKey',
    'taggerApiKey',
    'ticketmasterApiKey',
    'geniusClientId',
    'geniusClientSecret',
    'plexAdminToken'
  ]
  for (const f of fields) {
    const raw = store.get(f)
    if (typeof raw !== 'string' || !raw) continue
    if (raw.startsWith(ENC_PREFIX_V2)) continue
    const decoded = decrypt(raw)
    if (decoded) {
      store.set(f, encrypt(decoded))
    } else if (raw.startsWith(ENC_PREFIX_V1)) {
      // Unrecoverable v1 blob — wipe so the user can re-enter and have it
      // stick under v2.
      store.set(f, '')
    }
  }
}

export function addDupDismissal(key: string): string[] {
  const next = [...new Set([...getValue('dupDismissals'), key])]
  setValue('dupDismissals', next)
  return next
}

export function removeDupDismissal(key: string): string[] {
  const next = getValue('dupDismissals').filter((k) => k !== key)
  setValue('dupDismissals', next)
  return next
}

/** Mark an album reviewed now, recording which triage flags were ignored. */
export function setReviewedAlbum(
  ratingKey: string,
  ignoredFlags: string[]
): Record<string, { reviewedAt: number; ignoredFlags: string[] }> {
  patchRecord('reviewedAlbums', ratingKey, {
    reviewedAt: Date.now(),
    ignoredFlags: [...ignoredFlags]
  })
  return getValue('reviewedAlbums')
}

export function clearAlbumLabels(): void {
  const existing = store.get('albumLabels') ?? {}
  console.error('[store] clearAlbumLabels called:', new Error().stack)
  if (Object.keys(existing).length > 0) {
    store.set('albumLabelsBackup', existing)
  }
  store.set('albumLabels', {})
}

export function setLabelAlias(alias: string, canonical: string): void {
  const a = alias.trim()
  const c = canonical.trim()
  if (!a || !c || a === c) return
  const map = { ...(store.get('labelAliases') ?? {}) }
  // Collapse alias chains so resolving never needs more than one hop. If
  // canonical itself maps somewhere, follow it.
  let target = c
  const seen = new Set<string>([a])
  while (map[target] && !seen.has(target)) {
    seen.add(target)
    target = map[target]
  }
  map[a] = target
  // If anything else was pointing at the old alias, repoint it to the new
  // canonical so we keep a single-hop invariant globally.
  for (const [k, v] of Object.entries(map)) {
    if (v === a) map[k] = target
  }
  store.set('labelAliases', map)
}

export function getContinuationMode(): ContinuationMode {
  const v = store.get('continuationMode')
  if (v) return v
  // One-shot migration from the pre-1.1 boolean. Defaults never hit disk, so
  // raw key presence distinguishes an explicit legacy choice (preserve it:
  // true → radio, false → off) from a fresh install (→ 'album-end': finish
  // the record, then silence).
  let migrated: ContinuationMode = 'album-end'
  try {
    const raw = JSON.parse(readFileSync(store.path, 'utf8')) as Record<string, unknown>
    if ('continuousPlayback' in raw) migrated = raw.continuousPlayback ? 'radio' : 'off'
  } catch {
    // unreadable/fresh store — fall through to the default
  }
  store.set('continuationMode', migrated)
  return migrated
}

/** Union the given ids into the notified-set. Idempotent; dedupes. */
export function addNotifiedShowIds(ids: string[]): void {
  if (ids.length === 0) return
  const next = new Set(getValue('notifiedShowIds'))
  for (const id of ids) next.add(id)
  setValue('notifiedShowIds', [...next])
}

// How long a show keeps its "just announced" badge in the Shows screen. Long
// enough that "what was that notification from last week?" still finds it.
const RECENT_SHOW_WINDOW_MS = 21 * 24 * 60 * 60 * 1000

/** Recently-announced show ids, pruning anything past the recency window. */
export function listRecentlyNotifiedShowIds(): string[] {
  const all = store.get('recentlyNotifiedShows') ?? []
  const cutoff = Date.now() - RECENT_SHOW_WINDOW_MS
  const fresh = all.filter((e) => {
    const t = Date.parse(e.at)
    return Number.isFinite(t) && t >= cutoff
  })
  if (fresh.length !== all.length) store.set('recentlyNotifiedShows', fresh)
  return fresh.map((e) => e.id)
}

/** Record newly-announced show ids with the current timestamp. Dedupes by id
 *  (an id already recorded keeps its original announce time). */
export function addRecentlyNotifiedShowIds(ids: string[]): void {
  if (ids.length === 0) return
  const existing = store.get('recentlyNotifiedShows') ?? []
  const seen = new Set(existing.map((e) => e.id))
  const at = new Date().toISOString()
  const added = ids.filter((id) => !seen.has(id)).map((id) => ({ id, at }))
  if (added.length === 0) return
  store.set('recentlyNotifiedShows', [...existing, ...added])
}

// Marks linger a couple of days past the show date — "did I have tickets to
// that?" the morning after still answers — then prune on read.
const SHOW_MARK_GRACE_MS = 2 * 24 * 60 * 60 * 1000

/** All show marks, pruning any whose show date is comfortably past. */
export function listShowMarks(): Record<string, ShowMark> {
  const all = store.get('showMarks') ?? {}
  const cutoff = Date.now() - SHOW_MARK_GRACE_MS
  const fresh: Record<string, ShowMark> = {}
  let pruned = false
  for (const [id, mark] of Object.entries(all)) {
    const t = Date.parse(`${mark.date}T23:59:59Z`)
    if (Number.isFinite(t) && t < cutoff) {
      pruned = true
      continue
    }
    fresh[id] = mark
  }
  if (pruned) store.set('showMarks', fresh)
  return fresh
}

/** Set (or clear) the mark for one show. A mark that's neither pinned nor
 *  holding tickets is deleted — absence is the unmarked state. */
export function setShowMark(id: string, mark: ShowMark): void {
  const all = { ...(store.get('showMarks') ?? {}) }
  if (!mark.pinned && mark.tickets <= 0) {
    delete all[id]
  } else {
    all[id] = { ...mark, tickets: Math.max(0, Math.floor(mark.tickets)) }
  }
  store.set('showMarks', all)
}

export function addToListenLater(entry: ListenLaterEntry): ListenLaterEntry[] {
  const current = getValue('listenLater')
  if (current.some((e) => e.ratingKey === entry.ratingKey)) return current
  const next = [...current, entry]
  setValue('listenLater', next)
  return next
}

export function removeFromListenLater(ratingKey: string): ListenLaterEntry[] {
  const next = getValue('listenLater').filter((e) => e.ratingKey !== ratingKey)
  setValue('listenLater', next)
  return next
}

export function restoreAlbumLabelsBackup(): Record<string, string[]> {
  const backup = store.get('albumLabelsBackup') ?? {}
  if (Object.keys(backup).length === 0) return {}
  const current = store.get('albumLabels') ?? {}
  const merged = { ...backup, ...current }
  store.set('albumLabels', merged)
  return merged
}
