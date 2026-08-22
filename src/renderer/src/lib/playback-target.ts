import type { MusicTimeline } from '../../../shared/plex'
import { LOCAL_PLAYER_ID, LOCAL_PLAYER_NAME, LocalPlayer } from './local-player'

type PlexApi = Window['cratedigger']['plex']

/** A cast/play request before (or while) it's dispatched to a player. */
export type CastIntent =
  | {
      kind: 'album'
      ratingKey: string
      title: string
      artist: string
      startTrackRatingKey?: string
    }
  | { kind: 'track'; ratingKey: string; title: string; artist: string }
  | { kind: 'mood'; sectionKey: string; moodId: string; title: string }
  | { kind: 'playlist'; ratingKey: string; title: string; shuffle: boolean }

export interface CastResult {
  playQueueId: number
  player: { id: string; name: string }
}

/**
 * The seam between PlaybackController's orchestration and the device actually
 * making sound. Two adapters: {@link RemoteTarget} drives a Plexamp companion
 * over IPC; {@link LocalTarget} drives the in-app <audio> element via
 * LocalPlayer, including the local queue-resync ritual after every mutation.
 *
 * The contract callers rely on: queue mutations return `refreshed` — whether
 * the device picked the change up (remote: the refreshPlayQueue nudge landed;
 * local: always, the resync is synchronous-enough). Batch removes nudge the
 * device once, on the final delete.
 */
export interface PlaybackTarget {
  /** Which adapter this is. Callers ask the target instead of re-deriving it
   *  from player-id conventions; only the buildTarget factory branches on ids. */
  readonly kind: 'remote' | 'local'
  /** Human label for the player. Null means "not self-describing — look the
   *  player up in the Plex players list" (remote); the local target names
   *  itself since it lives outside that list. */
  readonly displayName: string | null
  /** Radio continuation appends through the Plex player API — remote only
   *  for v1; the local path would need its own queue-append + cursor logic. */
  readonly supportsRadio: boolean
  /** 0 = volume applies instantly (a local <audio> property); >0 = debounce
   *  window for network volume sends. */
  readonly volumeThrottleMs: number
  /** The session was refreshed (token/server may have changed) — re-attach
   *  whatever the adapter binds to it. Remote holds nothing; it no-ops. */
  attachSession(): void
  cast(intent: CastIntent): Promise<CastResult>
  transport(action: 'pause' | 'play' | 'next' | 'prev' | 'seek', offsetMs?: number): Promise<void>
  queueAdd(args: {
    playQueueId: number
    ratingKey: string
    mode: 'next' | 'end' | 'after-item'
    afterItemId?: number
  }): Promise<{ refreshed: boolean }>
  queueRemoveMany(playQueueId: number, playQueueItemIds: number[]): Promise<{ refreshed: boolean }>
  skipToQueueItem(playQueueItemId: number): Promise<void>
  sendVolume(volume: number): void | Promise<void>
  getTimeline(): Promise<MusicTimeline | null>
  /** Tear down when switching away (stops local audio immediately). */
  dispose(): void
}

interface RemoteTargetDeps {
  plex: PlexApi
  /** Resolved per call — the session can change under a live target. */
  serverId: () => string | null
  playerId: string
}

export class RemoteTarget implements PlaybackTarget {
  readonly kind = 'remote' as const
  readonly displayName = null
  readonly supportsRadio = true
  readonly volumeThrottleMs = 150

  #deps: RemoteTargetDeps

  constructor(deps: RemoteTargetDeps) {
    this.#deps = deps
  }

  private sid(): string {
    const s = this.#deps.serverId()
    if (!s) throw new Error('Not signed in')
    return s
  }

  attachSession(): void {
    // nothing bound — the server id is resolved fresh on every call
  }

