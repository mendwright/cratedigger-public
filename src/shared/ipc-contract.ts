// Single source of truth for every request/response IPC channel.
//
// Each entry maps a (frozen) channel string to its argument tuple and result
// type. Both sides derive their signatures from this contract:
//   - src/main/ipc.ts:    `register(channel, handler)` — handler params/result
//     are typechecked against the entry, and errors are uniformly wrapped in
//     `new Error(message)` so arbitrary error types never hit Electron's
//     structured clone.
//   - src/preload/index.ts: `invoke(channel)` — produces the renderer-facing
//     bridge function with the exact same args/result types.
//
// Adding a channel = add one entry here, then `register(...)` it in main and
// `invoke(...)` it in preload. Renderer types flow through automatically via
// `CratediggerApi`.
//
// Push (main → renderer) channels are listed separately in `IpcEvents` below;
// they use webContents.send / ipcRenderer.on, not invoke/handle.

import type {
  AlbumCredits,
  AlbumDetail,
  AlbumFilters,
  AlbumMediaInfo,
  AlbumSortKey,
  ArtFixAcceptResult,
  ArtFixCandidate,
  ArtFixLogEntry,
  ArtFixQueue,
  ArtFixScanProgress,
  ArtistBio,
  ArtistBrowse,
  ArtistRelation,
  AuthProgress,
  Bio,
  BookletImage,
  ContinuationMode,
  ContinuationPick,
  CoverCandidate,
  CoverOverride,
  CreditedWork,
  DeletedAlbum,
  LabelDiscography,
  LabelIndexProgress,
  GenreIndexProgress,
  LibraryWarmerProgress,
  ListenLaterEntry,
  LyricsResult,
  MbArtistReleaseGroup,
  MbReleaseCandidate,
  MirrorStatus,
  MusicTimeline,
  PersonAppearance,
  PlaylistItem,
  PlayQueueSnapshot,
  PlexAlbum,
  PlexPlaylist,
  PlexResource,
  PlexSection,
  PlexTrack,
  PlexUser,
  RadioSteer,
  ReleaseRadarProgress,
  ReleaseRadarSnapshot,
  ReportedShowMatch,
  SearchResults,
  ServerContext,
  ShowMark,
  ShowMatchReport,
  SmartPlaylistDef,
  Venue,
  VenueShow
} from './plex.js'
import type {
  SpotifyImportReport,
  SpotifyPlaylistSummary,
  SpotifyStatus,
  SpotifyTrack
} from './spotify.js'
import type { ParsedPlaylist } from './playlist-file.js'
import type { ComposerOverride, ComposerSearchResult } from './classical-model.js'
import type { ClassicalCatalogSnapshot } from './classical-catalog.js'
import type {
  ClassicalComposerDetail,
  ClassicalAgentDetail,
  ClassicalCorrection,
  ClassicalCorrectionCommand,
  ClassicalCorrectionDocument,
  ClassicalHome,
  ClassicalOwnedAlbumInput,
  ClassicalReviewCandidate,
  ClassicalRecordingDetail,
  ClassicalReleaseDetail,
  ClassicalSearchArgs,
  ClassicalSearchPage,
  ClassicalSyncStatus,
  ClassicalWorkDetail
} from './classical-api.js'
import type {
  ApplyOrPreviewResult,
  ApplyRequest,
  ApplyResult,
  AuditResponse,
  InboxFolder,
  MbCanonicalRelease,
  PrefingerprintResponse,
  RetagRequest,
  TaggerHealth
} from './tagger.js'
import type {
  SlskdDownloads,
  SlskdEnqueueRequest,
  SlskdEnqueueResult,
  SlskdHealth,
  SlskdSearchResult,
  SlskdSuccessfulPeer,
  SlskdUserBrowse
} from './slskd.js'
import type {
  ChartDimension,
  ChartResult,
  ChartUser,
  ChartWindow,
  TautulliConfig,
  TautulliHealth
} from './charts.js'
import type { UpdateState } from './updates.js'

// ---------------------------------------------------------------------------
// Wire-format helper types (previously inlined in src/preload/index.ts)
// ---------------------------------------------------------------------------

export type PlexSessionState =
  // `stale` = we hold a token for this account but plex.tv rejected it twice —
  // the sign-in screen names who needs to re-auth instead of a cold prompt.
  | { signedIn: false; stale?: { username: string; email: string } }
  | { signedIn: true; user: PlexUser; preferredServerId: string | null }

export interface PlexAccountSummary {
  id: string
  username: string
  email: string
  thumb: string | null
  active: boolean
}

