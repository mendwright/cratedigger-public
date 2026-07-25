import { describe, expect, it, vi } from 'vitest'
import { syncAlbumMatchAfterTaggerWrite, type AlbumMatchSyncDeps } from './album-match-sync.js'

interface MockedDeps extends AlbumMatchSyncDeps {
  getAlbumMatch: ReturnType<typeof vi.fn<(plexRatingKey: string) => string | null>>
  setAlbumMatch: ReturnType<typeof vi.fn<(plexRatingKey: string, mbReleaseMbid: string) => void>>
  invalidateAlbumCredits: ReturnType<typeof vi.fn<(plexRatingKey: string) => Promise<void>>>
  warn: ReturnType<typeof vi.fn<(message: string, err: unknown) => void>>
}

function makeDeps(existing: string | null): MockedDeps {
  return {
    getAlbumMatch: vi.fn((_rk: string) => existing),
    setAlbumMatch: vi.fn((_rk: string, _mbid: string) => {}),
    invalidateAlbumCredits: vi.fn(async (_rk: string) => {}),
    warn: vi.fn((_msg: string, _err: unknown) => {})
  }
}

describe('syncAlbumMatchAfterTaggerWrite', () => {
  it('overwrites a stale override and invalidates credits', async () => {
    const deps = makeDeps('old-mbid')
    await syncAlbumMatchAfterTaggerWrite('rk1', 'new-mbid', deps)
    expect(deps.setAlbumMatch).toHaveBeenCalledWith('rk1', 'new-mbid')
    expect(deps.invalidateAlbumCredits).toHaveBeenCalledWith('rk1')
  })

  it('sets an override when none existed (bridges the Plex guid lag)', async () => {
    const deps = makeDeps(null)
    await syncAlbumMatchAfterTaggerWrite('rk1', 'new-mbid', deps)
    expect(deps.setAlbumMatch).toHaveBeenCalledWith('rk1', 'new-mbid')
  })

  it('skips the redundant write when the override already agrees, but still invalidates', async () => {
    const deps = makeDeps('same-mbid')
    await syncAlbumMatchAfterTaggerWrite('rk1', 'same-mbid', deps)
    expect(deps.setAlbumMatch).not.toHaveBeenCalled()
    expect(deps.invalidateAlbumCredits).toHaveBeenCalledWith('rk1')
  })

  it('never throws: store failure is logged and invalidate still runs', async () => {
    const deps = makeDeps(null)
    deps.setAlbumMatch = vi.fn(() => {
      throw new Error('store exploded')
    })
    await expect(syncAlbumMatchAfterTaggerWrite('rk1', 'm', deps)).resolves.toBeUndefined()
    expect(deps.warn).toHaveBeenCalledTimes(1)
    expect(deps.invalidateAlbumCredits).toHaveBeenCalledWith('rk1')
  })

  it('never throws: invalidate failure is logged', async () => {
    const deps = makeDeps(null)
    deps.invalidateAlbumCredits = vi.fn(async () => {
      throw new Error('cache exploded')
    })
    await expect(syncAlbumMatchAfterTaggerWrite('rk1', 'm', deps)).resolves.toBeUndefined()
    expect(deps.warn).toHaveBeenCalledTimes(1)
  })
})
