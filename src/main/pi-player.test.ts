import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), writes: [] as string[] }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn, execFile: mock.execFile }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn(async () => {}) }))
vi.mock('./plex/library.js', () => ({ getTrackStreamUrl: vi.fn() }))
vi.mock('./plex/headers.js', () => ({ plexHeaders: () => ({}) }))
vi.mock('./store.js', () => ({ getValue: () => '' }))

function bridge(available = true) {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    stdout: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, done) {
        const request = JSON.parse(String(chunk))
        mock.writes.push(request.action)
        if (!available || request.action === 'quit') {
          queueMicrotask(() => child.kill())
          done()
          return
        }
        queueMicrotask(() => child.stdout.write(JSON.stringify({ ok: true, state: {
          state: 'playing', source: 'plex', index: 0,
          current: { ratingKey: 'track', title: 'Still playing', artist: 'Artist' },
          seconds: 12, duration: 180, volume: 25, playQueueId: 41
        } }) + '\n'))
        done()
      }
    }),
    kill: vi.fn(() => {
      child.exitCode = 0
      child.stdout.end()
      child.emit('exit', 0)
      return true
    })
  })
  return child
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.writes.length = 0
  mock.spawn.mockImplementation(() => bridge())
  mock.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '', ''))
})

describe('Pi controller lifetime', () => {
  it('disconnects on app quit without stopping an adopted queue, then reattaches', async () => {
    const pi = await import('./pi-player')
    expect(await pi.piStatus()).toMatchObject({ state: 'playing', playQueueId: 41 })
    pi.disconnectPiPlayerOnQuit()
    expect(mock.writes).not.toContain('quit')
    expect(mock.spawn.mock.results[0].value.kill).toHaveBeenCalled()
    expect(await pi.piStatus()).toMatchObject({ state: 'playing', playQueueId: 41 })
    expect(mock.spawn).toHaveBeenCalledTimes(2)
    pi.disconnectPiPlayerOnQuit()
  })

  it('starts a detached receiver and uses only its control bridge for desktop casts', async () => {
    mock.spawn.mockImplementationOnce(() => bridge(false))
    const pi = await import('./pi-player')
    await pi.piLoadQueue({ id: 'server', name: 'Server', baseUrl: 'http://plex.test', token: 'test' }, 41, [], 0, 15)
    const remoteCommands = mock.execFile.mock.calls
      .filter(([file]) => file === 'ssh').map(([, args]) => args.at(-1) as string)
    expect(remoteCommands.some((cmd) => cmd.includes('--no-stdin') &&
      cmd.includes('detached: true') && cmd.includes('stdio: "ignore"') &&
      cmd.includes('.unref()'))).toBe(true)
    for (const [, args] of mock.spawn.mock.calls) {
      expect(args.at(-1)).toBe('node .cache/cratedigger-pi-player/ctl.mjs')
    }
    expect(mock.writes).toContain('queue')
    pi.disconnectPiPlayerOnQuit()
    expect(mock.writes).not.toContain('quit')
  })

  it('still stops the receiver when explicitly requested', async () => {
    const pi = await import('./pi-player')
    await pi.piStatus()
    await pi.piStopSession()
    expect(mock.writes).toContain('quit')
  })
})