export interface AlbumPage {
  albums: PlexAlbum[]
  offset: number
  total: number
}

export interface MbArtistInfo {
  mbid: string
  name: string
  disambiguation: string | null
  type: string | null
  origin: string | null
}

export interface ReviewedAlbumEntry {
  reviewedAt: number
  ignoredFlags: string[]
}

// Mirrors `IndexJobItem` in src/main/label-index.ts (shared can't import main).
export interface LabelIndexJobItem {
  ratingKey: string
  artist: string
  title: string
  studio: string | null
  releaseMbid: string | null
  releaseGroupMbid: string | null
}

// Mirrors `GenreJobItem` in src/main/genre-index.ts.
export interface GenreIndexJobItem {
  ratingKey: string
  artist: string
  title: string
  releaseMbid: string | null
  releaseGroupMbid: string | null
}

// Mirrors `WarmerItem` in src/main/library-warmer.ts.
export interface LibraryWarmerItem {
  ratingKey: string
  artist: string
  title: string
  year: number | null
  guids: string[]
}

// Mirrors `MediaMetadata` in src/main/media-keys.ts.
export interface MediaKeyMetadata {
  title?: string
  artist?: string
  album?: string
  albumArt?: string
  state?: 'playing' | 'paused' | 'stopped'
  currentTime?: number
  duration?: number
}

export type MediaKeyAction = 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'seek'

// What the mini player renders. Computed by the MAIN window's renderer (it
// owns the timeline poll, cover overrides, and the thumb protocol URL) and
// relayed through main to the mini window — the mini window never talks to
// Plex itself.
export interface MiniPlayerState {
  title: string
  artist: string
  album: string
  state: 'playing' | 'buffering' | 'paused' | 'stopped'
  time: number
  duration: number
  thumbUrl: string | null
}

export interface AppSettings {
  lastfmApiKey: string
  taggerApiKey: string
  ticketmasterApiKey: string
  geniusClientId: string
  geniusClientSecret: string
  // Plex server-owner token for Art Fixer poster writes (private build).
  plexAdminToken: string
  // Bijou (RED acquisition) base URL for the grab notifier (private build).
  bijouUrl: string
  // nowplaying-kiosk base URL; the living-room Pi follows this app's theme.
  kioskUrl: string
  continuationMode: ContinuationMode
  showNotificationsEnabled: boolean
}

export interface AcousticDedupeResponse {
  folder: string
  file_count: number
  groups: {
    recording_mbid: string
    keep: string
    drop: string[]
    scores: Record<string, number>
  }[]
  to_delete: string[]
  to_keep: string[]
  unfingerprinted: string[]
}

export interface CastResult {
  ok: true
  player: { id: string; name: string }
  playQueueId: number
}

// ---------------------------------------------------------------------------
// Request/response channels (ipcMain.handle / ipcRenderer.invoke)
// ---------------------------------------------------------------------------

export interface IpcInvokeContract {
  // --- plex: auth/session/servers ---
  'plex:get-session': { args: []; result: PlexSessionState }
  'plex:start-auth': { args: []; result: { ok: true } | { ok: false; message: string } }
  'plex:cancel-auth': { args: []; result: { ok: true } }
  'plex:sign-out': { args: []; result: { ok: true } }
  'plex:list-accounts': { args: []; result: PlexAccountSummary[] }
  'plex:switch-account': {
    args: [id: string]
    result: { ok: true } | { ok: false; message: string }
  }
  'plex:list-servers': { args: []; result: PlexResource[] }
  'plex:list-players': { args: []; result: PlexResource[] }
  'plex:set-preferred-server': { args: [id: string]; result: { ok: true } }
  'plex:get-server-context': { args: [id: string]; result: ServerContext }
  'plex:list-music-sections': { args: [id: string]; result: PlexSection[] }

