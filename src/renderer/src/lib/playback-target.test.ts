import { describe, it, expect, vi } from 'vitest'
import { RemoteTarget } from './playback-target'

type PlexApi = Window['cratedigger']['plex']

// LocalTarget instantiates an <audio> element, which needs a DOM test
// environment — out of scope while the suite is pure-node. RemoteTarget is
// the adapter with the contract subtleties worth pinning: playerId routing
// and the nudge-once-batch-remove behavior.
function makePlex() {
  return {
    castPlayAlbum: vi.fn(async () => ({ playQueueId: 42, player: { id: 'pi', name: 'Pi' } })),
    castPlayTrack: vi.fn(async () => ({ playQueueId: 42, player: { id: 'pi', name: 'Pi' } })),
    castMood: vi.fn(async () => ({ playQueueId: 42, player: { id: 'pi', name: 'Pi' } })),
    transport: vi.fn(async () => ({ ok: true as const })),
    queueUpdate: vi.fn(async () => ({ ok: true as const, refreshed: true })),
    queueRemove: vi.fn(async (_args: { playerId?: string }) => ({
      ok: true as const,
      refreshed: true
    })),
    playerSkipTo: vi.fn(async () => ({ ok: true as const })),
    setVolume: vi.fn(async () => ({ ok: true as const })),
    getTimeline: vi.fn(async () => null)
  }
}

function makeTarget() {
  const plex = makePlex()
  const target = new RemoteTarget({
    plex: plex as unknown as PlexApi,
    serverId: () => 'srv-1',
    playerId: 'pi'
  })
  return { plex, target }
}

describe('RemoteTarget', () => {
  it('routes queue adds through the player so Plexamp gets nudged', async () => {
    const { plex, target } = makeTarget()
    await target.queueAdd({ playQueueId: 42, ratingKey: 'trk-9', mode: 'next' })
    expect(plex.queueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'srv-1', playerId: 'pi', mode: 'next' })
    )
  })

  it('batch remove nudges the player exactly once, on the final delete', async () => {
    const { plex, target } = makeTarget()
    await target.queueRemoveMany(42, [10, 11, 12])
    expect(plex.queueRemove).toHaveBeenCalledTimes(3)
    const calls = plex.queueRemove.mock.calls.map(([args]) => args.playerId)
    expect(calls).toEqual([undefined, undefined, 'pi'])
  })

  it('reports the nudge result from the final delete', async () => {
    const { plex, target } = makeTarget()
    plex.queueRemove
      .mockResolvedValueOnce({ ok: true, refreshed: true })
      .mockResolvedValueOnce({ ok: true, refreshed: false })
    const { refreshed } = await target.queueRemoveMany(42, [10, 11])
    expect(refreshed).toBe(false)
  })

  it('throws on any operation without a session (caller surfaces the toast)', async () => {
    const plex = makePlex()
    const target = new RemoteTarget({
      plex: plex as unknown as PlexApi,
      serverId: () => null,
      playerId: 'pi'
    })
    await expect(target.queueAdd({ playQueueId: 42, ratingKey: 'x', mode: 'end' })).rejects.toThrow(
      'Not signed in'
    )
    expect(plex.queueUpdate).not.toHaveBeenCalled()
  })

  it('dispatches the three cast intents to their IPC calls', async () => {
    const { plex, target } = makeTarget()
    await target.cast({ kind: 'album', ratingKey: 'alb-1', title: 'A', artist: 'B' })
    expect(plex.castPlayAlbum).toHaveBeenCalledTimes(1)
    await target.cast({ kind: 'track', ratingKey: 'trk-1', title: 'A', artist: 'B' })
    expect(plex.castPlayTrack).toHaveBeenCalledTimes(1)
    await target.cast({ kind: 'mood', sectionKey: '1', moodId: 'm', title: 'Sad' })
    expect(plex.castMood).toHaveBeenCalledTimes(1)
  })
})
