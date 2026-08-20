import type {
  AlbumCredits,
  AlbumDetail,
  AlbumFilters,
  AlbumSortKey,
  AuthProgress,
  Bio,
  BookletImage,
  DeletedAlbum,
  LibraryWarmerProgress,
  ListenLaterEntry,
  MusicTimeline,
  PlayQueueSnapshot,
  PlexAlbum,
  PlexResource,
  PlaystateFilter,
  PlexSection,
  PlexUser,
  ReleaseRadarProgress,
  ReleaseRadarSnapshot,
  ServerContext,
  SimilarArtist
} from '../../../shared/plex'
import type { PlexAccountSummary } from '../../../shared/ipc-contract'
import { redSearchUrl } from '../../../shared/urls'
import { applyTheme, loadStoredThemeId, storeThemeId } from './themes'
import { flushCoverTransition } from './cover-transition'
import { AlbumDetailLoader, type AlbumDetailLoaderDeps } from './album-detail-loader.svelte'
import { LyricsController } from './lyrics-controller.svelte'
import { CoverArtController } from './cover-art-controller.svelte'
import { OriginalYearController } from './original-year-controller.svelte'
import { ComposerOverrideController } from './composer-override-controller.svelte'
import { ShowsController } from './shows-controller.svelte'
import { ChartsController } from './charts-controller.svelte'
import { PlaylistsController } from './playlists-controller.svelte'
import { SpotifyImportController } from './spotify-import-controller.svelte'
import { ArtFixController } from './art-fix-controller.svelte'
import { AlbumOfTheDayController } from './album-of-the-day-controller.svelte'
import { LabelIndexController } from './label-index-controller.svelte'
import { LabelAliasController } from './label-alias-controller.svelte'
import { FilterState } from './filter-state.svelte'
import { SearchController } from './search-controller.svelte'
import { PlaybackController, type CastIntent } from './playback-controller.svelte'
import { safeLocalStorage } from './storage'
import { SettingsController } from './settings-controller.svelte'
import { NavController } from './nav-controller.svelte'
import { EntityController } from './entity-controller.svelte'
import { SlskdController, parseSlskdList } from './slskd-controller.svelte'
import { TriageController } from './triage-controller.svelte'
import { InboxController } from './inbox-controller.svelte'
import { MediaInfoController } from './media-info-controller.svelte'
import { ManualMatchController } from './manual-match-controller.svelte'
import type { NavFrame } from './nav-entity'

export interface MbArtistInfo {
  mbid: string
  name: string
  disambiguation: string | null
  type: string | null
  origin: string | null
}

export type Session =
  | { signedIn: false; stale?: { username: string; email: string } }
  | { signedIn: true; user: PlexUser; preferredServerId: string | null }

export type ContextMenuEntry =
  | { label: string; onClick: () => void; disabled?: boolean; separator?: undefined }
  | { separator: true }

const COVER_SIZE_KEY = 'jayamp:coverSize'
export const COVER_SIZE_MIN = 110
export const COVER_SIZE_MAX = 360
const COVER_SIZE_DEFAULT = 180

/**
 * The places the toolbar's primary nav can send you, in display order. The
 * maintenance views (inbox / triage / slskd / artfix) are deliberately absent —
 * they live behind the `tools` menu and light no pill.
 */
export const PRIMARY_PLACES = [
  'library',
  'releases',
  'shows',
  'charts',
  'classical',
  'playlists',
  'later'
] as const
export type PrimaryPlace = (typeof PRIMARY_PLACES)[number]

const SORT_KEY = 'jayamp:sort'
const VALID_SORTS: AlbumSortKey[] = ['addedAt', 'artist', 'title', 'lastViewed', 'rating', 'random']

function makeSortSeed(): string {
  return String(Math.floor(Math.random() * 1_000_000_000))
}

function loadSort(): AlbumSortKey {
  if (typeof localStorage === 'undefined') return 'addedAt'
  const raw = localStorage.getItem(SORT_KEY) as AlbumSortKey | null
  return raw && VALID_SORTS.includes(raw) ? raw : 'addedAt'
}

function loadCoverSize(): number {
  if (typeof localStorage === 'undefined') return COVER_SIZE_DEFAULT
  const raw = localStorage.getItem(COVER_SIZE_KEY)
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n)) return COVER_SIZE_DEFAULT
  return Math.max(COVER_SIZE_MIN, Math.min(COVER_SIZE_MAX, n))
}

import { mbidFromGuid, splitAlbumMbids } from '../../../shared/guid'
import { PUBLIC_BUILD } from '../../../shared/build-flags'
import type { ClassicalCatalogSnapshot } from '../../../shared/classical-catalog'
import { isClassicalCandidate } from '../../../shared/classical-model'
export { splitAlbumMbids }

function formatCreditsError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err)
  msg = msg
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
  if (/MusicBrainz 503/.test(msg)) {
    return 'MusicBrainz is temporarily unavailable. Try again in a few minutes.'
  }
  if (/MusicBrainz 5\d\d/.test(msg)) {
    return 'MusicBrainz is having trouble right now. Try again shortly.'
  }
  return msg
}

class PlexState {
  session = $state<Session | null>(null)
  authProgress = $state<AuthProgress>({ stage: 'idle' })
  servers = $state<PlexResource[]>([])
  serversLoading = $state(false)
  serversError = $state<string | null>(null)

  serverContext = $state<ServerContext | null>(null)
  sections = $state<PlexSection[]>([])
  activeSectionKey = $state<string | null>(null)
  albums = $state<PlexAlbum[]>([])
  albumsTotal = $state(0)
  albumsLoadingMore = $state(false)
  libraryLoading = $state(false)
  libraryError = $state<string | null>(null)
  private albumsLoadingMorePromise: Promise<void> | null = null

  changingServer = $state(false)

  coverSize = $state<number>(loadCoverSize())
  sortKey = $state<AlbumSortKey>(loadSort())
  private sortSeed: string | null = loadSort() === 'random' ? makeSortSeed() : null
  // Album object + credits + bio + booklet + the two discovery rails (label /
  // similar-artists) live on these two loader instances (see
  // src/renderer/src/lib/album-detail-loader.svelte.ts). openAlbumLoader drives
  // the album-detail view; nowPlayingAlbumLoader drives the now-playing screen.
  // Two instances so both can coexist (browsing a different album while a track
  // is playing). The rails reach into the whole library + artist-relation IPC,
  // injected here as deps.
  private loaderDeps = (): AlbumDetailLoaderDeps => ({
    ensureAllAlbums: () => this.ensureAllAlbums(),
    albumLabels: () => this.labelIndex.labels,
    canonicalLabel: (name) => this.labelAliases.canonical(name),
    session: () => this.session,
    onOriginalYear: (ratingKey, originalYear) => this.applyOriginalYear(ratingKey, originalYear),
    originalYearOverride: (ratingKey) => this.originalYear.get(ratingKey) ?? null,
    mediaInfoFor: (ratingKey) => this.mediaInfo.infoFor(ratingKey)
  })
  openAlbumLoader = new AlbumDetailLoader(this.loaderDeps())
  nowPlayingAlbumLoader = new AlbumDetailLoader(this.loaderDeps())
  lastClosedAlbumKey = $state<string | null>(null)

  // Settings modal state (API keys + preferences). Extracted into
  // SettingsController; `continuationMode` lives there and is injected into
  // the playback engine below. Components read plexState.settings.*.
  settings = new SettingsController({
    flashToast: (kind, text) => this.flashToast(kind, text)
  })

  // Playback / cast engine — active player, 2.5s timeline poll, casting, the
  // continuous-playback extender, transport, queue, and volume. Extracted into
  // PlaybackController (see playback-controller.svelte.ts). The toast helper
  // (castToast/flashToast) stays here because it's shared with non-playback
  // flows, and is injected into the controller, as is the continuation-mode
  // setting. Components read plexState.playback.*.
  playback = new PlaybackController({
    session: () => this.session,
    continuationMode: () => this.settings.continuationMode,
    flashToast: (kind, text) => this.flashToast(kind, text),
    onAlbumCast: (ratingKey) => this.jumpToNowPlayingForAlbum(ratingKey),
    storage: safeLocalStorage(),
    // Mini-player relay: main window computes the display state (incl. the
    // override-aware thumb URL) and pushes it up; main forwards to the mini
    // window. Cheap no-op push when the mini window is closed.
    pushMini: (tl) =>
      void window.cratedigger.mini.pushState(
        tl && tl.title
          ? {
              title: tl.title,
              artist: tl.artist,
              album: tl.album,
              state: tl.state,
              time: tl.time,
              duration: tl.duration,
              thumbUrl: this.thumbUrl(tl.thumb, 168, tl.albumRatingKey)
            }
          : null
      )
  })