  // --- plex: library browse/search ---
  'plex:list-albums': {
    args: [
      args: {
        serverId: string
        sectionKey: string
        offset?: number
        size?: number
        sort?: AlbumSortKey
        filters?: AlbumFilters
        seed?: string
      }
    ]
    result: AlbumPage
  }
  'plex:get-album-detail': {
    args: [args: { serverId: string; ratingKey: string }]
    result: AlbumDetail
  }
  'plex:get-album-media-info': {
    args: [args: { serverId: string; ratingKey: string }]
    result: AlbumMediaInfo
  }
  'plex:search-library': {
    args: [args: { serverId: string; sectionKey: string; query: string }]
    result: SearchResults
  }
  'plex:list-all-albums': {
    args: [args: { serverId: string; sectionKey: string }]
    result: PlexAlbum[]
  }
  // The previous run's persisted plex:list-all-albums result for this exact
  // server+section, or null when the stored snapshot is for another key (or
  // there is none). Read-only stale-while-revalidate seed: the renderer
  // paints from it, then the real fetch above replaces it — and re-persists
  // it, main-side — in the background.
  'plex:get-library-snapshot': {
    args: [args: { serverId: string; sectionKey: string }]
    result: PlexAlbum[] | null
  }
  'plex:list-library-artists-with-guids': {
    args: [args: { serverId: string }]
    result: { ratingKey: string; name: string; mbid: string | null }[]
  }
  'plex:list-similar-artists': {
    args: [args: { serverId: string; artistRatingKey: string }]
    result: { ratingKey: string; title: string; thumb: string | null; mbid: string | null }[]
  }
  'plex:list-moods': {
    args: [args: { serverId: string; sectionKey: string }]
    result: { key: string; title: string }[]
  }
  'plex:browse-artist': {
    args: [args: { serverId: string; name: string; mbid: string }]
    result: ArtistBrowse
  }

  // --- plex: casting / playback ---
  'plex:cast-play-album': {
    args: [
      args: {
        serverId: string
        playerId: string
        ratingKey: string
        startTrackRatingKey?: string
      }
    ]
    result: CastResult
  }
  'plex:cast-play-track': {
    args: [args: { serverId: string; playerId: string; ratingKey: string }]
    result: CastResult
  }
  'plex:cast-mood': {
    args: [args: { serverId: string; playerId: string; sectionKey: string; moodId: string }]
    result: CastResult
  }
  'plex:get-timeline': {
    args: [args: { serverId: string; playerId: string }]
    result: MusicTimeline | null
  }
  'plex:create-local-album-queue': {
    args: [args: { serverId: string; ratingKey: string; startTrackRatingKey?: string }]
    result: { ok: true; playQueueId: number }
  }
  'plex:create-local-track-queue': {
    args: [args: { serverId: string; ratingKey: string }]
    result: { ok: true; playQueueId: number }
  }
  'plex:get-track-stream-url': {
    args: [args: { serverId: string; ratingKey: string }]
    result: { url: string }
  }
  'plex:transport': {
    args: [
      args: {
        playerId: string
        action: 'pause' | 'play' | 'next' | 'prev' | 'seek'
        offsetMs?: number
      }
    ]
    result: { ok: true }
  }
  'plex:set-volume': {
    args: [args: { playerId: string; volume: number }]
    result: { ok: true }
  }
  'plex:player-skip-to': {
    args: [args: { playerId: string; playQueueItemId: number }]
    result: { ok: true }
  }

  // --- plex: play queue ---
  'plex:queue-update': {
    args: [
      args: {
        serverId: string
        playerId?: string
        playQueueId: number
        ratingKey: string
        mode: 'next' | 'end' | 'after-item'
        afterItemId?: number
      }
    ]
    result: { ok: true; refreshed: boolean }
  }
  'plex:get-play-queue': {
    args: [args: { serverId: string; playQueueId: number }]
    result: PlayQueueSnapshot
  }
  'plex:extend-queue-with-similar': {
    args: [
      args: {
        serverId: string
        playerId: string
        playQueueId: number
        currentAlbumRatingKey: string
        excludeAlbumRatingKeys?: string[]
        steer?: RadioSteer
      }
    ]
    result: { ok: true; album: ContinuationPick } | { ok: false; reason: string }
  }
  'plex:pick-continuation': {
    args: [
      args: {
        serverId: string
        currentAlbumRatingKey: string
        excludeAlbumRatingKeys?: string[]
        steer?: RadioSteer
      }
    ]
    result: ContinuationPick | null
  }
  'plex:queue-remove': {
    args: [
      args: {
        serverId: string
        playerId?: string
        playQueueId: number
        playQueueItemId: number
      }
    ]
    result: { ok: true; refreshed: boolean }
  }

