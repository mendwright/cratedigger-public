import { describe, expect, it, vi } from 'vitest'
import { audioSnapshot, HayesClient } from './hayes'

const config = {
  zones: ['living', 'front', 'kitchen'].map(id => ({ id, name: id, fixed: id === 'living' ? null : 'luxman', entity: `switch.${id}` })),
  sources: [{ id: 'luxman', name: 'Luxman' }, { id: 'sony', name: 'Sony' }],
  matrix: { mains: 'switch.amp' }
}
const raw = { connected: true, mains: true, protect: false, source: 'sony', zones: { living: true, front: true, kitchen: false } }
function mockClient(update = raw, status = 200) {
  const cancel = vi.fn()
  const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/api/config')) return Response.json(config)
    if (String(url).endsWith('/api/call')) return new Response('', { status })
    const encoder = new TextEncoder()
    const body = new ReadableStream({ start(controller) {
      const frame = `retry: 2000\r\n\r\ndata: ${JSON.stringify(update)}\r\n\r\n`
      controller.enqueue(encoder.encode(frame.slice(0, 29)))
      controller.enqueue(encoder.encode(frame.slice(29)))
    }, cancel })
    return new Response(body)
  })
  return { client: new HayesClient(request), request, cancel }
}

describe('Hayes audio boundary', () => {
  it('preserves fixed music routes while living room uses Sony; omits house secrets', () => {
    const audio = audioSnapshot(config, { ...raw, lock: { locked: true }, media: { art: 'secret-token' } })
    expect(audio.zones.map(z => z.source)).toEqual(['sony', 'luxman', 'luxman'])
    expect(JSON.stringify(audio)).not.toContain('secret-token')
    expect(audio).not.toHaveProperty('lock')
  })
  it('rejects incomplete state instead of showing switches as off', () => {
    expect(() => audioSnapshot(config, { ...raw, zones: {} })).toThrow('incomplete')
  })
  it('reads split SSE frames, coalesces requests, and closes the stream', async () => {
    const { client, request, cancel } = mockClient()
    const [a, b] = await Promise.all([client.snapshot(), client.snapshot()])
    expect(a).toEqual(b)
    expect(request).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('only permits known speaker switches and boolean values', async () => {
    const { client, request } = mockClient()
    await expect(client.setSwitch('lock.front_door' as never, true)).rejects.toThrow('Unknown')
    await expect(client.setSwitch('living', 'on' as never)).rejects.toThrow('Unknown')
    expect(request).not.toHaveBeenCalled()
  })
  it('sends the explicit desired state through Hayes', async () => {
    const { client, request } = mockClient()
    await client.setSwitch('front', false)
    const call = request.mock.calls.find(([url]) => String(url).endsWith('/api/call'))!
    expect(JSON.parse(call[1]!.body as string)).toEqual({ domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.front' } })
  })
  it('blocks turning on protected speakers but permits turning them off', async () => {
    const { client } = mockClient({ ...raw, protect: true })
    await expect(client.setSwitch('living', true)).rejects.toThrow('protection')
    await expect(client.setSwitch('living', false)).resolves.toBeUndefined()
  })
  it('does not send commands when disconnected', async () => {
    const { client, request } = mockClient({ ...raw, connected: false })
    await expect(client.setSwitch('mains', true)).rejects.toThrow('reconnecting')
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/api/call'))).toBe(false)
  })
  it('reports failed writes', async () => {
    const { client } = mockClient(raw, 503)
    await expect(client.setSwitch('kitchen', true)).rejects.toThrow('could not change')
  })
})
