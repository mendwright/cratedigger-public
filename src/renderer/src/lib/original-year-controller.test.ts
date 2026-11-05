import { describe, it, expect, vi } from 'vitest'
import { OriginalYearController, type OriginalYearDeps } from './original-year-controller.svelte'

type PlexApi = Window['cratedigger']['plex']

function makePlex(over: Record<string, unknown> = {}) {
  return {
    listOriginalYearOverrides: vi.fn(async () => ({}) as Record<string, number>),
    setOriginalYearOverride: vi.fn(async () => ({ ok: true as const })),
    clearOriginalYearOverride: vi.fn(async () => ({ ok: true as const })),
    ...over
  }
}

function makeController(plex?: ReturnType<typeof makePlex>) {
  const p = plex ?? makePlex()
  const flashToast = vi.fn()
  const deps: OriginalYearDeps = { flashToast, plex: p as unknown as PlexApi }
  return { c: new OriginalYearController(deps), plex: p, flashToast }
}

describe('OriginalYearController — load', () => {
  it('hydrates the override map from the store', async () => {
    const plex = makePlex({ listOriginalYearOverrides: vi.fn(async () => ({ rk1: 1957 })) })
    const { c } = makeController(plex)
    await c.load()
    expect(c.get('rk1')).toBe(1957)
  })

  it('tolerates an empty/failing store and keeps the {} default', async () => {
    const plex = makePlex({
      listOriginalYearOverrides: vi.fn(async () => {
        throw new Error('store empty on first run')
      })
    })
    const { c } = makeController(plex)
    await c.load()
    expect(c.overrides).toEqual({})
  })
})

describe('OriginalYearController — get', () => {
  it('returns the pinned year or undefined', () => {
    const { c } = makeController()
    expect(c.get('rk1')).toBeUndefined()
    c.overrides = { rk1: 1957 }
    expect(c.get('rk1')).toBe(1957)
  })
})

describe('OriginalYearController — set', () => {
  it('pins the year, persists it, and toasts success', async () => {
    const { c, plex, flashToast } = makeController()
    await c.set('rk1', 1957)
    expect(c.get('rk1')).toBe(1957)
    expect(plex.setOriginalYearOverride).toHaveBeenCalledWith({ plexRatingKey: 'rk1', year: 1957 })
    expect(flashToast).toHaveBeenCalledWith('ok', expect.stringContaining('1957'))
  })

  it('toasts an error when the save fails', async () => {
    const plex = makePlex({
      setOriginalYearOverride: vi.fn(async () => {
        throw new Error('disk full')
      })
    })
    const { c, flashToast } = makeController(plex)
    await c.set('rk1', 1957)
    expect(flashToast).toHaveBeenCalledWith('err', 'disk full')
  })
})

describe('OriginalYearController — clear', () => {
  it('drops the override, persists the removal, and toasts', async () => {
    const { c, plex, flashToast } = makeController()
    c.overrides = { rk1: 1957 }
    await c.clear('rk1')
    expect(c.get('rk1')).toBeUndefined()
    expect(plex.clearOriginalYearOverride).toHaveBeenCalledWith({ plexRatingKey: 'rk1' })
    expect(flashToast).toHaveBeenCalledWith('ok', expect.any(String))
  })

  it('toasts an error when the clear fails', async () => {
    const plex = makePlex({
      clearOriginalYearOverride: vi.fn(async () => {
        throw new Error('clear failed')
      })
    })
    const { c, flashToast } = makeController(plex)
    c.overrides = { rk1: 1957 }
    await c.clear('rk1')
    expect(flashToast).toHaveBeenCalledWith('err', 'clear failed')
  })
})