  // --- plex: album curation (matches, overrides, triage) ---
  'plex:set-album-match': {
    args: [args: { plexRatingKey: string; mbReleaseMbid: string }]
    result: { ok: true }
  }
  'plex:clear-album-match': {
    args: [args: { plexRatingKey: string }]
    result: { ok: true }
  }
  'plex:list-original-year-overrides': { args: []; result: Record<string, number> }
  'plex:set-original-year-override': {
    args: [args: { plexRatingKey: string; year: number }]
    result: { ok: true }
  }
  'plex:clear-original-year-override': {
    args: [args: { plexRatingKey: string }]
    result: { ok: true }
  }
  'plex:list-composer-overrides': {
    args: []
    result: Record<string, ComposerOverride>
  }
  'plex:set-composer-override': {
    args: [args: { plexRatingKey: string; composer: ComposerOverride }]
    result: { ok: true }
  }
  'plex:clear-composer-override': {
    args: [args: { plexRatingKey: string }]
    result: { ok: true }
  }
  'plex:delete-album': {
    args: [args: { serverId: string; ratingKey: string; reason: string | null }]
    result: DeletedAlbum
  }
  'plex:list-deleted-albums': { args: []; result: DeletedAlbum[] }
  'plex:list-dup-dismissals': { args: []; result: string[] }
  'plex:add-dup-dismissal': { args: [args: { key: string }]; result: string[] }
  'plex:remove-dup-dismissal': { args: [args: { key: string }]; result: string[] }
  'plex:list-reviewed-albums': { args: []; result: Record<string, ReviewedAlbumEntry> }
  'plex:set-reviewed-album': {
    args: [args: { ratingKey: string; ignoredFlags: string[] }]
    result: Record<string, ReviewedAlbumEntry>
  }
  'plex:clear-reviewed-album': {
    args: [args: { ratingKey: string }]
    result: Record<string, ReviewedAlbumEntry>
  }

  // --- mb: MusicBrainz lookups ---
  'mb:get-album-credits': {
    args: [
      args: {
        ratingKey: string
        artist: string
        title: string
        year: number | null
        guids: string[]
        tracks: PlexTrack[]
      }
    ]
    result: AlbumCredits | null
  }
  'mb:get-classical-catalog': { args: []; result: ClassicalCatalogSnapshot }
  'classical:get-home': { args: []; result: ClassicalHome }
  'classical:sync-owned-albums': {
    args: [args: { albums: ClassicalOwnedAlbumInput[] }]
    result: { queued: number; removed: number }
  }
  'classical:search': { args: [args: ClassicalSearchArgs]; result: ClassicalSearchPage }
  'classical:get-composer': { args: [args: { id: string }]; result: ClassicalComposerDetail | null }
  'classical:get-work': { args: [args: { id: string }]; result: ClassicalWorkDetail | null }
  'classical:get-agent': { args: [args: { id: string }]; result: ClassicalAgentDetail | null }
  'classical:get-recording': { args: [args: { id: string }]; result: ClassicalRecordingDetail | null }
  'classical:get-release': { args: [args: { id: string }]; result: ClassicalReleaseDetail | null }
  'classical:get-sync-status': { args: []; result: ClassicalSyncStatus }
  'classical:pause-sync': { args: []; result: { ok: true } }
  'classical:resume-sync': { args: []; result: { ok: true } }
  'classical:retry-sync': { args: []; result: { retried: number } }
  'classical:refresh-sources': { args: []; result: { changed: boolean; version: string | null } }
  'classical:list-review-candidates': {
    args: [args?: { limit?: number }]
    result: ClassicalReviewCandidate[]
  }
  'classical:apply-correction': {
    args: [args: { command: ClassicalCorrectionCommand }]
    result: ClassicalCorrection
  }
  'classical:undo-correction': { args: [args: { id: string }]; result: { ok: true } }
  'classical:export-corrections': { args: []; result: ClassicalCorrectionDocument }
  'classical:import-corrections': {
    args: [args: { document: ClassicalCorrectionDocument }]
    result: { imported: number }
  }
  'mb:get-artist-info': { args: [args: { mbid: string }]; result: MbArtistInfo | null }
  'mb:get-in-library-appearances': {
    args: [args: { mbid: string }]
    result: PersonAppearance[]
  }
  'mb:get-artist-relations': { args: [args: { mbid: string }]; result: ArtistRelation[] }
  'mb:get-artist-credited-works': { args: [args: { mbid: string }]; result: CreditedWork[] }
  'mb:get-artist-discography': {
    args: [args: { mbid: string }]
    result: MbArtistReleaseGroup[]
  }
  'mb:get-label-discography': {
    args: [args: { name: string }]
    result: LabelDiscography | null
  }
  'mb:search-release-candidates': {
    args: [args: { artist: string; title: string }]
    result: MbReleaseCandidate[]
  }
  'mb:search-artist-by-name': { args: [args: { name: string }]; result: string | null }
  'mb:search-composer-by-name': {
    args: [args: { name: string }]
    result: ComposerSearchResult | null
  }
  'mb:find-lp-for-track': {
    args: [args: { artist: string; title: string; sourceAlbum?: string | null }]
    result: { album: string; mbid: string } | null
  }
  'mb:get-release-track-count': { args: [args: { mbid: string }]; result: number }
  'mb:list-release-track-counts': { args: []; result: Record<string, number> }