  async cast(intent: CastIntent): Promise<CastResult> {
    const serverId = this.sid()
    const playerId = this.#deps.playerId
    return intent.kind === 'album'
      ? await this.#deps.plex.castPlayAlbum({
          serverId,
          playerId,
          ratingKey: intent.ratingKey,
          startTrackRatingKey: intent.startTrackRatingKey
        })
      : intent.kind === 'mood'
        ? await this.#deps.plex.castMood({
            serverId,
            playerId,
            sectionKey: intent.sectionKey,
            moodId: intent.moodId
          })
        : intent.kind === 'playlist'
          ? await this.#deps.plex.castPlaylist({
              serverId,
              playerId,
              ratingKey: intent.ratingKey,
              shuffle: intent.shuffle
            })
          : await this.#deps.plex.castPlayTrack({
              serverId,
              playerId,
              ratingKey: intent.ratingKey
            })
  }

  async transport(
    action: 'pause' | 'play' | 'next' | 'prev' | 'seek',
    offsetMs?: number
  ): Promise<void> {
    await this.#deps.plex.transport({ playerId: this.#deps.playerId, action, offsetMs })
  }

  async queueAdd(args: {
    playQueueId: number
    ratingKey: string
    mode: 'next' | 'end' | 'after-item'
    afterItemId?: number
  }): Promise<{ refreshed: boolean }> {
    const result = await this.#deps.plex.queueUpdate({
      serverId: this.sid(),
      playerId: this.#deps.playerId,
      ...args
    })
    return { refreshed: result.refreshed }
  }

  async queueRemoveMany(
    playQueueId: number,
    playQueueItemIds: number[]
  ): Promise<{ refreshed: boolean }> {
    let refreshed = true
    for (let i = 0; i < playQueueItemIds.length; i++) {
      const last = i === playQueueItemIds.length - 1
      const result = await this.#deps.plex.queueRemove({
        serverId: this.sid(),
        // One player nudge at the end, not N.
        playerId: last ? this.#deps.playerId : undefined,
        playQueueId,
        playQueueItemId: playQueueItemIds[i]
      })
      if (last) refreshed = result.refreshed
    }
    return { refreshed }
  }

  async skipToQueueItem(playQueueItemId: number): Promise<void> {
    await this.#deps.plex.playerSkipTo({ playerId: this.#deps.playerId, playQueueItemId })
  }

  async sendVolume(volume: number): Promise<void> {
    await this.#deps.plex.setVolume({ playerId: this.#deps.playerId, volume })
  }

  getTimeline(): Promise<MusicTimeline | null> {
    return this.#deps.plex.getTimeline({ serverId: this.sid(), playerId: this.#deps.playerId })
  }

  dispose(): void {
    // nothing held — the Plexamp keeps playing, by design
  }
}

interface LocalTargetDeps {
  plex: PlexApi
  serverId: () => string | null
  /** The <audio> element pushed a new position/track — refresh the timeline. */
  onTimelineChange: () => void
  onError: (msg: string) => void
  initialVolume: number
}

export class LocalTarget implements PlaybackTarget {
  readonly kind = 'local' as const
  readonly displayName = LOCAL_PLAYER_NAME
  readonly supportsRadio = false
  readonly volumeThrottleMs = 0

  #deps: LocalTargetDeps
  private localPlayer: LocalPlayer

  constructor(deps: LocalTargetDeps) {
    this.#deps = deps
    this.localPlayer = new LocalPlayer({
      onTimelineChange: deps.onTimelineChange,
      onError: deps.onError
    })
    this.localPlayer.setVolume(deps.initialVolume)
    const sid = deps.serverId()
    if (sid) this.localPlayer.attachServer(sid)
  }

  private sid(): string {
    const s = this.#deps.serverId()
    if (!s) throw new Error('Not signed in')
    return s
  }

  /** Re-attach after a session refresh (token/server may have changed). */
  attachSession(): void {
    const sid = this.#deps.serverId()
    if (sid) this.localPlayer.attachServer(sid)
  }

