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
  RadioHistoryEntry,
  ReleaseRadarSnapshot,
  ShowMark,
  SmartPlaylistDef
} from '../shared/plex.js'
import type { SpotifyImportReport } from '../shared/spotify.js'
import {
  docsEqual,
  roamingValues,
  type RoamingDoc,
  type RoamingKey
} from '../shared/roaming.js'
import type { AcquisitionJob } from '../shared/acquisition.js'
import type { SlskdPeerHistory } from '../shared/slskd.js'
import type { ComposerOverride } from '../shared/classical-model.js'

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
  // Manual composer identity for albums whose track↔work alignment is weak or
  // unavailable. Authorizes the hero composer only, never work grouping.
  albumComposerOverrides: Record<string, ComposerOverride>
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
  // Cratedigger smart-playlist definitions (the rules). The materialized
  // playlists live on the Plex server; these are the local recipes.
  smartPlaylists: SmartPlaylistDef[]
  // Spotify import: the user's own dev-app client ID (public, PKCE — no
  // secret), the OAuth refresh token (encrypted at rest), and the per-
  // playlist import reports (matched counts + gaps).
  spotifyClientId: string
  spotifyRefreshToken: string
  spotifyImports: SpotifyImportReport[]
  // Folder of playlist exports (Exportify CSVs / data-dump JSON) — re-read
  // on every Playlists-screen open so the import list survives reloads.
  spotifyImportDir: string
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
  // Plex ratingKey → genre names, sourced from MusicBrainz (release genres,
  // then the release-group's) and falling back to Last.fm tags filtered
  // through MB's genre vocabulary. Plex's own genre tags are the last resort
  // and are NOT copied in here — `effectiveGenres()` in shared/genre-text.ts
  // does that merge at view time, so clearing this index restores Plex's tags
  // without a refetch. Empty array means "checked, nothing found"; a missing
  // key means not yet indexed.
  albumGenres: Record<string, string[]>
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
  // Radio's long-term memory: every staged pick, newest last. Feeds the
  // picker's repeat exclusion (~30d per album) and artist-fatigue scoring
  // (~7d). Pruned on write; capped so it can't grow unbounded.
  radioHistory: RadioHistoryEntry[]
  // Per-album cover-art overrides. When set, the renderer's thumbUrl()
  // returns this external URL instead of routing through the Plex protocol.
  coverOverrides: Record<string, CoverOverride>
  // Cached output of the last release-radar run (recently-released +
  // upcoming releases for library artists). Null until the user has run
  // the radar at least once.
  releaseRadar: ReleaseRadarSnapshot | null
  // Legacy pre-roaming Listen Later list. Migrated into `roamingListenLater`
  // on first access and left empty; kept in the schema so old on-disk values
  // still typecheck. Don't read directly — use listListenLater().
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
  // Bijou (RED acquisition service) base URL for the grab notifier. Empty =
  // feature off. Private-build only, like the tagger/slskd endpoints.
  bijouUrl: string
  // nowplaying-kiosk base URL; themes are pushed here (private build).
  kioskUrl: string
  // RED ledger torrent_ids we've already notified about (or seeded). Same
  // shape/lifecycle as notifiedShowIds.
  bijouNotifiedGrabIds: number[]
  bijouNotifyBaselineSet: boolean
  // Legacy pre-roaming show marks. Migrated into `roamingShowMarks` on first
  // access and left empty; kept in the schema so old on-disk values still
  // typecheck. Don't read directly — use listShowMarks().
  showMarks: Record<string, ShowMark>
  // Roaming docs: show marks and Listen Later as per-item timestamped records
  // (tombstones included) so they can merge across machines via the tagger
  // service's /roaming endpoint. These are the source of truth; the UI-facing
  // shapes are derived views. See src/shared/roaming.ts.
  roamingShowMarks: RoamingDoc<ShowMark>
  roamingListenLater: RoamingDoc<ListenLaterEntry>
  // Append-only Art Fixer rollback log. Each accepted cover writes one entry
  // (before applying) carrying the prior selection, so a revert is one
  // re-select. Grows slowly; not pruned at this scale.
  artFixRollback: ArtFixLogEntry[]
  // Per-album Art Fixer decisions (accepted/skipped). Keeps the review queue
  // resumable across restarts — decided albums drop out until cleared.
  artFixProgress: Record<string, ArtFixDecision>
  // Durable slskd album intents. Unlike slskd's transfer list this survives
  // cleanup/restarts and preserves which MusicBrainz release the user chose.
  acquisitionJobs: AcquisitionJob[]
  // Soulseek peers whose albums have completed successfully. Used as a visible
  // trust signal; kept separately from the capped acquisition-job log.
  slskdPeerHistory: Record<string, SlskdPeerHistory>
  // Playlist mirroring: a second Plex account's token (encrypted; e.g. the
  // shop's "Shop Amp" account) that Cratedigger keeps selected playlists in
  // sync with — Plex has no cross-account playlist sharing, so we maintain
  // twins. `playlistMirrors` maps source playlist ratingKey → the mirror
  // account's twin ratingKey; presence in the map = "mirrored".
  mirrorPlexToken: string
  mirrorAccountName: string
  playlistMirrors: Record<string, string>
  // All signed-in Plex accounts, so switching between them never repeats the
  // pin-auth dance. `authToken`/`preferredServerId` above stay the *active*
  // session's working copies (every existing call site reads those);
  // activateAccount() swaps them wholesale. Tokens are encrypted envelopes,
  // same scheme as `authToken`.
  accounts: StoredAccount[]
  activeAccountId: string | null
}