  // --- mb: label index ---
  'mb:list-album-labels': { args: []; result: Record<string, string[]> }
  'mb:label-index-progress': { args: []; result: LabelIndexProgress }
  'mb:start-label-index': {
    args: [args: { items: LabelIndexJobItem[]; rebuild?: boolean }]
    result: { ok: true }
  }
  'mb:stop-label-index': { args: []; result: { ok: true } }
  'mb:clear-album-labels': { args: []; result: { ok: true } }

  // --- mb: genre index ---
  'mb:list-album-genres': { args: []; result: Record<string, string[]> }
  'mb:genre-index-progress': { args: []; result: GenreIndexProgress }
  'mb:start-genre-index': {
    args: [args: { items: GenreIndexJobItem[]; rebuild?: boolean }]
    result: { ok: true }
  }
  'mb:stop-genre-index': { args: []; result: { ok: true } }
  'mb:clear-album-genres': { args: []; result: { ok: true } }
  'mb:get-album-labels-backup': { args: []; result: Record<string, string[]> }
  'mb:restore-album-labels-backup': { args: []; result: Record<string, string[]> }
  'mb:list-label-aliases': { args: []; result: Record<string, string> }
  'mb:set-label-alias': {
    args: [args: { alias: string; canonical: string }]
    result: Record<string, string>
  }
  'mb:remove-label-alias': {
    args: [args: { alias: string }]
    result: Record<string, string>
  }
  'mb:fetch-album-labels': {
    args: [args: { ratingKey: string; mbid: string }]
    result: string[]
  }

  // --- warmer: library credit-cache warmer ---
  'warmer:progress': { args: []; result: LibraryWarmerProgress }
  'warmer:start': {
    args: [args: { serverId: string; items: LibraryWarmerItem[]; creditsOnly?: boolean }]
    result: { ok: true }
  }
  'warmer:stop': { args: []; result: { ok: true } }

  // --- art: cover overrides ---
  'art:list-cover-overrides': { args: []; result: Record<string, CoverOverride> }
  'art:search-covers': {
    args: [args: { artist: string; title: string; mbReleaseMbid: string | null }]
    result: CoverCandidate[]
  }
  'art:set-cover-override': {
    // serverId, when present, also pushes the poster into Plex so external
    // players repaint (a bare local override only changes Cratedigger's thumbs).
    args: [args: { plexRatingKey: string; serverId?: string; override: CoverOverride }]
    result: { ok: true; plexUpdated: boolean; plexError?: string }
  }
  'art:upload-local-cover': {
    args: [args: { plexRatingKey: string; serverId?: string }]
    result: { canceled: boolean; override?: CoverOverride; plexUpdated?: boolean; plexError?: string }
  }
  'art:clear-cover-override': {
    args: [args: { plexRatingKey: string }]
    result: { ok: true }
  }

  // --- releases: release radar ---
  'releases:get-snapshot': { args: []; result: ReleaseRadarSnapshot | null }
  'releases:get-progress': { args: []; result: ReleaseRadarProgress }
  'releases:refresh': { args: [args: { serverId: string }]; result: ReleaseRadarSnapshot }
  'releases:cancel': { args: []; result: { ok: true } }

  // --- artfix: album art fixer ---
  'artfix:list-queue': { args: []; result: ArtFixQueue }
  'artfix:scan': {
    args: [args: { serverId: string; threshold?: number }]
    result: ArtFixQueue
  }
  'artfix:scan-progress': { args: []; result: ArtFixScanProgress }
  'artfix:cancel-scan': { args: []; result: { ok: true } }
  'artfix:get-candidates': {
    args: [
      args: {
        serverId: string
        rk: string
        artist: string
        album: string
        mbid: string | null
        seedUrl?: string | null
      }
    ]
    result: ArtFixCandidate[]
  }
  'artfix:accept': {
    args: [args: { serverId: string; rk: string; candidate: ArtFixCandidate }]
    result: ArtFixAcceptResult
  }
  'artfix:skip': { args: [args: { rk: string }]; result: { ok: true } }
  'artfix:revert-last': {
    args: [args: { serverId: string }]
    result: { ok: true; reverted: ArtFixLogEntry | null }
  }

