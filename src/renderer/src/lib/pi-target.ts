import type {
  ContinuationPick,
  MusicTimeline,
  PiQueueTrack,
  PlayQueueSnapshot,
  RadioSteer
} from '../../../shared/plex'
import type { CastIntent, CastResult, PlaybackTarget } from './playback-target'

// Synthetic player id for the living-room Pi driven directly over SSH
// (src/main/pi-player.ts). Personal build only — PlayerPicker hides the
// entry on PUBLIC_BUILD and preload doesn't expose the bridge there.
export const PI_PLAYER_ID = 'pi:living-room'
export const PI_PLAYER_NAME = 'Living Room (direct)'

export function isPiPlayerId(id: string | null | undefined): boolean {
  return id === PI_PLAYER_ID
}

type PlexApi = Window['cratedigger']['plex']
type PiApi = NonNullable<Window['cratedigger']['pi']>

interface PiTargetDeps {
  plex: PlexApi
  pi: PiApi
  serverId: () => string | null
  /** The app's remembered volume — sent with the first cast so playback never
   *  starts at the receiver's conservative default. */
  volume: () => number
  onError: (msg: string) => void
}

function toPiTracks(snapshot: PlayQueueSnapshot): PiQueueTrack[] {
  return snapshot.items.map((i) => ({
    ratingKey: i.ratingKey,
    title: i.title,
    artist: i.artist,
    album: i.album,
    duration: i.duration,
    playQueueItemID: i.playQueueItemID
  }))
}

/**
 * Third PlaybackTarget adapter: a real Plex play queue (so the queue panel,
 * Now Playing and radio continuation all work exactly like the other targets)
 * whose audio comes out of mpv on the living-room Pi instead of a Plexamp.
 * Queue mutations follow the LocalTarget ritual — mutate server-side, re-read
 * the snapshot — plus one extra step: push the refreshed track list to the
 * receiver, which splices it around the playing track without a gap.
 */
export class PiTarget implements PlaybackTarget {
  readonly kind = 'pi' as const
  readonly displayName = PI_PLAYER_NAME
  readonly supportsRadio = true
  readonly volumeThrottleMs = 150

  #deps: PiTargetDeps
  // Receiver track order mirrors this snapshot's items; kept for
  // playQueueItemID → index mapping and timeline metadata (thumb, album key).
  private snapshot: PlayQueueSnapshot | null = null

