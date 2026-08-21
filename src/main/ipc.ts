import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { AuthFlow, verifyUser } from './plex/pin-auth.js'
import {
  mirrorStatus,
  connectMirror,
  disconnectMirror,
  mirrorPlaylist,
  mirrorAllPlaylists,
  unmirrorPlaylist
} from './plex/mirror.js'
import { listServers, listPlayers } from './plex/resources.js'
import {
  resolveServerContext,
  resolvePlayerContext,
  clearServerContextCache,
  invalidatePlayerContext
} from './plex/connection.js'
import { plexFetchErrorKind } from './plex/http.js'
import {
  listMusicSections,
  listAlbums,
  listAllAlbums,
  listAllArtistsWithGuids,
  getAlbumDetail,
  getAlbumMediaInfo,
  getAlbumTrackFiles,
  getTrackStreamUrl,
  mergePlexAlbums,
  refreshAlbumMetadata,
  searchArtists,
  listArtistAlbums,
  listSimilarArtists,
  listMoods,
  searchLibrary
} from './plex/library.js'
import {
  fetchArtistReleaseGroups,
  getAlbumCreditsCached,
  getArtistInfo,
  getArtistCreditedWorks,
  getArtistReleaseGroupsCached,
  getArtistRelations,
  searchReleaseCandidates,
  fetchLabelDiscography,
  getLabelDiscographyCached,
  searchArtistByName,
  searchComposerByName,
  findLpForTrack,
  invalidateAlbumCredits,
  getReleaseTrackCount,
  getReleaseLabels,
  overlayOriginalYears
} from './musicbrainz.js'
import { originalYears } from './original-years.js'
import { librarySnapshot, snapshotKey } from './library-snapshot.js'
import { isValidMbid } from '../shared/guid.js'
import { startLabelIndex, stopLabelIndex, getLabelIndexProgress } from './label-index.js'
import {
  getGenreIndexProgress,
  startGenreIndex,
  stopGenreIndex,
  clearAlbumGenres
} from './genre-index.js'
import {
  startLibraryWarmer,
  stopLibraryWarmer,
  getLibraryWarmerProgress
} from './library-warmer.js'
import {
  playAlbumOnPlayer,
  playTrackOnPlayer,
  playMoodOnPlayer,
  addToPlayQueue,
  insertIntoPlayQueueAfterItem,
  getPlayQueue,
  removeFromPlayQueue,
  refreshPlayQueueReliable,
  extendQueueWithSimilarAlbum,
  pickContinuationAlbum,
  createAlbumPlayQueue,
  createTrackPlayQueue,
  playPlaylistOnPlayer,
  createLocalPlaylistQueue
} from './plex/cast.js'
import {
  getMusicTimelineForPlayer,
  pause as pausePlayer,
  resume as resumePlayer,
  skipNext as skipNextPlayer,
  skipPrevious as skipPrevPlayer,
  seekTo as seekPlayer,
  setVolume as setVolumePlayer,
  skipToQueueItem as skipToQueueItemPlayer
} from './plex/playback.js'
import {
  getValue,
  setValue,
  getFromRecord,
  patchRecord,
  deleteFromRecord,
  getAuthToken,
  setAuthToken,
  listAccountInfos,
  getActiveAccountId,
  getAccountInfo,
  upsertAccount,
  activateAccount,
  removeAccount,
  syncActiveAccountIdentity,
  saveActiveServerId,
  getAlbumMatch,
  setAlbumMatch,
  clearAlbumMatch,
  getTaggerUrl,
  setTaggerUrl,
  getTaggerApiKey,
  setTaggerApiKey,
  getLastfmApiKey,
  setLastfmApiKey,
  getTicketmasterApiKey,
  setTicketmasterApiKey,
  getGeniusClientId,
  setGeniusClientId,
  getGeniusClientSecret,
  setGeniusClientSecret,
  getPlexAdminToken,
  setPlexAdminToken,
  // (secrets-file IPC below uses ensureBackupFileExists)
  addDupDismissal,
  removeDupDismissal,
  setReviewedAlbum,
  clearAlbumLabels,
  restoreAlbumLabelsBackup,
  setLabelAlias,
  getContinuationMode,
  listRecentlyNotifiedShowIds,
  listShowMarks,
  setShowMark,
  addToListenLater,
  removeFromListenLater,
  listListenLater,
  listRadioHistory,
  recordRadioPick
} from './store.js'
import { scheduleRoamingPush, startRoamingSync } from './roaming-sync.js'
import { getAlbumBio, getArtistBio } from './bios.js'
import { checkNow, getUpdateState, installAndRestart } from './updates.js'
import { getBookletImages, getReleaseFrontCovers } from './coverart.js'
import { searchITunesAlbumCovers } from './itunes.js'
import { saveLocalCover, deleteLocalCover, readLocalCover } from './cover-store.js'
import { CRATEDIGGER_COVER_SCHEME } from './imageProxy.js'
import {
  getReleaseRadarProgress,
  runReleaseRadar,
  stopReleaseRadar
} from './release-radar.js'
import {
  listArtFixQueue,
  scanArtFixQueue,
  getArtFixScanProgress,
  cancelArtFixScan,
  getArtFixCandidates,
  acceptArtFix,
  skipArtFix,
  revertLastArtFix,
  pushCoverToPlex
} from './art-fix.js'
import { getTrackLyrics } from './lyrics.js'
import { fetchVenueShows, listVenues } from './venues/index.js'
import { reportShowMatches } from './shows-notify.js'
import { getInLibraryAppearances } from './credit-index.js'
import { getClassicalCatalog } from './classical-catalog.js'
import {
  applyClassicalCorrection,
  getClassicalComposer,
  getClassicalAgent,
  getClassicalHome,
  getClassicalSyncStatus,
  getClassicalWork,
  getClassicalRecording,
  getClassicalRelease,
  exportClassicalCorrections,
  importClassicalCorrections,
  listClassicalReviewCandidates,
  pauseClassicalSync,
  resumeClassicalSync,
  retryClassicalSync,
  refreshClassicalSources,
  searchClassical,
  syncClassicalOwnedAlbums,
  undoClassicalCorrection
} from './classical/service.js'
import { ensureBackupFileExists, SECRETS_BACKUP_PATH, backUpCurrentKeysToFile } from './secrets-file.js'
import { setMediaMetadata } from './media-keys.js'
import { toggleMiniPlayer, pushMiniState, focusMainWindow } from './mini-player.js'
import { appleMusicListPlaylists, appleMusicGetPlaylistTracks } from './apple-music.js'
import {
  spotifyConnect,
  spotifyDisconnect,
  spotifyStatus,
  spotifyListPlaylists,
  spotifyGetPlaylistTracks,
  spotifyPickImportFolder,
  spotifyLoadImportFolder
} from './spotify.js'
import {
  listPlaylists,
  getPlaylistItems,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  addToPlaylist,
  removePlaylistItem,
  movePlaylistItem,
  syncSmartPlaylist
} from './plex/playlists.js'
import {
  taggerHealth,
  listInbox,
  getInboxFolder,
  getMbRelease,
  applyRelease,
  retagAlbums,
  auditMusic,
  refreshPlex,
  deleteInboxFolder,
  acousticDedupeInbox,
  prefingerprintInbox,
  deleteInboxFiles,
  applySingle
} from './tagger.js'
import {
  slskdHealth,
  searchAndWait,
  enqueueDownload,
  browseUser,
  listDownloads,
  removeDownload,
  retryDownload
} from './slskd.js'
import {
  beginAcquisition,
  failEnqueue,
  finishEnqueue,
  reconcileAcquisitions,
  listSuccessfulPeers,
  recordImport
} from './acquisitions.js'
import {
  getSlskdUrl,
  setSlskdUrl,
  getSlskdApiKey,
  setSlskdApiKey,
  setSpotifyClientId
} from './store.js'
import { syncAlbumMatchAfterTaggerWrite } from './album-match-sync.js'
import type { AuthProgress, CoverOverride, PlayerContext, PlexUser } from '../shared/plex.js'
import type { IpcArgs, IpcChannel, IpcResult } from '../shared/ipc-contract.js'
import { PUBLIC_BUILD } from '../shared/build-flags.js'
import { tautulliHealth, getChartUsers, getTopChart, clearTautulliCaches } from './tautulli.js'
import { snapshotUsers, snapshotTop } from './charts-snapshot.js'
import {
  getTautulliUrl,
  setTautulliUrl,
  getTautulliApiKey,
  setTautulliApiKey
} from './store.js'
import { isHttpUrl } from '../shared/urls.js'

