import type { ContinuationMode, ContinuationPick, MusicTimeline } from '../../../shared/plex'
import type { Session } from './plex-state.svelte'

type PlexApi = Window['cratedigger']['plex']

export interface StagedContinuation {
  albumRatingKey: string
  title: string
  artist: string
  source: ContinuationPick['source']
  firstItemId: number | null
}

export interface RadioContinuationDeps {
  /** Current Plex session (signed-in flag + preferred server id). */
  session: () => Session | null
  /** The continuation-mode setting (off / album-end / radio). */
  continuationMode: () => ContinuationMode
  /** Target player for the extend call; null when none selected. */
  playerId: () => string | null
  /** Whether the active target can be radio-extended (remote Plexamp: yes;
   *  the local <audio> path would need its own queue-append + cursor logic —
   *  out of scope for v1). */
  radioSupported: () => boolean
  /** The queue we're allowed to operate on. `queueIsOurs` gates staging so we
   *  never extend a listening session another controller started. */
  queueContext: () => { playQueueId: number | null; queueIsOurs: boolean }
  /** Push a fresh snapshot into the queue panel after staging appends. */
  setQueueSnapshot: (snap: Awaited<ReturnType<PlexApi['getPlayQueue']>>) => void
  /** Reconcile the panel after veto/swap mutations. */
  refreshQueue: () => void
  /** Surface a transient toast. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Plex IPC. Tests pass a stub. */
  plex: Pick<PlexApi, 'getPlayQueue' | 'extendQueueWithSimilar' | 'queueRemove'>
}

/**
 * The radio-continuation state machine. Plex's continuous=1 flag is unreliable
 * on Plexamp targets, so we roll our own — and unlike a "<90s left" extender,
 * staging is predictable: as soon as playback is on the queue's FINAL album,
 * the next record is picked and appended as real queue items. The queue panel
 * is the preview surface (Radio divider + source badge); no surprise toast.
 *
 * Lifecycle: `consider(timeline)` on every poll tick drives staging and the
 * staged→current promotion; `veto()` / `swap()` are the panel's divider
 * controls (two vetoes in quick succession latch "stop after this album");
 * `resetForNewQueue()` on cast, `resetForPlayerSwitch()` on target change.
 * The recent-album ring survives both — it's what keeps radio from looping
 * the same few records across casts.
 */
export class RadioContinuation {
  /** The album appended-but-not-yet-reached; firstItemId anchors the Radio
   *  divider in the queue panel. */
  staged = $state<StagedContinuation | null>(null)
  stopAfter = $state(false)

  private stagingInFlight = false
  private lastStageCheckAt = 0
  private lastVetoAt = 0
  private vetoedAlbumKeys: string[] = []
  private recentAlbumKeys: string[] = []
  private lastObservedAlbumKey: string | null = null
  // Last timeline seen by consider() — lets veto() recompute immediately
  // instead of waiting for the next poll tick.
  private lastTimeline: MusicTimeline | null = null

  #deps: RadioContinuationDeps

  constructor(deps: RadioContinuationDeps) {
    this.#deps = deps
  }

  /** Fresh queue from our own cast: vetoes and the stop latch are
   *  per-listening-session; the recent-album ring persists. */
  resetForNewQueue(): void {
    this.staged = null
    this.stopAfter = false
    this.vetoedAlbumKeys = []
    this.lastStageCheckAt = 0
    this.lastVetoAt = 0
  }

  /** Switching players: we know nothing about the new target's queue. */
  resetForPlayerSwitch(): void {
    this.staged = null
    this.stopAfter = false
  }

  /** The staged record's items were removed by someone else (e.g. Clear
   *  upcoming) — drop the state without treating it as a veto. */
  clearStaged(): void {
    this.staged = null
  }

  /** "…then stop": end-of-queue + wipe latches radio off past the pick. */
  latchStopAfter(): void {
    this.stopAfter = true
  }