  constructor(deps: PiTargetDeps) {
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
    if (intent.kind === 'mood') {
      throw new Error(`Mood mixes are not supported on ${PI_PLAYER_NAME} yet`)
    }
    const serverId = this.sid()
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
    this.snapshot = snapshot
    const startKey =
      intent.kind === 'album' && intent.startTrackRatingKey
        ? intent.startTrackRatingKey
        : undefined
    let startIndex = startKey
      ? snapshot.items.findIndex((i) => i.ratingKey === startKey)
      : snapshot.selectedItemID !== null
        ? snapshot.items.findIndex((i) => i.playQueueItemID === snapshot.selectedItemID)
        : 0
    if (startIndex < 0) startIndex = 0
    await this.#deps.pi.loadQueue({
      serverId,
      playQueueId: snapshot.playQueueID,
      tracks: toPiTracks(snapshot),
      startIndex,
      volume: this.#deps.volume()
    })
    return {
      playQueueId: created.playQueueId,
      player: { id: PI_PLAYER_ID, name: PI_PLAYER_NAME }
    }
  }

  async transport(
    action: 'pause' | 'play' | 'next' | 'prev' | 'seek',
    offsetMs?: number
  ): Promise<void> {
    await this.#deps.pi.transport({
      action,
      seconds: action === 'seek' && typeof offsetMs === 'number' ? offsetMs / 1000 : undefined
    })
  }

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

  // Server-side queue changed shape — re-read it and hand the receiver the
  // new track order so mpv's playlist follows without interrupting playback.
  private async resyncQueue(playQueueId: number): Promise<void> {
    try {
      const serverId = this.sid()
      const snapshot = await this.#deps.plex.getPlayQueue({ serverId, playQueueId })
      this.snapshot = snapshot
      await this.#deps.pi.refreshQueue({ serverId, tracks: toPiTracks(snapshot) })
    } catch (err) {
      this.#deps.onError(
        `${PI_PLAYER_NAME} queue sync failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  async radioExtend(args: {
    playQueueId: number
    currentAlbumRatingKey: string
    excludeAlbumRatingKeys: string[]
    steer: RadioSteer
  }): Promise<{ ok: true; album: ContinuationPick } | { ok: false; reason: string }> {
    const result = await this.#deps.plex.extendQueueWithSimilar({
      serverId: this.sid(),
      ...args
    })
    if (result.ok) await this.resyncQueue(args.playQueueId)
    return result
  }

  async skipToQueueItem(playQueueItemId: number): Promise<void> {
    const idx = this.snapshot?.items.findIndex((i) => i.playQueueItemID === playQueueItemId) ?? -1
    if (idx < 0) return
    await this.#deps.pi.skip(idx)
  }

  async sendVolume(volume: number): Promise<void> {
    await this.#deps.pi.setVolume(volume)
  }

  async getTimeline(): Promise<MusicTimeline | null> {
    const status = await this.#deps.pi.status()
    if (!status) return null
    if (status.source === 'radio') {
      // Split the stream metadata so the bar and the macOS Now Playing center
      // show a real song, station as the album. Orders differ per station:
      // KEXP sends "Song - Artist( - Album)", Radio Paradise "Artist - Song".
      const isKexp = status.ratingKey === 'radio:kexp'
      const station = isKexp
        ? 'KEXP'
        : status.ratingKey === 'radio:paradise'
          ? 'Radio Paradise'
          : 'Internet radio'
      const parts = (status.streamTitle ?? '')
        .split(' - ')
        .map((s) => s.trim())
        .filter(Boolean)
      const split = parts.length >= 2
      // Track-queue stations (SiriusXM Xtra) report real per-track metadata
      // and positions; live streams fall back to icy-text parsing.
      const isQueueTrack = Boolean(status.title && status.ratingKey?.startsWith('sxm:'))
      return {
        state: status.state,
        time: isQueueTrack ? Math.round((status.seconds ?? 0) * 1000) : 0,
        duration: isQueueTrack && status.duration ? Math.round(status.duration * 1000) : 0,
        title: isQueueTrack
          ? status.title!
          : split
            ? parts[isKexp ? 0 : 1]
            : status.streamTitle?.trim() || station,
        artist: isQueueTrack ? (status.artist ?? '') : split ? parts[isKexp ? 1 : 0] : '',
        album: `((·)) ${isQueueTrack && status.album ? status.album : station} — live`,
        ratingKey: status.ratingKey ?? '',
        albumRatingKey: null,
        thumb: null,
        playQueueID: null,
        volume: status.volume
      }
    }
    const item =
      this.snapshot?.items.find((i) => i.ratingKey === status.ratingKey) ??
      (status.index !== null ? this.snapshot?.items[status.index] : undefined)
    if (!item) return null
    return {
      state: status.state,
      time: Math.round((status.seconds ?? 0) * 1000),
      duration: Math.round((status.duration ?? item.duration / 1000) * 1000),
      title: item.title,
      artist: item.artist,
      album: item.album,
      ratingKey: item.ratingKey,
      albumRatingKey: item.albumRatingKey,
      thumb: item.thumb,
      playQueueID: this.snapshot?.playQueueID ?? null,
      volume: status.volume
    }
  }

  dispose(): void {
    // Switching away hands the DAC back to Plexamp; fire-and-forget so the
    // picker doesn't wait on an SSH round trip.
    void this.#deps.pi.stopSession().catch(() => {})
  }
}
