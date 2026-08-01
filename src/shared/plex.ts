export interface PlexPin {
  id: number
  code: string
  clientIdentifier: string
  authToken: string | null
  expiresAt: string
  expiresIn: number
}

export interface PlexUser {
  id: number
  uuid: string
  username: string
  email: string
  title: string
  thumb: string | null
}

// Playlist mirroring to a second Plex account (see main/plex/mirror.ts).
// `mirrored` maps source playlist ratingKey → the twin's ratingKey on the
// mirror account; presence in the map is what "mirrored" means.
export interface MirrorStatus {
  connected: boolean
  account: string | null
  mirrored: Record<string, string>
}

export interface PlexResourceConnection {
  protocol: 'http' | 'https'
  address: string
  port: number
  uri: string
  local: boolean
  relay: boolean
}

export interface PlexResource {
  name: string
  product: string
  productVersion: string
  platform: string
  platformVersion: string
  device: string
  clientIdentifier: string
  provides: string
  owned: boolean
  home: boolean
  accessToken?: string
  publicAddress?: string
  connections: PlexResourceConnection[]
  lastSeenAt?: string
}

export type AuthProgress =
  | { stage: 'creating-pin' }
  | { stage: 'awaiting-claim'; code: string; claimUrl: string; expiresAt: string }
  | { stage: 'signed-in'; user: PlexUser }
  | { stage: 'error'; message: string }
  | { stage: 'idle' }

export interface ServerContext {
  id: string
  name: string
  baseUrl: string
  token: string
}

export interface PlayerContext {
  id: string
  name: string
  product: string
  baseUrl: string
  token: string
}

export interface PlexSection {
  key: string
  title: string
  type: string
  uuid: string
  scanner: string
  agent: string
}

export interface PlexAlbum {
  ratingKey: string
  title: string
  artist: string
  artistRatingKey: string | null
  year: number | null
  thumb: string | null
  addedAt: number
  rating: number | null
  lastViewedAt: number | null
  viewCount: number | null
  guids: string[]
  trackCount: number | null
  studio: string | null
  genres: string[]
}

export type AlbumSortKey =
  | 'addedAt'
  | 'artist'
  | 'title'
  | 'lastViewed'
  | 'rating'
  | 'random'
  | 'negligence'

export interface AlbumFilters {
  genres?: string[]
  decade?: number
  year?: number
  studio?: string
  // Plex mood is a track-level tag — server expands to "albums whose
  // tracks include this mood ID." One mood at a time (no multi-select).
  mood?: string
}

export interface PlexTrack {
  ratingKey: string
  title: string
  index: number | null
  parentIndex: number | null
  duration: number | null
  originalTitle: string | null
  guids: string[]
  // Plex-side absolute path, used only by the tagger's read-only AcoustID
  // identification endpoint when structured MB alignment fails.
  filePath?: string | null
}

export interface AlbumDetail {
  album: PlexAlbum
  tracks: PlexTrack[]
  summary: string | null
  guids: string[]
  genres: string[]
}

export interface CreditPerson {
  mbid: string
  name: string
}

export interface TrackCredit {
  role: string
  instrument: string | null
  person: CreditPerson
}

export interface AlbumCredits {
  releaseMbid: string | null
  originalDate: string | null
  releaseLevel: Array<{ role: string; person: CreditPerson }>
  byTrack: Record<string, TrackCredit[]>
  trackArtists: Record<string, CreditPerson[]>
  members: CreditPerson[]
  // Release-group primary type ("Album", "EP", "Single", "Broadcast", "Other").
  // Optional because legacy cache entries don't have it — they'll backfill
  // on the next MB refresh.
  primaryType?: string | null
  // Release-group secondary types ("Live", "Compilation", "Soundtrack",
  // "Remix", "Demo", ...). Empty array = none, undefined = legacy entry.
  secondaryTypes?: string[]
  // Edition note on the specific release ("Deluxe edition", "Japan only",
  // "2014 remaster"). Distinct from `originalDate` — that's the release-group
  // year; this is the release variant.
  releaseDisambiguation?: string | null
  // ISO release country ("US", "JP", "GB"). Useful disambiguator on imports.
  releaseCountry?: string | null
  // Release status — "Official" is the default; "Promotional"/"Bootleg" matter.
  releaseStatus?: string | null
  // Classical semantics projected from the same MusicBrainz release used for
  // credits. Optional so old persisted payloads remain readable during cache
  // migration; fresh v2 cache entries always carry it.
  classical?: import('./classical-model.js').ClassicalAlbumModel
}