  // --- playlists ---
  'plex:list-playlists': { args: [args: { serverId: string }]; result: PlexPlaylist[] }
  'plex:get-playlist-items': {
    args: [args: { serverId: string; ratingKey: string }]
    result: PlaylistItem[]
  }
  // itemRatingKeys may be track OR album ids — Plex expands albums into
  // their tracks.
  'plex:create-playlist': {
    args: [args: { serverId: string; title: string; itemRatingKeys: string[] }]
    result: PlexPlaylist
  }
  'plex:delete-playlist': { args: [args: { serverId: string; ratingKey: string }]; result: { ok: true } }
  'plex:rename-playlist': {
    args: [args: { serverId: string; ratingKey: string; title: string }]
    result: { ok: true }
  }
  'plex:playlist-add': {
    args: [args: { serverId: string; ratingKey: string; itemRatingKeys: string[] }]
    result: { ok: true }
  }
  'plex:playlist-remove-item': {
    args: [args: { serverId: string; ratingKey: string; playlistItemID: number }]
    result: { ok: true }
  }
  'plex:playlist-move-item': {
    args: [
      args: { serverId: string; ratingKey: string; playlistItemID: number; afterItemID: number | null }
    ]
    result: { ok: true }
  }
  'plex:cast-playlist': {
    args: [args: { serverId: string; playerId: string; ratingKey: string; shuffle: boolean }]
    result: CastResult
  }
  'plex:create-local-playlist-queue': {
    args: [args: { serverId: string; ratingKey: string; shuffle: boolean }]
    result: { ok: true; playQueueId: number }
  }
  // Smart-playlist definitions (rules live in electron-store; the
  // materialized playlists live on Plex).
  'playlists:get-smart-defs': { args: []; result: SmartPlaylistDef[] }
  'playlists:set-smart-defs': { args: [defs: SmartPlaylistDef[]]; result: { ok: true } }
  // Replace the materialized playlist's contents with these albums' tracks.
  // Returns the live Plex ratingKey (recreated if deleted out from under us).
  'playlists:sync-smart': {
    args: [
      args: {
        serverId: string
        plexRatingKey: string | null
        title: string
        albumRatingKeys: string[]
      }
    ]
    result: { plexRatingKey: string }
  }

  // --- playlist mirroring (second Plex account, e.g. the shop) ---
  'mirror:status': { args: []; result: MirrorStatus }
  // Runs the plex.tv PIN flow in the default browser; the user signs in as
  // the account to mirror to. Resolves once claimed (or errors/cancelled).
  'mirror:start-auth': {
    args: []
    result: { ok: true; account: string | null } | { ok: false; message: string }
  }
  'mirror:cancel-auth': { args: []; result: { ok: true } }
  'mirror:disconnect': { args: []; result: { ok: true } }
  // Clear+refill (or create) the twin playlist under the mirror account.
  'mirror:sync': {
    args: [args: { serverId: string; ratingKey: string; title: string }]
    result: { mirrorRatingKey: string; itemCount: number }
  }
  // Merge every ordinary audio playlist across both accounts. Same-name
  // playlists become the union of their tracks; nothing is deleted.
  'mirror:sync-all': {
    args: [args: { serverId: string }]
    result: { playlistCount: number; createdOnPrimary: number; createdOnMirror: number }
  }
  // Delete the twin and forget the mapping.
  'mirror:unsync': { args: [args: { serverId: string; ratingKey: string }]; result: { ok: true } }

  // --- spotify import ---
  'spotify:status': { args: []; result: SpotifyStatus }
  'spotify:set-client-id': { args: [id: string]; result: { ok: true } }
  // Opens the consent page in the default browser; resolves once the loopback
  // redirect lands and tokens are stored (or rejects on refusal/timeout).
  'spotify:connect': { args: []; result: { ok: true } }
  'spotify:disconnect': { args: []; result: { ok: true } }
  'spotify:list-playlists': { args: []; result: SpotifyPlaylistSummary[] }
  'spotify:get-playlist-tracks': { args: [args: { id: string }]; result: SpotifyTrack[] }
  'spotify:get-import-reports': { args: []; result: SpotifyImportReport[] }
  'spotify:set-import-reports': { args: [reports: SpotifyImportReport[]]; result: { ok: true } }
  // Remembered folder of playlist exports. pick opens a native directory
  // dialog (persists the choice); load re-reads the remembered folder.
  'spotify:pick-import-folder': {
    args: []
    result: { dir: string | null; playlists: ParsedPlaylist[] }
  }
  'spotify:load-import-folder': {
    args: []
    result: { dir: string | null; playlists: ParsedPlaylist[] }
  }

