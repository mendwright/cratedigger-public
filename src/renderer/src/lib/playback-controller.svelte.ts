import type {
  ContinuationMode,
  MusicTimeline,
  PlayQueueSnapshot,
  PlexResource
} from '../../../shared/plex'
import { RadioContinuation } from './radio-continuation.svelte'
import { LocalTarget, RemoteTarget, type CastIntent, type PlaybackTarget } from './playback-target'
import { isLocalPlayerId } from './local-player'
import { PollLoop, type PollTickResult } from './poll-loop'
import type { KeyValueStorage } from './storage'
import type { Session } from './plex-state.svelte'

export type { CastIntent } from './playback-target'

const ACTIVE_PLAYER_KEY = 'jayamp:activePlayerId'
const VOLUME_KEY = 'jayamp:volume'
const VOLUME_DEFAULT = 80

// IPC namespaces injected so the controller can be exercised against stubs in
// unit tests instead of the live `window.cratedigger` bridge + a real Plex
// server / Plexamp client.
type PlexApi = Window['cratedigger']['plex']
type MediaKeysApi = Window['cratedigger']['mediaKeys']

export interface PlaybackDeps {
  /** Current Plex session (signed-in flag + preferred server id). */
  session: () => Session | null
  /** The continuation-mode setting (lives with the rest of settings on PlexState). */
  continuationMode: () => ContinuationMode
  /** Surface a transient toast. Owned by PlexState (shared with non-playback flows). */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /**
   * Jump the Now Playing view to a freshly-cast album. PlexState wires this to
   * open the screen + seed/ensure the album detail; the engine stays unaware
   * of the view's nav/loader machinery.
   */
  onAlbumCast: (ratingKey: string) => void
  /** Where the active player id + volume persist across launches. PlexState
   *  wires localStorage; tests pass a Map-backed fake. */
  storage: KeyValueStorage
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
  /** macOS media-center IPC. Defaults to the live bridge; tests pass a stub. */
  mediaKeys?: MediaKeysApi
  /**
   * Relay the timeline to the mini-player window. PlexState wires this to the
   * mini IPC (it owns thumbUrl / cover overrides); optional so tests and the
   * mini-less path stay untouched. Called alongside every pushNowPlaying.
   */
  pushMini?: (tl: MusicTimeline | null) => void
}

/**
 * Owns the playback/cast engine extracted from PlexState: the active player +
 * volume, the 2.5s timeline poll (with exponential backoff + a visibility
 * gate), cast orchestration (incl. the replace-confirm intent dance), the
 * custom continuous-playback queue extender, transport, and queue mutations.
 *
 * The local <audio> target (LocalPlayer) and the remote Plexamp companion path
 * are both driven from here. Everything that crosses out of the engine —
 * toasts, the signed-in session, the continuous-playback setting, and the
 * "jump to Now Playing" view glue — is injected via {@link PlaybackDeps} so the
 * timing/race logic is unit-testable without a live server.
 */
export class PlaybackController {
  players = $state<PlexResource[]>([])
  playersLoading = $state(false)
  playersError = $state<string | null>(null)
  activePlayerId = $state<string | null>(null)
  volume = $state<number>(VOLUME_DEFAULT)
  private volumeTimer: ReturnType<typeof setTimeout> | null = null
  private lastVolumeSentAt = 0
  // The device adapter behind the PlaybackTarget seam — RemoteTarget for a
  // Plexamp companion, LocalTarget for the in-app <audio> path. Rebuilt on
  // every player switch; null when no player is selected.
  private target: PlaybackTarget | null = null

  castBusy = $state(false)

  timeline = $state<MusicTimeline | null>(null)
  timelineError = $state<string | null>(null)
  // The 2.5s cadence / backoff / visibility-gating machine. pollTick below is
  // the tick body; manual "poll soon" call sites go through pollTimeline so
  // they fold into the loop instead of racing it.
  private pollLoop = new PollLoop({ tick: () => this.pollTick() })