export interface PlexArtist {
  ratingKey: string
  title: string
  thumb: string | null
  summary: string | null
}

export interface ArtistBrowse {
  plexArtist: PlexArtist | null
  albums: PlexAlbum[]
  mbid: string
  name: string
}

export interface SearchTrack {
  ratingKey: string
  title: string
  duration: number | null
  album: string
  albumRatingKey: string | null
  artist: string
  thumb: string | null
}

export interface SearchResults {
  artists: PlexArtist[]
  albums: PlexAlbum[]
  tracks: SearchTrack[]
}

export interface CreditedWork {
  kind: 'release' | 'release-group'
  mbid: string
  title: string
  date: string | null
  roles: string[]
}

export interface ArtistRelation {
  type: string
  direction: string
  artist: { mbid: string; name: string }
}

export interface SimilarArtist {
  mbid: string
  name: string
  score: number
  reasons: string[]
  inLibrary: boolean
  plexArtistRatingKey: string | null
  albumCount: number
}

export interface MbReleaseCandidate {
  mbid: string
  title: string
  artistName: string
  date: string | null
  country: string | null
  status: string | null
  disambiguation: string | null
  trackCount: number | null
}

export interface AlbumMediaInfo {
  ratingKey: string
  trackCount: number
  avgBitrate: number | null
  maxBitrate: number | null
  minBitrate: number | null
  totalSize: number | null
  codec: string | null
  codecs: string[]
  container: string | null
  // Absolute path of one track from Plex's POV. Used downstream to surface
  // which sibling root an album lives in — when the library is served under
  // `/music/<root>/...` the second path segment is the source-tree name.
  // null when Plex didn't return any Parts with a file.
  samplePath: string | null
}

export interface LabelIndexProgress {
  running: boolean
  done: number
  total: number
  current: string | null
  error: string | null
}

export interface LibraryWarmerProgress {
  running: boolean
  // done = items the warmer touched and either fetched or confirmed already
  // cached. `fetched` is the subset where MB/Last.fm work actually happened —
  // useful for the user to gauge progress, since cached items go by in seconds.
  done: number
  fetched: number
  errors: number
  total: number
  current: string | null
  lastError: string | null
}

// Slim shape of an MB release-group as we cache and surface it. We discard
// most of MB's payload to keep cache files small and the renderer's reasoning
// simple.
export interface MbArtistReleaseGroup {
  mbid: string
  title: string
  // YYYY, YYYY-MM, or YYYY-MM-DD. Null when MB has no date at all.
  firstReleaseDate: string | null
  primaryType: string | null
  secondaryTypes: string[]
  disambiguation: string | null
}

// One row rendered in the New Releases page — combines an MB release-group with
// the artist context the user knows it by (the Plex artist record). When the
// artist also exists in the user's library we wire `artistRatingKey` so the
// row links straight to the artist entity page.
export interface ReleaseRadarRow {
  artistMbid: string
  artistName: string
  artistRatingKey: string | null
  releaseGroupMbid: string
  title: string
  firstReleaseDate: string
  primaryType: string | null
  disambiguation: string | null
}

export interface ReleaseRadarSnapshot {
  // Releases whose first-release-date is within the last RECENT_WINDOW_DAYS.
  recent: ReleaseRadarRow[]
  // Releases whose first-release-date is strictly in the future.
  upcoming: ReleaseRadarRow[]
  // When the snapshot was last refreshed end-to-end (artist walk + MB fetch).
  // null until the user has run at least one refresh.
  builtAt: number | null
}

export interface ReleaseRadarProgress {
  running: boolean
  phase: 'idle' | 'enumerating' | 'fetching' | 'done'
  done: number
  total: number
  fetched: number
  errors: number
  currentArtist: string | null
  lastError: string | null
  // Set when a run completes — same value the renderer can read from a fresh
  // get-snapshot call, attached here for convenience so the UI can refresh
  // without a second IPC.
  snapshot: ReleaseRadarSnapshot | null
}

// One album the user saved for later. We snapshot the artist/title/thumb so
// the grid renders even if the underlying Plex item is later removed or
// renamed — clicking the tile still tries to open the album detail, but the
// user at least sees what they meant to revisit.
export interface ListenLaterEntry {
  ratingKey: string
  title: string
  artist: string
  thumb: string | null
  year: number | null
  addedAt: number
}

