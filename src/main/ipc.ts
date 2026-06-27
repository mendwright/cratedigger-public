import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { AuthFlow, verifyUser } from './plex/pin-auth.js'
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
  getAlbumCreditsCached,
  getArtistInfo,
  getArtistCreditedWorks,
  getArtistRelations,
  searchReleaseCandidates,
  searchArtistByName,
  invalidateAlbumCredits,
  getReleaseTrackCount,
  getReleaseLabels,
  overlayOriginalYears
} from './musicbrainz.js'
import { originalYears } from './original-years.js'
import { startLabelIndex, stopLabelIndex, getLabelIndexProgress } from './label-index.js'
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
  createTrackPlayQueue
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
  removeFromListenLater
} from './store.js'
import { getAlbumBio, getArtistBio } from './bios.js'
import { checkNow, getUpdateState, installAndRestart } from './updates.js'
import { getBookletImages, getReleaseFrontCovers } from './coverart.js'
import { searchITunesAlbumCovers } from './itunes.js'
import { saveLocalCover, deleteLocalCover } from './cover-store.js'
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
  revertLastArtFix
} from './art-fix.js'
import { getTrackLyrics } from './lyrics.js'
import { fetchVenueShows, listVenues } from './venues/index.js'
import { reportShowMatches } from './shows-notify.js'
import { getInLibraryAppearances } from './credit-index.js'
import { ensureBackupFileExists, SECRETS_BACKUP_PATH, backUpCurrentKeysToFile } from './secrets-file.js'
import { setMediaMetadata } from './media-keys.js'
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
  deleteInboxFiles
} from './tagger.js'
import {
  slskdHealth,
  searchAndWait,
  enqueueDownload,
  listDownloads,
  removeDownload,
  retryDownload
} from './slskd.js'
import {
  getSlskdUrl,
  setSlskdUrl,
  getSlskdApiKey,
  setSlskdApiKey
} from './store.js'
import { syncAlbumMatchAfterTaggerWrite } from './album-match-sync.js'
import type { AuthProgress, CoverOverride, PlexUser } from '../shared/plex.js'
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
    const res = await verifyUser(token)
    if (res.ok) {
      return { signedIn: true as const, user: res.user, preferredServerId: getValue('preferredServerId') }
    }
    if (res.authFailed) {
      setAuthToken(null)
      return { signedIn: false as const }
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
      const token = await flow.run(emit)
      setAuthToken(token)
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
    setAuthToken(null)
    setValue('preferredServerId', null)
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
      args.trackKeys
    )
  })

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
    const exact = matches.find((m) => m.title.toLowerCase() === args.name.toLowerCase()) ?? matches[0] ?? null
    let albums: Awaited<ReturnType<typeof listArtistAlbums>> = []
    if (exact) {
      try {
        albums = await listArtistAlbums(ctx, exact.ratingKey)
        await overlayOriginalYears(albums)
      } catch {
        albums = []
      }
    }
    return {
      mbid: args.mbid,
      name: args.name,
      plexArtist: exact,
      albums
    }
  })

  register('plex:transport', async (_e, args) => {
    const player = await resolvePlayerContext(args.playerId)
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
    return { ok: true as const }
  })

  register('plex:set-volume', async (_e, args) => {
    const player = await resolvePlayerContext(args.playerId)
    await setVolumePlayer(player, args.volume)
    return { ok: true as const }
  })

  register('media-keys:set-metadata', (_e, meta) => {
    setMediaMetadata(meta)
    return { ok: true as const }
  })

  register('plex:player-skip-to', async (_e, args) => {
    const player = await resolvePlayerContext(args.playerId)
    await skipToQueueItemPlayer(player, args.playQueueItemId)
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
    return await extendQueueWithSimilarAlbum(server, player, args.playQueueId, {
      currentAlbumRatingKey: args.currentAlbumRatingKey,
      excludeAlbumRatingKeys: args.excludeAlbumRatingKeys,
      listenLater: getValue('listenLater')
    })
  })

  register('plex:pick-continuation', async (_e, args) => {
    const server = await resolveServerContext(args.serverId)
    return await pickContinuationAlbum(server, {
      currentAlbumRatingKey: args.currentAlbumRatingKey,
      excludeAlbumRatingKeys: args.excludeAlbumRatingKeys,
      listenLater: getValue('listenLater')
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
    return albums
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

  register('mb:search-release-candidates', async (_e, args) => {
    return await searchReleaseCandidates(args.artist, args.title)
  })

  register('mb:search-artist-by-name', async (_e, args) => {
    return await searchArtistByName(args.name)
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
    return { ok: true as const }
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
    return { canceled: false, override }
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
    return getValue('listenLater')
  })

  register('listen-later:add', async (_e, args) => {
    return addToListenLater(args.entry)
  })

  register('listen-later:remove', async (_e, args) => {
    return removeFromListenLater(args.ratingKey)
  })

  // Library write — stripped from the public ("friends") build.
  if (!PUBLIC_BUILD) {
    register('plex:delete-album', async (_e, args) => {
      const ctx = await resolveServerContext(args.serverId)
      return await deleteAlbum(ctx, args)
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
  register('shows:set-mark', (_e, args) => setShowMark(args.id, args.mark))

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

  register('warmer:progress', () => getLibraryWarmerProgress())
  register('warmer:stop', () => {
    stopLibraryWarmer()
    return { ok: true as const }
  })
  register('warmer:start', (_e, args) => {
    void startLibraryWarmer(args.serverId, args.items)
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
    return await applyRelease(args)
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
  register('slskd:enqueue', async (_e, args) => {
    return await enqueueDownload(args)
  })
  register('slskd:list-downloads', async () => {
    return await listDownloads()
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
}