  // Single source of truth for which Plex play queue we operate on. Plexamp's
  // /player/timeline/poll doesn't reliably report playQueueID, so this is
  // written in exactly three places: the cast path (authoritative — a queue we
  // created), the timeline poll (adopting a queue another controller created,
  // e.g. Plexamp on a phone), and setActivePlayer (cleared). `queueIsOurs`
  // distinguishes the two origins and gates auto-continuation so we never
  // extend someone else's listening session.
  activePlayQueueId = $state<number | null>(null)
  queueIsOurs = false

  // The radio-continuation state machine — staging, veto/swap, the
  // stop-after latch. Components read/drive it directly via
  // plexState.playback.radio.*; the poll tick feeds it below.
  radio: RadioContinuation

  queueOpen = $state(false)
  queueSnapshot = $state<PlayQueueSnapshot | null>(null)
  queueLoading = $state(false)
  queueError = $state<string | null>(null)

  #deps: PlaybackDeps
  private plex: PlexApi
  private mediaKeys: MediaKeysApi
  private storage: KeyValueStorage

  constructor(deps: PlaybackDeps) {
    this.#deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
    this.mediaKeys = deps.mediaKeys ?? window.cratedigger.mediaKeys
    this.storage = deps.storage
    this.volume = this.loadVolume()
    this.activePlayerId = this.storage.getItem(ACTIVE_PLAYER_KEY)
    // Stand the adapter up right away so id-shaped questions (display label,
    // adapter kind) never have to fall back to id conventions. For a restored
    // local player the session isn't attached yet — syncLocalPlayerToSession
    // finishes the job after the first session refresh.
    this.target = this.buildTarget(this.activePlayerId)
    this.radio = new RadioContinuation({
      session: () => this.session,
      continuationMode: () => this.continuationMode,
      playerId: () => this.activePlayerId,
      radioSupported: () => this.target?.supportsRadio ?? false,
      queueContext: () => ({
        playQueueId: this.activePlayQueueId,
        queueIsOurs: this.queueIsOurs
      }),
      setQueueSnapshot: (snap) => {
        this.queueSnapshot = snap
      },
      refreshQueue: () => void this.refreshQueue(),
      flashToast: (kind, text) => this.flashToast(kind, text),
      plex: this.plex
    })
  }

  private loadVolume(): number {
    const raw = this.storage.getItem(VOLUME_KEY)
    const n = raw ? Number(raw) : NaN
    if (!Number.isFinite(n)) return VOLUME_DEFAULT
    return Math.max(0, Math.min(100, Math.round(n)))
  }

  // Thin accessors so the engine bodies read against the injected deps without
  // having to spell out `this.#deps.…` on every line.
  private get session(): Session | null {
    return this.#deps.session()
  }
  private get continuationMode(): ContinuationMode {
    return this.#deps.continuationMode()
  }
  private flashToast(kind: 'ok' | 'err', text: string): void {
    this.#deps.flashToast(kind, text)
  }

  async handleMediaKeyCommand(cmd: {
    action: 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'seek'
    payload?: number
  }): Promise<void> {
    if (!this.activePlayerId) return
    switch (cmd.action) {
      case 'play':
        await this.transport('play')
        return
      case 'pause':
        await this.transport('pause')
        return
      case 'playPause': {
        const isPlaying = this.timeline?.state === 'playing' || this.timeline?.state === 'buffering'
        await this.transport(isPlaying ? 'pause' : 'play')
        return
      }
      case 'next':
        await this.transport('next')
        return
      case 'previous':
        await this.transport('prev')
        return
      case 'seek':
        if (typeof cmd.payload === 'number') await this.transport('seek', cmd.payload)
        return
    }
  }

