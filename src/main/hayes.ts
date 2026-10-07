import type { HayesSnapshot, HayesSwitch } from '../shared/plex.js'

const BASE = 'https://hayes.i.scenicroutes.fm'
const zoneIds = ['living', 'front', 'kitchen'] as const
interface Config {
  zones: { id: string; name: string; fixed: string | null; entity: string }[]
  sources: { id: string; name: string }[]
  matrix: { mains: string }
}

// Read only the audio projection; never send Hayes's house state or artwork
// URLs (which contain HA tokens) across the renderer bridge.
export function audioSnapshot(config: Config, raw: Record<string, any>): HayesSnapshot {
  if (typeof raw.connected !== 'boolean' || typeof raw.mains !== 'boolean' ||
      typeof raw.protect !== 'boolean' || !config.sources.some(s => s.id === raw.source) ||
      !zoneIds.every(id => typeof raw.zones?.[id] === 'boolean')) {
    throw new Error('Hayes sent an incomplete speaker update')
  }
  return {
    connected: raw.connected,
    mains: raw.mains,
    protect: raw.protect,
    zones: zoneIds.map(id => {
      const zone = config.zones.find(z => z.id === id)
      if (!zone) throw new Error('Hayes speaker configuration is incomplete')
      const source = zone.fixed || raw.source
      return { id, name: zone.name, on: raw.zones[id], source,
        sourceName: config.sources.find(s => s.id === source)?.name || source }
    })
  }
}

export class HayesClient {
  private config: Config | null = null
  private pending: Promise<HayesSnapshot> | null = null
  constructor(private request: typeof fetch = fetch) {}

  private async getConfig(): Promise<Config> {
    if (!this.config) {
      const response = await this.request(`${BASE}/api/config`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('Hayes configuration is unavailable')
      this.config = await response.json() as Config
    }
    return this.config
  }

  snapshot(): Promise<HayesSnapshot> {
    // Coalesce calls from the panel and post-command confirmation.
    return this.pending ??= this.readSnapshot().finally(() => { this.pending = null })
  }

  private async readSnapshot(): Promise<HayesSnapshot> {
    const config = await this.getConfig()
    const response = await this.request(`${BASE}/api/stream`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok || !response.body) throw new Error('Hayes is unavailable')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) throw new Error('Hayes disconnected')
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
        if (buffer.length > 128 * 1024) throw new Error('Hayes update is too large')
        let end: number
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data) return audioSnapshot(config, JSON.parse(data))
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  async setSwitch(target: HayesSwitch, on: boolean): Promise<void> {
    if (typeof on !== 'boolean' || !['mains', ...zoneIds].includes(target)) {
      throw new Error('Unknown speaker control')
    }
    const current = await this.snapshot()
    if (!current.connected) throw new Error('Hayes is reconnecting')
    if (current.protect && on) throw new Error('Speaker protection is on')
    const config = await this.getConfig()
    const entity = target === 'mains' ? config.matrix.mains : config.zones.find(z => z.id === target)?.entity
    if (!entity?.startsWith('switch.')) throw new Error('Speaker switch is unavailable')
    const response = await this.request(`${BASE}/api/call`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'switch', service: on ? 'turn_on' : 'turn_off', data: { entity_id: entity } })
    })
    if (!response.ok) throw new Error('Hayes could not change the speaker switch')
  }
}

export const hayes = /* @__PURE__ */ new HayesClient()
