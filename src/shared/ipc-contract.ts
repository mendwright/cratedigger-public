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
  LabelIndexProgress,
  LibraryWarmerProgress,
  ListenLaterEntry,
  LyricsResult,
  MbReleaseCandidate,
  MusicTimeline,
  PersonAppearance,
  PlayQueueSnapshot,
  PlexAlbum,
  PlexResource,
  PlexSection,
  PlexUser,
  ReleaseRadarProgress,
  ReleaseRadarSnapshot,
  ReportedShowMatch,
  SearchResults,
  ServerContext,
  ShowMark,
  ShowMatchReport,
  Venue,
  VenueShow
} from './plex.js'
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
  SlskdSearchResult
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
  | { signedIn: false }
  | { signedIn: true; user: PlexUser; preferredServerId: string | null }

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

export interface AppSettings {
  lastfmApiKey: string
  taggerApiKey: string
  ticketmasterApiKey: string
  geniusClientId: string
  geniusClientSecret: string
  // Plex server-owner token for Art Fixer poster writes (private build).
  plexAdminToken: string
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
        trackKeys: string[]
      }
    ]
    result: AlbumCredits | null
  }
  'mb:get-artist-info': { args: [args: { mbid: string }]; result: MbArtistInfo | null }
  'mb:get-in-library-appearances': {
    args: [args: { mbid: string }]
    result: PersonAppearance[]
  }
  'mb:get-artist-relations': { args: [args: { mbid: string }]; result: ArtistRelation[] }
  'mb:get-artist-credited-works': { args: [args: { mbid: string }]; result: CreditedWork[] }
  'mb:search-release-candidates': {
    args: [args: { artist: string; title: string }]
    result: MbReleaseCandidate[]
  }
  'mb:search-artist-by-name': { args: [args: { name: string }]; result: string | null }
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
    args: [args: { serverId: string; items: LibraryWarmerItem[] }]
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
    args: [args: { plexRatingKey: string; override: CoverOverride }]
    result: { ok: true }
  }
  'art:upload-local-cover': {
    args: [args: { plexRatingKey: string }]
    result: { canceled: boolean; override?: CoverOverride }
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
// at preload module-eval time) and 'shows:open-from-notification' (no payload).
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'plex:auth-progress': AuthProgress
  'mb:label-index-progress': LabelIndexProgress
  'warmer:progress': LibraryWarmerProgress
  'releases:progress': ReleaseRadarProgress
  'artfix:scan-progress': ArtFixScanProgress
  'updates:state': UpdateState
  'media-keys:command': { action: MediaKeyAction; payload?: number }
}