  // Creates the same Plex play queue the remote path does (so queue mutations
  // and Now-Playing detail work) but hands the items to LocalPlayer to drive
  // an <audio> element instead of pushing playMedia to a companion.
  async cast(intent: CastIntent): Promise<CastResult> {
    if (intent.kind === 'mood') {
      // Mood mixes use a section-filter URI Plex resolves into a queue; the
      // same call works fine here, but exposing it through the local path
      // wasn't part of v1. Keep it remote-only for now.
      throw new Error('Mood mixes are not supported on This Mac yet')
    }
    const serverId = this.sid()
    this.localPlayer.attachServer(serverId)
    const created =
      intent.kind === 'album'
        ? await this.#deps.plex.createLocalAlbumQueue({
            serverId,
            ratingKey: intent.ratingKey,
            startTrackRatingKey: intent.startTrackRatingKey
          })
        : intent.kind === 'playlist'
          ? await this.#deps.plex.createLocalPlaylistQueue({
              serverId,
              ratingKey: intent.ratingKey,
              shuffle: intent.shuffle
            })
          : await this.#deps.plex.createLocalTrackQueue({
              serverId,
              ratingKey: intent.ratingKey
            })
    const snapshot = await this.#deps.plex.getPlayQueue({
      serverId,
      playQueueId: created.playQueueId
    })
    await this.localPlayer.loadQueue(
      snapshot,
      intent.kind === 'album' ? intent.startTrackRatingKey : undefined
    )
    return {
      playQueueId: created.playQueueId,
      player: { id: LOCAL_PLAYER_ID, name: LOCAL_PLAYER_NAME }
    }
  }

  async transport(
    action: 'pause' | 'play' | 'next' | 'prev' | 'seek',
    offsetMs?: number
  ): Promise<void> {
    switch (action) {
      case 'play':
        await this.localPlayer.play()
        break
      case 'pause':
        this.localPlayer.pause()
        break
      case 'next':
        await this.localPlayer.next()
        break
      case 'prev':
        await this.localPlayer.prev()
        break
      case 'seek':
        if (typeof offsetMs === 'number') this.localPlayer.seek(offsetMs)
        break
    }
  }

  // There's no companion to nudge — mutate server-side, then re-read the
  // snapshot so the local cursor follows the new queue shape.
  async queueAdd(args: {
    playQueueId: number
    ratingKey: string
    mode: 'next' | 'end' | 'after-item'
    afterItemId?: number
  }): Promise<{ refreshed: boolean }> {
    const result = await this.#deps.plex.queueUpdate({
      serverId: this.sid(),
      playerId: undefined,
      ...args
    })
    await this.resyncQueue(args.playQueueId)
    return { refreshed: result.refreshed }
  }

  async queueRemoveMany(
    playQueueId: number,
    playQueueItemIds: number[]
  ): Promise<{ refreshed: boolean }> {
    let refreshed = true
    for (let i = 0; i < playQueueItemIds.length; i++) {
      const last = i === playQueueItemIds.length - 1
      const result = await this.#deps.plex.queueRemove({
        serverId: this.sid(),
        playerId: undefined,
        playQueueId,
        playQueueItemId: playQueueItemIds[i]
      })
      if (last) refreshed = result.refreshed
    }
    await this.resyncQueue(playQueueId)
    return { refreshed }
  }

  private async resyncQueue(playQueueId: number): Promise<void> {
    try {
      const snapshot = await this.#deps.plex.getPlayQueue({
        serverId: this.sid(),
        playQueueId
      })
      this.localPlayer.refreshQueue(snapshot)
    } catch {
      // Non-fatal; the panel's next refreshQueue() reconciles.
    }
  }

  async skipToQueueItem(playQueueItemId: number): Promise<void> {
    await this.localPlayer.skipToQueueItem(playQueueItemId)
  }

  sendVolume(volume: number): void {
    this.localPlayer.setVolume(volume)
  }

  getTimeline(): Promise<MusicTimeline | null> {
    return Promise.resolve(this.localPlayer.buildTimeline())
  }

  dispose(): void {
    this.localPlayer.detach()
  }
}
