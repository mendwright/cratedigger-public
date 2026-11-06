import { describe, it, expect } from 'vitest'
import { LruCache } from './lru'

describe('LruCache', () => {
  it('stores and retrieves values, reporting size', () => {
    const c = new LruCache<string, number>(3)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1)
    expect(c.get('missing')).toBeUndefined()
    expect(c.size).toBe(2)
  })

  it('evicts the least-recently-used entry beyond capacity', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3) // capacity 2 — 'a' is oldest, out it goes
    expect(c.peek('a')).toBeUndefined()
    expect(c.peek('b')).toBe(2)
    expect(c.peek('c')).toBe(3)
    expect(c.size).toBe(2)
  })

  it('get() marks an entry most-recently-used', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // 'a' is now MRU, so 'b' is the eviction candidate
    c.set('c', 3)
    expect(c.peek('b')).toBeUndefined()
    expect(c.peek('a')).toBe(1)
  })

  it('peek() reads without touching recency', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.peek('a') // no promotion — 'a' stays oldest
    c.set('c', 3)
    expect(c.peek('a')).toBeUndefined()
  })

  it('set() on an existing key replaces the value and promotes to MRU', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 10) // refresh — 'b' becomes the eviction candidate
    c.set('c', 3)
    expect(c.peek('a')).toBe(10)
    expect(c.peek('b')).toBeUndefined()
  })

  it('delete() removes a single entry; clear() removes everything', () => {
    const c = new LruCache<string, number>(3)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.delete('a')).toBe(true)
    expect(c.delete('a')).toBe(false)
    expect(c.peek('a')).toBeUndefined()
    c.clear()
    expect(c.size).toBe(0)
    expect(c.peek('b')).toBeUndefined()
  })
})