  // --- apple music (local Music.app via Apple Events; macOS only) ---
  'apple-music:list-playlists': {
    args: []
    result: { id: string; name: string; trackCount: number }[]
  }
  'apple-music:get-playlist-tracks': { args: [args: { id: string }]; result: SpotifyTrack[] }

  // --- lyrics ---
  'lyrics:get': {
    args: [args: { artist: string; title: string; album: string; durationMs: number | null }]
    result: LyricsResult | null
  }

  // --- listen later ---
  'listen-later:list': { args: []; result: ListenLaterEntry[] }
  'listen-later:add': { args: [args: { entry: ListenLaterEntry }]; result: ListenLaterEntry[] }
  'listen-later:remove': { args: [args: { ratingKey: string }]; result: ListenLaterEntry[] }

  // --- secrets backup file ---
  'secrets:reveal-backup-file': { args: []; result: { path: string } }
  'secrets:get-backup-path': { args: []; result: { path: string } }
  'secrets:back-up-current-keys': { args: []; result: { path: string; written: number } }

  // --- shows ---
  'shows:list-venues': { args: []; result: Venue[] }
  'shows:fetch-venue': { args: [args: { venueId: string }]; result: VenueShow[] }
  'shows:report-matches': {
    args: [args: { matches: ReportedShowMatch[] }]
    result: ShowMatchReport
  }
  'shows:list-recent-notified': { args: []; result: string[] }
  'shows:list-marks': { args: []; result: Record<string, ShowMark> }
  'shows:set-mark': { args: [args: { id: string; mark: ShowMark }]; result: void }

  // --- living-room kiosk ---
  'kiosk:push-theme': {
    args: [theme: { id: string; name: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }]
    result: { ok: boolean }
  }

  // --- tagger service ---
  'tagger:get-url': { args: []; result: string }
  'tagger:set-url': { args: [url: string]; result: { ok: true } }
  'tagger:health': { args: []; result: TaggerHealth }
  'tagger:list-inbox': { args: []; result: InboxFolder[] }
  'tagger:get-folder': { args: [args: { name: string }]; result: InboxFolder }
  'tagger:get-release': { args: [args: { mbid: string }]; result: MbCanonicalRelease }
  'tagger:apply': { args: [args: ApplyRequest]; result: ApplyOrPreviewResult }
  'tagger:retag': {
    args: [args: RetagRequest & { plexRatingKey?: string }]
    result: ApplyOrPreviewResult
  }
  'tagger:audit-music': { args: []; result: AuditResponse }
  'tagger:merge-inbox-into-album': {
    args: [args: { serverId: string; ratingKey: string; mbid: string; inboxPath: string }]
    result: ApplyResult
  }
  'tagger:refresh-plex': {
    args: []
    result: { ok: boolean; reason?: string; scoped?: boolean }
  }
  'tagger:delete-folder': {
    args: [args: { name: string }]
    result: { ok: boolean; deleted: string }
  }
  'tagger:apply-single': {
    args: [
      args: {
        folderName: string
        filename: string
        artist: string
        title: string
        recordingMbid?: string | null
      }
    ]
    result: { ok: boolean; dst: string; plex?: { ok: boolean; reason?: string } }
  }
  'tagger:delete-files': {
    args: [args: { name: string; paths: string[] }]
    result: {
      ok: boolean
      deleted: string[]
      missing: string[]
      errors: { path: string; error: string }[]
    }
  }
  'tagger:acoustic-dedupe': {
    args: [args: { name: string }]
    result: AcousticDedupeResponse
  }
  'tagger:prefingerprint': {
    args: [args: { name: string }]
    result: PrefingerprintResponse
  }

  // --- slskd ---
  'slskd:get-config': { args: []; result: { url: string; apiKey: string } }
  'slskd:set-config': { args: [args: { url: string; apiKey: string }]; result: { ok: true } }
  'slskd:health': { args: []; result: SlskdHealth }
  'slskd:search': {
    args: [args: { artist: string; album: string; preferredReleaseMbid?: string }]
    result: SlskdSearchResult
  }
  'slskd:list-successful-peers': { args: []; result: SlskdSuccessfulPeer[] }
  'slskd:browse-user': { args: [args: { username: string }]; result: SlskdUserBrowse }
  'slskd:enqueue': { args: [args: SlskdEnqueueRequest]; result: SlskdEnqueueResult }
  'slskd:list-downloads': { args: []; result: SlskdDownloads }
  'slskd:remove-download': {
    args: [args: { username: string; id: string }]
    result: { ok: true }
  }
  'slskd:retry-download': {
    args: [args: { username: string; id: string; filename: string; size: number }]
    result: { ok: true }
  }
  'slskd:remove-downloads-bulk': {
    args: [args: { username: string; ids: string[] }]
    result: { removed: number; errors: { id: string; error: string }[] }
  }
  'slskd:retry-downloads-bulk': {
    args: [args: { username: string; files: { id: string; filename: string; size: number }[] }]
    result: { retried: number; errors: { id: string; error: string }[] }
  }

