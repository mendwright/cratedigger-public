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
  searchReleaseCandidates: invoke('mb:search-release-candidates'),
  searchArtistByName: invoke('mb:search-artist-by-name'),
  setAlbumMatch: invoke('plex:set-album-match'),
  clearAlbumMatch: invoke('plex:clear-album-match'),
  listOriginalYearOverrides: invoke('plex:list-original-year-overrides'),
  setOriginalYearOverride: invoke('plex:set-original-year-override'),
  clearOriginalYearOverride: invoke('plex:clear-original-year-override'),
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
  clearAlbumLabels: invoke('mb:clear-album-labels'),
  getAlbumLabelsBackup: invoke('mb:get-album-labels-backup'),
  restoreAlbumLabelsBackup: invoke('mb:restore-album-labels-backup'),
  fetchAlbumLabels: invoke('mb:fetch-album-labels'),
  listLabelAliases: invoke('mb:list-label-aliases'),
  setLabelAlias: invoke('mb:set-label-alias'),
  removeLabelAlias: invoke('mb:remove-label-alias'),
  onLabelIndexProgress: listen('mb:label-index-progress'),
  warmerProgress: invoke('warmer:progress'),
  startWarmer: invoke('warmer:start'),
  stopWarmer: invoke('warmer:stop'),
  onWarmerProgress: listen('warmer:progress'),
  releaseRadarSnapshot: invoke('releases:get-snapshot'),
  releaseRadarProgress: invoke('releases:get-progress'),
  refreshReleaseRadar: invoke('releases:refresh'),
  cancelReleaseRadar: invoke('releases:cancel'),
  getLyrics: invoke('lyrics:get'),
  listListenLater: invoke('listen-later:list'),
  addToListenLater: invoke('listen-later:add'),
  removeFromListenLater: invoke('listen-later:remove'),
  onReleaseRadarProgress: listen('releases:progress'),
  getAlbumCredits: invoke('mb:get-album-credits'),
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
  enqueue: invoke('slskd:enqueue'),
  listDownloads: invoke('slskd:list-downloads'),
  removeDownload: invoke('slskd:remove-download'),
  retryDownload: invoke('slskd:retry-download'),
  removeDownloadsBulk: invoke('slskd:remove-downloads-bulk'),
  retryDownloadsBulk: invoke('slskd:retry-downloads-bulk')
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
  }
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

interface AppInfo { version: string; isDev: boolean }
const appInfo = ipcRenderer.sendSync('app:get-info') as AppInfo

const api = {
  appInfo,
  plex,
  tagger,
  slskd,
  charts,
  shows,
  secretsFile,
  settings,
  win,
  mediaKeys,
  updates
}

contextBridge.exposeInMainWorld('cratedigger', api)

export type CratediggerApi = typeof api
