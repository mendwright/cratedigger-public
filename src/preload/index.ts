import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcEvents, IpcResult } from '../shared/ipc-contract.js'

// Bridge builders derived from the shared IPC contract
// (src/shared/ipc-contract.ts). `invoke(channel)` produces a function whose
// argument tuple and result type come straight from the contract entry, so a
// channel's types are declared exactly once. The nested grouping below
// (plex/tagger/slskd/…) is the frozen renderer-facing API.
const invoke =
  <C extends IpcChannel>(channel: C) =>
  (...args: IpcArgs<C>): Promise<IpcResult<C>> =>
    ipcRenderer.invoke(channel, ...args)

// Push (main → renderer) subscriptions. Returns an unsubscribe function.
const listen =
  <E extends keyof IpcEvents>(channel: E) =>
  (cb: (payload: IpcEvents[E]) => void): (() => void) => {
    const listener = (_e: unknown, payload: IpcEvents[E]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const plex = {
  getSession: invoke('plex:get-session'),
  startAuth: invoke('plex:start-auth'),
  cancelAuth: invoke('plex:cancel-auth'),
  signOut: invoke('plex:sign-out'),
  listAccounts: invoke('plex:list-accounts'),
  switchAccount: invoke('plex:switch-account'),
  listServers: invoke('plex:list-servers'),
  listPlayers: invoke('plex:list-players'),
  setPreferredServer: invoke('plex:set-preferred-server'),
  getServerContext: invoke('plex:get-server-context'),
  listMusicSections: invoke('plex:list-music-sections'),
  listAlbums: invoke('plex:list-albums'),
  getAlbumDetail: invoke('plex:get-album-detail'),
  getAlbumMediaInfo: invoke('plex:get-album-media-info'),
  castPlayAlbum: invoke('plex:cast-play-album'),
  castPlayTrack: invoke('plex:cast-play-track'),
  getTimeline: invoke('plex:get-timeline'),
  createLocalAlbumQueue: invoke('plex:create-local-album-queue'),
  createLocalTrackQueue: invoke('plex:create-local-track-queue'),
  getTrackStreamUrl: invoke('plex:get-track-stream-url'),
  transport: invoke('plex:transport'),
  setVolume: invoke('plex:set-volume'),
  playerSkipTo: invoke('plex:player-skip-to'),
  queueUpdate: invoke('plex:queue-update'),
  getPlayQueue: invoke('plex:get-play-queue'),
  extendQueueWithSimilar: invoke('plex:extend-queue-with-similar'),
  pickContinuation: invoke('plex:pick-continuation'),
  queueRemove: invoke('plex:queue-remove'),
  searchLibrary: invoke('plex:search-library'),
  listAllAlbums: invoke('plex:list-all-albums'),
  listLibraryArtistsWithGuids: invoke('plex:list-library-artists-with-guids'),
  getArtistCreditedWorks: invoke('mb:get-artist-credited-works'),
  getArtistDiscography: invoke('mb:get-artist-discography'),
  getLabelDiscography: invoke('mb:get-label-discography'),
  searchReleaseCandidates: invoke('mb:search-release-candidates'),
  searchArtistByName: invoke('mb:search-artist-by-name'),
  searchComposerByName: invoke('mb:search-composer-by-name'),
  findLpForTrack: invoke('mb:find-lp-for-track'),
  setAlbumMatch: invoke('plex:set-album-match'),
  clearAlbumMatch: invoke('plex:clear-album-match'),
  listOriginalYearOverrides: invoke('plex:list-original-year-overrides'),
  setOriginalYearOverride: invoke('plex:set-original-year-override'),
  clearOriginalYearOverride: invoke('plex:clear-original-year-override'),
  listComposerOverrides: invoke('plex:list-composer-overrides'),
  setComposerOverride: invoke('plex:set-composer-override'),
  clearComposerOverride: invoke('plex:clear-composer-override'),
  listCoverOverrides: invoke('art:list-cover-overrides'),
  searchCoverCandidates: invoke('art:search-covers'),
  setCoverOverride: invoke('art:set-cover-override'),
  clearCoverOverride: invoke('art:clear-cover-override'),
  uploadLocalCover: invoke('art:upload-local-cover'),
  deleteAlbum: invoke('plex:delete-album'),
  listDeletedAlbums: invoke('plex:list-deleted-albums'),
  listDupDismissals: invoke('plex:list-dup-dismissals'),
  addDupDismissal: invoke('plex:add-dup-dismissal'),
  removeDupDismissal: invoke('plex:remove-dup-dismissal'),
  listReviewedAlbums: invoke('plex:list-reviewed-albums'),
  setReviewedAlbum: invoke('plex:set-reviewed-album'),
  clearReviewedAlbum: invoke('plex:clear-reviewed-album'),
  getReleaseTrackCount: invoke('mb:get-release-track-count'),
  listReleaseTrackCounts: invoke('mb:list-release-track-counts'),
  listAlbumLabels: invoke('mb:list-album-labels'),
  labelIndexProgress: invoke('mb:label-index-progress'),
  startLabelIndex: invoke('mb:start-label-index'),
  stopLabelIndex: invoke('mb:stop-label-index'),
  listAlbumGenres: invoke('mb:list-album-genres'),
  genreIndexProgress: invoke('mb:genre-index-progress'),
  startGenreIndex: invoke('mb:start-genre-index'),
  stopGenreIndex: invoke('mb:stop-genre-index'),
  clearAlbumGenres: invoke('mb:clear-album-genres'),
  clearAlbumLabels: invoke('mb:clear-album-labels'),
  getAlbumLabelsBackup: invoke('mb:get-album-labels-backup'),
  restoreAlbumLabelsBackup: invoke('mb:restore-album-labels-backup'),
  fetchAlbumLabels: invoke('mb:fetch-album-labels'),
  listLabelAliases: invoke('mb:list-label-aliases'),
  setLabelAlias: invoke('mb:set-label-alias'),
  removeLabelAlias: invoke('mb:remove-label-alias'),
  onLabelIndexProgress: listen('mb:label-index-progress'),
  onGenreIndexProgress: listen('mb:genre-index-progress'),
  warmerProgress: invoke('warmer:progress'),
  startWarmer: invoke('warmer:start'),
  stopWarmer: invoke('warmer:stop'),
  onWarmerProgress: listen('warmer:progress'),
  onAlbumEnriched: listen('warmer:album-enriched'),
  releaseRadarSnapshot: invoke('releases:get-snapshot'),
  releaseRadarProgress: invoke('releases:get-progress'),
  refreshReleaseRadar: invoke('releases:refresh'),
  cancelReleaseRadar: invoke('releases:cancel'),
  artFixListQueue: invoke('artfix:list-queue'),
  artFixScan: invoke('artfix:scan'),
  artFixScanProgress: invoke('artfix:scan-progress'),
  artFixCancelScan: invoke('artfix:cancel-scan'),
  artFixGetCandidates: invoke('artfix:get-candidates'),
  artFixAccept: invoke('artfix:accept'),
  artFixSkip: invoke('artfix:skip'),
  artFixRevertLast: invoke('artfix:revert-last'),
  onArtFixScanProgress: listen('artfix:scan-progress'),
  listPlaylists: invoke('plex:list-playlists'),
  getPlaylistItems: invoke('plex:get-playlist-items'),
  createPlaylist: invoke('plex:create-playlist'),
  deletePlaylist: invoke('plex:delete-playlist'),
  renamePlaylist: invoke('plex:rename-playlist'),
  playlistAdd: invoke('plex:playlist-add'),
  playlistRemoveItem: invoke('plex:playlist-remove-item'),
  playlistMoveItem: invoke('plex:playlist-move-item'),
  castPlaylist: invoke('plex:cast-playlist'),
  createLocalPlaylistQueue: invoke('plex:create-local-playlist-queue'),
  getSmartPlaylistDefs: invoke('playlists:get-smart-defs'),
  setSmartPlaylistDefs: invoke('playlists:set-smart-defs'),
  syncSmartPlaylist: invoke('playlists:sync-smart'),
  mirrorStatus: invoke('mirror:status'),
  mirrorStartAuth: invoke('mirror:start-auth'),
  mirrorCancelAuth: invoke('mirror:cancel-auth'),
  mirrorDisconnect: invoke('mirror:disconnect'),
  mirrorSync: invoke('mirror:sync'),
  mirrorSyncAll: invoke('mirror:sync-all'),
  mirrorUnsync: invoke('mirror:unsync'),
  getLyrics: invoke('lyrics:get'),
  listListenLater: invoke('listen-later:list'),
  addToListenLater: invoke('listen-later:add'),
  removeFromListenLater: invoke('listen-later:remove'),
  onReleaseRadarProgress: listen('releases:progress'),
  getAlbumCredits: invoke('mb:get-album-credits'),
  getClassicalCatalog: invoke('mb:get-classical-catalog'),
  getArtistInfo: invoke('mb:get-artist-info'),
  getInLibraryAppearances: invoke('mb:get-in-library-appearances'),
  getArtistRelations: invoke('mb:get-artist-relations'),
  listSimilarArtists: invoke('plex:list-similar-artists'),
  listMoods: invoke('plex:list-moods'),
  castMood: invoke('plex:cast-mood'),
  getAlbumBio: invoke('bios:get-album-bio'),
  getArtistBio: invoke('bios:get-artist-bio'),
  getBooklet: invoke('caa:get-booklet'),
  browseArtist: invoke('plex:browse-artist'),
  onAuthProgress: listen('plex:auth-progress')
}

const classical = {
  getHome: invoke('classical:get-home'),
  syncOwnedAlbums: invoke('classical:sync-owned-albums'),
  search: invoke('classical:search'),
  getComposer: invoke('classical:get-composer'),
  getWork: invoke('classical:get-work'),
  getAgent: invoke('classical:get-agent'),
  getRecording: invoke('classical:get-recording'),
  getRelease: invoke('classical:get-release'),
  getSyncStatus: invoke('classical:get-sync-status'),
  pauseSync: invoke('classical:pause-sync'),
  resumeSync: invoke('classical:resume-sync'),
  retrySync: invoke('classical:retry-sync'),
  refreshSources: invoke('classical:refresh-sources'),
  onSyncProgress: listen('classical:sync-progress'),
  onCatalogChanged: listen('classical:catalog-changed'),
  listReviewCandidates: invoke('classical:list-review-candidates'),
  applyCorrection: invoke('classical:apply-correction'),
  undoCorrection: invoke('classical:undo-correction'),
  exportCorrections: invoke('classical:export-corrections'),
  importCorrections: invoke('classical:import-corrections')
}

const kiosk = {
  pushTheme: invoke('kiosk:push-theme')
}

const tagger = {
  getUrl: invoke('tagger:get-url'),
  setUrl: invoke('tagger:set-url'),
  health: invoke('tagger:health'),
  listInbox: invoke('tagger:list-inbox'),
  getFolder: invoke('tagger:get-folder'),
  getRelease: invoke('tagger:get-release'),
  apply: invoke('tagger:apply'),
  retag: invoke('tagger:retag'),
  auditMusic: invoke('tagger:audit-music'),
  mergeInboxIntoAlbum: invoke('tagger:merge-inbox-into-album'),
  refreshPlex: invoke('tagger:refresh-plex'),
  deleteFolder: invoke('tagger:delete-folder'),
  deleteFiles: invoke('tagger:delete-files'),
  applySingle: invoke('tagger:apply-single'),
  acousticDedupe: invoke('tagger:acoustic-dedupe'),
  prefingerprint: invoke('tagger:prefingerprint')
}

const settings = {
  get: invoke('settings:get'),
  set: invoke('settings:set')
}

const slskd = {
  getConfig: invoke('slskd:get-config'),
  setConfig: invoke('slskd:set-config'),
  health: invoke('slskd:health'),
  search: invoke('slskd:search'),
  listSuccessfulPeers: invoke('slskd:list-successful-peers'),
  browseUser: invoke('slskd:browse-user'),
  enqueue: invoke('slskd:enqueue'),
  listDownloads: invoke('slskd:list-downloads'),
  removeDownload: invoke('slskd:remove-download'),
  retryDownload: invoke('slskd:retry-download'),
  removeDownloadsBulk: invoke('slskd:remove-downloads-bulk'),
  retryDownloadsBulk: invoke('slskd:retry-downloads-bulk'),
  // Fires when the background sweeper gave failed transfers their one automatic
  // retry, so the UI can say so and refresh the list.
  onAutoRetried: listen('slskd:auto-retried')
}

const win = {
  toggleFullScreen: invoke('window:toggle-fullscreen'),
  setBackground: invoke('window:set-background')
}

const updates = {
  getState: invoke('updates:get-state'),
  check: invoke('updates:check'),
  installAndRestart: invoke('updates:install-and-restart'),
  onState: listen('updates:state')
}

const mediaKeys = {
  setMetadata: invoke('media-keys:set-metadata'),
  onCommand: listen('media-keys:command')
}

const appleMusic = {
  listPlaylists: invoke('apple-music:list-playlists'),
  getPlaylistTracks: invoke('apple-music:get-playlist-tracks')
}

const spotify = {
  status: invoke('spotify:status'),
  setClientId: invoke('spotify:set-client-id'),
  connect: invoke('spotify:connect'),
  disconnect: invoke('spotify:disconnect'),
  listPlaylists: invoke('spotify:list-playlists'),
  getPlaylistTracks: invoke('spotify:get-playlist-tracks'),
  getImportReports: invoke('spotify:get-import-reports'),
  setImportReports: invoke('spotify:set-import-reports'),
  pickImportFolder: invoke('spotify:pick-import-folder'),
  loadImportFolder: invoke('spotify:load-import-folder')
}

const mini = {
  toggle: invoke('mini:toggle'),
  pushState: invoke('mini:push-state'),
  sendCommand: invoke('mini:command'),
  focusMain: invoke('mini:focus-main'),
  onState: listen('mini:state'),
  onOpenChanged: listen('mini:open-changed')
}

const shows = {
  listVenues: invoke('shows:list-venues'),
  fetchVenue: invoke('shows:fetch-venue'),
  reportMatches: invoke('shows:report-matches'),
  // Show ids announced within the recency window — the Shows screen badges
  // these rows "just announced".
  listRecentNotified: invoke('shows:list-recent-notified'),
  // Pinned / tickets-bought marks, keyed by stable VenueShow id.
  listMarks: invoke('shows:list-marks'),
  setMark: invoke('shows:set-mark'),
  // Fires when the user clicks a "library artist announced" native notification.
  // Hand-written: payload-less event, not part of the IpcEvents payload map.
  onOpenFromNotification: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('shows:open-from-notification', listener)
    return () => ipcRenderer.removeListener('shows:open-from-notification', listener)
  },
  // Fires after a roaming sync pulled another machine's show-mark /
  // Listen Later changes into this one.
  onRoamingChanged: listen('roaming:changed')
}

const charts = {
  getConfig: invoke('charts:get-config'),
  setConfig: invoke('charts:set-config'),
  health: invoke('charts:health'),
  users: invoke('charts:users'),
  top: invoke('charts:top')
}

const secretsFile = {
  revealBackupFile: invoke('secrets:reveal-backup-file'),
  getBackupPath: invoke('secrets:get-backup-path'),
  backUpCurrentKeys: invoke('secrets:back-up-current-keys')
}

const deepLinks = {
  onSoulseekSearch: listen('deeplink:soulseek-search'),
  // Announce the renderer is subscribed; main flushes any link that arrived
  // during launch. Hand-written: fire-and-forget send, not in the contract.
  ready: (): void => ipcRenderer.send('deeplink:ready')
}

interface AppInfo { version: string; isDev: boolean }
const appInfo = ipcRenderer.sendSync('app:get-info') as AppInfo

const api = {
  appInfo,
  plex,
  classical,
  tagger,
  kiosk,
  slskd,
  charts,
  shows,
  secretsFile,
  settings,
  win,
  mediaKeys,
  mini,
  spotify,
  appleMusic,
  updates,
  deepLinks
}

contextBridge.exposeInMainWorld('cratedigger', api)

export type CratediggerApi = typeof api
