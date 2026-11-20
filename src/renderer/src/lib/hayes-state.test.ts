import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HayesState } from './hayes-state.svelte'
import type { HayesSnapshot } from '../../../shared/plex'

let current: HayesSnapshot
let read: ReturnType<typeof vi.fn>
let write: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  current = { connected: true, mains: true, protect: false, zones: [
    { id: 'living', name: 'Living room', on: true, source: 'sony', sourceName: 'Sony' },
    { id: 'front', name: 'Front room', on: true, source: 'luxman', sourceName: 'Luxman' }
  ] }
  read = vi.fn(async () => structuredClone(current))
  write = vi.fn(async () => {})
  vi.stubGlobal('window', { cratedigger: { hayes: { snapshot: read, setSwitch: write } } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('house speaker state', () => {
  it('summarizes music routes separately from Sony and amp power', async () => {
    const view = new HayesState()
    await view.refresh()
    expect(view.summary).toBe('Front room')
    current.mains = false
    await view.refresh()
    expect(view.summary).toBe('Music amp off')
  })
  it('keeps a change pending until the device confirms it', async () => {
    const view = new HayesState()
    await view.refresh()
    const operation = view.setSwitch('front', false)
    await vi.advanceTimersByTimeAsync(600)
    expect(view.pending).toBe('front')
    expect(view.snapshot?.zones[1].on).toBe(true)
    current.zones[1].on = false
    await vi.advanceTimersByTimeAsync(600)
    await operation
    expect(view.pending).toBeNull()
    expect(view.summary).toBe('No music speakers on')
  })
  it('reports unconfirmed changes without inventing a new state', async () => {
    const view = new HayesState()
    await view.refresh()
    const operation = view.setSwitch('front', false)
    await vi.advanceTimersByTimeAsync(8500)
    await operation
    expect(view.error).toContain('not confirmed')
    expect(view.snapshot?.zones[1].on).toBe(true)
    expect(view.pending).toBeNull()
  })
  it('marks stale state offline and recovers on a later read', async () => {
    const view = new HayesState()
    await view.refresh()
    read.mockRejectedValueOnce(new Error('offline'))
    await view.refresh()
    expect(view.online).toBe(false)
    expect(view.summary).toBe('Speakers unavailable')
    await view.setSwitch('front', false)
    expect(write).not.toHaveBeenCalled()
    await view.refresh()
    expect(view.online).toBe(true)
  })
  it('stops polling when the toolbar unmounts', async () => {
    const view = new HayesState()
    const stop = view.start()
    await vi.advanceTimersByTimeAsync(3100)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