  // --- listening charts (Tautulli-backed) ---
  'charts:get-config': { args: []; result: TautulliConfig }
  'charts:set-config': { args: [config: TautulliConfig]; result: { ok: true } }
  'charts:health': { args: []; result: TautulliHealth }
  'charts:users': { args: []; result: ChartUser[] }
  'charts:top': {
    args: [args: { userIds: number[]; window: ChartWindow; dimension: ChartDimension; limit: number }]
    result: ChartResult
  }

  // --- bios / cover art archive ---
  'bios:get-album-bio': {
    args: [
      args: {
        releaseMbid: string | null
        releaseGroupMbid: string | null
        artist: string
        title: string
      }
    ]
    result: Bio | null
  }
  'bios:get-artist-bio': {
    args: [args: { mbid: string; name: string }]
    result: ArtistBio | null
  }
  'caa:get-booklet': { args: [args: { releaseMbid: string }]; result: BookletImage[] }

  // --- settings / window / updates / media keys ---
  'settings:get': { args: []; result: AppSettings }
  'settings:set': { args: [args: Partial<AppSettings>]; result: { ok: true } }
  'window:toggle-fullscreen': { args: []; result: void }
  // Persist the active theme's paper color so the next launch's BrowserWindow
  // backgroundColor (and the resize gutter) matches the theme instead of a
  // hard-coded dark tone flashing behind a light theme.
  'window:set-background': { args: [color: string]; result: void }
  'updates:get-state': { args: []; result: UpdateState }
  'updates:check': { args: []; result: { ok: true } }
  'updates:install-and-restart': { args: []; result: { ok: true } }
  'media-keys:set-metadata': { args: [meta: MediaKeyMetadata]; result: { ok: true } }

  // --- mini player ---
  'mini:toggle': { args: []; result: { open: boolean } }
  // Main window pushes its timeline state (null = nothing playing) on every
  // poll; main caches the latest and forwards to the mini window.
  'mini:push-state': { args: [state: MiniPlayerState | null]; result: void }
  // Mini window transport — relayed to the main window as a
  // 'media-keys:command' event, riding the existing handler.
  'mini:command': { args: [cmd: { action: MediaKeyAction; payload?: number }]; result: void }
  'mini:focus-main': { args: []; result: void }
}

export type IpcChannel = keyof IpcInvokeContract
export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcInvokeContract[C]['result']

// ---------------------------------------------------------------------------
// Push channels (webContents.send → ipcRenderer.on). Listed here for typing
// only — registration stays hand-written on both sides because the mechanism
// (broadcast, subscription lifetime) differs from invoke/handle.
//
// Not listed: 'app:get-info' (synchronous ipcMain.on/sendSync handshake read
// at preload module-eval time), 'shows:open-from-notification' (no payload),
// and 'deeplink:ready' (renderer → main fire-and-forget ping, no payload).
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'classical:sync-progress': ClassicalSyncStatus
  'classical:catalog-changed': { reason: string; ratingKey?: string }
  'plex:auth-progress': AuthProgress
  'mb:label-index-progress': LabelIndexProgress
  'mb:genre-index-progress': GenreIndexProgress
  'warmer:progress': LibraryWarmerProgress
  'warmer:album-enriched': { ratingKey: string }
  'releases:progress': ReleaseRadarProgress
  'artfix:scan-progress': ArtFixScanProgress
  'updates:state': UpdateState
  'media-keys:command': { action: MediaKeyAction; payload?: number }
  // A roaming sync pass pulled another machine's changes — show marks and/or
  // Listen Later moved under the renderer's feet; refetch both.
  'roaming:changed': Record<string, never>
  // → mini window: the latest relayed now-playing state.
  'mini:state': MiniPlayerState | null
  // → main window: mini window opened/closed (drives the bar button state).
  'mini:open-changed': boolean
  // A cratedigger://soulseek?q=… deep link arrived (browser right-click
  // hand-off). q is freeform "Artist - Album" text; renderer parses it.
  'deeplink:soulseek-search': { q: string }
  // The background sweeper re-queued `count` failed Soulseek transfers.
  'slskd:auto-retried': { count: number }
}
