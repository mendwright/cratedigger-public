import type { HayesSnapshot, HayesSwitch } from '../../../shared/plex'

export class HayesState {
  snapshot = $state<HayesSnapshot | null>(null)
  error = $state('')
  pending = $state<HayesSwitch | null>(null)
  online = $state(false)
  private reading: Promise<void> | null = null

  get summary(): string {
    if (!this.online) return 'Speakers unavailable'
    if (this.snapshot?.protect) return 'Speaker protection on'
    if (!this.snapshot?.mains) return 'Music amp off'
    const rooms = this.snapshot.zones.filter(z => z.on && z.source === 'luxman')
    return rooms.length ? rooms.map(z => z.name).join(' + ') : 'No music speakers on'
  }

  refresh(): Promise<void> {
    return this.reading ??= this.read().finally(() => { this.reading = null })
  }

  private async read(): Promise<void> {
    try {
      const api = window.cratedigger.hayes
      if (!api) return
      this.snapshot = await api.snapshot()
      this.online = this.snapshot.connected
    } catch {
      this.online = false
    }
  }

  start(): () => void {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      await this.refresh()
      if (!stopped) timer = setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }

  async setSwitch(target: HayesSwitch, on: boolean): Promise<void> {
    if (this.pending || !this.online) return
    this.pending = target
    this.error = ''
    try {
      await window.cratedigger.hayes!.setSwitch(target, on)
      // A successful request isn't proof the relay changed. Keep the previous
      // reading visible until Hayes reports the requested value.
      const deadline = Date.now() + 8000
      do {
        await this.refresh()
        const actual = target === 'mains' ? this.snapshot?.mains : this.snapshot?.zones.find(z => z.id === target)?.on
        if (this.online && actual === on) return
        await new Promise(resolve => setTimeout(resolve, 500))
      } while (Date.now() < deadline)
      throw new Error('Hayes has not confirmed the change. Check the speaker state before trying again.')
    } catch (error) {
      this.error = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The speaker switch did not change.'
    } finally {
      this.pending = null
    }
  }
}

export const hayesState = new HayesState()
