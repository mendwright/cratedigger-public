import { describe, expect, it, vi } from 'vitest'
import { PiTarget } from './pi-target'
import type { PiPlayerStatus } from '../../../shared/plex'

describe('PiTarget external playback', () => {
  it('leaves the remote player running when the target is disposed', () => {
    const stopSession = vi.fn()
    const target = new PiTarget({
      pi: { stopSession } as unknown as NonNullable<Window['cratedigger']['pi']>,
      plex: {} as Window['cratedigger']['plex'],
      serverId: () => 'server', volume: () => 25, onError: vi.fn()
    })
    target.dispose()
    expect(stopSession).not.toHaveBeenCalled()
  })
  it('shows a phone-started track without a locally created queue', async () => {
    const status: PiPlayerStatus = {
      state: 'playing', source: 'plex', index: 2, ratingKey: 'track-3',
      title: 'External track', artist: 'Artist', album: 'Album',
      seconds: 12, duration: 180, volume: 25, streamTitle: null, error: null
    }
    const pi = { status: vi.fn(async () => status) }
    const target = new PiTarget({
      pi: pi as unknown as NonNullable<Window['cratedigger']['pi']>,
      plex: {} as Window['cratedigger']['plex'],
      serverId: () => 'server', volume: () => 25, onError: vi.fn()
    })
    expect(await target.getTimeline()).toMatchObject({
      state: 'playing', ratingKey: 'track-3', title: 'External track',
      artist: 'Artist', album: 'Album', time: 12000, duration: 180000
    })
  })

  it('adopts external queues read-only and drops stale metadata when adoption fails', async () => {
    const status: PiPlayerStatus = {
      state: 'playing', source: 'plex', index: 0, ratingKey: 'first',
      playQueueId: 41, title: 'First song', artist: 'Artist', album: 'Album',
      seconds: 12, duration: 180, volume: 25, streamTitle: null, error: null
    }
    const getPlayQueue = vi.fn().mockResolvedValue({
      playQueueID: 41, selectedItemID: 1, items: [{
        ratingKey: 'first', playQueueItemID: 1, title: 'First song',
        artist: 'Artist', album: 'Album', albumRatingKey: 'album-1',
        thumb: '/cover-1', duration: 180000
      }]
    })
    const pi = {
      status: vi.fn(async () => status), refreshQueue: vi.fn(), skip: vi.fn()
    }
    const target = new PiTarget({
      pi: pi as unknown as NonNullable<Window['cratedigger']['pi']>,
      plex: { getPlayQueue } as unknown as Window['cratedigger']['plex'],
      serverId: () => 'server', volume: () => 25, onError: vi.fn()
    })
    expect(await target.getTimeline()).toMatchObject({
      playQueueID: 41, thumb: '/cover-1', albumRatingKey: 'album-1'
    })
    await target.getTimeline()
    expect(getPlayQueue).toHaveBeenCalledTimes(1)
    await target.skipToQueueItem(1)
    expect(pi.skip).toHaveBeenCalledWith(0)

    Object.assign(status, { playQueueId: 42, ratingKey: 'second', title: 'Second song' })
    getPlayQueue.mockRejectedValueOnce(new Error('PMS unavailable'))
    expect(await target.getTimeline()).toMatchObject({
      playQueueID: 42, ratingKey: 'second', title: 'Second song',
      thumb: null, albumRatingKey: null
    })
    expect(getPlayQueue).toHaveBeenLastCalledWith({ serverId: 'server', playQueueId: 42 })
    expect(pi.refreshQueue).not.toHaveBeenCalled()
  })
})