export interface StoredAccount {
  // Plex account uuid. 'legacy' until the first successful user verify after
  // migration from the single-account era fills in the real identity.
  id: string
  username: string
  email: string
  thumb: string | null
  // Encrypted envelope (enc:v2:…), never plaintext.
  token: string
  preferredServerId: string | null
}

/** What crosses IPC about an account — everything except the token. */
export interface AccountInfo {
  id: string
  username: string
  email: string
  thumb: string | null
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
  windowBackground: '#0c0b0a',
  albumMatches: {},
  albumComposerOverrides: {},
  originalYearOverrides: {},
  taggerUrl: DEFAULT_TAGGER_URL,
  taggerApiKey: '',
  slskdUrl: DEFAULT_SLSKD_URL,
  slskdApiKey: '',
  tautulliUrl: '',
  tautulliApiKey: '',
  plexAdminToken: '',
  deletedAlbums: [],
  smartPlaylists: [],
  spotifyClientId: '',
  spotifyRefreshToken: '',
  spotifyImports: [],
  spotifyImportDir: '',
  mbTrackCounts: {},
  lastfmApiKey: '',
  ticketmasterApiKey: '',
  geniusClientId: '',
  geniusClientSecret: '',
  dupDismissals: [],
  reviewedAlbums: {},
  albumLabels: {},
  albumGenres: {},
  albumLabelsBackup: {},
  labelAliases: {},
  continuousPlayback: true,
  continuationMode: null,
  radioHistory: [],
  coverOverrides: {},
  releaseRadar: null,
  listenLater: [],
  showNotificationsEnabled: true,
  notifiedShowIds: [],
  showsNotifyBaselineSet: false,
  bijouUrl: '',
  kioskUrl: '',
  bijouNotifiedGrabIds: [],
  bijouNotifyBaselineSet: false,
  recentlyNotifiedShows: [],
  showMarks: {},
  roamingShowMarks: { items: {} },
  roamingListenLater: { items: {} },
  artFixRollback: [],
  artFixProgress: {},
  acquisitionJobs: [],
  slskdPeerHistory: {},
  mirrorPlexToken: '',
  mirrorAccountName: '',
  playlistMirrors: {},
  accounts: [],
  activeAccountId: null
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
  | 'mirrorPlexToken'

// `accounts` is excluded like the secrets: its entries embed encrypted token
// envelopes and must only move through the dedicated account helpers below.
type PlainKey = Exclude<keyof StoreSchema, SecretKey | 'continuousPlayback' | 'accounts'>

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

export function getMirrorPlexToken(): string | null {
  const raw = store.get('mirrorPlexToken')
  if (!raw) return null
  return decrypt(raw) || null
}

export function setMirrorPlexToken(token: string | null): void {
  store.set('mirrorPlexToken', token ? encrypt(token) : '')
}

// ---------------------------------------------------------------------------
// Multi-account. `authToken`/`preferredServerId` remain the active session's
// working copies (every call site reads those); these helpers keep the
// `accounts` roster in sync and swap the working copies on switch. Token
// envelopes move between roster and working copy as-is — same key, no
// decrypt/re-encrypt round trip.
// ---------------------------------------------------------------------------

/** Placeholder id for the pre-multi-account token until its identity is verified. */
export const LEGACY_ACCOUNT_ID = 'legacy'

function readAccounts(): StoredAccount[] {
  return (store.get('accounts') ?? []) as StoredAccount[]
}

export function listAccountInfos(): AccountInfo[] {
  return readAccounts().map(({ id, username, email, thumb }) => ({ id, username, email, thumb }))
}

export function getActiveAccountId(): string | null {
  return store.get('activeAccountId') ?? null
}

export function getAccountInfo(id: string): AccountInfo | null {
  const a = readAccounts().find((a) => a.id === id)
  return a ? { id: a.id, username: a.username, email: a.email, thumb: a.thumb } : null
}

/**
 * Add or update an account after a successful pin-auth, make it active, and
 * point the working copies at it. Replaces any unresolved legacy placeholder —
 * a fresh sign-in supersedes whatever that token was.
 */
export function upsertAccount(info: AccountInfo, tokenPlain: string): void {
  saveActiveServerId()
  const envelope = encrypt(tokenPlain)
  const accounts = readAccounts().filter((a) => a.id !== LEGACY_ACCOUNT_ID)
  const existing = accounts.find((a) => a.id === info.id)
  if (existing) {
    Object.assign(existing, info, { token: envelope })
  } else {
    accounts.push({ ...info, token: envelope, preferredServerId: null })
  }
  store.set('accounts', accounts)
  store.set('activeAccountId', info.id)
  store.set('authToken', envelope)
  setValue('preferredServerId', existing?.preferredServerId ?? null)
}

/** Swap the working copies to another stored account. False if unknown id. */
export function activateAccount(id: string): boolean {
  saveActiveServerId()
  const target = readAccounts().find((a) => a.id === id)
  if (!target) return false
  store.set('activeAccountId', target.id)
  store.set('authToken', target.token)
  setValue('preferredServerId', target.preferredServerId)
  return true
}

/**
 * Drop an account from the roster. If it was active, activate the next one
 * (returning its id) or clear the session entirely (returning null).
 */
export function removeAccount(id: string): string | null {
  const remaining = readAccounts().filter((a) => a.id !== id)
  store.set('accounts', remaining)
  if (getActiveAccountId() !== id) return getActiveAccountId()
  if (remaining.length > 0) {
    const next = remaining[0]
    store.set('activeAccountId', next.id)
    store.set('authToken', next.token)
    setValue('preferredServerId', next.preferredServerId)
    return next.id
  }
  store.set('activeAccountId', null)
  store.set('authToken', null)
  setValue('preferredServerId', null)
  return null
}

/**
 * Fill in (or refresh) the active account's identity from a verified user —
 * this is how the legacy placeholder acquires its real uuid/username/email.
 */
export function syncActiveAccountIdentity(user: {
  uuid: string
  username: string
  email: string
  thumb: string | null
}): void {
  const activeId = getActiveAccountId()
  if (!activeId) return
  const accounts = readAccounts()
  const active = accounts.find((a) => a.id === activeId)
  if (!active) return
  if (
    active.id === user.uuid &&
    active.username === user.username &&
    active.email === user.email &&
    active.thumb === user.thumb
  ) {
    return
  }
  active.id = user.uuid
  active.username = user.username
  active.email = user.email
  active.thumb = user.thumb
  store.set('accounts', accounts)
  store.set('activeAccountId', user.uuid)
}

/** Mirror the current preferredServerId back into the active account's record. */
export function saveActiveServerId(): void {
  const activeId = getActiveAccountId()
  if (!activeId) return
  const accounts = readAccounts()
  const active = accounts.find((a) => a.id === activeId)
  if (!active) return
  active.preferredServerId = getValue('preferredServerId')
  store.set('accounts', accounts)
}

/**
 * One-time seed of the roster from the single-account era: wrap the existing
 * working-copy token in a placeholder entry so it survives switching. Identity
 * fills in on the next successful session verify. Called at startup.
 */
export function migrateAccounts(): void {
  if (readAccounts().length > 0) return
  const raw = store.get('authToken')
  if (!raw) return
  store.set('accounts', [
    {
      id: LEGACY_ACCOUNT_ID,
      username: '',
      email: '',
      thumb: null,
      token: raw,
      preferredServerId: getValue('preferredServerId')
    }
  ])
  store.set('activeAccountId', LEGACY_ACCOUNT_ID)
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

export function getSpotifyClientId(): string {
  return store.get('spotifyClientId') || ''
}

export function setSpotifyClientId(id: string): void {
  store.set('spotifyClientId', id.trim())
}

export function getSpotifyRefreshToken(): string {
  return decrypt(store.get('spotifyRefreshToken') || '')
}

export function setSpotifyRefreshToken(token: string): void {
  store.set('spotifyRefreshToken', token ? encrypt(token) : '')
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
    | 'spotifyRefreshToken'
    | 'mirrorPlexToken'
  )[] = [
    'authToken',
    'slskdApiKey',
    'lastfmApiKey',
    'taggerApiKey',
    'ticketmasterApiKey',
    'geniusClientId',
    'geniusClientSecret',
    'plexAdminToken',
    'spotifyRefreshToken',
    'mirrorPlexToken'
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

// ---------------------------------------------------------------------------
// Roaming docs (show marks, Listen Later).
//
// The docs are the persisted truth; the functions below expose the same
// UI-facing shapes the renderer always used (Record of marks, ordered array)
// as derived views, so nothing above the IPC layer knows about records or
// tombstones. Legacy flat keys migrate in on first access.
// ---------------------------------------------------------------------------

const ROAMING_STORE_KEY: Record<RoamingKey, 'roamingShowMarks' | 'roamingListenLater'> = {
  'show-marks': 'roamingShowMarks',
  'listen-later': 'roamingListenLater'
}

function showMarksDoc(): RoamingDoc<ShowMark> {
  const doc = store.get('roamingShowMarks')
  const legacy = store.get('showMarks') ?? {}
  if (Object.keys(legacy).length === 0) return doc
  const updatedAt = new Date().toISOString()
  const items = { ...doc.items }
  for (const [id, mark] of Object.entries(legacy)) {
    if (!(id in items)) items[id] = { value: mark, updatedAt }
  }
  const migrated = { items }
  store.set('roamingShowMarks', migrated)
  store.set('showMarks', {})
  return migrated
}

function listenLaterDoc(): RoamingDoc<ListenLaterEntry> {
  const doc = store.get('roamingListenLater')
  const legacy = store.get('listenLater') ?? []
  if (legacy.length === 0) return doc
  const updatedAt = new Date().toISOString()
  const items = { ...doc.items }
  for (const entry of legacy) {
    if (!(entry.ratingKey in items)) items[entry.ratingKey] = { value: entry, updatedAt }
  }
  const migrated = { items }
  store.set('roamingListenLater', migrated)
  store.set('listenLater', [])
  return migrated
}

/** A roaming doc by wire key — the sync engine's read side. */
export function getRoamingDoc(key: RoamingKey): RoamingDoc<unknown> {
  return key === 'show-marks' ? showMarksDoc() : listenLaterDoc()
}

/** Replace a roaming doc (with the result of a merge). Returns whether the
 *  stored doc actually changed, so the caller knows to refresh the UI. */
export function setRoamingDoc(key: RoamingKey, doc: RoamingDoc<unknown>): boolean {
  const changed = !docsEqual(getRoamingDoc(key), doc)
  if (changed) store.set(ROAMING_STORE_KEY[key], doc as never)
  return changed
}

// Marks linger a couple of days past the show date — "did I have tickets to
// that?" the morning after still answers — then drop out of the derived view.
// (The underlying records stay in the doc so a merge can't resurrect them.)
const SHOW_MARK_GRACE_MS = 2 * 24 * 60 * 60 * 1000

/** All show marks whose show date isn't comfortably past. */
export function listShowMarks(): Record<string, ShowMark> {
  const cutoff = Date.now() - SHOW_MARK_GRACE_MS
  const fresh: Record<string, ShowMark> = {}
  for (const [id, mark] of Object.entries(roamingValues(showMarksDoc()))) {
    const t = Date.parse(`${mark.date}T23:59:59Z`)
    if (Number.isFinite(t) && t < cutoff) continue
    fresh[id] = mark
  }
  return fresh
}

/** Set (or clear) the mark for one show. A mark that's neither pinned nor
 *  holding tickets becomes a tombstone — unmarked is the deleted state. */
export function setShowMark(id: string, mark: ShowMark): void {
  const doc = showMarksDoc()
  const cleared = !mark.pinned && mark.tickets <= 0
  const value = cleared ? null : { ...mark, tickets: Math.max(0, Math.floor(mark.tickets)) }
  store.set('roamingShowMarks', {
    items: { ...doc.items, [id]: { value, updatedAt: new Date().toISOString() } }
  })
}

/** Listen Later in insertion order (most-recently added last, which the
 *  renderer reverses for display). */
export function listListenLater(): ListenLaterEntry[] {
  return Object.values(roamingValues(listenLaterDoc())).sort((a, b) => a.addedAt - b.addedAt)
}

export function addToListenLater(entry: ListenLaterEntry): ListenLaterEntry[] {
  const doc = listenLaterDoc()
  if (doc.items[entry.ratingKey]?.value == null) {
    store.set('roamingListenLater', {
      items: {
        ...doc.items,
        [entry.ratingKey]: { value: entry, updatedAt: new Date().toISOString() }
      }
    })
  }
  return listListenLater()
}

export function removeFromListenLater(ratingKey: string): ListenLaterEntry[] {
  const doc = listenLaterDoc()
  if (doc.items[ratingKey]?.value != null) {
    store.set('roamingListenLater', {
      items: { ...doc.items, [ratingKey]: { value: null, updatedAt: new Date().toISOString() } }
    })
  }
  return listListenLater()
}

const RADIO_HISTORY_MAX_AGE_MS = 60 * 24 * 3600_000
const RADIO_HISTORY_CAP = 200

export function listRadioHistory(): RadioHistoryEntry[] {
  return store.get('radioHistory') ?? []
}

export function recordRadioPick(entry: RadioHistoryEntry): void {
  const cutoff = Date.now() - RADIO_HISTORY_MAX_AGE_MS
  const next = [...listRadioHistory().filter((h) => h.at >= cutoff), entry]
  store.set('radioHistory', next.slice(-RADIO_HISTORY_CAP))
}

export function restoreAlbumLabelsBackup(): Record<string, string[]> {
  const backup = store.get('albumLabelsBackup') ?? {}
  if (Object.keys(backup).length === 0) return {}
  const current = store.get('albumLabels') ?? {}
  const merged = { ...backup, ...current }
  store.set('albumLabels', merged)
  return merged
}
