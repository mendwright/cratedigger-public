import { describe, it, expect, vi } from 'vitest'
import { SettingsController, type SettingsDeps } from './settings-controller.svelte'

type SettingsApi = Window['cratedigger']['settings']

const STORED = {
  lastfmApiKey: 'lf-key',
  taggerApiKey: 'tag-key',
  ticketmasterApiKey: 'tm-key',
  geniusClientId: 'g-id',
  geniusClientSecret: 'g-secret',
  continuationMode: 'off' as const
}

function makeController(overrides: Partial<{ get: () => Promise<typeof STORED>; set: SettingsApi['set'] }> = {}) {
  const toasts: { kind: string; text: string }[] = []
  const get = vi.fn(overrides.get ?? (async () => STORED))
  const set = vi.fn(overrides.set ?? (async () => ({ ok: true as const })))
  const deps: SettingsDeps = {
    flashToast: (kind, text) => toasts.push({ kind, text }),
    settings: { get, set } as unknown as SettingsApi
  }
  return { c: new SettingsController(deps), get, set, toasts }
}

describe('SettingsController', () => {
  it('loads the persisted settings once', async () => {
    const { c, get } = makeController()
    expect(c.loaded).toBe(false)

    await c.ensureLoaded()
    expect(get).toHaveBeenCalledTimes(1)
    expect(c.loaded).toBe(true)
    expect(c.lastfmApiKey).toBe('lf-key')
    expect(c.continuationMode).toBe('off')

    await c.ensureLoaded() // second open
    expect(get).toHaveBeenCalledTimes(1) // not re-fetched
  })

  it('latches loaded even when the fetch fails, keeping defaults', async () => {
    const { c } = makeController({ get: async () => { throw new Error('no store') } })
    await c.ensureLoaded()
    expect(c.loaded).toBe(true) // won't retry forever
    expect(c.lastfmApiKey).toBe('') // defaults preserved
    expect(c.continuationMode).toBe('album-end')
  })

  it('persists and merges only the provided fields on save', async () => {
    const { c, set, toasts } = makeController()
    c.continuationMode = 'radio'
    c.lastfmApiKey = 'old'

    await c.save({ lastfmApiKey: 'new', continuationMode: 'off' })

    expect(set).toHaveBeenCalledWith({ lastfmApiKey: 'new', continuationMode: 'off' })
    expect(c.lastfmApiKey).toBe('new')
    expect(c.continuationMode).toBe('off')
    expect(c.taggerApiKey).toBe('') // untouched
    expect(toasts).toContainEqual({ kind: 'ok', text: 'Settings saved' })
  })

  it('surfaces an error toast and does not mutate fields when save fails', async () => {
    const { c, toasts } = makeController({ set: async () => { throw new Error('write failed') } })
    c.lastfmApiKey = 'before'
    await c.save({ lastfmApiKey: 'after' })
    expect(c.lastfmApiKey).toBe('before')
    expect(toasts).toContainEqual({ kind: 'err', text: 'write failed' })
  })

  it('close() flips the open flag', () => {
    const { c } = makeController()
    c.open = true
    c.close()
    expect(c.open).toBe(false)
  })
})
