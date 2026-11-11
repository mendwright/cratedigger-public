import { describe, it, expect, vi, beforeEach } from 'vitest'

// connection.ts reaches electron via headers.js and electron-store via
// ../store.js; resources.js hits plex.tv. Stub all three so this stays a
// unit test of connection picking. Probes go through global fetch — each
// test declares which addresses answer.
const state = vi.hoisted(() => ({
  lastGoodConnections: {} as Record<string, string>,
  resources: [] as unknown[]
}))

vi.mock('./headers.js', () => ({ plexHeaders: () => ({}) }))
vi.mock('./resources.js', () => ({ listResources: async () => state.resources }))
vi.mock('../store.js', () => ({
  getAuthToken: () => 'account-token',
  getValue: (key: string) => (state as Record<string, unknown>)[key],
  setValue: (key: string, value: unknown) => {
    ;(state as Record<string, unknown>)[key] = value
  }
}))

import { resolveServerContext, clearServerContextCache } from './connection'
import type { PlexResource, PlexResourceConnection } from '../../shared/plex'

const LOCAL_HTTPS = 'https://192-168-1-2.abc.plex.direct:32400'
const LOCAL_HTTP = 'http://192.168.1.2:32400'
const REMOTE_HTTPS = 'https://1-2-3-4.abc.plex.direct:32400'

function conn(
  uri: string,
  opts: { local?: boolean; relay?: boolean } = {}
): PlexResourceConnection {
  return {
    protocol: uri.startsWith('https') ? 'https' : 'http',
    address: '',
    port: 32400,
    uri,
    local: opts.local ?? false,
    relay: opts.relay ?? false
  }
}

function server(connections: PlexResourceConnection[]): PlexResource {
  return {
    name: 'Test Server',
    product: 'Plex Media Server',
    productVersion: '1',
    platform: 'Linux',
    platformVersion: '1',
    device: 'PC',
    clientIdentifier: 'srv-1',
    provides: 'server',
    owned: true,
    home: false,
    accessToken: 'server-token',
    connections
  } as PlexResource
}

/** Probes against `alive` answer 200; everything else rejects like a dead
 *  host. All probes resolve on the microtask queue, so award order — not
 *  answer order — must decide the winner. */
function stubProbes(alive: string[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const base = url.replace(/\/identity$/, '')
    if (alive.some((a) => a.replace(/\/$/, '') === base)) return { status: 200 }
    throw new Error(`unreachable: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  clearServerContextCache()
  state.lastGoodConnections = {}
  vi.unstubAllGlobals()
})

describe('resolveServerContext', () => {
  it('probes candidates concurrently and picks the best-ranked responder', async () => {
    state.resources = [
      server([
        conn(REMOTE_HTTPS),
        conn(LOCAL_HTTP, { local: true }),
        conn(LOCAL_HTTPS, { local: true })
      ])
    ]
    const fetchMock = stubProbes([LOCAL_HTTP, REMOTE_HTTPS])

    const ctx = await resolveServerContext('srv-1')

    // local http (rank 1) beats remote https (rank 2) even though the
    // local https ranked above both never answered.
    expect(ctx.baseUrl).toBe(LOCAL_HTTP)
    expect(ctx.token).toBe('server-token')
    // Every candidate was probed — the race starts them all at once rather
    // than waiting out each timeout in turn.
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(
      expect.arrayContaining([
        `${LOCAL_HTTPS}/identity`,
        `${LOCAL_HTTP}/identity`,
        `${REMOTE_HTTPS}/identity`
      ])
    )
    // The winner is remembered for the next launch.
    expect(state.lastGoodConnections['srv-1']).toBe(LOCAL_HTTP)
  })

  it('serves the persisted last-good address first, then upgrades to a better route', async () => {
    state.resources = [
      server([conn(LOCAL_HTTP, { local: true }), conn(REMOTE_HTTPS)])
    ]
    state.lastGoodConnections['srv-1'] = REMOTE_HTTPS
    stubProbes([LOCAL_HTTP, REMOTE_HTTPS])

    const ctx = await resolveServerContext('srv-1')
    // Last launch's winner answers → use it immediately, no full race first.
    expect(ctx.baseUrl).toBe(REMOTE_HTTPS)

    // The background race notices the better-ranked local route and adopts
    // it for later requests and the next launch.
    await vi.waitFor(() => {
      expect(state.lastGoodConnections['srv-1']).toBe(LOCAL_HTTP)
    })
    clearServerContextCache()
    const next = await resolveServerContext('srv-1')
    expect(next.baseUrl).toBe(LOCAL_HTTP)
  })

  it('ignores a stored address the server no longer advertises', async () => {
    state.resources = [server([conn(REMOTE_HTTPS)])]
    state.lastGoodConnections['srv-1'] = 'https://gone.example.com:32400'
    const fetchMock = stubProbes([REMOTE_HTTPS, 'https://gone.example.com:32400'])

    const ctx = await resolveServerContext('srv-1')

    expect(ctx.baseUrl).toBe(REMOTE_HTTPS)
    // The stale URL could point at anything by now — it must not be probed.
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain(
      'https://gone.example.com:32400/identity'
    )
  })

  it('throws when nothing answers', async () => {
    state.resources = [server([conn(LOCAL_HTTP, { local: true }), conn(REMOTE_HTTPS)])]
    stubProbes([])

    await expect(resolveServerContext('srv-1')).rejects.toThrow(
      'No reachable connection'
    )
  })
})