  // Push the current timeline state into macOS' Now Playing center on every
  // poll. macOS routes media keys to whichever app most recently published
  // `state: 'playing'`, so without this Apple Music keeps stealing F8.
  private pushNowPlaying(): void {
    const t = this.timeline
    this.#deps.pushMini?.(t)
    if (!t || !t.title) {
      this.mediaKeys.setMetadata({ state: 'stopped' })
      return
    }
    const state =
      t.state === 'playing' || t.state === 'buffering'
        ? 'playing'
        : t.state === 'paused'
          ? 'paused'
          : 'stopped'
    this.mediaKeys.setMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      state,
      currentTime: Math.max(0, Math.round(t.time)),
      duration: Math.max(0, Math.round(t.duration))
    })
  }

  /**
   * The session refreshed — re-attach whatever the target binds to it (the
   * restored-from-storage target was built before a session existed, and a
   * token/server change can invalidate a live one). Called by PlexState after
   * every session refresh; the target decides what that means for its device.
   */
  syncLocalPlayerToSession(): void {
    this.target?.attachSession()
  }

  private serverIdOrNull(): string | null {
    const s = this.session
    return s?.signedIn ? s.preferredServerId : null
  }

  private buildTarget(id: string | null): PlaybackTarget | null {
    if (!id) return null
    if (isLocalPlayerId(id)) {
      return new LocalTarget({
        plex: this.plex,
        serverId: () => this.serverIdOrNull(),
        onTimelineChange: () => this.refreshLocalTimeline(),
        onError: (msg) => this.flashToast('err', msg),
        initialVolume: this.volume
      })
    }
    return new RemoteTarget({
      plex: this.plex,
      serverId: () => this.serverIdOrNull(),
      playerId: id
    })
  }

  /** Reset the player list when leaving / switching libraries. */
  resetPlayers(): void {
    this.players = []
    this.playersError = null
  }

  async loadPlayers(): Promise<void> {
    this.playersLoading = true
    this.playersError = null
    try {
      this.players = await this.plex.listPlayers()
      // The synthetic "this Mac" target lives outside the Plex players list,
      // so don't drop it when refreshing — only drop a remote Plexamp id
      // that's no longer reachable.
      if (
        this.target?.kind === 'remote' &&
        !this.players.some((p) => p.clientIdentifier === this.activePlayerId)
      ) {
        this.setActivePlayer(null)
      }
    } catch (err) {
      this.playersError = err instanceof Error ? err.message : String(err)
    } finally {
      this.playersLoading = false
    }
  }

  setActivePlayer(id: string | null): void {
    this.activePlayerId = id
    this.timeline = null
    // A play queue belongs to a player session — switching targets means we
    // know nothing until the next cast or poll-adopt.
    this.activePlayQueueId = null
    this.queueIsOurs = false
    this.queueSnapshot = null
    this.radio.resetForPlayerSwitch()
    try {
      if (id) this.storage.setItem(ACTIVE_PLAYER_KEY, id)
      else this.storage.removeItem(ACTIVE_PLAYER_KEY)
    } catch {
      // storage unavailable; in-memory only
    }
    // Dispose stops local audio immediately; a Plexamp keeps playing (its
    // adapter holds nothing).
    this.target?.dispose()
    this.target = this.buildTarget(id)
    if (id) this.startTimelinePolling()
    else this.stopTimelinePolling()
  }

  // Only remote players have a PlexResource entry — the local target lives
  // outside the players list and describes itself via displayName.
  activePlayer(): PlexResource | null {
    if (this.target?.kind !== 'remote') return null
    return this.players.find((p) => p.clientIdentifier === this.activePlayerId) ?? null
  }

  activePlayerName(): string | null {
    if (!this.activePlayerId) return null
    return this.target?.displayName ?? this.activePlayer()?.name ?? null
  }

  // The local <audio> element pushed a play/pause/timeupdate event — pull the
  // synthesized timeline. (Local queues always originate from our own cast
  // path, which already recorded activePlayQueueId — no adoption needed.)
  private refreshLocalTimeline(): void {
    const target = this.target
    if (!target) return
    void target.getTimeline().then((t) => {
      this.timeline = t
      this.pushNowPlaying()
    })
  }

  async requestCastAlbum(ratingKey: string, title: string, artist: string): Promise<void> {
    await this.castIntent({ kind: 'album', ratingKey, title, artist })
  }

  async requestCastAlbumFromTrack(
    albumRatingKey: string,
    startTrackRatingKey: string,
    title: string,
    artist: string
  ): Promise<void> {
    await this.castIntent({
      kind: 'album',
      ratingKey: albumRatingKey,
      startTrackRatingKey,
      title,
      artist
    })
  }

  async requestCastTrack(ratingKey: string, title: string, artist: string): Promise<void> {
    await this.castIntent({ kind: 'track', ratingKey, title, artist })
  }

  async requestCastMood(sectionKey: string, moodId: string, title: string): Promise<void> {
    await this.castIntent({ kind: 'mood', sectionKey, moodId, title })
  }

  async requestCastPlaylist(ratingKey: string, title: string, shuffle: boolean): Promise<void> {
    await this.castIntent({ kind: 'playlist', ratingKey, title, shuffle })
  }

  // Play just plays — replaces whatever the target is doing, like Plexamp or
  // Tidal. Play Next / Add to Queue are the non-destructive paths.
  private async castIntent(intent: CastIntent): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    if (!this.activePlayerId) {
      this.flashToast('err', 'Pick a player first')
      return
    }
    await this.executeIntent(intent)
  }

  private async executeIntent(intent: CastIntent): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId || !this.target) return
    this.castBusy = true
    try {
      const result = await this.target.cast(intent)
      this.activePlayQueueId = result.playQueueId
      this.queueIsOurs = true
      // Fresh queue → vetoes and the "stop after this album" latch are
      // per-listening-session.
      this.radio.resetForNewQueue()
      const toastLabel =
        intent.kind === 'mood'
          ? `${intent.title} mix on ${result.player.name}`
          : intent.kind === 'playlist'
            ? `${intent.title} on ${result.player.name}`
            : `Playing on ${result.player.name}`
      this.flashToast('ok', toastLabel)
      setTimeout(() => void this.pollTimeline(), 800)
      // Jump to Now Playing for album casts — PlexState seeds + ensures the
      // album detail. Track casts don't auto-open: we'd have to resolve the
      // parent album to latch correctly, and without it the screen flashes the
      // previously loaded album while the timeline catches up. User can click
      // the bar.
      if (intent.kind === 'album') {
        this.#deps.onAlbumCast(intent.ratingKey)
      }
      void this.refreshQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    } finally {
      this.castBusy = false
    }
  }

  startTimelinePolling(): void {
    this.pollLoop.start()
  }

  stopTimelinePolling(): void {
    this.pollLoop.stop()
    this.timeline = null
    this.timelineError = null
  }

  // Manual "poll soon" entry point (after a cast / transport / queue
  // mutation). Routes through the loop so the out-of-band poll replaces the
  // pending tick instead of racing it.
  private pollTimeline(): Promise<void> {
    return this.pollLoop.run()
  }

  // The tick body — what one poll *does*; PollLoop owns when it runs.
  private async pollTick(): Promise<PollTickResult> {
    if (!this.activePlayerId) return 'skip'
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return 'skip'
    const target = this.target
    if (!target) return 'skip'
    try {
      this.timeline = await target.getTimeline()
      // Adopt a queue we didn't create (another controller — e.g. Plexamp on
      // a phone — started it) so the queue panel and Play Next / Add to Queue
      // operate on what's actually playing. Not ours → never auto-extended.
      const polledQueueId = this.timeline?.playQueueID
      if (polledQueueId && polledQueueId !== this.activePlayQueueId) {
        this.activePlayQueueId = polledQueueId
        this.queueIsOurs = false
      }
      this.timelineError = null
      this.pushNowPlaying()
      this.syncVolumeFromDevice()
      this.maybeInvalidateQueueSnapshot()
      void this.radio.consider(this.timeline)
      return 'ok'
    } catch (err) {
      this.timelineError = err instanceof Error ? err.message : String(err)
      return 'error'
    }
  }

  // The device's reported volume wins when we're not the ones changing it —
  // the app launching with a stale remembered value, or someone turning the
  // Pi up from another controller. A recent send (or a pending throttle
  // timer) means the device hasn't caught up to *us* yet — leave the slider
  // alone so it doesn't snap back mid-drag.
  private syncVolumeFromDevice(): void {
    const deviceVolume = this.timeline?.volume
    if (deviceVolume == null) return
    if (this.volumeTimer !== null) return
    if (Date.now() - this.lastVolumeSentAt < 3_000) return
    if (deviceVolume === this.volume) return
    this.volume = deviceVolume
    try {
      this.storage.setItem(VOLUME_KEY, String(deviceVolume))
    } catch {
      // in-memory only
    }
  }

  // Keep the open queue panel honest against the 2.5s timeline poll: when the
  // playing track no longer matches the snapshot's selected item (natural
  // advance, a skip from another controller, an external mutation), refetch.
  // Throttled so a track that legitimately isn't in the queue can't trigger a
  // fetch every tick.
  private lastDriftRefreshAt = 0
  private maybeInvalidateQueueSnapshot(): void {
    if (!this.queueOpen || this.queueLoading) return
    const snap = this.queueSnapshot
    const t = this.timeline
    if (!snap || !t) return
    const selected = snap.items.find((it) => it.playQueueItemID === snap.selectedItemID)
    const inSync = selected
      ? selected.ratingKey === t.ratingKey
      : snap.items.some((it) => it.ratingKey === t.ratingKey)
    if (inSync) return
    const now = Date.now()
    if (now - this.lastDriftRefreshAt < 5_000) return
    this.lastDriftRefreshAt = now
    void this.refreshQueue()
  }

  // --- Radio continuation --------------------------------------------------
  // Plex's continuous=1 flag is supposed to extend the queue automatically but
  // is unreliable on Plexamp targets, so we roll our own. Unlike the old
  // "<90s left on the last track" extender, staging is *predictable*: as soon
  // as playback is on the queue's final album, the next record is picked and
  // appended as real queue items — the queue panel is the preview surface
  // (Radio divider + source badge), no surprise toast. Veto removes the
  // staged tail and recomputes; two vetoes in quick succession mean "stop
  // after this album" for the rest of the session.
  async transport(action: 'pause' | 'play' | 'next' | 'prev' | 'seek', offsetMs?: number): Promise<void> {
    if (!this.target) return
    try {
      await this.target.transport(action, offsetMs)
      setTimeout(() => void this.pollTimeline(), 300)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    }
  }

  // Queue insertion. Modes:
  //   'next'        — directly after the playing track (Plex next=1)
  //   'after-album' — after the playing record finishes (append + move-into-
  //                   place behind the current album's contiguous run)
  //   'end'         — after everything queued
  // With `wipe`, everything AFTER the insert point is cleared first — so
  // next+wipe leaves [this song, your pick], after-album+wipe leaves [rest of
  // record, your pick], and end+wipe keeps the whole queue, puts the pick
  // last, and latches the radio stop-after so it won't continue past it.
  async enqueue(
    kind: 'album' | 'track',
    ratingKey: string,
    title: string,
    artist: string,
    mode: 'next' | 'after-album' | 'end',
    opts: { wipe?: boolean } = {}
  ): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    const playQueueId = this.activePlayQueueId
    if (!playQueueId) {
      if (kind === 'album') await this.requestCastAlbum(ratingKey, title, artist)
      else await this.requestCastTrack(ratingKey, title, artist)
      return
    }
    if (!this.target) return
    const wipe = opts.wipe ?? false
    try {
      // Anchor positions come from a fresh snapshot — the cached one may
      // predate auto-advance.
      let snap: PlayQueueSnapshot | null = null
      if (mode === 'after-album' || wipe) {
        snap = await this.plex.getPlayQueue({ serverId: s.preferredServerId, playQueueId })
      }
      const selIndex = snap
        ? snap.items.findIndex((it) => it.playQueueItemID === snap.selectedItemID)
        : -1
      // Last index of the playing record's contiguous run; equals selIndex
      // when the playing track isn't part of an album run.
      let albumEndIndex = selIndex
      if (snap && selIndex >= 0) {
        const albumKey = snap.items[selIndex].albumRatingKey
        while (
          albumEndIndex + 1 < snap.items.length &&
          albumKey &&
          snap.items[albumEndIndex + 1].albumRatingKey === albumKey
        ) {
          albumEndIndex++
        }
      }

      if (wipe && snap) {
        // Clear everything past the insert point; the insert then collapses
        // to a plain append. Wiped items may include a staged radio tail —
        // drop the state (not a veto; radio may restage per its own rules).
        const anchorIndex = mode === 'next' ? selIndex : mode === 'after-album' ? albumEndIndex : -1
        if (anchorIndex >= 0) {
          await this.clearItemsAfter(anchorIndex, snap, playQueueId)
          this.radio.clearStaged()
        }
      }

      const collapseToEnd = wipe && mode !== 'end'
      const useAfterItem =
        !collapseToEnd && mode === 'after-album' && snap && selIndex >= 0 && albumEndIndex < snap.items.length - 1
      const result = await this.target.queueAdd({
        playQueueId,
        ratingKey,
        mode: useAfterItem ? 'after-item' : mode === 'next' && !collapseToEnd ? 'next' : 'end',
        afterItemId: useAfterItem ? snap!.items[albumEndIndex].playQueueItemID : undefined
      })

      if (wipe && mode === 'end') {
        // "…then stop": the pick is the night's last record.
        this.radio.latchStopAfter()
      }

      if (result.refreshed) {
        const label =
          mode === 'next'
            ? wipe
              ? 'Playing next — queue cleared'
              : 'Playing next'
            : mode === 'after-album'
              ? wipe
                ? 'Playing after this album — queue cleared'
                : 'Playing after this album'
              : wipe
                ? 'Playing last, then stopping'
                : 'Added to queue'
        this.flashToast('ok', label)
      } else {
        // Server queue mutated fine; only the player nudge failed. The next
        // natural queue re-read usually picks it up — warn, don't error.
        this.flashToast('err', 'Queued — the speaker may not have picked it up')
      }
      setTimeout(() => void this.pollTimeline(), 400)
      if (this.queueOpen) void this.refreshQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    }
  }

  toggleQueue(): void {
    if (this.queueOpen) {
      this.queueOpen = false
      return
    }
    this.queueOpen = true
    void this.refreshQueue()
  }

  closeQueue(): void {
    this.queueOpen = false
  }

  async refreshQueue(): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    const playQueueId = this.activePlayQueueId
    if (!playQueueId) {
      this.queueSnapshot = null
      this.queueError = null
      return
    }
    this.queueLoading = true
    this.queueError = null
    try {
      this.queueSnapshot = await this.plex.getPlayQueue({
        serverId: s.preferredServerId,
        playQueueId
      })
    } catch (err) {
      this.queueError = err instanceof Error ? err.message : String(err)
    } finally {
      this.queueLoading = false
    }
  }

  async removeFromQueue(playQueueItemId: number): Promise<void> {
    await this.removeItemsFromQueue([playQueueItemId])
  }

  // Remove a batch of items (e.g. a whole queued album). Per-item deletes —
  // Plex has no bulk endpoint — with the player nudge on the final one only.
  // Optimistic: rows drop immediately; refreshQueue() reconciles after.
  async removeItemsFromQueue(playQueueItemIds: number[]): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    const playQueueId = this.activePlayQueueId
    if (!playQueueId || playQueueItemIds.length === 0 || !this.target) return
    const ids = new Set(playQueueItemIds)
    if (this.queueSnapshot) {
      this.queueSnapshot = {
        ...this.queueSnapshot,
        items: this.queueSnapshot.items.filter((it) => !ids.has(it.playQueueItemID))
      }
    }
    try {
      const { refreshed } = await this.target.queueRemoveMany(playQueueId, playQueueItemIds)
      if (!refreshed) {
        this.flashToast('err', 'Removed — the speaker may not have picked it up')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    } finally {
      void this.refreshQueue()
    }
  }

  // Per-item deletes of everything after `index` (Plex has no bulk clear);
  // only the final one carries the player nudge so Plexamp re-reads the queue
  // once instead of N times. Returns whether that nudge landed.
  private async clearItemsAfter(
    index: number,
    snap: PlayQueueSnapshot,
    playQueueId: number
  ): Promise<boolean> {
    const toRemove = snap.items.slice(index + 1)
    if (toRemove.length === 0 || !this.target) return true
    const { refreshed } = await this.target.queueRemoveMany(
      playQueueId,
      toRemove.map((it) => it.playQueueItemID)
    )
    return refreshed
  }

  async clearUpcoming(): Promise<void> {
    const s = this.session
    if (!s?.signedIn || !s.preferredServerId) return
    const playQueueId = this.activePlayQueueId
    const snap = this.queueSnapshot
    if (!playQueueId || !snap) return
    const sel = snap.items.findIndex((it) => it.playQueueItemID === snap.selectedItemID)
    if (sel < 0 || sel === snap.items.length - 1) return
    this.queueSnapshot = { ...snap, items: snap.items.slice(0, sel + 1) }
    try {
      const refreshed = await this.clearItemsAfter(sel, snap, playQueueId)
      // The staged radio tail (if any) was among the cleared items.
      this.radio.clearStaged()
      this.flashToast(
        'ok',
        refreshed ? 'Cleared upcoming' : 'Cleared — the speaker may not have picked it up'
      )
    } catch (err) {
      this.flashToast('err', err instanceof Error ? err.message : String(err))
    } finally {
      void this.refreshQueue()
    }
  }

  // Item-scoped skip — unlike skipToTrackInQueue (ratingKey-based, used from
  // track rows elsewhere in the app), this resolves duplicates correctly when
  // the same track appears twice in the queue (e.g. History + Up Next).
  async skipToQueueItemId(playQueueItemId: number): Promise<void> {
    if (!this.target) return
    try {
      await this.target.skipToQueueItem(playQueueItemId)
      setTimeout(() => void this.pollTimeline(), 400)
    } catch (err) {
      this.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async skipToTrackInQueue(trackRatingKey: string): Promise<boolean> {
    if (!this.target) return false
    const snap = this.queueSnapshot
    const item = snap?.items.find((it) => it.ratingKey === trackRatingKey)
    if (!item) return false
    try {
      await this.target.skipToQueueItem(item.playQueueItemID)
      setTimeout(() => void this.pollTimeline(), 400)
      return true
    } catch (err) {
      this.flashToast('err', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    this.volume = clamped
    try {
      this.storage.setItem(VOLUME_KEY, String(clamped))
    } catch {
      // in-memory only
    }
    if (!this.target) return
    const throttle = this.target.volumeThrottleMs
    if (throttle === 0) {
      // <audio>.volume is a synchronous local property — apply instantly.
      void this.target.sendVolume(clamped)
      return
    }
    const elapsed = Date.now() - this.lastVolumeSentAt
    if (this.volumeTimer !== null) return
    if (elapsed >= throttle) {
      this.sendVolume()
    } else {
      this.volumeTimer = setTimeout(() => {
        this.volumeTimer = null
        this.sendVolume()
      }, throttle - elapsed)
    }
  }

  private sendVolume(): void {
    const target = this.target
    if (!target) return
    this.lastVolumeSentAt = Date.now()
    void Promise.resolve(target.sendVolume(this.volume)).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.flashToast('err', msg)
    })
  }
}
