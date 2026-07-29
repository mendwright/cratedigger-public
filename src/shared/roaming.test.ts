import { describe, expect, it } from 'vitest'
import {
  docsEqual,
  emptyRoamingDoc,
  mergeRoamingDocs,
  roamingValues,
  type RoamingDoc
} from './roaming'

const NOW = Date.parse('2026-07-09T00:00:00Z')

function doc(items: RoamingDoc<string>['items']): RoamingDoc<string> {
  return { items }
}

describe('mergeRoamingDocs', () => {
  it('unions ids from both docs', () => {
    const a = doc({ x: { value: 'ax', updatedAt: '2026-07-01T00:00:00Z' } })
    const b = doc({ y: { value: 'by', updatedAt: '2026-07-02T00:00:00Z' } })
    expect(roamingValues(mergeRoamingDocs(a, b, NOW))).toEqual({ x: 'ax', y: 'by' })
  })

  it('newer write wins per id', () => {
    const a = doc({ x: { value: 'old', updatedAt: '2026-07-01T00:00:00Z' } })
    const b = doc({ x: { value: 'new', updatedAt: '2026-07-05T00:00:00Z' } })
    expect(roamingValues(mergeRoamingDocs(a, b, NOW)).x).toBe('new')
  })

  it('a newer tombstone deletes an older value', () => {
    const a = doc({ x: { value: 'live', updatedAt: '2026-07-01T00:00:00Z' } })
    const b = doc({ x: { value: null, updatedAt: '2026-07-05T00:00:00Z' } })
    expect(roamingValues(mergeRoamingDocs(a, b, NOW))).toEqual({})
  })

  it('an older tombstone loses to a newer re-add', () => {
    const a = doc({ x: { value: null, updatedAt: '2026-07-01T00:00:00Z' } })
    const b = doc({ x: { value: 'back', updatedAt: '2026-07-05T00:00:00Z' } })
    expect(roamingValues(mergeRoamingDocs(a, b, NOW)).x).toBe('back')
  })

  it('is symmetric', () => {
    const a = doc({
      x: { value: 'ax', updatedAt: '2026-07-01T00:00:00Z' },
      y: { value: null, updatedAt: '2026-07-03T00:00:00Z' }
    })
    const b = doc({
      x: { value: 'bx', updatedAt: '2026-07-01T00:00:00Z' },
      z: { value: 'bz', updatedAt: '2026-07-02T00:00:00Z' }
    })
    expect(docsEqual(mergeRoamingDocs(a, b, NOW), mergeRoamingDocs(b, a, NOW))).toBe(true)
  })

  it('equal timestamps prefer data over tombstone', () => {
    const t = '2026-07-01T00:00:00Z'
    const a = doc({ x: { value: null, updatedAt: t } })
    const b = doc({ x: { value: 'data', updatedAt: t } })
    expect(roamingValues(mergeRoamingDocs(a, b, NOW)).x).toBe('data')
    expect(roamingValues(mergeRoamingDocs(b, a, NOW)).x).toBe('data')
  })

  it('drops tombstones older than the TTL, keeps fresh ones', () => {
    const merged = mergeRoamingDocs(
      doc({
        stale: { value: null, updatedAt: '2026-01-01T00:00:00Z' },
        fresh: { value: null, updatedAt: '2026-07-01T00:00:00Z' }
      }),
      emptyRoamingDoc<string>(),
      NOW
    )
    expect(Object.keys(merged.items)).toEqual(['fresh'])
  })

  it('never drops live values regardless of age', () => {
    const merged = mergeRoamingDocs(
      doc({ ancient: { value: 'keep', updatedAt: '2020-01-01T00:00:00Z' } }),
      emptyRoamingDoc<string>(),
      NOW
    )
    expect(roamingValues(merged).ancient).toBe('keep')
  })
})

describe('docsEqual', () => {
  it('detects value and timestamp differences', () => {
    const a = doc({ x: { value: 'v', updatedAt: '2026-07-01T00:00:00Z' } })
    expect(docsEqual(a, doc({ x: { value: 'v', updatedAt: '2026-07-01T00:00:00Z' } }))).toBe(true)
    expect(docsEqual(a, doc({ x: { value: 'w', updatedAt: '2026-07-01T00:00:00Z' } }))).toBe(false)
    expect(docsEqual(a, doc({}))).toBe(false)
  })
})
