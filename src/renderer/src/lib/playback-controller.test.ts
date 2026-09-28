import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MusicTimeline, PlayQueueSnapshot } from '../../../shared/plex'
import { PlaybackController, type PlaybackDeps } from './playback-controller.svelte'

type PlexApi = Window['cratedigger']['plex']
type MediaKeysApi = Window['cratedigger']['mediaKeys']

const REMOTE = 'plexamp-pi'
const SERVER = 'srv-1'

/** Map-backed stand-in for localStorage behind the storage seam. */
function makeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  }
}

function timeline(overrides: Partial<MusicTimeline> = {}): MusicTimeline {
  return {
    state: 'playing',
    title: 'A Song',
    artist: 'An Artist',
    album: 'An Album',
    time: 1000,
    duration: 200_000,
    playQueueID: 42,
    albumRatingKey: 'alb-1',
    ratingKey: 'trk-1',
    ...overrides
  } as MusicTimeline
}

function queue(items: { ratingKey: string; playQueueItemID: number }[]): PlayQueueSnapshot {
  return { playQueueID: 42, items } as unknown as PlayQueueSnapshot
}

/** A Plex IPC stub: vi.fn for every method the controller might reach for. */
function makePlex() {
  return {
    listPlayers: vi.fn(async () => []),
    getTimeline: vi.fn(async () => null as MusicTimeline | null),
    getPlayQueue: vi.fn(async () => queue([])),
    castPlayAlbum: vi.fn(async () => ({ playQueueId: 42, player: { id: REMOTE, name: 'Pi' } })),
    castPlayTrack: vi.fn(async () => ({ playQueueId: 42, player: { id: REMOTE, name: 'Pi' } })),
    castMood: vi.fn(async () => ({ playQueueId: 42, player: { id: REMOTE, name: 'Pi' } })),
    createLocalAlbumQueue: vi.fn(async () => ({ playQueueId: 7 })),
    createLocalTrackQueue: vi.fn(async () => ({ playQueueId: 7 })),
    transport: vi.fn(async () => ({ ok: true as const })),
    setVolume: vi.fn(async () => ({ ok: true as const })),
    queueUpdate: vi.fn(async () => ({ ok: true as const, refreshed: true })),
    queueRemove: vi.fn(
      async (_args: { playQueueItemId: number; playerId?: string; playQueueId: number }) => ({
        ok: true as const,
        refreshed: true
      })
    ),
    extendQueueWithSimilar: vi.fn(
      async (_args: { excludeAlbumRatingKeys?: string[]; currentAlbumRatingKey: string }) => ({
        ok: true as const,
        album: {
          albumRatingKey: 'alb-next',
          title: 'Next One',
          artist: 'Some Artist',
          source: 'similar' as const
        }
      })
    ),
    playerSkipTo: vi.fn(async () => ({ ok: true as const }))
  }
}

function makeController(
  opts: {
    continuation?: 'off' | 'album-end' | 'radio'
    storage?: ReturnType<typeof makeStorage>
  } = {}
) {
  const plex = makePlex()
  const toasts: { kind: string; text: string }[] = []
  const albumCasts: string[] = []
  const mediaKeys = { setMetadata: vi.fn(), onCommand: vi.fn() }
  const storage = opts.storage ?? makeStorage()
  const deps: PlaybackDeps = {
    session: () => ({ signedIn: true, user: {} as never, preferredServerId: SERVER }),
    continuationMode: () => opts.continuation ?? 'radio',
    flashToast: (kind, text) => toasts.push({ kind, text }),
    onAlbumCast: (rk) => albumCasts.push(rk),
    storage,
    plex: plex as unknown as PlexApi,
    mediaKeys: mediaKeys as unknown as MediaKeysApi
  }
  const c = new PlaybackController(deps)
  return { c, plex, toasts, albumCasts, mediaKeys, storage }
}