function wrapErr(err: unknown): Error {
  return new Error(err instanceof Error ? err.message : String(err))
}

// Typed registration against the shared IPC contract (src/shared/ipc-contract.ts).
// Every handler's args + result are checked against the contract entry, and any
// thrown error — handler-internal validation included — is uniformly re-wrapped
// as `new Error(message)` so arbitrary error types never hit Electron's
// structured clone ("An object could not be cloned").
type IpcHandler<C extends IpcChannel> = (
  e: Electron.IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

function register<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...(args as IpcArgs<C>))
    } catch (err) {
      throw wrapErr(err)
    }
  })
}

// After the tagger writes MBID tags into an existing library album's files,
// bring the store-backed manual override + credit cache into agreement.
// Never throws — file tags are already committed; a sync hiccup must not
// turn a succeeded retag into an IPC error.
function syncAlbumMatchForTaggerWrite(plexRatingKey: string, mbid: string): Promise<void> {
  return syncAlbumMatchAfterTaggerWrite(plexRatingKey, mbid, {
    getAlbumMatch,
    setAlbumMatch,
    invalidateAlbumCredits
  })
}

import { deleteAlbum } from './operations/album-ops.js'

let activeFlow: AuthFlow | null = null
let activeMirrorFlow: AuthFlow | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  // Seed the in-memory original-year override map from electron-store so the
  // very first list/grid call overlays pinned years without waiting on the
  // renderer to send them back.
  originalYears.loadOverrides(getValue('originalYearOverrides'))

  // Synchronous so the preload bridge can read it at module-eval time and
  // expose it as plain data; the renderer reads window.cratedigger.appInfo
  // without an async round-trip. Hand-registered: sendSync/returnValue is a
  // different mechanism from the invoke/handle contract.
  ipcMain.on('app:get-info', (e) => {
    e.returnValue = { version: app.getVersion(), isDev: !app.isPackaged }
  })

  register('plex:get-session', async () => {
    const token = getAuthToken()
    if (!token) return { signedIn: false as const }
    let res = await verifyUser(token)
    if (!res.ok && res.authFailed) {
      // plex.tv has 401'd valid tokens during outages (2026-07-22 wiped a real
      // session). Confirm the rejection on a second attempt before believing it.
      await new Promise((r) => setTimeout(r, 2500))
      res = await verifyUser(token)
    }
    if (res.ok) {
      syncActiveAccountIdentity(res.user)
      return { signedIn: true as const, user: res.user, preferredServerId: getValue('preferredServerId') }
    }
    if (res.authFailed) {
      // Even a confirmed rejection doesn't destroy the token: a revoked token
      // re-prompts sign-in anyway, while a plex.tv incident lying twice would
      // otherwise cost the user their session. Name who needs to re-auth.
      const activeId = getActiveAccountId()
      const info = activeId ? getAccountInfo(activeId) : null
      return {
        signedIn: false as const,
        ...(info?.username ? { stale: { username: info.username, email: info.email } } : {})
      }
    }
    // Transient failure (5xx from plex.tv, DNS, offline). Keep the token and
    // stay signed-in with a stub user — a plex.tv outage shouldn't kick the
    // user to the sign-in screen. The username field will fill in once a
    // later call succeeds.
    const stubUser: PlexUser = { id: 0, uuid: '', username: '', email: '', title: '', thumb: null }
    return {
      signedIn: true as const,
      user: stubUser,
      preferredServerId: getValue('preferredServerId')
    }
  })

  register('plex:start-auth', async () => {
    if (activeFlow) activeFlow.cancel()
    activeFlow = new AuthFlow()
    const flow = activeFlow
    const emit = (p: AuthProgress): void => broadcast('plex:auth-progress', p)
    try {
      const { token, user } = await flow.run(emit)
      upsertAccount(
        { id: user.uuid, username: user.username, email: user.email, thumb: user.thumb },
        token
      )
      clearServerContextCache()
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit({ stage: 'error', message })
      return { ok: false as const, message }
    } finally {
      if (activeFlow === flow) activeFlow = null
    }
  })

  register('plex:cancel-auth', () => {
    activeFlow?.cancel()
    activeFlow = null
    return { ok: true as const }
  })

  register('plex:sign-out', () => {
    // Sign-out removes the active account from the roster (its token dies with
    // it) and falls through to the next stored account if there is one.
    const activeId = getActiveAccountId()
    if (activeId) {
      removeAccount(activeId)
    } else {
      setAuthToken(null)
      setValue('preferredServerId', null)
    }
    clearServerContextCache()
    // The persisted library snapshot belongs to the account that just left —
    // never serve it to whoever signs in next.
    void librarySnapshot.clear()
    return { ok: true as const }
  })

  register('plex:list-accounts', () => {
    const activeId = getActiveAccountId()
    return listAccountInfos().map((a) => ({ ...a, active: a.id === activeId }))
  })

  register('plex:switch-account', (_e, id) => {
    if (id === getActiveAccountId()) return { ok: true as const }
    if (!activateAccount(id)) return { ok: false as const, message: 'Unknown account' }
    clearServerContextCache()
    return { ok: true as const }
  })

  register('plex:list-servers', async () => {
    const token = getAuthToken()
    if (!token) throw new Error('Not signed in')
    return await listServers(token)
  })

  register('plex:list-players', async () => {
    const token = getAuthToken()
    if (!token) throw new Error('Not signed in')
    return await listPlayers(token)
  })

  register('plex:set-preferred-server', (_e, id) => {
    setValue('preferredServerId', id)
    saveActiveServerId()
    return { ok: true as const }
  })

  register('plex:get-server-context', async (_e, id) => {
    return await resolveServerContext(id)
  })

  register('plex:list-music-sections', async (_e, id) => {
    const ctx = await resolveServerContext(id)
    return await listMusicSections(ctx)
  })

  register('plex:list-albums', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    const page = await listAlbums(
      ctx,
      args.sectionKey,
      args.offset ?? 0,
      args.size ?? 200,
      args.sort,
      args.filters ?? {},
      args.seed
    )
    await overlayOriginalYears(page.albums)
    return page
  })

  register('plex:get-album-detail', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    return await getAlbumDetail(ctx, args.ratingKey)
  })

  register('plex:get-album-media-info', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    return await getAlbumMediaInfo(ctx, args.ratingKey)
  })

  register('plex:cast-play-album', async (_e, args) => {
    const [server, player] = await Promise.all([
      resolveServerContext(args.serverId),
      resolvePlayerContext(args.playerId)
    ])
    const playQueueId = await playAlbumOnPlayer(
      server,
      player,
      args.ratingKey,
      args.startTrackRatingKey,
      getContinuationMode() === 'radio'
    )
    return {
      ok: true as const,
      player: { id: player.id, name: player.name },
      playQueueId
    }
  })

  register('plex:cast-play-track', async (_e, args) => {
    const [server, player] = await Promise.all([
      resolveServerContext(args.serverId),
      resolvePlayerContext(args.playerId)
    ])
    const playQueueId = await playTrackOnPlayer(
      server,
      player,
      args.ratingKey,
      getContinuationMode() === 'radio'
    )
    return {
      ok: true as const,
      player: { id: player.id, name: player.name },
      playQueueId
    }
  })

  register('plex:get-timeline', async (_e, args) => {
    try {
      const [server, player] = await Promise.all([
        resolveServerContext(args.serverId),
        resolvePlayerContext(args.playerId)
      ])
      return await getMusicTimelineForPlayer(server, player)
    } catch (err) {
      // Only evict the cached context when the player is genuinely
      // unreachable (stale LAN IP, network blip) so the next poll re-probes
      // and follows its current address. A *timeout* is usually transient —
      // Plexamp holding the poll connection open through a track transition —
      // and re-probing on every such hiccup just compounds the lag, so leave
      // the cached connection in place and let the next 2.5s poll retry it.
      if (plexFetchErrorKind(err) !== 'timeout') {
        invalidatePlayerContext(args.playerId)
      }
      throw err
    }
  })

  register('plex:list-playlists', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await listPlaylists(server)
  })

  register('plex:get-playlist-items', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await getPlaylistItems(server, args.ratingKey)
  })

  register('plex:create-playlist', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await createPlaylist(server, args.title, args.itemRatingKeys)
  })

  register('plex:delete-playlist', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await deletePlaylist(server, args.ratingKey)
    return { ok: true as const }
  })

  register('plex:rename-playlist', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await renamePlaylist(server, args.ratingKey, args.title)
    return { ok: true as const }
  })

  register('plex:playlist-add', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await addToPlaylist(server, args.ratingKey, args.itemRatingKeys)
    return { ok: true as const }
  })

  register('plex:playlist-remove-item', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await removePlaylistItem(server, args.ratingKey, args.playlistItemID)
    return { ok: true as const }
  })

  register('plex:playlist-move-item', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await movePlaylistItem(server, args.ratingKey, args.playlistItemID, args.afterItemID)
    return { ok: true as const }
  })

  register('plex:cast-playlist', async (_e, args) => {
    const [server, player] = await Promise.all([
      resolveServerContext(args.serverId),
      resolvePlayerContext(args.playerId)
    ])
    const playQueueId = await playPlaylistOnPlayer(server, player, args.ratingKey, args.shuffle)
    return { ok: true as const, player: { id: player.id, name: player.name }, playQueueId }
  })

  register('plex:create-local-playlist-queue', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    const playQueueId = await createLocalPlaylistQueue(server, args.ratingKey, args.shuffle)
    return { ok: true as const, playQueueId }
  })

  register('apple-music:list-playlists', async () => await appleMusicListPlaylists())
  register('apple-music:get-playlist-tracks', async (_e, args) => {
    return await appleMusicGetPlaylistTracks(args.id)
  })

  register('spotify:status', () => spotifyStatus())
  register('spotify:set-client-id', (_e, id) => {
    setSpotifyClientId(id)
    return { ok: true as const }
  })
  register('spotify:connect', async () => {
    await spotifyConnect()
    return { ok: true as const }
  })
  register('spotify:disconnect', () => {
    spotifyDisconnect()
    return { ok: true as const }
  })
  register('spotify:list-playlists', async () => await spotifyListPlaylists())
  register('spotify:get-playlist-tracks', async (_e, args) => {
    return await spotifyGetPlaylistTracks(args.id)
  })
  register('spotify:pick-import-folder', async () => await spotifyPickImportFolder())
  register('spotify:load-import-folder', () => spotifyLoadImportFolder())
  register('spotify:get-import-reports', () => getValue('spotifyImports'))
  register('spotify:set-import-reports', (_e, reports) => {
    setValue('spotifyImports', reports)
    return { ok: true as const }
  })

  register('mirror:status', () => mirrorStatus())
  register('mirror:start-auth', async () => {
    if (activeMirrorFlow) activeMirrorFlow.cancel()
    activeMirrorFlow = new AuthFlow()
    const flow = activeMirrorFlow
    try {
      // The PIN flow opens the claim page in the default browser; the user
      // signs in there as the account to mirror to. No progress UI needed —
      // the renderer button just shows "waiting…" until this resolves.
      const { token } = await flow.run(() => {})
      const status = await connectMirror(token)
      return { ok: true as const, account: status.account }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
    } finally {
      if (activeMirrorFlow === flow) activeMirrorFlow = null
    }
  })
  register('mirror:cancel-auth', () => {
    activeMirrorFlow?.cancel()
    activeMirrorFlow = null
    return { ok: true as const }
  })
  register('mirror:disconnect', () => {
    disconnectMirror()
    return { ok: true as const }
  })
  register('mirror:sync', async (_e, args) => {
    return await mirrorPlaylist(args.serverId, args.ratingKey, args.title)
  })
  register('mirror:sync-all', async (_e, args) => {
    return await mirrorAllPlaylists(args.serverId)
  })
  register('mirror:unsync', async (_e, args) => {
    await unmirrorPlaylist(args.serverId, args.ratingKey)
    return { ok: true as const }
  })

  register('playlists:get-smart-defs', () => getValue('smartPlaylists'))
  register('playlists:set-smart-defs', (_e, defs) => {
    setValue('smartPlaylists', defs)
    return { ok: true as const }
  })

  register('playlists:sync-smart', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    const plexRatingKey = await syncSmartPlaylist(
      server,
      args.plexRatingKey,
      args.title,
      args.albumRatingKeys
    )
    return { plexRatingKey }
  })

  register('plex:create-local-album-queue', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    const playQueueId = await createAlbumPlayQueue(
      server,
      args.ratingKey,
      args.startTrackRatingKey,
      getContinuationMode() === 'radio'
    )
    return { ok: true as const, playQueueId }
  })

  register('plex:create-local-track-queue', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    const playQueueId = await createTrackPlayQueue(
      server,
      args.ratingKey,
      getContinuationMode() === 'radio'
    )
    return { ok: true as const, playQueueId }
  })

  register('plex:get-track-stream-url', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    const url = await getTrackStreamUrl(server, args.ratingKey)
    return { url }
  })

  register('mb:get-album-credits', async (_e, args) => {
    return await getAlbumCreditsCached(
      args.ratingKey,
      args.artist,
      args.title,
      args.year,
      args.guids,
      args.tracks
    )
  })

  register('mb:get-classical-catalog', async () => await getClassicalCatalog())
  register('classical:get-home', async () => await getClassicalHome())
  register('classical:sync-owned-albums', async (_e, args) => await syncClassicalOwnedAlbums(args.albums))
  register('classical:search', async (_e, args) => await searchClassical(args))
  register('classical:get-composer', async (_e, args) => await getClassicalComposer(args.id))
  register('classical:get-work', async (_e, args) => await getClassicalWork(args.id))
  register('classical:get-agent', async (_e, args) => await getClassicalAgent(args.id))
  register('classical:get-recording', async (_e, args) => await getClassicalRecording(args.id))
  register('classical:get-release', async (_e, args) => await getClassicalRelease(args.id))
  register('classical:get-sync-status', async () => await getClassicalSyncStatus())
  register('classical:pause-sync', async () => await pauseClassicalSync())
  register('classical:resume-sync', async () => await resumeClassicalSync())
  register('classical:retry-sync', async () => await retryClassicalSync())
  register('classical:refresh-sources', async () => await refreshClassicalSources())
  register('classical:list-review-candidates', async (_e, args) => await listClassicalReviewCandidates(args?.limit))
  register('classical:apply-correction', async (_e, args) => await applyClassicalCorrection(args.command))
  register('classical:undo-correction', async (_e, args) => await undoClassicalCorrection(args.id))
  register('classical:export-corrections', async () => await exportClassicalCorrections())
  register('classical:import-corrections', async (_e, args) => await importClassicalCorrections(args.document))

  register('mb:get-artist-info', async (_e, args) => {
    return await getArtistInfo(args.mbid)
  })

  register('mb:get-in-library-appearances', async (_e, args) => {
    return await getInLibraryAppearances(args.mbid)
  })

  register('mb:get-artist-relations', async (_e, args) => {
    return await getArtistRelations(args.mbid)
  })

  register('plex:list-similar-artists', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    return await listSimilarArtists(ctx, args.artistRatingKey)
  })

  register('plex:list-moods', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    return await listMoods(ctx, args.sectionKey)
  })

  register('plex:cast-mood', async (_e, args) => {
    const [server, player] = await Promise.all([
      resolveServerContext(args.serverId),
      resolvePlayerContext(args.playerId)
    ])
    const playQueueId = await playMoodOnPlayer(server, player, args.sectionKey, args.moodId)
    return {
      ok: true as const,
      player: { id: player.id, name: player.name },
      playQueueId
    }
  })

  register('plex:browse-artist', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    const matches = await searchArtists(ctx, args.name)
    // Plex splits an artist into multiple entries when one album's tags diverge
    // (a badly-tagged bootleg is enough). Merge albums across every exact-name
    // match so the entity page sees the whole discography, not just whichever
    // entry the search returns first.
    const exact = matches.filter((m) => m.title.toLowerCase() === args.name.toLowerCase())
    const candidates = exact.length > 0 ? exact : matches.slice(0, 1)
    const albums: Awaited<ReturnType<typeof listArtistAlbums>> = []
    const seen = new Set<string>()
    let plexArtist: (typeof matches)[number] | null = null
    let plexArtistAlbumCount = -1
    for (const artist of candidates) {
      let own: Awaited<ReturnType<typeof listArtistAlbums>> = []
      try {
        own = await listArtistAlbums(ctx, artist.ratingKey)
      } catch {
        own = []
      }
      // The entry with the most albums is the "real" one — its thumb/summary
      // and ratingKey (similar-artists lookups) are the best-maintained.
      if (own.length > plexArtistAlbumCount) {
        plexArtist = artist
        plexArtistAlbumCount = own.length
      }
      for (const album of own) {
        if (seen.has(album.ratingKey)) continue
        seen.add(album.ratingKey)
        albums.push(album)
      }
    }
    if (albums.length > 0) {
      try {
        await overlayOriginalYears(albums)
      } catch {
        // original-year overlay is cosmetic — never fail the browse over it
      }
    }
    return {
      mbid: args.mbid,
      name: args.name,
      plexArtist,
      albums
    }
  })

  // A player command that fails against the cached address should heal itself:
  // evict the context and retry once against a fresh resolve, which re-probes
  // the player's currently-registered connections. Without this, a player whose
  // preferred LAN address went unroutable (moved networks, new DHCP lease)
  // stays wedged forever once the timeline poll stops — the poll's own
  // invalidation never runs again, and transport taps just keep dying against
  // the dead address (2026-07-22: pause unreachable while the Pi played on,
  // fixed only by hand-driving the companion API over Tailscale). Response
  // timeouts stay single-shot — see plex:get-timeline for why re-probing on
  // those compounds the lag.
  async function withPlayerRetry<T>(
    playerId: string,
    run: (player: PlayerContext) => Promise<T>
  ): Promise<T> {
    const player = await resolvePlayerContext(playerId)
    try {
      return await run(player)
    } catch (err) {
      if (plexFetchErrorKind(err) === 'timeout') throw err
      invalidatePlayerContext(playerId)
      return await run(await resolvePlayerContext(playerId))
    }
  }

  register('plex:transport', async (_e, args) => {
    await withPlayerRetry(args.playerId, async (player) => {
      switch (args.action) {
        case 'pause':
          await pausePlayer(player)
          break
        case 'play':
          await resumePlayer(player)
          break
        case 'next':
          await skipNextPlayer(player)
          break
        case 'prev':
          await skipPrevPlayer(player)
          break
        case 'seek':
          await seekPlayer(player, args.offsetMs ?? 0)
          break
      }
    })
    return { ok: true as const }
  })

  register('plex:set-volume', async (_e, args) => {
    await withPlayerRetry(args.playerId, (player) => setVolumePlayer(player, args.volume))
    return { ok: true as const }
  })

  register('media-keys:set-metadata', (_e, meta) => {
    setMediaMetadata(meta)
    return { ok: true as const }
  })

  register('plex:player-skip-to', async (_e, args) => {
    await withPlayerRetry(args.playerId, (player) =>
      skipToQueueItemPlayer(player, args.playQueueItemId)
    )
    return { ok: true as const }
  })

  register('plex:queue-update', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    if (args.mode === 'after-item') {
      if (typeof args.afterItemId !== 'number') {
        throw new Error('after-item mode requires afterItemId')
      }
      await insertIntoPlayQueueAfterItem(
        server,
        args.playQueueId,
        args.ratingKey,
        args.afterItemId
      )
    } else {
      await addToPlayQueue(server, args.playQueueId, args.ratingKey, args.mode)
    }
    // The server-side mutation succeeded; whether the player picked it up
    // is reported separately so the renderer can show a soft warning
    // instead of failing the whole operation.
    let refreshed = true
    if (args.playerId) {
      try {
        const player = await resolvePlayerContext(args.playerId)
        refreshed = await refreshPlayQueueReliable(player, args.playQueueId)
      } catch {
        refreshed = false
      }
    }
    return { ok: true as const, refreshed }
  })

  register('plex:get-play-queue', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await getPlayQueue(server, args.playQueueId)
  })

  register('plex:extend-queue-with-similar', async (_e, args) => {
    const [server, player] = await Promise.all([
      resolveServerContext(args.serverId),
      resolvePlayerContext(args.playerId)
    ])
    const result = await extendQueueWithSimilarAlbum(server, player, args.playQueueId, {
      currentAlbumRatingKey: args.currentAlbumRatingKey,
      excludeAlbumRatingKeys: args.excludeAlbumRatingKeys,
      listenLater: listListenLater(),
      steer: args.steer,
      albumLabels: getValue('albumLabels'),
      history: listRadioHistory()
    })
    if (result.ok) {
      recordRadioPick({
        albumRatingKey: result.album.albumRatingKey,
        artistRatingKey: result.album.artistRatingKey ?? null,
        at: Date.now()
      })
    }
    return result
  })

  register('plex:pick-continuation', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await pickContinuationAlbum(server, {
      currentAlbumRatingKey: args.currentAlbumRatingKey,
      excludeAlbumRatingKeys: args.excludeAlbumRatingKeys,
      listenLater: listListenLater(),
      steer: args.steer,
      albumLabels: getValue('albumLabels'),
      history: listRadioHistory()
    })
  })

  register('plex:queue-remove', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    await removeFromPlayQueue(server, args.playQueueId, args.playQueueItemId)
    // Same soft-failure contract as plex:queue-update — without the
    // refresh, Plexamp keeps playing its cached copy of the queue and the
    // removed track still plays.
    let refreshed = true
    if (args.playerId) {
      try {
        const player = await resolvePlayerContext(args.playerId)
        refreshed = await refreshPlayQueueReliable(player, args.playQueueId)
      } catch {
        refreshed = false
      }
    }
    return { ok: true as const, refreshed }
  })

  register('plex:search-library', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    const results = await searchLibrary(ctx, args.sectionKey, args.query)
    await overlayOriginalYears(results.albums)
    return results
  })

  register('plex:list-all-albums', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    const albums = await listAllAlbums(ctx, args.sectionKey)
    await overlayOriginalYears(albums)
    // Persist exactly what the renderer is about to receive (years included)
    // so the next launch can paint the crate before Plex answers. Fire and
    // forget — the disk write must not delay the response.
    void librarySnapshot.set(snapshotKey(args.serverId, args.sectionKey), albums)
    return albums
  })

  // The stale-while-revalidate read behind ensureAllAlbums: the previous
  // run's full-library snapshot, or null when none was captured for exactly
  // this server+section. Served as stored — years were overlaid at capture
  // time, so overlaying again here would be redundant (the fresh fetch that
  // always follows carries any newly-learned years).
  register('plex:get-library-snapshot', async (_e, args) => {
    return await librarySnapshot.get(snapshotKey(args.serverId, args.sectionKey))
  })

  // Snapshot of every library artist with their Plex-stored MBID (when
  // present). Used by the Shows screen to enrich rows with plexArtistMbid
  // so clicking a band name opens the entity page instantly — no
  // MusicBrainz lookup needed.
  register('plex:list-library-artists-with-guids', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    return await listAllArtistsWithGuids(ctx)
  })

  register('mb:get-artist-credited-works', async (_e, args) => {
    return await getArtistCreditedWorks(args.mbid)
  })

  // The artist's full MB discography (albums/EPs/singles as release-groups),
  // shared with the release radar's per-artist cache. Serve cached when less
  // than a week old; on a failed refetch a stale entry still beats nothing.
  const DISCOGRAPHY_TTL_MS = 7 * 24 * 3600 * 1000
  register('mb:get-artist-discography', async (_e, args) => {
    const cached = await getArtistReleaseGroupsCached(args.mbid)
    if (cached && Date.now() - cached.fetchedAt < DISCOGRAPHY_TTL_MS) return cached.groups
    try {
      const entry = await fetchArtistReleaseGroups(args.mbid)
      return entry.groups
    } catch (err) {
      if (cached) return cached.groups
      throw err
    }
  })

  // A record label's MB catalog, resolved from its name. Same freshness
  // policy as the artist discography: week-old cache, stale beats nothing.
  register('mb:get-label-discography', async (_e, args) => {
    const cached = await getLabelDiscographyCached(args.name)
    if (cached && Date.now() - cached.fetchedAt < DISCOGRAPHY_TTL_MS) return cached.discography
    try {
      const entry = await fetchLabelDiscography(args.name)
      return entry.discography
    } catch (err) {
      if (cached) return cached.discography
      throw err
    }
  })

  register('mb:search-release-candidates', async (_e, args) => {
    return await searchReleaseCandidates(args.artist, args.title)
  })

  register('mb:search-artist-by-name', async (_e, args) => {
    return await searchArtistByName(args.name)
  })

  register('mb:search-composer-by-name', async (_e, args) => {
    return await searchComposerByName(args.name)
  })

  register('mb:find-lp-for-track', async (_e, args) => {
    return await findLpForTrack(args.artist, args.title, args.sourceAlbum)
  })

  register('plex:set-album-match', async (_e, args) => {
    setAlbumMatch(args.plexRatingKey, args.mbReleaseMbid)
    await invalidateAlbumCredits(args.plexRatingKey)
    return { ok: true as const }
  })

  register('plex:clear-album-match', async (_e, args) => {
    clearAlbumMatch(args.plexRatingKey)
    await invalidateAlbumCredits(args.plexRatingKey)
    return { ok: true as const }
  })

  register('plex:list-original-year-overrides', async () => {
    return getValue('originalYearOverrides')
  })

  register('plex:set-original-year-override', async (_e, args) => {
    patchRecord('originalYearOverrides', args.plexRatingKey, args.year)
    originalYears.setOverride(args.plexRatingKey, args.year)
    return { ok: true as const }
  })

  register('plex:clear-original-year-override', async (_e, args) => {
    deleteFromRecord('originalYearOverrides', args.plexRatingKey)
    originalYears.clearOverride(args.plexRatingKey)
    return { ok: true as const }
  })

  register('plex:list-composer-overrides', async () => {
    return getValue('albumComposerOverrides')
  })

  register('plex:set-composer-override', async (_e, args) => {
    const plexRatingKey = args.plexRatingKey.trim()
    const mbid = args.composer.mbid.trim().toLowerCase()
    const name = args.composer.name.trim()
    if (!plexRatingKey) throw new Error('Album rating key is required')
    if (!isValidMbid(mbid)) throw new Error('Composer MBID is invalid')
    if (!name) throw new Error('Composer name is required')
    patchRecord('albumComposerOverrides', plexRatingKey, { mbid, name })
    return { ok: true as const }
  })

  register('plex:clear-composer-override', async (_e, args) => {
    const plexRatingKey = args.plexRatingKey.trim()
    if (!plexRatingKey) throw new Error('Album rating key is required')
    deleteFromRecord('albumComposerOverrides', plexRatingKey)
    return { ok: true as const }
  })

  register('art:list-cover-overrides', async () => {
    return getValue('coverOverrides')
  })

  // Fan out to iTunes + (if we know the album's MB release) Cover Art Archive.
  // Two parallel sources is plenty for v1 — iTunes catches mainstream, CAA
  // catches indie/obscure. Returned list is iTunes first, then CAA fronts.
  register('art:search-covers', async (_e, args) => {
    const [itunes, caa] = await Promise.all([
      searchITunesAlbumCovers(args.artist, args.title),
      args.mbReleaseMbid ? getReleaseFrontCovers(args.mbReleaseMbid) : Promise.resolve([])
    ])
    return [...itunes, ...caa]
  })

  register('art:set-cover-override', async (_e, args) => {
    patchRecord('coverOverrides', args.plexRatingKey, args.override)
    // Also push the poster into Plex so external players (headless Plexamp
    // casts, the living-room Pi display) repaint — the local override alone only
    // changes Cratedigger's own thumbnails. Best-effort: keep the local override
    // even if the Plex write fails (e.g. no owner token) and report why so the
    // UI can warn. Local uploads use a cratedigger-cover:// URL Plex can't fetch,
    // so they go through the upload handler's raw-bytes path instead.
    if (args.serverId && args.override.source !== 'local') {
      try {
        await pushCoverToPlex({
          serverId: args.serverId,
          rk: args.plexRatingKey,
          source: args.override.source,
          remoteUrl: args.override.url
        })
        return { ok: true as const, plexUpdated: true }
      } catch (err) {
        return {
          ok: true as const,
          plexUpdated: false,
          plexError: err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { ok: true as const, plexUpdated: false }
  })

  // Native open-dialog → copy the chosen image into userData/covers → pin it as
  // a 'local' override served over cratedigger-cover://. The &v= cache-buster
  // forces the renderer to re-fetch when the user replaces an existing upload
  // (the filename, keyed by ratingKey, otherwise stays the same).
  register('art:upload-local-cover', async (e, args) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose album cover',
      buttonLabel: 'Use as cover',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }

    const filename = await saveLocalCover(args.plexRatingKey, result.filePaths[0])
    const url =
      `${CRATEDIGGER_COVER_SCHEME}://local/?file=${encodeURIComponent(filename)}&v=${Date.now()}`
    const override: CoverOverride = {
      source: 'local',
      url,
      thumbUrl: url,
      setAt: Date.now()
    }
    patchRecord('coverOverrides', args.plexRatingKey, override)

    // Push the uploaded image into Plex too (raw bytes — Plex can't fetch the
    // cratedigger-cover:// URL) so external players repaint. Best-effort, same
    // as the remote-candidate path: keep the local override on failure.
    if (args.serverId) {
      try {
        const local = await readLocalCover(args.plexRatingKey)
        if (!local) throw new Error('saved cover not found on disk')
        await pushCoverToPlex({
          serverId: args.serverId,
          rk: args.plexRatingKey,
          source: 'local',
          localData: local
        })
        return { canceled: false, override, plexUpdated: true }
      } catch (err) {
        return {
          canceled: false,
          override,
          plexUpdated: false,
          plexError: err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { canceled: false, override, plexUpdated: false }
  })

  register('art:clear-cover-override', async (_e, args) => {
    deleteFromRecord('coverOverrides', args.plexRatingKey)
    // Harmless no-op when the cleared override wasn't a local upload.
    await deleteLocalCover(args.plexRatingKey)
    return { ok: true as const }
  })

  register('releases:get-snapshot', async () => {
    return getValue('releaseRadar')
  })

  register('releases:get-progress', async () => {
    return getReleaseRadarProgress()
  })

  register('releases:refresh', async (_e, args) => {
    return await runReleaseRadar(args.serverId)
  })

  register('releases:cancel', async () => {
    stopReleaseRadar()
    return { ok: true as const }
  })

  register('artfix:list-queue', async () => {
    return listArtFixQueue()
  })

  register('artfix:scan', async (_e, args) => {
    return await scanArtFixQueue(args.serverId, args.threshold)
  })

  register('artfix:scan-progress', async () => {
    return getArtFixScanProgress()
  })

  register('artfix:cancel-scan', async () => {
    cancelArtFixScan()
    return { ok: true as const }
  })

  register('artfix:get-candidates', async (_e, args) => {
    return await getArtFixCandidates(args)
  })

  register('artfix:accept', async (_e, args) => {
    return await acceptArtFix(args)
  })

  register('artfix:skip', async (_e, args) => {
    skipArtFix(args.rk)
    return { ok: true as const }
  })

  register('artfix:revert-last', async (_e, args) => {
    return await revertLastArtFix(args.serverId)
  })

  register('lyrics:get', async (_e, args) => {
    return await getTrackLyrics(args)
  })

  register('listen-later:list', async () => {
    return listListenLater()
  })

  register('listen-later:add', async (_e, args) => {
    const next = addToListenLater(args.entry)
    scheduleRoamingPush()
    return next
  })

  register('listen-later:remove', async (_e, args) => {
    const next = removeFromListenLater(args.ratingKey)
    scheduleRoamingPush()
    return next
  })

  // Library write — stripped from the public ("friends") build.
  if (!PUBLIC_BUILD) {
    register('plex:delete-album', async (_e, args) => {
      const ctx = await resolveServerContext(args.serverId)
      const entry = await deleteAlbum(ctx, args)
      // Keep the persisted library snapshot in step, so the deleted album
      // can't flash back into the grid on the next warm launch.
      void librarySnapshot.removeAlbum(args.ratingKey)
      return entry
    })
  }

  register('plex:list-deleted-albums', () => getValue('deletedAlbums'))

  register('plex:list-dup-dismissals', () => getValue('dupDismissals'))
  register('plex:add-dup-dismissal', (_e, args) => addDupDismissal(args.key))
  register('plex:remove-dup-dismissal', (_e, args) => removeDupDismissal(args.key))

  register('secrets:reveal-backup-file', async () => {
    const path = ensureBackupFileExists()
    // openPath returns '' on success, an error string on failure. Either
    // way we surface the path so the renderer can show it as a hint.
    await shell.openPath(path)
    return { path }
  })
  register('secrets:get-backup-path', () => ({ path: SECRETS_BACKUP_PATH }))
  register('secrets:back-up-current-keys', () => backUpCurrentKeysToFile())

  register('shows:list-venues', () => listVenues())
  register('shows:fetch-venue', async (_e, args) => {
    return await fetchVenueShows(args.venueId)
  })
  register('shows:report-matches', (_e, args) => reportShowMatches(args.matches ?? []))
  register('shows:list-recent-notified', () => listRecentlyNotifiedShowIds())
  register('shows:list-marks', () => listShowMarks())
  register('shows:set-mark', (_e, args) => {
    setShowMark(args.id, args.mark)
    scheduleRoamingPush()
  })

  register('plex:list-reviewed-albums', () => getValue('reviewedAlbums'))
  register('plex:set-reviewed-album', (_e, args) =>
    setReviewedAlbum(args.ratingKey, args.ignoredFlags)
  )
  register('plex:clear-reviewed-album', (_e, args) => {
    deleteFromRecord('reviewedAlbums', args.ratingKey)
    return getValue('reviewedAlbums')
  })

  register('mb:get-release-track-count', async (_e, args) => {
    const cached = getFromRecord('mbTrackCounts', args.mbid)
    if (typeof cached === 'number') return cached
    const count = await getReleaseTrackCount(args.mbid)
    patchRecord('mbTrackCounts', args.mbid, count)
    return count
  })

  register('mb:list-release-track-counts', () => getValue('mbTrackCounts'))

  register('mb:list-album-labels', () => getValue('albumLabels'))
  register('mb:label-index-progress', () => getLabelIndexProgress())
  register('mb:stop-label-index', () => {
    stopLabelIndex()
    return { ok: true as const }
  })
  register('mb:start-label-index', (_e, args) => {
    void startLabelIndex(args.items, { rebuild: args.rebuild })
    return { ok: true as const }
  })
  register('mb:clear-album-labels', () => {
    clearAlbumLabels()
    return { ok: true as const }
  })

  register('mb:list-album-genres', () => getValue('albumGenres'))
  register('mb:genre-index-progress', () => getGenreIndexProgress())
  register('mb:stop-genre-index', () => {
    stopGenreIndex()
    return { ok: true as const }
  })
  register('mb:start-genre-index', (_e, args) => {
    void startGenreIndex(args.items, { rebuild: args.rebuild })
    return { ok: true as const }
  })
  register('mb:clear-album-genres', () => {
    clearAlbumGenres()
    return { ok: true as const }
  })

  register('warmer:progress', () => getLibraryWarmerProgress())
  register('warmer:stop', () => {
    stopLibraryWarmer()
    return { ok: true as const }
  })
  register('warmer:start', (_e, args) => {
    void startLibraryWarmer(args.serverId, args.items, { creditsOnly: args.creditsOnly })
    return { ok: true as const }
  })
  register('mb:get-album-labels-backup', () => getValue('albumLabelsBackup'))
  register('mb:restore-album-labels-backup', () => restoreAlbumLabelsBackup())
  register('mb:list-label-aliases', () => getValue('labelAliases'))
  register('mb:set-label-alias', (_e, args) => {
    setLabelAlias(args.alias, args.canonical)
    return getValue('labelAliases')
  })
  register('mb:remove-label-alias', (_e, args) => {
    deleteFromRecord('labelAliases', args.alias)
    return getValue('labelAliases')
  })
  register('mb:fetch-album-labels', async (_e, args) => {
    const labels = await getReleaseLabels(args.mbid)
    patchRecord('albumLabels', args.ratingKey, labels)
    return labels
  })

  // Inbox/triage tagger handlers — stripped from the public build. The
  // `tagger:get-release` MB lookup below is NOT gated: album-detail credits
  // and manual MB match depend on it (and degrade gracefully if no service).
  if (!PUBLIC_BUILD) {
    register('tagger:get-url', () => getTaggerUrl())
    register('tagger:set-url', (_e, url) => {
      if (!isHttpUrl(url)) throw new Error('Tagger URL must be http(s)://')
      setTaggerUrl(url)
      return { ok: true as const }
    })
    register('tagger:health', async () => {
      return await taggerHealth()
    })
    register('tagger:list-inbox', async () => {
      return await listInbox()
    })
    register('tagger:get-folder', async (_e, args) => {
      return await getInboxFolder(args.name)
    })
  }
  register('tagger:get-release', async (_e, args) => {
    return await getMbRelease(args.mbid)
  })
  if (!PUBLIC_BUILD) {
  register('tagger:apply', async (_e, args) => {
    const result = await applyRelease(args)
    recordImport(args.folder, args.mbid, result)
    return result
  })
  // `plexRatingKey` is Cratedigger-side context, not part of the tagger
  // service's request schema — strip it before forwarding. When the caller
  // knows which existing Plex album the retag targets, a committed write
  // also syncs the manual MB override + credit cache (see album-match-sync).
  register('tagger:retag', async (_e, args) => {
    const { plexRatingKey, ...req } = args
    const result = await retagAlbums(req)
    const filesWritten = result.ok && result.mode !== 'preview' && !req.dry_run
    if (filesWritten && plexRatingKey) {
      await syncAlbumMatchForTaggerWrite(plexRatingKey, req.mbid)
    }
    return result
  })
  register('tagger:audit-music', async () => {
    return await auditMusic()
  })
  register('tagger:merge-inbox-into-album', async (_e, args) => {
    const ctx = await resolveServerContext(args.serverId)
    const files = await getAlbumTrackFiles(ctx, args.ratingKey)
    if (files.length === 0) {
      throw new Error('existing album has no track files on disk')
    }
    const dirSet = new Set<string>()
    for (const f of files) {
      const slash = f.lastIndexOf('/')
      if (slash > 0) dirSet.add(f.slice(0, slash))
    }
    const dirs = [...dirSet]
    const existingDirs = dirs.filter(
      (d) => !dirs.some((other) => other !== d && other.startsWith(d + '/'))
    )
    const result = await retagAlbums({
      source_paths: [args.inboxPath, ...existingDirs],
      mbid: args.mbid,
      refresh_plex: true,
      dry_run: false
    })
    if (result.ok && result.mode === 'preview') {
      throw new Error(
        'tagger could not auto-map files to tracks — open the inbox folder to resolve manually'
      )
    }
    if (!result.ok) throw new Error(result.reason || 'tagger /music/retag failed')
    // Force Plex to re-read metadata on the target so newly-arrived files
    // (with the same musicbrainz_albumid as the existing album) get
    // grouped into the same record instead of starting a parallel one.
    try {
      await refreshAlbumMetadata(ctx, args.ratingKey)
    } catch (err) {
      console.warn('tagger:merge-inbox-into-album: refresh failed:', err)
    }
    // Files now carry args.mbid — pin the manual override to match and
    // bust cached credits (supersedes the old bare invalidate here).
    await syncAlbumMatchForTaggerWrite(args.ratingKey, args.mbid)
    return result
  })
  register('tagger:refresh-plex', async () => {
    return await refreshPlex()
  })

  register('tagger:delete-folder', async (_e, args) => {
    return await deleteInboxFolder(args.name)
  })
  register('tagger:apply-single', async (_e, args) => {
    return await applySingle(args)
  })
  register('tagger:delete-files', async (_e, args) => {
    return await deleteInboxFiles(args.name, args.paths)
  })
  register('tagger:acoustic-dedupe', async (_e, args) => {
    return await acousticDedupeInbox(args.name)
  })
  register('tagger:prefingerprint', async (_e, args) => {
    return await prefingerprintInbox(args.name)
  })

  register('slskd:get-config', () => ({
    url: getSlskdUrl(),
    apiKey: getSlskdApiKey()
  }))
  register('slskd:set-config', (_e, args) => {
    if (!isHttpUrl(args.url)) throw new Error('slskd URL must be http(s)://')
    setSlskdUrl(args.url)
    setSlskdApiKey(args.apiKey)
    return { ok: true as const }
  })
  register('slskd:health', async () => {
    return await slskdHealth()
  })
  register('slskd:search', async (_e, args) => {
    return await searchAndWait(args.artist, args.album, {
      preferredReleaseMbid: args.preferredReleaseMbid
    })
  })
  register('slskd:list-successful-peers', () => listSuccessfulPeers())
  register('slskd:browse-user', async (_e, args) => await browseUser(args.username))
  register('slskd:enqueue', async (_e, args) => {
    const job = args.intent ? beginAcquisition(args.username, args.intent) : null
    try {
      const result = await enqueueDownload(args)
      if (job) finishEnqueue(job.id, result)
      return job ? { ...result, taskId: job.id } : result
    } catch (err) {
      if (job) failEnqueue(job.id, err instanceof Error ? err.message : String(err))
      throw err
    }
  })
  register('slskd:list-downloads', async () => {
    const downloads = await listDownloads()
    return { ...downloads, acquisitions: reconcileAcquisitions(downloads) }
  })
  register('slskd:remove-download', async (_e, args) => {
    await removeDownload(args.username, args.id)
    return { ok: true as const }
  })
  register('slskd:retry-download', async (_e, args) => {
    await retryDownload(args.username, args.id, args.filename, args.size)
    return { ok: true as const }
  })
  register('slskd:remove-downloads-bulk', async (_e, args) => {
    const errors: { id: string; error: string }[] = []
    let removed = 0
    for (const id of args.ids) {
      try {
        await removeDownload(args.username, id)
        removed += 1
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { removed, errors }
  })
  register('slskd:retry-downloads-bulk', async (_e, args) => {
    const errors: { id: string; error: string }[] = []
    let retried = 0
    for (const f of args.files) {
      try {
        await retryDownload(args.username, f.id, f.filename, f.size)
        retried += 1
      } catch (err) {
        errors.push({ id: f.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { retried, errors }
  })
  } // end !PUBLIC_BUILD (tagger writes + slskd)

  // --- listening charts (Tautulli) — shipped in both builds (read-only) ---
  register('charts:get-config', () => ({
    url: getTautulliUrl(),
    apiKey: getTautulliApiKey()
  }))
  register('charts:set-config', (_e, config) => {
    if (config.url && !isHttpUrl(config.url)) throw new Error('Tautulli URL must be http(s)://')
    setTautulliUrl(config.url)
    setTautulliApiKey(config.apiKey)
    clearTautulliCaches()
    return { ok: true as const }
  })
  // Source decision: if Tautulli is configured (owner, on the LAN/Tailscale)
  // use it live; otherwise — and as a fallback when Tautulli is unreachable —
  // read the public precomputed snapshot (this is how the friends build works).
  const tautulliConfigured = (): boolean => !!getTautulliUrl() && !!getTautulliApiKey()
  register('charts:health', async () => {
    if (tautulliConfigured()) {
      const h = await tautulliHealth()
      if (h.ok) return h
    }
    try {
      await snapshotUsers()
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  register('charts:users', async () => {
    if (tautulliConfigured()) {
      try {
        return await getChartUsers()
      } catch {
        // Tautulli unreachable (e.g. owner off-Tailscale) — fall back.
      }
    }
    return await snapshotUsers()
  })
  register('charts:top', async (_e, args) => {
    if (tautulliConfigured()) {
      try {
        return await getTopChart(args)
      } catch {
        // fall through to the published snapshot
      }
    }
    return await snapshotTop(args)
  })

  register('bios:get-album-bio', async (_e, args) => {
    return await getAlbumBio(args)
  })

  register('bios:get-artist-bio', async (_e, args) => {
    return await getArtistBio(args)
  })

  register('caa:get-booklet', async (_e, args) => {
    return await getBookletImages(args.releaseMbid)
  })

  register('settings:get', () => ({
    lastfmApiKey: getLastfmApiKey(),
    taggerApiKey: getTaggerApiKey(),
    ticketmasterApiKey: getTicketmasterApiKey(),
    geniusClientId: getGeniusClientId(),
    geniusClientSecret: getGeniusClientSecret(),
    plexAdminToken: getPlexAdminToken(),
    bijouUrl: getValue('bijouUrl'),
    continuationMode: getContinuationMode(),
    showNotificationsEnabled: getValue('showNotificationsEnabled')
  }))

  register('settings:set', (_e, args) => {
    if (typeof args.lastfmApiKey === 'string') setLastfmApiKey(args.lastfmApiKey)
    if (typeof args.taggerApiKey === 'string') setTaggerApiKey(args.taggerApiKey)
    if (typeof args.ticketmasterApiKey === 'string') {
      setTicketmasterApiKey(args.ticketmasterApiKey)
    }
    if (typeof args.geniusClientId === 'string') setGeniusClientId(args.geniusClientId)
    if (typeof args.geniusClientSecret === 'string') {
      setGeniusClientSecret(args.geniusClientSecret)
    }
    if (typeof args.plexAdminToken === 'string') setPlexAdminToken(args.plexAdminToken)
    if (typeof args.bijouUrl === 'string') setValue('bijouUrl', args.bijouUrl.trim())
    if (args.continuationMode === 'off' || args.continuationMode === 'album-end' || args.continuationMode === 'radio') {
      setValue('continuationMode', args.continuationMode)
    }
    if (typeof args.showNotificationsEnabled === 'boolean') {
      setValue('showNotificationsEnabled', args.showNotificationsEnabled)
    }
    return { ok: true as const }
  })

  register('window:toggle-fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.setFullScreen(!win.isFullScreen())
  })

  register('mini:toggle', () => ({ open: toggleMiniPlayer() }))
  register('mini:push-state', (_e, state) => pushMiniState(state))
  register('mini:command', (e, cmd) => {
    // Relay mini-window transport to the main window over the existing
    // media-keys command channel — PlexState already routes it to the
    // playback controller.
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== e.sender && !win.isDestroyed()) {
        win.webContents.send('media-keys:command', cmd)
      }
    }
  })
  register('mini:focus-main', () => focusMainWindow())

  register('window:set-background', (e, color) => {
    // Themes only ever send #rrggbb; reject anything else rather than hand an
    // arbitrary renderer string to setBackgroundColor.
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
    setValue('windowBackground', color)
    BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(color)
  })

  register('updates:get-state', () => getUpdateState())
  register('updates:check', async () => {
    await checkNow()
    return { ok: true as const }
  })
  register('updates:install-and-restart', () => {
    installAndRestart()
    return { ok: true as const }
  })

  // Cross-machine roaming sync (show marks / Listen Later via the tagger
  // service). Deferred a few seconds so launch isn't competing with the
  // first library paint; no-ops when no tagger URL is configured.
  setTimeout(() => {
    startRoamingSync(() => broadcast('roaming:changed', {}))
  }, 5_000)
}