// Venue-centric Shows model. Bandsintown's free API was killed (IAM-denied,
// not bypassable) so we scrape a hand-picked list of Bay Area venues
// directly. Each venue has its own adapter; the registry below names them.
export type VenueId =
  | 'independent'
  | 'castro'
  | 'cafedunord'
  | 'swedishamerican'
  | 'bottomofthehill'
  | 'augusthall'
  | 'fillmore'
  | 'masonic'
  | 'regency'
  | 'billgraham'
  | 'gamh'
  | 'warfield'
  | 'chapel'
  | 'rickshaw'
  | 'brickandmortar'
  | 'starline'
  | 'theeparkside'
  | 'sfjazz'
  | 'freight'
  | 'knockout'
  | 'storkclub'

export interface Venue {
  id: VenueId
  name: string
  city: string
  region: string
  latitude: number
  longitude: number
  // Canonical calendar URL; also the fallback ticket URL when an event row
  // lacks its own permalink.
  url: string
  // Which adapter implementation owns this venue. Multiple venues can share
  // an adapter (Ticketmaster, Squarespace) — the adapter resolves venueId
  // internally to pick the right query parameters.
  adapter:
    | 'ticketmaster'
    | 'ticketweb'
    | 'squarespace'
    | 'bottomofthehill'
    | 'seetickets-list'
    | 'seetickets-cal'
    | 'webview'
}

// One album in the user's library that credits a given person. Output of
// the inverted album-credits index in src/main/credit-index.ts.
export interface PersonAppearance {
  plexRatingKey: string
  roles: { role: string; instrument: string | null }[]
}

export interface VenueShow {
  // Stable composite id: `${venueId}:${date}:${artistName}`. Used for hide-
  // this-show and dedupe across re-fetches.
  id: string
  venueId: VenueId
  // Top-billed artist as displayed by the venue. Adapters parse "Headliner
  // with Opener" / "Headliner / Opener" forms into headliner + supports.
  artistName: string
  supportArtists: string[]
  date: string  // ISO YYYY-MM-DD
  // Adapter-specific ticket URL when available; falls back to the venue's
  // canonical calendar URL.
  url: string
}

export interface ShowRow {
  event: VenueShow
  venue: Venue
  // Aggregate library hit count across artistName + supportArtists.
  ownedAlbumCount: number
  // Which artist name in the event matched the library (headliner or
  // first matching support). Null = no match.
  matchedArtistName: string | null
  plexArtistRatingKey: string | null
  // MBID for the matched library artist (from Plex's stored guids). Used to
  // open the Entity page directly — no MusicBrainz search needed. Null when
  // either the artist isn't in the library or Plex didn't tag them with an
  // MBID.
  plexArtistMbid: string | null
}

// User mark on a show: pinned ("keep an eye on it") and/or tickets bought
// (how many). Keyed by stable VenueShow.id in the store; a mark that goes
// back to pinned=false + tickets=0 is deleted rather than kept. `date`
// mirrors the show's ISO date so past-show marks can be pruned without
// needing the row.
export interface ShowMark {
  pinned: boolean
  tickets: number
  date: string // ISO YYYY-MM-DD
}

export interface ShowsProgress {
  done: number
  total: number
  // Currently-fetching venue display name; null when idle / between venues.
  current: string | null
}

// A library-matched show handed to the main process so it can decide whether
// it's newly announced (diff against the persisted notified-set) and, if so,
// fire a native notification. Carries just enough to render the alert text and
// jump back to the right place — the full ShowRow stays in the renderer.
export interface ReportedShowMatch {
  // Stable VenueShow.id (`${venueId}:${date}:${artist}`).
  id: string
  artistName: string
  venueName: string
  date: string // ISO YYYY-MM-DD
  ownedAlbumCount: number
}

// Result of reporting matches to main: the subset that was newly announced
// (not previously notified). Empty on the first-ever run (silent baseline) and
// whenever nothing new turned up.
export interface ShowMatchReport {
  newMatches: ReportedShowMatch[]
}

// Triage reviewed-album marker. The user has decided the recorded set of
// flags is acceptable for this album (a 1986 EP with no MB year, a deliberate
// cover override Plex can't proxy, a track-count mismatch on a deluxe
// edition). The marker filters the album out of Triage *as long as* the
// current flags are a subset of `ignoredFlags`. If a new flag appears, the
// album resurfaces — the user re-approves or fixes.
export interface ReviewedAlbum {
  reviewedAt: number
  ignoredFlags: string[]
}

