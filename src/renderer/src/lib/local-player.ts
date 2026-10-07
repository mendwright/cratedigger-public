import type { MusicTimeline, PlayQueueItem, PlayQueueSnapshot } from '../../../shared/plex'

// Stable, recognizable ID for the synthetic "this Mac" player. Used as the
// activePlayerId value in plexState so all the existing Plex-Companion call
// sites can branch on it before issuing a Plex Companion request.
export const LOCAL_PLAYER_ID = 'local:this-mac'
export const LOCAL_PLAYER_NAME = 'This Mac'

export function isLocalPlayerId(id: string | null | undefined): boolean {
  return id === LOCAL_PLAYER_ID
}

interface LocalPlayerHooks {
  // Called whenever audio element state or queue position changes — drives
  // the renderer's `timeline` so the now-playing bar updates immediately
  // without waiting for a poll tick.
  onTimelineChange(): void
  // Called when the audio element fires an error event (decode/CORS/load
  // failure) or play() rejects. Routed to a toast so silent failures aren't
  // a mystery.
  onError(message: string): void
}

export class LocalPlayer {
  private audio: HTMLAudioElement
  private hooks: LocalPlayerHooks
  private serverId: string | null = null
  private queue: PlayQueueSnapshot | null = null
  // Index into queue.items of the currently-selected track. Kept independent
  // of audio.src so we can synthesize timeline when audio hasn't loaded yet.
  private cursor = 0

  constructor(hooks: LocalPlayerHooks) {
    this.hooks = hooks
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.addEventListener('play', () => this.hooks.onTimelineChange())
    this.audio.addEventListener('pause', () => this.hooks.onTimelineChange())
    this.audio.addEventListener('ended', () => {
      // Advance into the next queue item. If we've hit the tail, stop —
      // continuous-playback extension is the next thing to wire up, but in
      // v1 the album just ends.
      if (this.queue && this.cursor + 1 < this.queue.items.length) {
        this.cursor += 1
        void this.loadCurrent({ autoplay: true })
      } else {
        this.hooks.onTimelineChange()
      }
    })
    this.audio.addEventListener('timeupdate', () => this.hooks.onTimelineChange())
    this.audio.addEventListener('durationchange', () => this.hooks.onTimelineChange())
    this.audio.addEventListener('loadedmetadata', () => this.hooks.onTimelineChange())
    this.audio.addEventListener('error', () => {
      const err = this.audio.error
      const code = err?.code
      const msg =
        code === 1 ? 'audio aborted'
        : code === 2 ? 'network error loading audio'
        : code === 3 ? 'audio decode failed (codec not supported?)'
        : code === 4 ? 'audio source not supported'
        : 'audio error'
      this.hooks.onError(`This Mac playback: ${msg}`)
      this.hooks.onTimelineChange()
    })
  }

  attachServer(serverId: string): void {
    this.serverId = serverId
  }

  detach(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.queue = null
    this.cursor = 0
    this.hooks.onTimelineChange()
  }

  hasQueue(): boolean {
    return this.queue !== null && this.queue.items.length > 0
  }

  currentPlayQueueId(): number | null {
    return this.queue?.playQueueID ?? null
  }

  // Adopt a freshly created play queue, seek the cursor to the requested
  // start track (defaults to the first item), and begin playing.
  async loadQueue(
    snapshot: PlayQueueSnapshot,
    startRatingKey?: string
  ): Promise<void> {
    this.queue = snapshot
    if (startRatingKey) {
      const idx = snapshot.items.findIndex((i) => i.ratingKey === startRatingKey)
      this.cursor = idx >= 0 ? idx : 0
    } else if (snapshot.selectedItemID !== null) {
      const idx = snapshot.items.findIndex((i) => i.playQueueItemID === snapshot.selectedItemID)
      this.cursor = idx >= 0 ? idx : 0
    } else {
      this.cursor = 0
    }
    await this.loadCurrent({ autoplay: true })
  }

  // Refresh the queue snapshot in place — e.g. after an enqueueNext/enqueueEnd
  // mutation on Plex's side. Preserves the current cursor by matching the
  // playQueueItemID, falling back to ratingKey if that's gone.
  refreshQueue(snapshot: PlayQueueSnapshot): void {
    const currentItem = this.queue?.items[this.cursor]
    this.queue = snapshot
    if (!currentItem) {
      this.cursor = 0
    } else {
      let idx = snapshot.items.findIndex(
        (i) => i.playQueueItemID === currentItem.playQueueItemID
      )
      if (idx < 0) idx = snapshot.items.findIndex((i) => i.ratingKey === currentItem.ratingKey)
      this.cursor = idx >= 0 ? idx : 0
    }
    this.hooks.onTimelineChange()
  }