  castToast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null)
  private toastTimer: number | null = null

  // Note: album / credits / bio / booklet AND the two discovery rails (label /
  // similar-artists) for both the album-detail and now-playing scopes now live
  // on openAlbumLoader and nowPlayingAlbumLoader (see field declarations above).
  // Components read e.g. plexState.openAlbumLoader.labelRail.
  nowPlayingOpen = $state(false)
  // Theater mode — the full-bleed cover + synced-lyrics + track-credits
  // overlay. Renders above everything except the transport bar; reuses
  // nowPlayingAlbumLoader for credits, so opening it ensures the playing
  // album is loaded just like the Now Playing screen does.
  theaterOpen = $state(false)
  private nowPlayingLoadedKey: string | null = null
  // When set, the Now Playing screen was just opened for a specific album
  // that the user explicitly triggered (e.g. Play Album). The timeline poll
  // may still report the PREVIOUS album's ratingKey for ~1s after the cast
  // dispatches — timeline-driven ensureNowPlayingAlbum calls during that
  // window would clobber the correct album with the stale one. This latch
  // makes the screen's timeline effect wait until the timeline reflects
  // the explicit request before it's allowed to drive loading again.
  private nowPlayingExplicitKey: string | null = null

  // Artist/person entity page (header, MB-walked credits, in-library
  // appearances, bio). Extracted into EntityController; openEntity below stays
  // as the view orchestrator. Components read plexState.entityPage.*.
  entityPage = new EntityController({
    session: () => this.session,
    ensureAllAlbums: () => this.ensureAllAlbums()
  })

  allAlbums = $state<PlexAlbum[] | null>(null)
  allAlbumsLoading = $state(false)
  private allAlbumsKey: string | null = null
  private allAlbumsPromise: Promise<PlexAlbum[]> | null = null
  libraryScrollY = 0

  // "Album of the day" — deterministic daily pick. Extracted into
  // AlbumOfTheDayController; components read plexState.albumOfTheDay.album.
  albumOfTheDay = new AlbumOfTheDayController({
    ensureAllAlbums: () => this.ensureAllAlbums(),
    activeSectionKey: () => this.activeSectionKey,
    storage: safeLocalStorage()
  })

  // Record-label index (per-album label map + indexer progress + backup count).
  // Extracted into LabelIndexController; components read plexState.labelIndex.*.
  // The album-detail loader's label rail reads its `labels` map via the dep
  // getter above.
  labelIndex = new LabelIndexController({
    ensureAllAlbums: () => this.ensureAllAlbums(),
    clearLabelFilters: () => this.filterState.clearLabels()
  })
  // User-curated alias map. Folds variant label names ("New West Records LLC")
  // into a canonical form ("New West Records") at view time. Components read
  // plexState.labelAliases.canonical(name) / .canonicalize(names).
  labelAliases = new LabelAliasController({})
  // Roon-style tri-state on list dimensions: a value can be neutral, included,
  // or excluded. We hold include + exclude as separate sets and never share
  // members between them; toggle helpers cycle neutral → include → exclude →
  // neutral.
  // labelInclude / labelExclude moved to filterState (see above).
  labelFilterOpen = $state(false)
  private detachLabelProgress: (() => void) | null = null

  warmerProgress = $state<LibraryWarmerProgress>({
    running: false,
    done: 0,
    fetched: 0,
    errors: 0,
    total: 0,
    current: null,
    lastError: null
  })
  private detachWarmerProgress: (() => void) | null = null
  private detachAlbumEnriched: (() => void) | null = null

  // Every filter dimension lives on this instance — see
  // src/renderer/src/lib/filter-state.svelte.ts. clearAll routes through
  // it; per-dimension mutators are thin orchestrators on this class that
  // delegate then trigger the section reselect.
  filterState = new FilterState()
  genreFilterOpen = $state(false)
  decadeFilterOpen = $state(false)
  playstateFilterOpen = $state(false)
  private filterRequestSeq = 0

  themeId = $state<string>(loadStoredThemeId())
  themePickerOpen = $state(false)

  contextMenu = $state<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)

  // Dive-upon-dive navigation stack (back/forward). The stack mechanics live
  // in NavController; goBack/goForward/restoreFrame below drive the screen
  // restore. Dual-written alongside the legacy openAlbum / entity slots for
  // now; Wave 5 Step 2 will switch App.svelte to branch on the stack top and
  // retire the individual slots.
  nav = new NavController()

  search = new SearchController({
    context: () => {
      if (!this.session?.signedIn || !this.session.preferredServerId || !this.activeSectionKey) {
        return null
      }
      return { serverId: this.session.preferredServerId, sectionKey: this.activeSectionKey }
    },
    search: (args) => window.cratedigger.plex.searchLibrary(args)
  })

  // Manual album→MB match modal (search MB, pin a release when auto-reconcile
  // picked wrong). Extracted into ManualMatchController; components read
  // plexState.manualMatch.*. Confirm/clear bust main's per-album credit cache
  // via IPC; the callback below refreshes the open album's credits.
  manualMatch = new ManualMatchController({
    flashToast: (kind, text) => this.flashToast(kind, text),
    onMatchChanged: async (plexRatingKey) => {
      if (this.openAlbumLoader.album?.album.ratingKey === plexRatingKey) {
        await this.reloadAlbumCredits()
      }
    }
  })

  // Cover art: per-album override map (read by thumbUrl) + the cover-picker
  // modal. Extracted into CoverArtController; components read plexState.coverArt.*.
  coverArt = new CoverArtController({
    flashToast: (kind, text) => this.flashToast(kind, text),
    serverId: () => (this.session?.signedIn ? this.session.preferredServerId : null)
  })

  // Manual original-release-year overrides (read by the album page and by
  // applyOriginalYear so a pinned year isn't clobbered by resolving credits).
  originalYear = new OriginalYearController({
    flashToast: (kind, text) => this.flashToast(kind, text)
  })

  // Manual composer overrides (read by AlbumMeta's hero line via
  // resolveEffectiveComposers). Lets the user pin the obvious composer on box
  // sets MusicBrainz can't align — override wins the composer line, never nesting.
  composerOverride = new ComposerOverrideController({
    flashToast: (kind, text) => this.flashToast(kind, text)
  })

  // Per-track lyrics (fetch cache + open panels). Extracted into
  // LyricsController; components read plexState.lyrics.*. The prefetch loop
  // bails when the open album changes, so the loader's ratingKey is injected.
  lyrics = new LyricsController({
    currentAlbumRatingKey: () => this.openAlbumLoader.album?.album.ratingKey ?? null,
    nowPlayingTrackRatingKey: () => this.playback.timeline?.ratingKey ?? null
  })

  view = $state<
    | 'library'
    | 'inbox'
    | 'triage'
    | 'slskd'
    | 'releases'
    | 'later'
    | 'shows'
    | 'charts'
    | 'artfix'
    | 'playlists'
    | 'classical'
  >('library')

  /**
   * Which primary-nav pill should read as selected, or null in a tools view.
   *
   * Opening an album or an artist doesn't touch `view` — it pushes onto the nav
   * stack and mounts over the current screen — so the pill you arrived through
   * stays lit while you're deep in a credit-graph dive, which is what we want.
   */
  get currentPlace(): PrimaryPlace | null {
    return (PRIMARY_PLACES as readonly string[]).includes(this.view)
      ? (this.view as PrimaryPlace)
      : null
  }

  classicalCatalog = $state<ClassicalCatalogSnapshot | null>(null)
  classicalCatalogLoading = $state(false)
  classicalCatalogError = $state<string | null>(null)

  // Plex audio playlists (manual + materialized smart). openPlaylists/
  // closePlaylists below flip the view; the controller owns list/items/CRUD
  // and the smart-definition store. Components read plexState.playlistsCtl.*.
  playlistsCtl = new PlaylistsController({
    session: () => this.session,
    flashToast: (kind, text) => this.flashToast(kind, text)
  })

  // Spotify playlist import (browse + match + gap report). Destination-
  // playlist writes are delegated to playlistsCtl; the refill path rides the
  // same clear+add+rename main-process helper the smart sync uses.
  spotifyImport = new SpotifyImportController({
    context: () => {
      if (!this.session?.signedIn || !this.session.preferredServerId || !this.activeSectionKey) {
        return null
      }
      // Active (album) library first, then every other music section — the
      // Singles bin counts toward playlist matching without ever surfacing
      // in browse.
      const active = this.activeSectionKey
      const rest = this.sections.map((s) => s.key).filter((k) => k !== active)
      return { serverId: this.session.preferredServerId, sectionKeys: [active, ...rest] }
    },
    createPlaylist: (title, itemRatingKeys) => this.playlistsCtl.create(title, itemRatingKeys),
    findPlaylistByName: (title) =>
      this.playlistsCtl.playlists.find((p) => !p.smart && p.title === title)?.ratingKey ?? null,
    playlistExists: (ratingKey) =>
      this.playlistsCtl.playlists.some((p) => p.ratingKey === ratingKey),
    replacePlaylist: async (ratingKey, title, itemRatingKeys) => {
      const s = this.session
      if (!s?.signedIn || !s.preferredServerId) throw new Error('Not signed in')
      const { plexRatingKey } = await window.cratedigger.plex.syncSmartPlaylist({
        serverId: s.preferredServerId,
        plexRatingKey: ratingKey,
        title,
        albumRatingKeys: itemRatingKeys
      })
      void this.playlistsCtl.refresh()
      this.playlistsCtl.remirrorIfMirrored(plexRatingKey)
      return plexRatingKey
    },
    flashToast: (kind, text) => this.flashToast(kind, text)
  })

  // Album Art Fixer (private build only): a review deck for the low-res-cover
  // queue. openArtFixer/closeArtFixer below flip the view; the controller owns
  // the queue, candidates, and accept/skip/search/revert/scan actions and reads
  // window.cratedigger.plex.artFix*.
  artFix = new ArtFixController({
    serverId: () => (this.session?.signedIn ? this.session.preferredServerId : null)
  })

  // Listening charts (Tautulli-backed): top artists/albums/tracks per user and
  // combined. openCharts/closeCharts below flip the view; the controller owns
  // config + data loading. Reads window.cratedigger.charts.
  charts = new ChartsController()

  // Shows: incremental per-venue scrape (each venue resolves independently so
  // the screen renders as they arrive). Extracted into ShowsController;
  // openShows/closeShows below stay as view orchestrators. The lookup force-
  // refreshes the library snapshot, so refreshAllAlbums busts the cache.
  shows = new ShowsController({
    refreshAllAlbums: () => {
      this.allAlbums = null
      return this.ensureAllAlbumsLoaded()
    },
    session: () => this.session,
    notificationsEnabled: () => this.settings.showNotificationsEnabled
  })

  // Background show-notification poll. Cleared in dispose(). Fires a quiet scan
  // shortly after launch, then on a slow interval — the app being open is the
  // trigger; matches are diffed + notified in the main process.
  private showsCheckTimer: ReturnType<typeof setInterval> | null = null
  private showsCheckKickoff: ReturnType<typeof setTimeout> | null = null
  private detachShowsNotification: (() => void) | null = null
  private detachRoamingChanged: (() => void) | null = null
  private detachDeepLink: (() => void) | null = null
  private detachSlskdAutoRetry: (() => void) | null = null

  releaseRadar = $state<ReleaseRadarSnapshot | null>(null)
  releaseRadarProgress = $state<ReleaseRadarProgress | null>(null)
  private detachReleaseRadar: (() => void) | null = null

  listenLater = $state<ListenLaterEntry[]>([])

  // Library triage — the three modes (flags / duplicates / mistagged) and their
  // state (flag filters, MB track-count scan, mistagged audit + repairs, dup
  // dismissals, reviewed albums). Extracted into TriageController; openTriage/
  // closeTriage stay here (view flip) and call triage.load(). deletedAlbums +
  // deleteAlbumFromLibrary stay on PlexState (shared / library-wide); the
  // media-info subsystem lives on MediaInfoController (plexState.mediaInfo) and
  // its duplicates scan is injected below. Components read plexState.triage.*.
  triage = new TriageController({
    flashToast: (kind, text) => this.flashToast(kind, text),
    ensureAllAlbums: () => this.ensureAllAlbums(),
    getAllAlbums: () => this.allAlbums ?? [],
    ensureDuplicatesMediaScan: () => {
      if (this.mediaInfo.scan === null) void this.mediaInfo.runScanForDuplicates()
    }
  })
  deletedAlbums = $state<DeletedAlbum[]>([])
  deletingRatingKey = $state<string | null>(null)

  // ?-overlay listing all keyboard shortcuts. Bound in App.svelte's global
  // key handler so the user can toggle from anywhere outside text inputs.
  keyboardHelpOpen = $state(false)

  // Cmd+Shift+P command palette. Surfaces every nav action + a handful of
  // transport / library / settings entries behind a fuzzy filter.
  commandPaletteOpen = $state(false)

  // In-app browser pane (v0): right-side dockable webview for AOTY/Discogs/etc
  // with a "search Soulseek for this" hand-off into the existing slskd flow.
  browserPaneOpen = $state(false)
  // Set to a URL to navigate the pane. BrowserPane.svelte $effect-watches and
  // clears it on apply. Either toggleBrowserPane or openBrowserPaneAt sets it.
  browserPaneNavTo = $state<string | null>(null)
  // Per-album media info (codec / bitrate / size): the cache behind the album-
  // card format badges, the concurrency-capped trickle-fetch queue, and the
  // duplicates-mode bulk scan. Extracted into MediaInfoController; components
  // read plexState.mediaInfo.*.
  mediaInfo = new MediaInfoController({
    serverId: () => (this.session?.signedIn ? this.session.preferredServerId : null),
    getAllAlbums: () => this.allAlbums ?? []
  })

  // slskd-download inbox / tagger flow — folder list + service health, the
  // open-folder MB-match (shared ReleaseMatcher) + background fingerprint, and
  // the pick→preview→apply reconciler that writes tags + moves files into the
  // library. Extracted into InboxController; openInbox/closeInbox below stay
  // here (view flip) and call activate()/clearOpenFolder(). Post-apply slskd
  // cleanup is injected as removeSlskdDownloadsForFolder. Components read
  // plexState.inbox.*.
  inbox = new InboxController({
    flashToast: (kind, text) => this.flashToast(kind, text),
    session: () => this.session,
    ensureAllAlbums: () => this.ensureAllAlbums(),
    removeSlskdDownloadsForFolder: (name) => void this.slskd.removeDownloadsByFolder(name)
  })

  // Soulseek (slskd) download client — config/health, the search-queue
  // workflow + prefetch memo cache, the MB release-override picker, and the
  // live downloads poll. Extracted into SlskdController; openSlskd/closeSlskd
  // below stay here (view flip) and call activate()/deactivate(). The Inbox
  // post-apply cleanup calls slskd.removeDownloadsByFolder. Components read
  // plexState.slskd.*.
  slskd = new SlskdController({
    flashToast: (kind, text) => this.flashToast(kind, text),
    ensureAllAlbums: () => this.ensureAllAlbums()
  })

  private detachProgress: (() => void) | null = null
  private detachMediaKeys: (() => void) | null = null
  private detachMiniOpen: (() => void) | null = null
  // Whether the mini-player window is open (drives the bar button state).
  miniOpen = $state(false)

  async init(): Promise<void> {
    this.detachProgress = window.cratedigger.plex.onAuthProgress((p) => {
      this.authProgress = p
      if (p.stage === 'signed-in') {
        this.refreshSession()
      }
    })
    this.detachLabelProgress = this.labelIndex.subscribe()
    this.detachWarmerProgress = window.cratedigger.plex.onWarmerProgress((p) => {
      this.warmerProgress = p
    })
    this.detachAlbumEnriched = window.cratedigger.plex.onAlbumEnriched(({ ratingKey }) => {
      if (this.openAlbumLoader.album?.album.ratingKey === ratingKey) {
        void this.openAlbumLoader.reloadCredits()
      }
      if (this.nowPlayingAlbumLoader.album?.album.ratingKey === ratingKey) {
        void this.nowPlayingAlbumLoader.reloadCredits()
      }
    })
    void this.loadWarmerProgress()
    this.detachMediaKeys = window.cratedigger.mediaKeys.onCommand((cmd) => {
      void this.playback.handleMediaKeyCommand(cmd)
    })
    this.detachMiniOpen = window.cratedigger.mini.onOpenChanged((open) => {
      this.miniOpen = open
    })
    void this.labelIndex.loadLabels()
    void this.labelIndex.loadProgress()
    void this.labelAliases.load()
    void this.coverArt.load()
    void this.originalYear.load()
    void this.composerOverride.load()
    void this.loadReleaseRadar()
    void this.loadListenLater()
    this.detachReleaseRadar = window.cratedigger.plex.onReleaseRadarProgress((p) => {
      this.releaseRadarProgress = p
      if (p.snapshot) this.releaseRadar = p.snapshot
    })
    // Open the notification-click channel: clicking a "library artist
    // announced" native notification focuses the window (main side) and routes
    // us to the Shows screen here.
    this.detachShowsNotification = window.cratedigger.shows.onOpenFromNotification(() => {
      void this.openShows({ focusNew: true })
    })
    // Another machine's show marks / Listen Later just synced in — refetch
    // both derived views so this window reflects the merged state.
    this.detachRoamingChanged = window.cratedigger.shows.onRoamingChanged(() => {
      void this.loadListenLater()
      void this.shows.loadMarks()
    })
    // cratedigger://soulseek?q=… from the browser right-click extension.
    // Subscribe before pinging ready so a launch-via-link can't slip through.
    this.detachDeepLink = window.cratedigger.deepLinks.onSoulseekSearch(({ q }) => {
      const parsed = parseSlskdList(q)[0]
      void this.findGapOnSlskd(parsed?.artist ?? q, parsed?.album ?? '')
    })
    // Failed Soulseek transfers get one automatic retry in the background. Say
    // so when it happens and refresh the list if the user is looking at it.
    this.detachSlskdAutoRetry = window.cratedigger.slskd.onAutoRetried(({ count }) => {
      this.flashToast('ok', `Retried ${count} failed download${count === 1 ? '' : 's'}`)
      void this.slskd.pollDownloads()
    })
    window.cratedigger.deepLinks.ready()
    await this.refreshSession()
    if (this.playback.activePlayerId) this.playback.startTimelinePolling()
    // Load the persisted notification toggle so the background check honors it
    // from the first tick, then kick off the show-announcement poll.
    void this.settings.ensureLoaded().finally(() => this.startShowsNotifyPoll())
  }

  // Background poll for newly-announced library-artist shows. A first scan runs
  // ~45s after launch (let sign-in + the initial library load settle), then
  // every 6 hours while the app is open. The scan + diff is cheap to repeat and
  // the main process only notifies on genuinely new matches.
  private startShowsNotifyPoll(): void {
    const SIX_HOURS = 6 * 60 * 60 * 1000
    if (this.showsCheckTimer !== null) return
    const tick = (): void => {
      const s = this.session
      if (s?.signedIn && s.preferredServerId && this.settings.showNotificationsEnabled) {
        void this.shows.backgroundCheck()
      }
    }
    this.showsCheckKickoff = setTimeout(tick, 45_000)
    this.showsCheckTimer = setInterval(tick, SIX_HOURS)
  }

  dispose(): void {
    this.detachProgress?.()
    this.detachProgress = null
    this.detachLabelProgress?.()
    this.detachLabelProgress = null
    this.detachWarmerProgress?.()
    this.detachWarmerProgress = null
    this.detachAlbumEnriched?.()
    this.detachAlbumEnriched = null
    this.detachMediaKeys?.()
    this.detachMediaKeys = null
    this.detachMiniOpen?.()
    this.detachMiniOpen = null
    this.detachReleaseRadar?.()
    this.detachReleaseRadar = null
    this.detachShowsNotification?.()
    this.detachShowsNotification = null
    this.detachRoamingChanged?.()
    this.detachRoamingChanged = null
    this.detachDeepLink?.()
    this.detachDeepLink = null
    this.detachSlskdAutoRetry?.()
    this.detachSlskdAutoRetry = null
    if (this.showsCheckKickoff !== null) clearTimeout(this.showsCheckKickoff)
    this.showsCheckKickoff = null
    if (this.showsCheckTimer !== null) clearInterval(this.showsCheckTimer)
    this.showsCheckTimer = null
    this.playback.stopTimelinePolling()
    this.slskd.stopDownloadsPolling()
  }

  async refreshSession(): Promise<void> {
    this.session = await window.cratedigger.plex.getSession()
    if (!this.session.signedIn) {
      this.resetLibrary()
      return
    }
    void this.loadServers()
    if (this.session.preferredServerId && !this.changingServer) {
      void this.enterLibrary(this.session.preferredServerId)
    }
    // The user's previously-chosen target was restored from storage before a
    // session existed — let it re-attach (the local player binds its server
    // here; a remote target no-ops) so transport / cast calls have something
    // to talk to.
    this.playback.syncLocalPlayerToSession()
  }

  async signIn(): Promise<void> {
    const result = await window.cratedigger.plex.startAuth()
    if (!result.ok) this.authProgress = { stage: 'error', message: result.message }
  }

  async cancelAuth(): Promise<void> {
    await window.cratedigger.plex.cancelAuth()
    this.authProgress = { stage: 'idle' }
  }

  async signOut(): Promise<void> {
    await window.cratedigger.plex.signOut()
    this.servers = []
    this.resetLibrary()
    await this.refreshSession()
  }

  /** Swap the whole session to another stored account — no pin-auth needed. */
  async switchAccount(id: string): Promise<void> {
    const result = await window.cratedigger.plex.switchAccount(id)
    if (!result.ok) return
    this.servers = []
    this.changingServer = false
    this.resetLibrary()
    await this.refreshSession()
  }

  async listAccounts(): Promise<PlexAccountSummary[]> {
    return await window.cratedigger.plex.listAccounts()
  }

  async loadServers(): Promise<void> {
    this.serversLoading = true
    this.serversError = null
    try {
      this.servers = await window.cratedigger.plex.listServers()
    } catch (err) {
      this.serversError = err instanceof Error ? err.message : String(err)
    } finally {
      this.serversLoading = false
    }
  }

  async pickServer(id: string): Promise<void> {
    await window.cratedigger.plex.setPreferredServer(id)
    this.changingServer = false
    await this.refreshSession()
  }

  requestChangeServer(): void {
    this.changingServer = true
    this.resetLibrary()
  }

  private resetLibrary(): void {
    this.serverContext = null
    this.sections = []
    this.activeSectionKey = null
    this.albums = []
    this.albumsTotal = 0
    this.libraryError = null
    this.openAlbumLoader.clear()
    this.playback.resetPlayers()
    this.nav.reset()
  }

  async enterLibrary(serverId: string): Promise<void> {
    this.libraryLoading = true
    this.libraryError = null
    try {
      this.serverContext = await window.cratedigger.plex.getServerContext(serverId)
      this.sections = await window.cratedigger.plex.listMusicSections(serverId)
      if (this.sections.length === 0) {
        this.libraryError = 'No music libraries on this server.'
        return
      }
      await this.selectSection(this.sections[0].key)
      void this.playback.loadPlayers()
    } catch (err) {
      this.libraryError = err instanceof Error ? err.message : String(err)
    } finally {
      this.libraryLoading = false
    }
  }

  // Jump the Now Playing view to a freshly-cast album. Injected into
  // PlaybackController as `onAlbumCast`. The timeline poll may still report the
  // PREVIOUS album's ratingKey for ~1s after the cast dispatches, so we latch
  // on to the explicit request (ensureNowPlayingAlbum's explicit-key latch)
  // and seed the loader from the open album detail when it's the same album.
  private jumpToNowPlayingForAlbum(ratingKey: string): void {
    this.nowPlayingOpen = true
    const seed =
      this.openAlbumLoader.album && this.openAlbumLoader.album.album.ratingKey === ratingKey
        ? this.openAlbumLoader.album
        : undefined
    void this.ensureNowPlayingAlbum(ratingKey, { seed })
  }

  private flashToast(kind: 'ok' | 'err', text: string, ms = 3500): void {
    this.castToast = { kind, text }
    if (this.toastTimer !== null) clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.castToast = null
      this.toastTimer = null
    }, ms)
  }

  // "Add to Playlist…" picker (opened from every right-click menu via
  // queueMenuItems). kind is informational — Plex expands album ids into
  // tracks on add, so the modal treats both the same.
  addToPlaylist = $state<{ ratingKey: string; kind: 'album' | 'track'; label: string } | null>(
    null
  )

  openAddToPlaylist(args: { ratingKey: string; kind: 'album' | 'track'; label: string }): void {
    this.addToPlaylist = args
    // The picker needs the playlist list even if the Playlists screen was
    // never opened this session.
    if (this.playlistsCtl.playlists.length === 0) void this.playlistsCtl.activate()
  }

  closeAddToPlaylist(): void {
    this.addToPlaylist = null
  }

  openContextMenu(x: number, y: number, items: ContextMenuEntry[]): void {
    this.contextMenu = { x, y, items }
  }

  closeContextMenu(): void {
    this.contextMenu = null
  }

  private async loadReleaseRadar(): Promise<void> {
    try {
      this.releaseRadar = await window.cratedigger.plex.releaseRadarSnapshot()
    } catch {
      // never run before, or store empty — keep null
    }
  }

  async openNewReleases(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'releases'
    // Refresh the progress snapshot in case a run finished while we were
    // elsewhere and the event arrived before the listener was attached
    // (init order). Cheap one-shot read.
    try {
      this.releaseRadarProgress = await window.cratedigger.plex.releaseRadarProgress()
      if (this.releaseRadarProgress.snapshot) this.releaseRadar = this.releaseRadarProgress.snapshot
    } catch {
      // ignore — page renders empty-state until refresh runs
    }
  }

  closeNewReleases(): void {
    this.view = 'library'
  }

  async openShows(opts?: { focusNew?: boolean }): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'shows'
    // Opening the screen acknowledges any pending alert.
    this.shows.dismissBanner()
    // Arriving from a notification / banner click: scroll to the first
    // just-announced row once it's on screen. Clear any venue filter first —
    // the announced show may be at a filtered-out venue, and the scroll
    // effect polls until the row exists.
    if (opts?.focusNew) {
      this.shows.clearVenueFilter()
      this.shows.scrollToNewPending = true
    }
    // Sync the persisted "just announced" ids before deciding whether the
    // current rows are usable — a background check may have notified about a
    // show the last visible scan predates. In that case re-scan; otherwise the
    // notification click lands on a stale list missing the very show it named.
    // Marks (pins / tickets) load alongside — run() also loads them, but the
    // fresh-rows path below skips run() entirely.
    void this.shows.loadMarks()
    await this.shows.refreshRecentNew()
    const stale = this.shows.rows.length === 0 || this.shows.hasUnseenNewShows()
    if (stale && !this.shows.loading) {
      void this.shows.run()
    }
  }

  closeShows(): void {
    this.view = 'library'
    this.shows.scrollToNewPending = false
  }

  // Right-click "Open tickets in browser pane" — opens the pane (if closed)
  // and asks the embedded webview to load the URL. BrowserPane.svelte
  // $effect-watches browserPaneNavTo and clears it after loading.
  openBrowserPaneAt(url: string): void {
    if (!url) return
    this.browserPaneOpen = true
    this.browserPaneNavTo = url
  }

  async refreshReleaseRadar(): Promise<void> {
    const serverId = this.serverContext?.id
    if (!serverId) {
      this.flashToast('err', 'No Plex server selected.')
      return
    }
    try {
      const snapshot = await window.cratedigger.plex.refreshReleaseRadar({ serverId })
      this.releaseRadar = snapshot
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    }
  }

  async cancelReleaseRadar(): Promise<void> {
    try {
      await window.cratedigger.plex.cancelReleaseRadar()
    } catch {
      // best-effort
    }
  }

  private async loadListenLater(): Promise<void> {
    try {
      this.listenLater = await window.cratedigger.plex.listListenLater()
    } catch {
      // empty list is the default
    }
  }

  isInListenLater(ratingKey: string): boolean {
    return this.listenLater.some((e) => e.ratingKey === ratingKey)
  }

  async toggleListenLater(album: {
    ratingKey: string
    title: string
    artist: string
    thumb: string | null
    year: number | null
  }): Promise<void> {
    if (this.isInListenLater(album.ratingKey)) {
      try {
        this.listenLater = await window.cratedigger.plex.removeFromListenLater({
          ratingKey: album.ratingKey
        })
        this.flashToast('ok', 'Removed from later')
      } catch (err) {
        this.flashToast('err', err instanceof Error ? err.message : String(err))
      }
      return
    }
    try {
      this.listenLater = await window.cratedigger.plex.addToListenLater({
        entry: {
          ratingKey: album.ratingKey,
          title: album.title,
          artist: album.artist,
          thumb: album.thumb,
          year: album.year,
          addedAt: Date.now()
        }
      })
      this.flashToast('ok', 'Saved for later')
    } catch (err) {
      this.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async openListenLater(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'later'
    // Refresh from disk in case it was changed in another window or by a
    // direct file edit while the app was open.
    try {
      this.listenLater = await window.cratedigger.plex.listListenLater()
    } catch {
      // keep whatever's in memory
    }
  }

  closeListenLater(): void {
    this.view = 'library'
  }

  private async reloadAlbumCredits(): Promise<void> {
    await this.openAlbumLoader.reloadCredits()
  }

  private currentFilters(): AlbumFilters {
    return this.filterState.toAlbumFilters()
  }

  // Side-effect helper for filter mutations. Genres / decade / year / mood
  // are server-side filters, so a section reselect re-fetches the grid.
  // needsAllAlbums covers the client-only filters (label, playstate,
  // genre-exclude) — they require the full library cache to apply.
  private _afterFilterChange(): void {
    if (this.filterState.needsAllAlbums()) void this.ensureAllAlbumsLoaded()
    if (this.activeSectionKey) void this.selectSection(this.activeSectionKey)
  }

  setMood(mood: { id: string; title: string } | null): void {
    this.filterState.setMood(mood)
    this._afterFilterChange()
  }

  clearMood(): void {
    if (this.filterState.clearMood()) this._afterFilterChange()
  }

  async selectSection(sectionKey: string): Promise<void> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    const sectionChanged = this.activeSectionKey !== sectionKey
    if (sectionChanged) {
      // New library section: previous albums are no longer relevant, blank
      // the grid while we fetch the new section's first page.
      this.allAlbums = null
      this.allAlbumsKey = null
      this.albums = []
      this.albumsTotal = 0
    }
    // Sort / filter change in the same section: KEEP the existing albums
    // visible while the new page fetches. The user sees a brief stale-order
    // grid instead of an empty-then-filled flash, then the swap is
    // instantaneous when the page arrives.
    this.activeSectionKey = sectionKey
    this.libraryLoading = true
    this.libraryError = null
    const seq = ++this.filterRequestSeq
    try {
      const page = await window.cratedigger.plex.listAlbums({
        serverId: this.session.preferredServerId,
        sectionKey,
        offset: 0,
        size: 200,
        sort: this.sortKey,
        filters: this.currentFilters(),
        seed: this.sortSeed ?? undefined
      })
      if (seq !== this.filterRequestSeq) return
      this.albums = page.albums
      this.albumsTotal = page.total
    } catch (err) {
      if (seq !== this.filterRequestSeq) return
      this.libraryError = err instanceof Error ? err.message : String(err)
    } finally {
      if (seq === this.filterRequestSeq) this.libraryLoading = false
    }
  }

  async loadMoreAlbums(): Promise<void> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    if (!this.activeSectionKey) return
    if (this.albumsLoadingMorePromise) return this.albumsLoadingMorePromise
    if (this.albums.length >= this.albumsTotal && this.albumsTotal > 0) return

    const serverId = this.session.preferredServerId
    const sectionKey = this.activeSectionKey
    const offset = this.albums.length
    const sort = this.sortKey
    const filters = this.currentFilters()
    const seq = this.filterRequestSeq
    this.albumsLoadingMore = true
    this.albumsLoadingMorePromise = (async () => {
      try {
        const page = await window.cratedigger.plex.listAlbums({
          serverId,
          sectionKey,
          offset,
          size: 200,
          sort,
          filters,
          seed: this.sortSeed ?? undefined
        })
        if (this.activeSectionKey !== sectionKey || this.sortKey !== sort) return
        if (this.filterRequestSeq !== seq) return
        const seen = new Set(this.albums.map((a) => a.ratingKey))
        const fresh = page.albums.filter((a) => !seen.has(a.ratingKey))
        this.albums = [...this.albums, ...fresh]
        if (page.total) this.albumsTotal = page.total
      } catch (err) {
        this.libraryError = err instanceof Error ? err.message : String(err)
      } finally {
        this.albumsLoadingMore = false
        this.albumsLoadingMorePromise = null
      }
    })()
    return this.albumsLoadingMorePromise
  }

  async setSort(sort: AlbumSortKey): Promise<void> {
    const reshuffle = sort === 'random' && this.sortKey === 'random'
    if (sort === this.sortKey && !reshuffle) return
    this.sortKey = sort
    this.sortSeed = sort === 'random' ? makeSortSeed() : null
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      // in-memory only
    }
    // Negligence is computed client-side off the full library; warm allAlbums
    // before the user has to wait for the page-1 fetch to finish first.
    if (sort === 'negligence') void this.ensureAllAlbumsLoaded()
    if (this.activeSectionKey) await this.selectSection(this.activeSectionKey)
  }

  async reshuffle(): Promise<void> {
    if (this.sortKey !== 'random') return
    this.sortSeed = makeSortSeed()
    if (this.activeSectionKey) await this.selectSection(this.activeSectionKey)
  }

  // Fetch a fresh random batch from the active section, respecting any Focus
  // filters that the server can apply (genreInclude / decade / year). Used by
  // the hold-to-shuffle slot machine; doesn't touch the main library state.
  async fetchRandomAlbums(size = 50): Promise<PlexAlbum[]> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return []
    if (!this.activeSectionKey) return []
    const page = await window.cratedigger.plex.listAlbums({
      serverId: this.session.preferredServerId,
      sectionKey: this.activeSectionKey,
      offset: 0,
      size,
      sort: 'random',
      filters: this.currentFilters(),
      seed: makeSortSeed()
    })
    return page.albums
  }

  thumbUrl(thumbPath: string | null, size = 320, ratingKey?: string | null): string | null {
    // User-pinned override beats Plex's chosen cover. The picker stores a
    // ~600px URL; the smaller thumbUrl is used when the requested size is
    // tiny (track rows, queue thumbs) to avoid pulling a 600px JPEG for an
    // 80px slot.
    if (ratingKey) {
      const ov = this.coverArt.overrides[ratingKey]
      if (ov) return size <= 200 ? ov.thumbUrl : ov.url
    }
    if (!thumbPath || !this.serverContext) return null
    // Route through the cratedigger-plex:// protocol so the Plex auth token never
    // appears in the renderer DOM, devtools, or any URL the browser might log.
    return `cratedigger-plex://thumb/?path=${encodeURIComponent(thumbPath)}&size=${size}`
  }

  setCoverSize(px: number): void {
    const clamped = Math.max(COVER_SIZE_MIN, Math.min(COVER_SIZE_MAX, Math.round(px)))
    this.coverSize = clamped
    try {
      localStorage.setItem(COVER_SIZE_KEY, String(clamped))
    } catch {
      // storage quota or private mode; preference stays in-memory only
    }
  }

  // Renderer-side LRU of pre-warmed AlbumDetail payloads. AlbumCard hover
  // (120ms dwell) populates this; openAlbumDetail hits it first to skip the
  // loading flash when the click is predicted. Cap is small — typical
  // hover-then-click sessions visit < 12 distinct cards.
  private prefetchedDetails = new Map<string, AlbumDetail>()
  private prefetchingDetails = new Set<string>()
  private static readonly PREFETCH_LRU = 12

  prefetchAlbumDetail(ratingKey: string): void {
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    const existing = this.prefetchedDetails.get(ratingKey)
    if (existing) {
      // bump to MRU
      this.prefetchedDetails.delete(ratingKey)
      this.prefetchedDetails.set(ratingKey, existing)
      return
    }
    if (this.prefetchingDetails.has(ratingKey)) return
    this.prefetchingDetails.add(ratingKey)
    const serverId = this.session.preferredServerId
    void window.cratedigger.plex
      .getAlbumDetail({ serverId, ratingKey })
      .then((detail) => {
        this.prefetchedDetails.set(ratingKey, detail)
        while (this.prefetchedDetails.size > PlexState.PREFETCH_LRU) {
          const oldest = this.prefetchedDetails.keys().next().value
          if (oldest) this.prefetchedDetails.delete(oldest)
        }
      })
      .catch(() => {
        // prefetch is best-effort; a failure here is harmless — the real
        // click will hit the cold path with its own error handling.
      })
      .finally(() => {
        this.prefetchingDetails.delete(ratingKey)
      })
  }

  async openAlbumDetail(
    ratingKey: string,
    opts: { fromNav?: boolean } = {}
  ): Promise<void> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    if (this.nowPlayingOpen) this.closeNowPlaying()
    this.entityPage.entity = null

    // Hand the cascade (album fetch / credits / bio / booklet) to the
    // loader. Seed it with any hover-prefetched payload so the screen
    // opens without a loading flash on the hot path.
    const prefetched = this.prefetchedDetails.get(ratingKey)
    if (prefetched) this.prefetchedDetails.delete(ratingKey)

    if (!opts.fromNav) this.nav.push({ kind: 'album', ratingKey })
    if (ratingKey === this.lastClosedAlbumKey) {
      this.lastClosedAlbumKey = null
    }

    // Fire the loader cascade + its two rails in parallel. Once the detail is
    // in hand (seed or network), kick the silent background lyrics prefetch.
    // Gating this on `prefetched` regressed it to "only prefetch on the
    // hover-prefetch hot path" — a direct click that never warmed the LRU got
    // no lyrics until each track row was opened.
    void this.openAlbumLoader
      .load(this.session.preferredServerId, ratingKey, {
        seed: prefetched ?? undefined,
        includeBooklet: true
      })
      .then(() => {
        const detail = this.openAlbumLoader.album
        if (detail && detail.album.ratingKey === ratingKey) {
          void this.lyrics.prefetchAlbum(detail)
        }
      })
    void this.openAlbumLoader.loadLabelRail()
    void this.openAlbumLoader.loadSimilarArtists()
    this.mediaInfo.request(ratingKey)
  }

  private clearAlbumState(): void {
    // clear() resets the album, cascade, and both rails.
    this.openAlbumLoader.clear()
    this.lyrics.closeAll()
  }

  closeAlbumDetail(): void {
    // Force-finish any in-flight card->detail cover morph before we unmount the
    // screen, so its snapshot can't strand on the top layer (oversized-cover
    // bug) when the user backs out mid-transition.
    flushCoverTransition()
    const rk = this.openAlbumLoader.album?.album.ratingKey ?? null
    if (rk) this.nav.popIfTop({ kind: 'album', ratingKey: rk })
    this.clearAlbumState()
    if (rk) this.lastClosedAlbumKey = rk
  }

  openNowPlaying(): void {
    const timeline = this.playback.timeline
    if (!timeline) return
    const albumKey = timeline.albumRatingKey
    // Swipe-back-into-album-detail jank fix: if the user opened the
    // playing album's detail page first and then opened now-playing on
    // top, swiping back from now-playing would unwind into that
    // album-detail page (the playing album, again) — surprising. Pop it
    // from the nav stack here so close-now-playing lands on whatever the
    // user was doing before they opened the album detail (typically the
    // library grid).
    if (albumKey) {
      const top = this.nav.stack.at(-1)
      if (top?.entity.kind === 'album' && top.entity.ratingKey === albumKey) {
        this.nav.pop()
      }
    }
    this.nowPlayingOpen = true
    // Album metadata may be missing on the first poll after a new track starts
    // (Plexamp sends the ratingKey before we've fetched parentRatingKey). The
    // NowPlayingScreen effect re-runs on timeline changes and will fetch the
    // album as soon as it's available, so just open the screen now.
    if (albumKey) void this.ensureNowPlayingAlbum(albumKey, { fromTimeline: true })
    if (this.playback.activePlayQueueId) void this.playback.refreshQueue()
  }

  closeNowPlaying(): void {
    this.nowPlayingOpen = false
    this.nowPlayingExplicitKey = null
  }

  openTheater(): void {
    const timeline = this.playback.timeline
    if (!timeline) return
    this.theaterOpen = true
    // Same load path as the Now Playing screen — the theater view reads
    // credits off nowPlayingAlbumLoader.
    if (timeline.albumRatingKey) {
      void this.ensureNowPlayingAlbum(timeline.albumRatingKey, { fromTimeline: true })
    }
  }

  closeTheater(): void {
    this.theaterOpen = false
  }

  async ensureNowPlayingAlbum(
    albumRatingKey: string,
    opts: { fromTimeline?: boolean; seed?: AlbumDetail } = {}
  ): Promise<void> {
    if (opts.fromTimeline) {
      if (
        this.nowPlayingExplicitKey !== null &&
        this.nowPlayingExplicitKey !== albumRatingKey
      ) {
        // Timeline is still reporting the previous album; ignore until it
        // catches up to what the user just asked for.
        return
      }
      if (albumRatingKey === this.nowPlayingExplicitKey) {
        this.nowPlayingExplicitKey = null
      }
    } else {
      this.nowPlayingExplicitKey = albumRatingKey
    }
    if (
      this.nowPlayingLoadedKey === albumRatingKey &&
      this.nowPlayingAlbumLoader.album
    ) {
      return
    }
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    this.nowPlayingLoadedKey = albumRatingKey
    // Reset just the rails — the loader's album is about to be (re)loaded below,
    // and the rail loaders re-derive from it.
    this.nowPlayingAlbumLoader.resetRails()

    // Hand the cascade to the loader. Now-playing doesn't show the
    // booklet, so opt out — saves a Cover Art Archive round-trip per
    // track change. Seed path mirrors openAlbumDetail's hover hot path.
    const seed = opts.seed && opts.seed.album.ratingKey === albumRatingKey ? opts.seed : undefined
    void this.nowPlayingAlbumLoader.load(
      this.session.preferredServerId,
      albumRatingKey,
      { seed, includeBooklet: false }
    )
    void this.nowPlayingAlbumLoader.loadLabelRail()
    void this.nowPlayingAlbumLoader.loadSimilarArtists()
    // Same media-info fetch the album-detail view fires, so now-playing's
    // stats row can show codec / bitrate / size alongside the play count.
    this.mediaInfo.request(albumRatingKey)
  }

  async openArtistFromAlbum(detail: AlbumDetail): Promise<void> {
    const name = detail.album.artist
    if (!name) return

    // Try release MBIDs in order: credit-reconciler's pick (most reliable,
    // since it's what populated the credits), then Plex album guids.
    const candidateMbids: string[] = []
    if (this.openAlbumLoader.credits?.releaseMbid) candidateMbids.push(this.openAlbumLoader.credits.releaseMbid)
    for (const g of detail.guids) {
      const m = mbidFromGuid(g)
      if (m && !candidateMbids.includes(m)) candidateMbids.push(m)
    }

    let artistMbid: string | null = null
    for (const mbid of candidateMbids) {
      try {
        const release = await window.cratedigger.tagger.getRelease({ mbid })
        if (release.albumartist_ids[0]) {
          artistMbid = release.albumartist_ids[0]
          break
        }
      } catch {
        // try next candidate
      }
    }

    if (!artistMbid) {
      try {
        artistMbid = await window.cratedigger.plex.searchArtistByName({ name })
      } catch (err) {
        this.flashToast('err', err instanceof Error ? err.message : String(err))
        return
      }
    }
    if (!artistMbid) {
      this.flashToast('err', `no MusicBrainz artist found for "${name}"`)
      return
    }
    await this.openEntity(artistMbid, name)
  }

  async openSimilarArtist(item: SimilarArtist): Promise<void> {
    if (item.mbid) {
      await this.openEntity(item.mbid, item.name)
      return
    }
    try {
      const mbid = await window.cratedigger.plex.searchArtistByName({ name: item.name })
      if (mbid) {
        await this.openEntity(mbid, item.name)
        return
      }
    } catch {
      // fall through
    }
    this.flashToast('err', `couldn't find "${item.name}" on MusicBrainz`)
  }

  async openSearchArtist(name: string): Promise<void> {
    try {
      const mbid = await window.cratedigger.plex.searchArtistByName({ name })
      if (mbid) {
        await this.openEntity(mbid, name)
        return
      }
    } catch (err) {
      this.flashToast('err', err instanceof Error ? err.message : String(err))
      return
    }
    this.flashToast('err', `couldn't find "${name}" on MusicBrainz`)
  }

  // View orchestrator for the artist/person page: tears down the album +
  // now-playing overlays, records the nav frame, then hands the data loading
  // (header / credits / appearances / bio, with the request guard) to
  // EntityController.
  async openEntity(
    mbid: string,
    name: string,
    opts: { fromNav?: boolean } = {}
  ): Promise<void> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return
    // Clear album state but preserve the nav stack — the album stays in history
    // so Esc from the entity page returns to it.
    this.clearAlbumState()
    if (this.nowPlayingOpen) this.closeNowPlaying()
    if (!opts.fromNav) this.nav.push({ kind: 'artist', mbid, name })
    this.entityPage.load(mbid, name)
  }

  private async ensureAllAlbums(): Promise<PlexAlbum[]> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return []
    if (!this.activeSectionKey) return []
    const key = `${this.session.preferredServerId}:${this.activeSectionKey}`
    if (this.allAlbums && this.allAlbumsKey === key) return this.allAlbums
    if (this.allAlbumsPromise) return this.allAlbumsPromise
    const serverId = this.session.preferredServerId
    const sectionKey = this.activeSectionKey
    this.allAlbumsLoading = true
    this.allAlbumsPromise = (async () => {
      try {
        const albums = await window.cratedigger.plex.listAllAlbums({ serverId, sectionKey })
        this.allAlbums = albums
        this.allAlbumsKey = key
        return albums
      } finally {
        this.allAlbumsLoading = false
        this.allAlbumsPromise = null
      }
    })()
    return this.allAlbumsPromise
  }

  async ensureAllAlbumsLoaded(): Promise<PlexAlbum[]> {
    return this.ensureAllAlbums()
  }

  // Re-date an album to its original release year across the in-memory library
  // caches. The IPC list handlers already overlay known years at fetch time, but
  // when credits resolve for an album opened *after* these arrays were loaded
  // this session, they still hold Plex's edition year — patch them so the
  // discography strip and grid update live, without a reload. A null year means
  // MusicBrainz had no usable date, so we leave the Plex year in place.
  applyOriginalYear(ratingKey: string, originalYear: number | null): void {
    // A user-pinned year always wins over the credits-derived one (the whole
    // point of the override is that MusicBrainz's release-group date is wrong
    // for this album), so don't let resolving credits overwrite it.
    const year = this.originalYear.get(ratingKey) ?? originalYear
    if (year == null) return
    const patch = (album: PlexAlbum | undefined): void => {
      if (album && album.year !== year) album.year = year
    }
    patch(this.allAlbums?.find((a) => a.ratingKey === ratingKey))
    patch(this.albums.find((a) => a.ratingKey === ratingKey))
  }

  openLabelFilter(): void {
    this.labelFilterOpen = true
  }

  closeLabelFilter(): void {
    this.labelFilterOpen = false
  }

  openGenreFilter(): void {
    this.genreFilterOpen = true
    void this.ensureAllAlbums()
  }

  closeGenreFilter(): void {
    this.genreFilterOpen = false
  }

  openDecadeFilter(): void {
    this.decadeFilterOpen = true
    void this.ensureAllAlbums()
  }

  closeDecadeFilter(): void {
    this.decadeFilterOpen = false
  }

  genreState(value: string): 'neutral' | 'include' | 'exclude' {
    return this.filterState.genreStateOf(value)
  }

  // Cycle: neutral → include → exclude → neutral. Excluding requires the full
  // library (server-side genre filter is include-only).
  toggleGenre(genre: string): void {
    this.filterState.toggleGenre(genre)
    this._afterFilterChange()
  }

  clearGenres(): void {
    if (this.filterState.clearGenres()) this._afterFilterChange()
  }

  // The crate rail's one-at-a-time selection. Replaces the genre selection
  // rather than adding to it; null clears.
  setGenreCrate(genre: string | null): void {
    if (this.filterState.setGenreCrate(genre)) this._afterFilterChange()
  }

  get crateGenre(): string | null {
    return this.filterState.crateGenre()
  }

  // Chip × — drop the value out of either set. Different from toggleGenre's
  // 3-way cycle: this always returns to neutral.
  removeGenre(genre: string): void {
    this.filterState.removeGenre(genre)
    this._afterFilterChange()
  }

  // Chip body click — flip include↔exclude without passing through neutral.
  // No-op on a value that's neither.
  flipGenre(genre: string): void {
    this.filterState.flipGenre(genre)
    this._afterFilterChange()
  }

  setDecade(decade: number | null): void {
    if (this.filterState.setDecade(decade)) this._afterFilterChange()
  }

  setYear(year: number | null): void {
    if (this.filterState.setYear(year)) this._afterFilterChange()
  }

  setPlaystate(state: PlaystateFilter): void {
    if (this.filterState.setPlaystate(state)) this._afterFilterChange()
  }

  setTheme(id: string): void {
    if (this.themeId === id) return
    this.themeId = id
    storeThemeId(id)
    applyTheme(id)
  }

  openThemePicker(): void {
    // Mutually exclusive with Settings — stacking the two reads as a bug.
    this.settings.open = false
    this.themePickerOpen = true
  }

  closeThemePicker(): void {
    this.themePickerOpen = false
  }

  clearAllFilters(): void {
    if (this.filterState.clearAll()) this._afterFilterChange()
  }

  labelState(value: string): 'neutral' | 'include' | 'exclude' {
    return this.filterState.labelStateOf(value)
  }

  // Wrapper around labelAliases.setAlias that also migrates any active label
  // filter from the alias name to the canonical name. Without this, an
  // existing "include New West Records LLC" would orphan itself once the LLC
  // row vanishes from the filter UI.
  async mergeLabel(alias: string, canonical: string): Promise<void> {
    await this.labelAliases.setAlias(alias, canonical)
    if (this.filterState.migrateLabel(alias, canonical)) {
      this._afterFilterChange()
    }
  }

  async unmergeLabel(alias: string): Promise<void> {
    await this.labelAliases.removeAlias(alias)
  }

  toggleLabel(label: string): void {
    this.filterState.toggleLabel(label)
    if (!this.filterState.isEmpty()) void this.ensureAllAlbums()
  }

  clearLabelFilter(): void {
    this.filterState.clearLabels()
  }

  removeLabel(label: string): void {
    this.filterState.removeLabel(label)
  }

  flipLabel(label: string): void {
    this.filterState.flipLabel(label)
    if (this.filterState.labelInclude.size > 0 || this.filterState.labelExclude.size > 0) {
      void this.ensureAllAlbums()
    }
  }

  filterByLabel(label: string): void {
    this.filterState.setLabelInclude(label)
    this.closeAlbumDetail()
    this.view = 'library'
    void this.ensureAllAlbums()
  }

  openLabelEntity(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    if (this.nowPlayingOpen) this.closeNowPlaying()
    this.clearAlbumState()
    this.clearEntityState()
    this.nav.push({ kind: 'label', name: trimmed })
    void this.ensureAllAlbums()
  }

  openGenreEntity(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    if (this.nowPlayingOpen) this.closeNowPlaying()
    this.clearAlbumState()
    this.clearEntityState()
    this.nav.push({ kind: 'genre', name: trimmed })
    void this.ensureAllAlbums()
  }

  openYearEntity(year: number): void {
    if (!Number.isFinite(year)) return
    if (this.nowPlayingOpen) this.closeNowPlaying()
    this.clearAlbumState()
    this.clearEntityState()
    this.nav.push({ kind: 'year', year })
    void this.ensureAllAlbums()
  }

  filterLibraryByLabel(name: string): PlexAlbum[] {
    const target = this.labelAliases.canonical(name).toLowerCase()
    if (!target) return []
    const source = this.allAlbums ?? this.albums
    const out: PlexAlbum[] = []
    for (const a of source) {
      const indexed = this.labelIndex.labels[a.ratingKey] ?? []
      const candidates = a.studio ? [...indexed, a.studio] : indexed
      for (const c of candidates) {
        if (this.labelAliases.canonical(c).toLowerCase() === target) {
          out.push(a)
          break
        }
      }
    }
    out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return out
  }

  filterLibraryByGenre(name: string): PlexAlbum[] {
    const target = name.trim().toLowerCase()
    if (!target) return []
    const source = this.allAlbums ?? this.albums
    const out = source.filter((a) => a.genres.some((g) => g.toLowerCase() === target))
    out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return out
  }

  filterLibraryByYear(year: number): PlexAlbum[] {
    const source = this.allAlbums ?? this.albums
    const out = source.filter((a) => a.year === year)
    out.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    return out
  }

  allLibraryAlbums(): PlexAlbum[] {
    return this.allAlbums ?? this.albums
  }

  private async loadWarmerProgress(): Promise<void> {
    try {
      this.warmerProgress = await window.cratedigger.plex.warmerProgress()
    } catch {
      // ignore
    }
  }

  async startLibraryWarmer(): Promise<void> {
    const serverId =
      this.session?.signedIn ? this.session.preferredServerId : null
    if (!serverId) return
    const albums = await this.ensureAllAlbums()
    const items = albums.map((a) => ({
      ratingKey: a.ratingKey,
      artist: a.artist,
      title: a.title,
      year: a.year,
      // Snapshot the guids array — Svelte 5 $state proxies aren't structured-
      // cloneable across IPC.
      guids: [...a.guids]
    }))
    await window.cratedigger.plex.startWarmer({ serverId, items })
    if (this.view === 'classical') {
      this.classicalCatalog = await window.cratedigger.plex.getClassicalCatalog()
    }
  }

  async startClassicalWarmer(): Promise<void> {
    const serverId = this.session?.signedIn ? this.session.preferredServerId : null
    if (!serverId) return
    const albums = (await this.ensureAllAlbums()).filter(isClassicalCandidate)
    const items = albums.map((album) => ({
      ratingKey: album.ratingKey,
      artist: album.artist,
      title: album.title,
      year: album.year,
      guids: [...album.guids]
    }))
    await window.cratedigger.plex.startWarmer({ serverId, items, creditsOnly: true })
    if (this.view === 'classical') {
      this.classicalCatalog = await window.cratedigger.plex.getClassicalCatalog()
    }
  }

  async stopLibraryWarmer(): Promise<void> {
    await window.cratedigger.plex.stopWarmer()
  }

  private clearEntityState(): void {
    this.entityPage.clear()
  }

  closeEntity(): void {
    const { mbid, entity } = this.entityPage
    if (mbid && entity?.name) {
      this.nav.popIfTop({ kind: 'artist', mbid, name: entity.name })
    }
    this.entityPage.clear()
  }

  // Opens the Settings modal and lazily loads both settings (API keys +
  // preferences, owned by SettingsController) and the slskd config (a separate
  // subsystem still on PlexState). Stays here because it orchestrates both.
  async openSettings(): Promise<void> {
    // Mutually exclusive with the theme picker — stacking the two reads as a bug.
    this.themePickerOpen = false
    this.settings.open = true
    await this.settings.ensureLoaded()
    // slskd is stripped from the public build — skip its (now-unregistered)
    // config IPC so opening Settings doesn't fire a dead handler.
    if (!PUBLIC_BUILD) await this.slskd.ensureConfigLoaded()
  }

  canGoBack(): boolean {
    if (this.nav.stack.length > 0) return true
    return (
      !!this.entityPage.entity ||
      this.entityPage.loading ||
      !!this.openAlbumLoader.album ||
      this.openAlbumLoader.albumLoading ||
      !!this.openAlbumLoader.albumError
    )
  }

  canGoForward(): boolean {
    if (this.nav.forward.length > 0) return true
    return (
      !this.openAlbumLoader.album &&
      !this.openAlbumLoader.albumLoading &&
      !this.entityPage.entity &&
      !!this.lastClosedAlbumKey
    )
  }

  private async restoreFrame(frame: NavFrame): Promise<void> {
    const e = frame.entity
    if (e.kind === 'album') {
      this.clearEntityState()
      await this.openAlbumDetail(e.ratingKey, { fromNav: true })
    } else if (e.kind === 'artist') {
      this.clearAlbumState()
      await this.openEntity(e.mbid, e.name, { fromNav: true })
    } else if (e.kind === 'label' || e.kind === 'genre' || e.kind === 'year') {
      // Filter-entity screens read directly from the stack top; no slots to restore.
      this.clearAlbumState()
      this.clearEntityState()
    }
  }

  async goBack(): Promise<void> {
    // Any back/swipe/keyboard exit swaps the visible screen; finish a pending
    // cover morph first so its snapshot can't strand on the top layer.
    flushCoverTransition()
    if (this.nowPlayingOpen) {
      this.closeNowPlaying()
      return
    }
    if (this.nav.stack.length > 0) {
      const popped = this.nav.pop()
      const newTop = this.nav.stack.at(-1)
      if (newTop) {
        await this.restoreFrame(newTop)
        return
      }
      // Stack now empty — clear whatever screen was visible.
      if (popped?.entity.kind === 'album') {
        this.clearAlbumState()
        this.lastClosedAlbumKey = popped.entity.ratingKey
      } else if (popped?.entity.kind === 'artist') {
        this.clearEntityState()
      }
      return
    }
    // Legacy fallback if the stack is empty but old slots have state.
    if (this.entityPage.entity || this.entityPage.loading) {
      this.closeEntity()
      return
    }
    if (
      this.openAlbumLoader.album ||
      this.openAlbumLoader.albumLoading ||
      this.openAlbumLoader.albumError
    ) {
      this.closeAlbumDetail()
    }
  }

  async goForward(): Promise<void> {
    if (this.nav.forward.length > 0) {
      const restored = this.nav.unpop()
      if (restored) await this.restoreFrame(restored)
      return
    }
    if (this.canGoForward() && this.lastClosedAlbumKey) {
      void this.openAlbumDetail(this.lastClosedAlbumKey)
    }
  }

  // Switching to a top-level view (library / inbox / triage / slskd) needs to
  // tear down whatever overlay was on top — Now Playing, album detail, entity
  // page, or a label/genre/year filter-entity in the nav stack — otherwise the
  // App.svelte routing keeps rendering the overlay and clicking the toolbar
  // button looks like a no-op.
  private resetForTopLevelView(): void {
    if (this.nowPlayingOpen) this.closeNowPlaying()
    if (this.entityPage.mbid) this.clearEntityState()
    this.clearAlbumState()
    this.nav.reset()
  }

  goHome(): void {
    // First press tears down overlays back to the library grid; a second
    // press while already at the bare grid clears the search too.
    const alreadyHome =
      this.view === 'library' &&
      !this.nowPlayingOpen &&
      !this.entityPage.mbid &&
      !this.openAlbumLoader.album &&
      this.nav.stack.length === 0
    this.resetForTopLevelView()
    this.view = 'library'
    if (alreadyHome) this.search.clear()
  }

  async openInbox(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'inbox'
    await this.inbox.activate()
  }

  closeInbox(): void {
    this.view = 'library'
    this.inbox.clearOpenFolder()
  }

  async openTriage(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'triage'
    // The deleted-albums log lives on PlexState (shared with AlbumDetail); the
    // rest of the triage data load is owned by the controller.
    await Promise.all([this.refreshDeletedAlbums(), this.triage.load()])
  }

  closeTriage(): void {
    this.view = 'library'
  }

  async openCharts(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'charts'
    await this.charts.activate()
  }

  async openClassical(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'classical'
  }

  async classicalLibraryAlbums(): Promise<PlexAlbum[]> {
    return await this.ensureAllAlbums()
  }

  closeClassical(): void { this.view = 'library' }

  closeCharts(): void {
    this.view = 'library'
  }

  async openPlaylists(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'playlists'
    void this.spotifyImport.activate()
    await this.playlistsCtl.activate()
  }

  /** Jump from a Spotify import gap to a pre-filled Soulseek search. */
  async findGapOnSlskd(artist: string, album: string): Promise<void> {
    await this.openSlskd()
    await this.slskd.runSearch(artist, album)
  }

  /**
   * "album" button on a gap row: resolve the full LP the track appears on
   * before searching. Exports often name the single/7" the service attached
   * the track to (album title == track title); MusicBrainz tells us the real
   * LP. Falls back to the export's album (then the title) when MB has
   * nothing or is unreachable.
   */
  async findGapAlbumOnSlskd(
    artist: string,
    title: string,
    sourceAlbum: string | null
  ): Promise<void> {
    await this.openSlskd()
    let album = sourceAlbum || title
    try {
      const lp = await window.cratedigger.plex.findLpForTrack({ artist, title, sourceAlbum })
      if (lp) album = lp.album
    } catch {
      // MB down — search the export's album name as-is.
    }
    await this.slskd.runSearch(artist.split(';')[0].trim() || artist, album)
  }

  /**
   * "RED" button on a gap row: open a Redacted torrent search for the album
   * in the default browser. Same LP resolution as the Soulseek album button
   * so the search targets the full-length, not the export's single.
   */
  async findGapOnRed(artist: string, title: string, sourceAlbum: string | null): Promise<void> {
    let album = sourceAlbum || title
    try {
      const lp = await window.cratedigger.plex.findLpForTrack({ artist, title, sourceAlbum })
      if (lp) album = lp.album
    } catch {
      // MB down — search the export's album name as-is.
    }
    window.open(redSearchUrl(artist, album), '_blank', 'noopener,noreferrer')
  }

  closePlaylists(): void {
    this.view = 'library'
  }

  async openArtFixer(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'artfix'
    await this.artFix.activate()
  }

  closeArtFixer(): void {
    this.view = 'library'
  }

  async refreshDeletedAlbums(): Promise<void> {
    try {
      this.deletedAlbums = await window.cratedigger.plex.listDeletedAlbums()
    } catch (err) {
      this.triage.error = err instanceof Error ? err.message : String(err)
    }
  }

  async reloadAllAlbums(): Promise<void> {
    this.allAlbums = null
    this.allAlbumsKey = null
    this.mediaInfo.resetScan()
    try {
      await this.ensureAllAlbums()
    } catch (err) {
      this.triage.error = err instanceof Error ? err.message : String(err)
    }
  }

  async deleteAlbumFromLibrary(
    ratingKey: string,
    reason: string | null = null
  ): Promise<DeletedAlbum | null> {
    if (!this.session?.signedIn || !this.session.preferredServerId) return null
    this.deletingRatingKey = ratingKey
    try {
      const entry = await window.cratedigger.plex.deleteAlbum({
        serverId: this.session.preferredServerId,
        ratingKey,
        reason
      })
      this.deletedAlbums = [...this.deletedAlbums, entry]
      if (this.allAlbums) this.allAlbums = this.allAlbums.filter((a) => a.ratingKey !== ratingKey)
      this.albums = this.albums.filter((a) => a.ratingKey !== ratingKey)
      if (this.albumsTotal > 0) this.albumsTotal -= 1
      this.flashToast('ok', `Deleted "${entry.title}"`)
      return entry
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
      return null
    } finally {
      this.deletingRatingKey = null
    }
  }

  async openSlskd(): Promise<void> {
    this.resetForTopLevelView()
    this.view = 'slskd'
    await this.slskd.activate()
  }

  closeSlskd(): void {
    this.view = 'library'
    this.slskd.deactivate()
  }

  toggleBrowserPane(force?: boolean): void {
    this.browserPaneOpen = typeof force === 'boolean' ? force : !this.browserPaneOpen
  }

}

export const plexState = new PlexState()