  /** Poll-tick driver: tracks album transitions, promotes a staged record the
   *  user has reached, and stages the next pick when on the final album. */
  async consider(timeline: MusicTimeline | null): Promise<void> {
    this.lastTimeline = timeline
    this.noteAlbumTransition(timeline)
    if (this.#deps.continuationMode() !== 'radio') return
    if (this.stopAfter) return
    if (this.stagingInFlight) return
    if (!timeline || timeline.state !== 'playing') return
    const albumKey = timeline.albumRatingKey
    if (!albumKey) return
    const playerId = this.#deps.playerId()
    if (!playerId) return
    if (!this.#deps.radioSupported()) return
    const s = this.#deps.session()
    if (!s?.signedIn || !s.preferredServerId) return
    const { playQueueId, queueIsOurs } = this.#deps.queueContext()
    if (!playQueueId) return
    // Only extend queues we created — leaves user-initiated queues from other
    // Plex clients alone.
    if (!queueIsOurs) return

    if (this.staged) {
      if (albumKey === this.staged.albumRatingKey) {
        // Playback advanced into the staged record — it's the user's album
        // now. Clear so the next tick stages the one after it.
        this.staged = null
      }
      return
    }

    // Throttle the snapshot fetch — the poll runs every 2.5s; while mid-queue
    // this check is the only cost.
    const now = Date.now()
    if (now - this.lastStageCheckAt < 15_000) return
    this.lastStageCheckAt = now

    this.stagingInFlight = true
    try {
      const before = await this.#deps.plex.getPlayQueue({
        serverId: s.preferredServerId,
        playQueueId
      })
      if (before.items.length === 0) return
      // Stage only while playing the queue's FINAL album — earlier records
      // (or manually queued ones) still stand between us and silence.
      const tailAlbumKey = before.items[before.items.length - 1].albumRatingKey
      if (tailAlbumKey !== albumKey) return

      const result = await this.#deps.plex.extendQueueWithSimilar({
        serverId: s.preferredServerId,
        playerId,
        playQueueId,
        currentAlbumRatingKey: albumKey,
        excludeAlbumRatingKeys: [...this.recentAlbumKeys, ...this.vetoedAlbumKeys]
      })
      if (!result.ok) return
      // The first appended item anchors the Radio divider in the panel.
      let firstItemId: number | null = null
      try {
        const after = await this.#deps.plex.getPlayQueue({
          serverId: s.preferredServerId,
          playQueueId
        })
        firstItemId = after.items[before.items.length]?.playQueueItemID ?? null
        this.#deps.setQueueSnapshot(after)
      } catch {
        // divider just won't anchor; the next panel refresh reconciles
      }
      this.staged = { ...result.album, firstItemId }
    } catch {
      // next poll retries
    } finally {
      this.stagingInFlight = false
    }
  }

  /** ✕ on the Radio divider: drop the staged record and pick a different one.
   *  A second veto within a few seconds means "stop after this album". */
  async veto(): Promise<void> {
    const staged = this.staged
    if (!staged) return
    const now = Date.now()
    const doubleVeto = now - this.lastVetoAt < 6_000
    this.lastVetoAt = now
    if (doubleVeto) this.stopAfter = true
    await this.removeStagedTail(staged)
    if (doubleVeto) {
      this.#deps.flashToast('ok', 'Stopping after this album')
    } else {
      this.lastStageCheckAt = 0
      void this.consider(this.lastTimeline) // recompute a different record now
    }
  }

  /** ⟳ on the Radio divider: swap the staged record for another suggestion. */
  async swap(): Promise<void> {
    const staged = this.staged
    if (!staged) return
    this.lastVetoAt = 0 // an explicit swap is not a "stop" gesture
    await this.removeStagedTail(staged)
    this.lastStageCheckAt = 0
    void this.consider(this.lastTimeline)
  }

  // Ring buffer of recently finished albums, fed into the picker's exclusion
  // window so radio doesn't loop the same few records.
  private noteAlbumTransition(timeline: MusicTimeline | null): void {
    const key = timeline?.albumRatingKey ?? null
    if (key && this.lastObservedAlbumKey && key !== this.lastObservedAlbumKey) {
      this.recentAlbumKeys.push(this.lastObservedAlbumKey)
      if (this.recentAlbumKeys.length > 5) this.recentAlbumKeys.shift()
    }
    if (key) this.lastObservedAlbumKey = key
  }

  private async removeStagedTail(staged: StagedContinuation): Promise<void> {
    const s = this.#deps.session()
    const { playQueueId } = this.#deps.queueContext()
    if (!s?.signedIn || !s.preferredServerId || !playQueueId) return
    this.vetoedAlbumKeys.push(staged.albumRatingKey)
    this.staged = null
    try {
      const snap = await this.#deps.plex.getPlayQueue({
        serverId: s.preferredServerId,
        playQueueId
      })
      const fromIdx = staged.firstItemId
        ? snap.items.findIndex((it) => it.playQueueItemID === staged.firstItemId)
        : -1
      const toRemove =
        fromIdx >= 0
          ? snap.items.slice(fromIdx)
          : snap.items.filter((it) => it.albumRatingKey === staged.albumRatingKey)
      for (let i = 0; i < toRemove.length; i++) {
        const last = i === toRemove.length - 1
        await this.#deps.plex.queueRemove({
          serverId: s.preferredServerId,
          // One player nudge at the end, not N.
          playerId: last ? this.#deps.playerId() ?? undefined : undefined,
          playQueueId,
          playQueueItemId: toRemove[i].playQueueItemID
        })
      }
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    } finally {
      this.#deps.refreshQueue()
    }
  }
}