  async play(): Promise<void> {
    if (!this.queue) return
    if (!this.audio.src) {
      await this.loadCurrent({ autoplay: true })
      return
    }
    try {
      await this.audio.play()
    } catch (err) {
      this.hooks.onError(
        `This Mac playback: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  pause(): void {
    this.audio.pause()
  }

  async next(): Promise<void> {
    if (!this.queue) return
    if (this.cursor + 1 >= this.queue.items.length) return
    this.cursor += 1
    await this.loadCurrent({ autoplay: true })
  }

  async prev(): Promise<void> {
    if (!this.queue) return
    // Mirror typical media-player behavior: if we're >3s into the track,
    // restart it; otherwise jump to the previous track.
    if (this.audio.currentTime > 3 || this.cursor === 0) {
      this.audio.currentTime = 0
      if (this.audio.paused) await this.play()
      return
    }
    this.cursor -= 1
    await this.loadCurrent({ autoplay: true })
  }

  seek(offsetMs: number): void {
    if (!this.audio.duration) return
    const sec = Math.max(0, offsetMs / 1000)
    this.audio.currentTime = Math.min(sec, this.audio.duration)
  }

  async skipToQueueItem(playQueueItemID: number): Promise<void> {
    if (!this.queue) return
    const idx = this.queue.items.findIndex((i) => i.playQueueItemID === playQueueItemID)
    if (idx < 0) return
    this.cursor = idx
    await this.loadCurrent({ autoplay: true })
  }

  setVolume(volume0to100: number): void {
    const v = Math.max(0, Math.min(1, volume0to100 / 100))
    this.audio.volume = v
    this.hooks.onTimelineChange()
  }

  getVolume(): number {
    return Math.round(this.audio.volume * 100)
  }

  // Synthesize the same MusicTimeline shape the Plex Companion API returns,
  // so the rest of the renderer (now-playing bar, media-keys metadata, etc.)
  // doesn't need to know whether playback is local or remote.
  buildTimeline(): MusicTimeline | null {
    if (!this.queue) return null
    const item = this.queue.items[this.cursor]
    if (!item) return null
    const state: MusicTimeline['state'] = this.audio.error
      ? 'stopped'
      : this.audio.paused
        ? this.audio.currentTime > 0
          ? 'paused'
          : 'stopped'
        : 'playing'
    // Prefer the audio element's reported duration (sample-accurate once
    // metadata loads); fall back to Plex's queue-item duration so the
    // progress bar has a denominator before audio metadata arrives.
    const durSec = Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : item.duration / 1000
    return {
      state,
      time: Math.round(this.audio.currentTime * 1000),
      duration: Math.round(durSec * 1000),
      title: item.title,
      artist: item.artist,
      album: item.album,
      ratingKey: item.ratingKey,
      albumRatingKey: item.albumRatingKey,
      thumb: item.thumb,
      playQueueID: this.queue.playQueueID,
      volume: Math.round(this.audio.volume * 100)
    }
  }

  currentItem(): PlayQueueItem | null {
    if (!this.queue) return null
    return this.queue.items[this.cursor] ?? null
  }

  private async loadCurrent(opts: { autoplay: boolean }): Promise<void> {
    if (!this.queue || !this.serverId) return
    const item = this.queue.items[this.cursor]
    if (!item) return
    let url: string
    try {
      const res = await window.cratedigger.plex.getTrackStreamUrl({
        serverId: this.serverId,
        ratingKey: item.ratingKey
      })
      url = res.url
    } catch (err) {
      // Stream URL lookup failed (server unreachable, track removed).
      this.audio.removeAttribute('src')
      this.audio.load()
      this.hooks.onError(
        `Stream URL lookup failed: ${err instanceof Error ? err.message : String(err)}`
      )
      this.hooks.onTimelineChange()
      return
    }
    this.audio.src = url
    this.audio.load()
    this.hooks.onTimelineChange()
    if (opts.autoplay) {
      try {
        await this.audio.play()
      } catch {
        // play() may reject if there's no user gesture in the chain yet —
        // user clicked Play Album which is a gesture, so this should work,
        // but if it fails the play/pause event will reflect actual state.
      }
    }
  }
}
