import { describe, expect, it } from 'vitest'
import { cleanStudioPeople, personNameKey, studioHow, studioLabel } from './studio'

describe('studioHow', () => {
  it('ranks recorded over produced over mixed', () => {
    expect(studioHow([{ role: 'mix' }, { role: 'producer' }])).toBe('produced')
    expect(studioHow([{ role: 'producer' }, { role: 'recording' }])).toBe('recorded')
    expect(studioHow([{ role: 'engineer' }])).toBe('recorded')
    expect(studioHow([{ role: 'mix' }])).toBe('mixed')
  })

  it('ignores non-board credits', () => {
    expect(studioHow([{ role: 'member' }, { role: 'writer' }, { role: 'instrument' }])).toBeNull()
  })
})

describe('names', () => {
  it('folds case and accents', () => {
    expect(personNameKey('Rudy van Gelder')).toBe(personNameKey('Rudy Van Gelder'))
    expect(personNameKey('Björk')).toBe('bjork')
  })

  it('cleans a typed list', () => {
    expect(cleanStudioPeople([' Steve Albini ', '', 'steve albini', 'Conny Plank'])).toEqual([
      'Steve Albini',
      'Conny Plank'
    ])
  })

  it('labels', () => {
    expect(studioLabel('recorded', 'Steve Albini')).toBe('Recorded by Steve Albini')
  })
})