export interface LyricsResult {
  // Either both fields are present (synced is parsed at render time), only
  // plain is present, or `instrumental` is true and both are empty.
  plainLyrics: string | null
  syncedLyrics: string | null
  instrumental: boolean
  source: 'lrclib' | 'genius'
  // Where to find the canonical record (lrclib.net page so users can correct
  // mismatches, or the Genius song page).
  url: string | null
}

export type CoverSource = 'itunes' | 'caa' | 'local'

export interface CoverCandidate {
  source: CoverSource
  // Full-resolution URL used as the active override. iTunes returns ~600px;
  // CAA returns the largest thumbnail we asked for (1200 if available).
  url: string
  // Smaller URL for the picker grid. Same URL is fine if the source has no
  // separate thumb.
  thumbUrl: string
  // Optional context shown under the candidate (e.g. CAA release types like
  // "Front" or iTunes "collection" name). Free-form.
  label: string | null
}

export interface CoverOverride {
  source: CoverSource
  url: string
  thumbUrl: string
  // When the user pinned this override, so we can prune stale entries later
  // if a library ever needs migrating.
  setAt: number
}

// One poster option Plex holds for an album (GET /library/metadata/{rk}/posters).
// Used by the Art Fixer to read the current selection and to re-select a prior
// option on revert. Plex never deletes options, so every selection is reversible.
export interface PlexPoster {
  // The image path/URL — `/library/metadata/.../file?url=…` for a cached option
  // or a raw remote URL for one Plex found but hasn't downloaded.
  key: string
  // The handle used to *select* this option via PUT .../poster?url=… — a
  // `metadata://posters/<hash>` for cached options, the remote URL otherwise.
  // NOTE: selecting must pass this, not `key` (passing `key` is a silent no-op).
  ratingKey: string
  provider: string
  selected: boolean
}

// One reversible Art Fixer change. Written *before* the poster is applied so a
// crash mid-write still leaves a revertable record. Revert = re-select
// `prevRatingKey` (Plex never deletes options, so it always still resolves).
export interface ArtFixLogEntry {
  rk: string
  // The poster ratingKey selected before this change (null if the album had
  // no selected poster — revert then is a no-op).
  prevRatingKey: string | null
  // What was applied: a remote URL we uploaded+selected, or an existing
  // option's ratingKey we re-selected. Exactly one is non-null.
  newUrl: string | null
  newRatingKey: string | null
  // Which candidate source won: 'deezer' | 'itunes' | 'caa' | 'existing' | …
  source: string
  at: number
}

export type ArtFixDecisionKind = 'accepted' | 'skipped'

// Per-album review outcome. Drives queue resumability — an album with a
// decision drops out of the work-list until the decision is cleared (revert).
export interface ArtFixDecision {
  decision: ArtFixDecisionKind
  at: number
}

export type ArtFixSource = 'deezer' | 'itunes' | 'caa' | 'fanarttv' | 'existing'

// A replacement cover the user can apply to one album in the Art Fixer.
export interface ArtFixCandidate {
  source: ArtFixSource
  // Full-resolution image to apply. For an 'existing' Plex option this is a
  // display URL only — applying uses `posterRatingKey` (a re-select, no upload).
  url: string
  thumbUrl: string
  // Measured native dimensions; null when the header couldn't be read.
  width: number | null
  height: number | null
  short: number | null
  label: string | null
  // Set only for source: 'existing' — the Plex Photo ratingKey to re-select.
  posterRatingKey: string | null
  // Title looks like a deluxe/expanded/remaster edition — a yellow flag, since
  // Jay prefers original/standard releases.
  altEdition: boolean
}

// The pre-fetched Deezer candidate carried in review-queue.json (HANDOFF §2).
export interface ArtFixSeed {
  candUrl: string
  candRes: number
  deezerArtist: string
  deezerTitle: string
  asim: number
  bsim: number
}

// One album in the review work-list.
export interface ArtFixQueueItem {
  rk: string
  artist: string
  album: string
  year: number | null
  // Current selected poster's shorter side (px) — measured by the live scan,
  // or carried from the seed snapshot.
  short: number
  // Plex thumb path for displaying the current art.
  thumb: string | null
  // Release MBID if resolvable from the album's Plex guids (enables CAA).
  mbid: string | null
  // Pre-fetched Deezer candidate + match scores, when the seed had one.
  seed: ArtFixSeed | null
}

