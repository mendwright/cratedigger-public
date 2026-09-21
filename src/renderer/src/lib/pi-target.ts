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

/** The Pi's hostname, which its resident Plexamp uses as its companion-player
 *  name. We drive the living room through the direct player, so this entry is
 *  filtered out of the picker. Mirrors PI_HOST in src/main/pi-player.ts. */
export const PI_PLEXAMP_PLAYER_NAME = 'pi-dac-living-room'

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
    // Library casts are on: the direct player is THE living-room player now
    // (decision 2026-09-16 evening — Plexamp retires once mobile is
    // Mary-ready). It plays both radio and library; the brief radio-only
    // window earlier that day is gone.
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
      // Main stamps the station's display title onto the status; the old
      // renderer-side ratingKey mapping only knew two stations.
      const station = status.station ?? 'Internet radio'
      const parts = (status.streamTitle ?? '')
        .split(' - ')
        .map((s) => s.trim())
        .filter(Boolean)
      const split = parts.length >= 2
      // Track-queue stations (SiriusXM Xtra) report real per-track metadata
      // and positions. Live SiriusXM channels get song/artist stamped by main
      // from the sxm-proxy now-playing feed (their HLS has no icy text), so
      // explicit metadata wins wherever it exists; icy parsing is the last
      // resort for plain streams.
      const isQueueTrack = Boolean(status.title && status.ratingKey?.startsWith('sxm:'))
      const hasOwnMeta = Boolean(status.title)
      return {
        state: status.state,
        time: isQueueTrack ? Math.round((status.seconds ?? 0) * 1000) : 0,
        duration: isQueueTrack && status.duration ? Math.round(status.duration * 1000) : 0,
        title: hasOwnMeta
          ? status.title!
          : split
            ? parts[isKexp ? 0 : 1]
            : status.streamTitle?.trim() || station,
        artist: hasOwnMeta ? (status.artist ?? '') : split ? parts[isKexp ? 1 : 0] : '',
        album: `((·)) ${isQueueTrack && status.album ? status.album : station} — live`,
        ratingKey: status.ratingKey ?? '',
        albumRatingKey: null,
        thumb: null,
        // Song art straight from the station's feed (SiriusXM live channels);
        // the iTunes lookup and the bundled station tile are the fallbacks.
        artUrl: status.art ?? null,
        playQueueID: null,
        volume: status.volume
      }
    }
    // A phone/agent can replace the queue while this app is closed or idle.
    // Adopt it read-only: resyncQueue would write our copy back to the Pi.
    const queueId = status.playQueueId ?? null
    if (queueId && this.snapshot?.playQueueID !== queueId) {
      this.snapshot = null
      try {
        this.snapshot = await this.#deps.plex.getPlayQueue({
          serverId: this.sid(), playQueueId: queueId
        })
      } catch {
        // Receiver metadata still lights up transport when PMS is unavailable.
      }
    }
    const item = this.snapshot?.items.find((i) => i.ratingKey === status.ratingKey)
    if (!status.ratingKey) return null
    return {
      state: status.state,
      time: Math.round((status.seconds ?? 0) * 1000),
      duration: Math.round((status.duration ?? (item?.duration ?? 0) / 1000) * 1000),
      title: status.title ?? item?.title ?? '',
      artist: status.artist ?? item?.artist ?? '',
      album: status.album ?? item?.album ?? '',
      ratingKey: status.ratingKey,
      albumRatingKey: item?.albumRatingKey ?? null,
      thumb: item?.thumb ?? null,
      playQueueID: queueId ?? (item ? this.snapshot?.playQueueID ?? null : null),
      volume: status.volume
    }
  }

  dispose(): void {
    // Like Plexamp, this remote player keeps playing when its controller
    // switches targets or closes. Only an explicit playback command stops it.
  }
}
