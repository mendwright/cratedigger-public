import { describe, expect, it } from 'vitest'
import type { ClassicalAlbumModel } from './classical-model'
import { classicalAlbumPerformers, classicalTrackPerformers, isClassicalCandidate, isClassicalRepertoire, matchesClassicalQuery, modelAssertsRepertoire, resolveEffectiveComposers } from './classical-model'

describe('isClassicalRepertoire', () => {
  it.each(['Classical', 'Chamber Music', 'Opera', 'Orchestral', 'Concerto']) (
    'recognizes the explicit repertoire genre %s',
    (genre) => expect(isClassicalRepertoire([genre])).toBe(true)
  )

  it('does not infer classical from a colon-bearing title or generic genre', () => {
    expect(isClassicalRepertoire(['Rock'])).toBe(false)
    expect(isClassicalRepertoire(['Instrumental'])).toBe(false)
  })
})

describe('isClassicalCandidate', () => {
  it('finds untagged composer, work-form, and catalogue-number albums', () => {
    expect(isClassicalCandidate({ artist: 'Wilhelm Kempff', title: 'Beethoven: Piano Sonatas', genres: [] })).toBe(true)
    expect(isClassicalCandidate({ artist: 'Takács Quartet', title: 'String Quartets, Op. 59', genres: [] })).toBe(true)
    expect(isClassicalCandidate({ artist: 'Glenn Gould', title: 'Goldberg Variations, BWV 988', genres: [] })).toBe(true)
  })

  it('does not pull an ordinary untagged rock album into enrichment', () => {
    expect(isClassicalCandidate({ artist: 'Sleater-Kinney', title: 'Dig Me Out', genres: ['Rock'] })).toBe(false)
  })
})

describe('matchesClassicalQuery', () => {
  it('matches whole short names and incremental long names', () => {
    expect(matchesClassicalQuery('Johann Sebastian Bach', 'bach')).toBe(true)
    expect(matchesClassicalQuery('Ludwig van Beethoven', 'beeth')).toBe(true)
    expect(matchesClassicalQuery('Bach: Well-Tempered Clavier', 'bach well')).toBe(true)
  })

  it('does not treat substrings in unrelated names as composers', () => {
    expect(matchesClassicalQuery('Death at a Bachelorette Party', 'bach')).toBe(false)
    expect(matchesClassicalQuery('Bachelor No. 2', 'bach')).toBe(false)
    expect(matchesClassicalQuery('Laibach — Opus Dei', 'bach')).toBe(false)
    expect(matchesClassicalQuery('Kabachare, Jiraato', 'bach')).toBe(false)
  })
})

describe('modelAssertsRepertoire', () => {
  it('recognizes variations as a classical work form without requiring a catalogue number', () => {
    expect(modelAssertsRepertoire({
      source: 'exact', alignmentConfidence: 'exact', releaseMbid: null,
      matchedTracks: 1, totalTracks: 1,
      alignment: { acoustidRecording: 0, recordingGuid: 1, releaseTrackGuid: 0, discIndex: 0, titleDuration: 0, unmatched: 0 },
      composers: [],
      byTrack: {
        one: {
          matchMethod: 'recording-guid', releaseTrackMbid: null,
          recordingMbid: 'recording-1', workMbid: 'work-1',
          workTitle: 'Goldberg Variations', parentWorkMbid: null,
          parentWorkTitle: null, composers: []
        }
      }
    })).toBe(true)
  })
})

describe('classical performer projection', () => {
  const quartet = { mbid: 'quartet', name: 'Danish String Quartet' }
  const bach = { mbid: 'bach', name: 'J. S. Bach' }
  const mozart = { mbid: 'mozart', name: 'W. A. Mozart' }
  const row = [
    { role: 'instrument', instrument: 'string quartet', person: quartet },
    { role: 'composer', instrument: null, person: bach },
    { role: 'arranger', instrument: null, person: mozart }
  ]

  it('keeps performers separate from composers and arrangers', () => {
    expect(classicalTrackPerformers(row)).toEqual([quartet])
  })

  it('lists a performer once even when they hold several roles on the track', () => {
    const degarmo = { mbid: 'degarmo', name: 'Chris DeGarmo' }
    expect(
      classicalTrackPerformers([
        { role: 'instrument', instrument: 'guitar', person: degarmo },
        { role: 'vocal', instrument: 'background vocals', person: degarmo },
        { role: 'instrument', instrument: 'string quartet', person: quartet }
      ])
    ).toEqual([degarmo, quartet])
  })

  it('chooses the performer with the broadest album coverage', () => {
    expect(classicalAlbumPerformers({
      releaseMbid: null, originalDate: null, releaseLevel: [], members: [], trackArtists: {},
      byTrack: { one: row, two: row },
      classical: { source: 'exact', alignmentConfidence: 'exact', releaseMbid: null, matchedTracks: 2, totalTracks: 2, alignment: { acoustidRecording: 0, recordingGuid: 2, releaseTrackGuid: 0, discIndex: 0, titleDuration: 0, unmatched: 0 }, composers: [], byTrack: {} }
    })).toEqual([quartet])
  })
})

function model(confidence: ClassicalAlbumModel['alignmentConfidence']): ClassicalAlbumModel {
  return {
    source: confidence === 'none' ? 'none' : 'reconciled',
    alignmentConfidence: confidence,
    releaseMbid: null,
    matchedTracks: confidence === 'none' ? 0 : 1,
    totalTracks: 1,
    alignment: {
      acoustidRecording: 0,
      recordingGuid: 0,
      releaseTrackGuid: 0,
      discIndex: 0,
      titleDuration: confidence === 'weak' ? 1 : 0,
      unmatched: confidence === 'none' ? 1 : 0
    },
    composers: [{ person: { mbid: 'mb-composer', name: 'MB Composer' }, trackCount: 1 }],
    byTrack: {}
  }
}

describe('resolveEffectiveComposers', () => {
  it('prefers trusted per-work MB composers over a legacy album override', () => {
    expect(
      resolveEffectiveComposers(model('strong'), { mbid: 'override', name: 'Pinned Composer' })
    ).toEqual({
      source: 'musicbrainz',
      people: [{ mbid: 'mb-composer', name: 'MB Composer' }]
    })
  })

  it.each(['exact', 'strong'] as const)('uses MB composers for %s alignment', (confidence) => {
    expect(resolveEffectiveComposers(model(confidence), null)).toEqual({
      source: 'musicbrainz',
      people: [{ mbid: 'mb-composer', name: 'MB Composer' }]
    })
  })

  it.each(['weak', 'none'] as const)('suppresses MB composers for %s alignment', (confidence) => {
    expect(resolveEffectiveComposers(model(confidence), null)).toEqual({
      source: 'none',
      people: []
    })
  })

  it('allows an override even when no classical model exists', () => {
    expect(resolveEffectiveComposers(null, { mbid: 'beethoven', name: ' Ludwig van Beethoven ' }))
      .toEqual({
        source: 'override',
        people: [{ mbid: 'beethoven', name: 'Ludwig van Beethoven' }]
      })
  })
})