export interface ArtFixQueue {
  items: ArtFixQueueItem[]
  // 'seed' = the bundled snapshot (instant); 'scan' = a live re-scan result.
  source: 'seed' | 'scan'
  scannedAt: number | null
}

export interface ArtFixScanProgress {
  running: boolean
  done: number
  total: number
  lowRes: number
  current: string | null
  lastError: string | null
}

export interface ArtFixAcceptResult {
  rk: string
  // Measured shorter side of the newly-selected poster (null if unmeasurable).
  newShort: number | null
}

export interface DeletedAlbum {
  deletedAt: number
  ratingKey: string
  title: string
  artist: string
  year: number | null
  mbid: string | null
  plexTrackCount: number | null
  trackTitles: string[]
  reason: string | null
}

export type BioSource = 'wikipedia' | 'lastfm'

export interface Bio {
  source: BioSource
  text: string
  url: string | null
}

export interface ArtistBio extends Bio {
  image: { url: string; source: BioSource } | null
  tags: string[]
}

export interface BookletImage {
  id: string
  url: string
  thumbUrl: string
  types: string[]
  comment: string
}

export type PlayerState = 'playing' | 'paused' | 'stopped' | 'buffering'

// What happens when the music runs out. 'off' stops at the end of the
// explicit queue, 'album-end' finishes the record then goes quiet (the
// crate-digger default), 'radio' keeps going with auto-picked albums.
export type ContinuationMode = 'off' | 'album-end' | 'radio'

export interface PlexPlaylist {
  ratingKey: string
  title: string
  // Plex's own server-side smart flag. Cratedigger's smart playlists are
  // regular (smart=0) Plex playlists materialized from local rules — this
  // flag identifies playlists made smart *in Plex*, which we show read-only.
  smart: boolean
  leafCount: number
  durationMs: number | null
  // Composite art path (`/playlists/{rk}/composite/{ts}`), token-proxied
  // through thumbUrl like any other thumb.
  thumb: string | null
}

export interface PlaylistItem {
  playlistItemID: number
  ratingKey: string
  title: string
  artist: string
  album: string
  albumRatingKey: string | null
  thumb: string | null
  durationMs: number | null
}

// Rules for a Cratedigger smart playlist. Album-grain: an album matches when
// it passes EVERY populated clause (empty clause = don't care); list clauses
// are any-of. Years compare against the *effective original year* (manual
// override > MB original date > Plex year) and labels against the canonical
// names from the MB label index — both Cratedigger-only data that Plex-native
// smart playlists can't see, which is the point of rolling our own.
export interface SmartRules {
  genres: string[]
  labels: string[]
  yearFrom: number | null
  yearTo: number | null
}

export type SmartOrder = 'artist' | 'year' | 'added' | 'random'

export interface SmartPlaylistDef {
  id: string
  name: string
  rules: SmartRules
  // ratingKey of the materialized Plex playlist; null until the first sync.
  plexRatingKey: string | null
  // Cap on matching ALBUMS (not tracks); null = no cap.
  limit: number | null
  order: SmartOrder
  lastSyncedAt: number | null
}

// The album radio mode picked to play next, and why. 'listen-later' = from
// the user's shelf (explicit signal, always wins), 'similar' = scored
// similar-artist pick, 'same-artist' = fallback to another record by the
// same artist when the library has nothing similar.
export interface ContinuationPick {
  albumRatingKey: string
  title: string
  artist: string
  source: 'listen-later' | 'similar' | 'same-artist'
}

export type PlaystateFilter = 'all' | 'unplayed' | 'stale-6m' | 'stale-1y' | 'stale-2y'


export interface MusicTimeline {
  state: PlayerState
  time: number
  duration: number
  title: string
  artist: string
  album: string
  ratingKey: string
  albumRatingKey: string | null
  thumb: string | null
  playQueueID: number | null
  // The device's actual volume (0–100) as reported in the timeline poll —
  // lets the slider reflect reality instead of the app's remembered value.
  // Null when the player doesn't report it.
  volume: number | null
}

export interface PlayQueueItem {
  playQueueItemID: number
  ratingKey: string
  title: string
  artist: string
  album: string
  albumRatingKey: string | null
  thumb: string | null
  duration: number
}

export interface PlayQueueSnapshot {
  playQueueID: number
  selectedItemID: number | null
  items: PlayQueueItem[]
}