describe('PlaybackController', () => {
  // Fake only the timers, not Date — the continuous-extender + volume throttle
  // compare against Date.now(), which we want to be real wall-clock time.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  describe('player persistence', () => {
    it('persists the active player id through the storage seam and restores it', () => {
      const storage = makeStorage()
      const { c } = makeController({ storage })
      c.setActivePlayer(REMOTE)
      expect(storage.getItem('jayamp:activePlayerId')).toBe(REMOTE)

      // A fresh controller over the same storage picks the player back up…
      const { c: c2 } = makeController({ storage })
      expect(c2.activePlayerId).toBe(REMOTE)

      // …and clearing the player removes the persisted id.
      c2.setActivePlayer(null)
      expect(storage.getItem('jayamp:activePlayerId')).toBeNull()
    })

    it('persists and restores the volume', () => {
      const storage = makeStorage()
      const { c } = makeController({ storage })
      c.setVolume(37)
      const { c: c2 } = makeController({ storage })
      expect(c2.volume).toBe(37)
    })
  })

  describe('casting', () => {
    it('refuses to cast with no active player', async () => {
      const { c, plex, toasts } = makeController()
      await c.requestCastAlbum('alb-1', 'Album', 'Artist')
      expect(plex.castPlayAlbum).not.toHaveBeenCalled()
      expect(toasts).toContainEqual({ kind: 'err', text: 'Pick a player first' })
    })

    it('casts straight to an idle remote player and jumps to Now Playing', async () => {
      const { c, plex, albumCasts, toasts } = makeController()
      c.setActivePlayer(REMOTE)
      plex.getTimeline.mockResolvedValueOnce(null) // nothing currently playing

      await c.requestCastAlbum('alb-1', 'Album', 'Artist')

      expect(plex.castPlayAlbum).toHaveBeenCalledTimes(1)
      expect(c.activePlayQueueId).toBe(42)
      expect(c.queueIsOurs).toBe(true)
      expect(albumCasts).toEqual(['alb-1'])
      expect(toasts).toContainEqual({ kind: 'ok', text: 'Playing on Pi' })
    })

    it('casts immediately even when the remote player is mid-playback (play just plays)', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      plex.getTimeline.mockResolvedValue(timeline({ state: 'playing' }))

      await c.requestCastAlbum('alb-1', 'Album', 'Artist')

      // No pre-flight timeline check, no confirmation hold — straight to cast.
      expect(plex.castPlayAlbum).toHaveBeenCalledTimes(1)
    })
  })

  describe('timeline poll backoff', () => {
    it('reschedules 2.5s out after a successful poll', async () => {
      const { c, plex } = makeController()
      plex.getTimeline.mockResolvedValue(timeline())
      c.setActivePlayer(REMOTE) // schedules the first poll at delay 0

      await vi.advanceTimersByTimeAsync(0)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(2499)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(plex.getTimeline).toHaveBeenCalledTimes(2)
    })

    it('backs off exponentially while the player is unreachable', async () => {
      const { c, plex } = makeController()
      plex.getTimeline.mockRejectedValue(new Error('offline'))
      c.setActivePlayer(REMOTE)

      await vi.advanceTimersByTimeAsync(0)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1)
      expect(c.timelineError).toBe('offline')

      // first failure → 2500 * 2^0 = 2500ms (normal cadence; a lone failure is
      // usually a transient transition timeout, so we don't back off yet)
      await vi.advanceTimersByTimeAsync(2499)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(plex.getTimeline).toHaveBeenCalledTimes(2)

      // second failure → 2500 * 2^1 = 5000ms
      await vi.advanceTimersByTimeAsync(4999)
      expect(plex.getTimeline).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(plex.getTimeline).toHaveBeenCalledTimes(3)
    })

    it('stops polling and clears state when the player is cleared', async () => {
      const { c, plex } = makeController()
      plex.getTimeline.mockResolvedValue(timeline())
      c.setActivePlayer(REMOTE)
      await vi.advanceTimersByTimeAsync(0)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1)

      c.setActivePlayer(null)
      expect(c.timeline).toBeNull()
      await vi.advanceTimersByTimeAsync(5000)
      expect(plex.getTimeline).toHaveBeenCalledTimes(1) // no further polls
    })
  })

  describe('radio continuation', () => {
    // A stateful queue stub: extend appends the picked album's items, remove
    // deletes by playQueueItemID — mirrors how the server-side queue evolves.
    function statefulQueue(plex: ReturnType<typeof makePlex>) {
      const items: { ratingKey: string; playQueueItemID: number; albumRatingKey: string }[] = [
        { ratingKey: 'trk-1', playQueueItemID: 9, albumRatingKey: 'alb-1' }
      ]
      plex.getPlayQueue.mockImplementation(async () => queue([...items]))
      plex.extendQueueWithSimilar.mockImplementation(async () => {
        items.push({ ratingKey: 'trk-n1', playQueueItemID: 10, albumRatingKey: 'alb-next' })
        return {
          ok: true as const,
          album: {
            albumRatingKey: 'alb-next',
            title: 'Next One',
            artist: 'Some Artist',
            source: 'similar' as const
          }
        }
      })
      plex.queueRemove.mockImplementation(async (args: { playQueueItemId: number }) => {
        const i = items.findIndex((it) => it.playQueueItemID === args.playQueueItemId)
        if (i >= 0) items.splice(i, 1)
        return { ok: true as const, refreshed: true }
      })
      return items
    }

    async function castAndStage(c: PlaybackController, plex: ReturnType<typeof makePlex>) {
      plex.getTimeline.mockResolvedValue(timeline()) // track 1, plenty of time left
      c.setActivePlayer(REMOTE)
      await c.requestCastAlbum('alb-1', 'Album', 'Artist') // own queue 42
      await vi.advanceTimersByTimeAsync(0) // first poll → staging
    }

    it('stages the next album as soon as the final album is playing — no end-of-track window', async () => {
      const { c, plex, toasts } = makeController({ continuation: 'radio' })
      statefulQueue(plex)
      await castAndStage(c, plex)

      expect(plex.extendQueueWithSimilar).toHaveBeenCalledTimes(1)
      expect(c.radio.staged).toMatchObject({
        albumRatingKey: 'alb-next',
        title: 'Next One',
        source: 'similar',
        firstItemId: 10
      })
      // The queue is the preview surface — no surprise toast.
      expect(toasts.map((t) => t.text)).not.toContainEqual(
        expect.stringContaining('Up next')
      )
    })

    it('never extends a queue adopted from another controller', async () => {
      const { c, plex } = makeController({ continuation: 'radio' })
      statefulQueue(plex)
      // The queue arrived via the timeline poll (e.g. started from Plexamp
      // on a phone) — not ours to extend.
      plex.getTimeline.mockResolvedValue(timeline())
      c.setActivePlayer(REMOTE)

      await vi.advanceTimersByTimeAsync(0)
      expect(c.activePlayQueueId).toBe(42) // adopted for display/mutation
      expect(c.queueIsOurs).toBe(false)
      expect(plex.extendQueueWithSimilar).not.toHaveBeenCalled()
    })

    it('does nothing unless the mode is radio', async () => {
      const { c, plex } = makeController({ continuation: 'album-end' })
      statefulQueue(plex)
      await castAndStage(c, plex)
      expect(plex.extendQueueWithSimilar).not.toHaveBeenCalled()
    })

    it('does not stage while earlier queue albums still stand before the tail', async () => {
      const { c, plex } = makeController({ continuation: 'radio' })
      const items = statefulQueue(plex)
      // A second, manually queued album after the playing one.
      items.push({ ratingKey: 'trk-2', playQueueItemID: 11, albumRatingKey: 'alb-2' })
      await castAndStage(c, plex)
      expect(plex.extendQueueWithSimilar).not.toHaveBeenCalled()
    })

    it('veto removes the staged tail and recomputes with the album excluded', async () => {
      const { c, plex } = makeController({ continuation: 'radio' })
      const items = statefulQueue(plex)
      await castAndStage(c, plex)
      expect(items.some((it) => it.albumRatingKey === 'alb-next')).toBe(true)

      await c.radio.veto()
      await vi.advanceTimersByTimeAsync(0) // flush the fire-and-forget restage

      // Staged tail deleted (one player nudge on the final delete)…
      expect(plex.queueRemove).toHaveBeenCalledWith(
        expect.objectContaining({ playQueueItemId: 10, playerId: REMOTE })
      )
      // …and a replacement computed with the vetoed album excluded.
      expect(plex.extendQueueWithSimilar).toHaveBeenCalledTimes(2)
      expect(plex.extendQueueWithSimilar).toHaveBeenLastCalledWith(
        expect.objectContaining({
          excludeAlbumRatingKeys: expect.arrayContaining(['alb-next'])
        })
      )
    })

    it('a second veto in quick succession stops after this album', async () => {
      const { c, plex, toasts } = makeController({ continuation: 'radio' })
      statefulQueue(plex)
      await castAndStage(c, plex)

      await c.radio.veto() // restages (extend call #2)
      await vi.advanceTimersByTimeAsync(0) // flush the restage
      await c.radio.veto() // within 6s → stop

      expect(c.radio.stopAfter).toBe(true)
      expect(c.radio.staged).toBeNull()
      expect(toasts).toContainEqual({ kind: 'ok', text: 'Stopping after this album' })
      // No further staging once stopped.
      expect(plex.extendQueueWithSimilar).toHaveBeenCalledTimes(2)
    })
  })

  describe('enqueue', () => {
    it('falls back to a fresh cast when there is no queue yet', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      plex.getTimeline.mockResolvedValueOnce(null)
      // No queue adopted or cast yet → enqueue can't target one.
      await c.enqueue('album', 'alb-9', 'Album', 'Artist', 'end')

      expect(plex.queueUpdate).not.toHaveBeenCalled()
      expect(plex.castPlayAlbum).toHaveBeenCalledTimes(1)
    })

    it('mutates the existing queue when one is active', async () => {
      const { c, plex, toasts } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42 // pretend a queue already exists

      await c.enqueue('track', 'trk-9', 'Song', 'Artist', 'next')

      expect(plex.queueUpdate).toHaveBeenCalledTimes(1)
      expect(plex.queueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ playQueueId: 42, ratingKey: 'trk-9', mode: 'next' })
      )
      expect(toasts).toContainEqual({ kind: 'ok', text: 'Playing next' })
    })

    // Queue: [played alb-1 track] [CURRENT alb-1] [alb-1 tail] [alb-2 track]
    const MID_QUEUE = {
      playQueueID: 42,
      selectedItemID: 9,
      items: [
        { ratingKey: 'trk-1', playQueueItemID: 8, albumRatingKey: 'alb-1' },
        { ratingKey: 'trk-2', playQueueItemID: 9, albumRatingKey: 'alb-1' },
        { ratingKey: 'trk-3', playQueueItemID: 10, albumRatingKey: 'alb-1' },
        { ratingKey: 'trk-4', playQueueItemID: 11, albumRatingKey: 'alb-2' }
      ]
    } as unknown as PlayQueueSnapshot

    it('after-album anchors behind the current record (after-item + afterItemId)', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42
      plex.getPlayQueue.mockResolvedValue(MID_QUEUE)

      await c.enqueue('album', 'alb-9', 'Album', 'Artist', 'after-album')

      expect(plex.queueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'after-item', afterItemId: 10 })
      )
    })

    it('after-album collapses to a plain append when the record is already the tail', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42
      plex.getPlayQueue.mockResolvedValue({
        ...MID_QUEUE,
        items: MID_QUEUE.items.slice(0, 3) // alb-1 only
      } as PlayQueueSnapshot)

      await c.enqueue('album', 'alb-9', 'Album', 'Artist', 'after-album')

      expect(plex.queueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'end', afterItemId: undefined })
      )
    })

    it('next + wipe clears everything after the current song, then appends', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42
      plex.getPlayQueue.mockResolvedValue(MID_QUEUE)

      await c.enqueue('track', 'trk-9', 'Song', 'Artist', 'next', { wipe: true })

      // Items 10 and 11 follow the current song — both removed, single player
      // nudge on the final delete.
      expect(plex.queueRemove).toHaveBeenCalledTimes(2)
      expect(plex.queueRemove).toHaveBeenLastCalledWith(
        expect.objectContaining({ playQueueItemId: 11, playerId: REMOTE })
      )
      expect(plex.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'end' }))
    })

    it('after-album + wipe keeps the rest of the record, clears the album behind it', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42
      plex.getPlayQueue.mockResolvedValue(MID_QUEUE)

      await c.enqueue('album', 'alb-9', 'Album', 'Artist', 'after-album', { wipe: true })

      expect(plex.queueRemove).toHaveBeenCalledTimes(1)
      expect(plex.queueRemove).toHaveBeenCalledWith(
        expect.objectContaining({ playQueueItemId: 11 })
      )
      expect(plex.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'end' }))
    })

    it('end + wipe appends last and latches stop-after so radio ends the night there', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.activePlayQueueId = 42
      plex.getPlayQueue.mockResolvedValue(MID_QUEUE)

      await c.enqueue('album', 'alb-9', 'Album', 'Artist', 'end', { wipe: true })

      expect(plex.queueRemove).not.toHaveBeenCalled()
      expect(plex.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'end' }))
      expect(c.radio.stopAfter).toBe(true)
    })
  })

  describe('transport + media keys', () => {
    it('drives the remote player', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      await c.transport('next')
      expect(plex.transport).toHaveBeenCalledWith(
        expect.objectContaining({ playerId: REMOTE, action: 'next' })
      )
    })

    it('playPause toggles to pause while playing', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.timeline = timeline({ state: 'playing' })
      await c.handleMediaKeyCommand({ action: 'playPause' })
      expect(plex.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'pause' }))
    })

    it('playPause toggles to play while paused', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.timeline = timeline({ state: 'paused' })
      await c.handleMediaKeyCommand({ action: 'playPause' })
      expect(plex.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'play' }))
    })
  })

  describe('volume', () => {
    it('clamps out-of-range values', () => {
      const { c } = makeController()
      c.setVolume(140)
      expect(c.volume).toBe(100)
      c.setVolume(-10)
      expect(c.volume).toBe(0)
    })

    it('sends the volume to a remote player', () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      c.setVolume(55)
      expect(plex.setVolume).toHaveBeenCalledWith(expect.objectContaining({ playerId: REMOTE, volume: 55 }))
    })

    it('does not hit the network with no active player', () => {
      const { c, plex } = makeController()
      c.setVolume(55)
      expect(c.volume).toBe(55)
      expect(plex.setVolume).not.toHaveBeenCalled()
    })

    it('adopts the device-reported volume from the timeline poll when idle', async () => {
      const { c, plex } = makeController()
      // App remembers 80 (the default); the Pi is actually at 37.
      plex.getTimeline.mockResolvedValue(timeline({ volume: 37 }))
      c.setActivePlayer(REMOTE)

      await vi.advanceTimersByTimeAsync(0)
      expect(c.volume).toBe(37)
    })

    it('does not snap the slider back right after the user changed volume', async () => {
      const { c, plex } = makeController()
      c.setActivePlayer(REMOTE)
      // The Pi still reports its stale pre-drag volume on the next poll…
      plex.getTimeline.mockResolvedValue(timeline({ volume: 10 }))
      c.setVolume(80) // …but we just sent 80.

      await vi.advanceTimersByTimeAsync(0)
      expect(c.volume).toBe(80)
    })
  })
})
