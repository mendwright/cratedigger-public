import { describe, expect, it } from 'vitest'
import type { PlexTrack } from './plex'
import type { ClassicalTrackMetadata } from './classical-model'
import {
  discDiagnostics,
  hasMultipleDiscs,
  hasWorkStructure,
  projectClassicalTracks,
  projectDiscGroups,
  stableSortTracks
} from './classical-tracks'

function track(id: string, disc: number | null, index: number | null): PlexTrack {
  return {
    ratingKey: id,
    title: id,
    index,
    parentIndex: disc,
    duration: null,
    originalTitle: null,
    guids: []
  }
}

function metadata(opts: Partial<ClassicalTrackMetadata> = {}): ClassicalTrackMetadata {
  return {
    matchMethod: 'disc-index',
    releaseTrackMbid: null,
    recordingMbid: null,
    workMbid: null,
    workTitle: null,
    parentWorkMbid: null,
    parentWorkTitle: null,
    composers: [],
    ...opts
  }
}

describe('stableSortTracks', () => {
  it('sorts shuffled tracks by disc then track without mutating the input', () => {
    const input = [track('2-2', 2, 2), track('1-2', 1, 2), track('2-1', 2, 1), track('1-1', 1, 1)]
    const before = [...input]

    const sorted = stableSortTracks(input)

    expect(sorted.map((t) => t.ratingKey)).toEqual(['1-1', '1-2', '2-1', '2-2'])
    expect(input).toEqual(before)
    expect(sorted[0]).toBe(input[3])
  })

  it('keeps duplicate coordinates stable', () => {
    const first = track('first', 1, 1)
    const second = track('second', 1, 1)
    expect(stableSortTracks([second, first])).toEqual([second, first])
  })

  it('places malformed coordinates last in their original relative order', () => {
    const noDisc = track('no-disc', null, 1)
    const noIndex = track('no-index', 1, null)
    const zeroDisc = track('zero-disc', 0, 2)
    const valid = track('valid', 1, 1)
    expect(stableSortTracks([noDisc, valid, noIndex, zeroDisc])).toEqual([
      valid,
      noDisc,
      noIndex,
      zeroDisc
    ])
  })
})

describe('projectDiscGroups', () => {
  it('projects a single disc and does not request headers', () => {
    const input = [track('2', 1, 2), track('1', 1, 1)]
    const groups = projectDiscGroups(input)
    expect(groups).toEqual([{ discNumber: 1, tracks: [input[1], input[0]] }])
    expect(hasMultipleDiscs(groups)).toBe(false)
  })

  it('projects a clean shuffled 13-disc set in order', () => {
    const input = Array.from({ length: 13 }, (_, i) => track(`disc-${13 - i}`, 13 - i, 1))
    const groups = projectDiscGroups(input)
    expect(groups.map((g) => g.discNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(groups.flatMap((g) => g.tracks)).toHaveLength(13)
    expect(hasMultipleDiscs(groups)).toBe(true)
  })

  it('puts null or malformed coordinates into one final Other group', () => {
    const noDisc = track('no-disc', null, 2)
    const noIndex = track('no-index', 1, null)
    const valid = track('valid', 1, 1)
    const groups = projectDiscGroups([noDisc, valid, noIndex])
    expect(groups).toEqual([
      { discNumber: 1, tracks: [valid] },
      { discNumber: null, tracks: [noDisc, noIndex] }
    ])
  })

  it('projects all-null coordinates as a single Other group', () => {
    const input = [track('a', null, null), track('b', null, null)]
    expect(projectDiscGroups(input)).toEqual([{ discNumber: null, tracks: input }])
  })

  it('requests a disc header when the only real disc starts above one', () => {
    expect(hasMultipleDiscs(projectDiscGroups([track('a', 2, 1)]))).toBe(true)
  })

  it('preserves every track object identity', () => {
    const input = [track('a', 2, 1), track('b', null, 1), track('c', 1, 1)]
    const output = projectDiscGroups(input).flatMap((group) => group.tracks)
    expect(new Set(output)).toEqual(new Set(input))
    for (const projected of output) expect(input).toContain(projected)
  })
})

describe('discDiagnostics', () => {
  it('reports duplicate coordinates and missing or malformed values', () => {
    const result = discDiagnostics([
      track('a', 1, 1),
      track('b', 1, 1),
      track('c', null, 2),
      track('d', null, 2),
      track('e', 2, null),
      track('f', 0, -1)
    ])

    expect(result).toEqual({
      duplicateCoords: [
        { disc: 1, index: 1, count: 2 },
        { disc: null, index: 2, count: 2 }
      ],
      missingDisc: 3,
      missingIndex: 2
    })
  })
})

describe('projectClassicalTracks', () => {
  it('groups consecutive movements and strips a shared German work prefix', () => {
    const allegro = { ...track('a', 1, 1), title: 'Klaviersonate Nr. 1 in F-Moll, Op. 2,1: Allegro' }
    const adagio = { ...track('b', 1, 2), title: 'Klaviersonate Nr. 1 in F-Moll, Op. 2,1: Adagio' }
    const menuetto = { ...track('c', 1, 3), title: 'Klaviersonate Nr. 1 in F-Moll, Op. 2,1: Menuetto' }
    const composer = { mbid: 'beethoven', name: 'Ludwig van Beethoven' }
    const byTrack = Object.fromEntries(
      [allegro, adagio, menuetto].map((item) => [
        item.ratingKey,
        metadata({
          workMbid: `movement-${item.ratingKey}`,
          workTitle: item.title,
          parentWorkMbid: 'sonata-1',
          parentWorkTitle: 'Piano Sonata no. 1 in F minor, op. 2 no. 1',
          composers: [composer]
        })
      ])
    )

    const result = projectClassicalTracks(projectDiscGroups([allegro, adagio, menuetto]), byTrack)
    expect(result[0].groups).toEqual([
      {
        key: 'work:sonata-1:1',
        title: 'Piano Sonata no. 1 in F minor, op. 2 no. 1',
        composers: [composer],
        movements: [
          { track: allegro, movementLabel: 'Allegro' },
          { track: adagio, movementLabel: 'Adagio' },
          { track: menuetto, movementLabel: 'Menuetto' }
        ]
      }
    ])
    expect(hasWorkStructure(result)).toBe(true)
  })

  it('strips a shared Bach prefix while keeping roman movement numbers', () => {
    const first = { ...track('a', 1, 1), title: 'Partita No.5 In G, BWV 829: I. Praeambulum' }
    const second = { ...track('b', 1, 2), title: 'Partita No.5 In G, BWV 829: II. Allemande' }
    const byTrack = {
      a: metadata({ parentWorkMbid: 'partita', parentWorkTitle: 'Partita no. 5 in G major, BWV 829' }),
      b: metadata({ parentWorkMbid: 'partita', parentWorkTitle: 'Partita no. 5 in G major, BWV 829' })
    }
    const group = projectClassicalTracks(projectDiscGroups([first, second]), byTrack)[0].groups[0]
    expect(group.movements.map((movement) => movement.movementLabel)).toEqual([
      'I. Praeambulum',
      'II. Allemande'
    ])
  })

  it('keeps non-adjacent instances of the same work as uniquely keyed runs', () => {
    const input = [track('a', 1, 1), track('interlude', 1, 2), track('b', 1, 3)]
    const byTrack = {
      a: metadata({ parentWorkMbid: 'same', parentWorkTitle: 'Same work' }),
      interlude: metadata(),
      b: metadata({ parentWorkMbid: 'same', parentWorkTitle: 'Same work' })
    }
    const groups = projectClassicalTracks(projectDiscGroups(input), byTrack)[0].groups
    expect(groups.map((group) => group.key)).toEqual(['work:same:1', 'loose:1', 'work:same:2'])
    expect(groups.map((group) => group.movements[0].track)).toEqual(input)
    expect(hasWorkStructure([{ discNumber: 1, groups }])).toBe(false)
  })

  it('keeps consecutive unknown tracks in one ungrouped run in place', () => {
    const input = [track('known', 1, 1), track('x', 1, 2), track('y', 1, 3)]
    const result = projectClassicalTracks(projectDiscGroups(input), {
      known: metadata({ workMbid: 'standalone', workTitle: 'Standalone' })
    })
    expect(result[0].groups.map((group) => ({
      key: group.key,
      title: group.title,
      tracks: group.movements.map((movement) => movement.track.ratingKey)
    }))).toEqual([
      { key: 'work:standalone:1', title: 'Standalone', tracks: ['known'] },
      { key: 'loose:1', title: null, tracks: ['x', 'y'] }
    ])
  })

  it('does not merge a work across a disc boundary', () => {
    const first = track('a', 1, 1)
    const second = track('b', 2, 1)
    const byTrack = {
      a: metadata({ parentWorkMbid: 'cross-disc', parentWorkTitle: 'Cross-disc work' }),
      b: metadata({ parentWorkMbid: 'cross-disc', parentWorkTitle: 'Cross-disc work' })
    }
    const result = projectClassicalTracks(projectDiscGroups([second, first]), byTrack)
    expect(result.map((disc) => disc.groups[0].movements[0].track)).toEqual([first, second])
    expect(hasWorkStructure(result)).toBe(false)
  })

  it('deduplicates composers by MBID in first-seen order', () => {
    const first = track('a', 1, 1)
    const second = track('b', 1, 2)
    const bach = { mbid: 'bach', name: 'Johann Sebastian Bach' }
    const busoni = { mbid: 'busoni', name: 'Ferruccio Busoni' }
    const byTrack = {
      a: metadata({ parentWorkMbid: 'work', parentWorkTitle: 'Work', composers: [bach] }),
      b: metadata({ parentWorkMbid: 'work', parentWorkTitle: 'Work', composers: [bach, busoni] })
    }
    const group = projectClassicalTracks(projectDiscGroups([first, second]), byTrack)[0].groups[0]
    expect(group.composers).toEqual([bach, busoni])
  })

  it('falls back to full titles when no safe shared delimiter exists', () => {
    const first = { ...track('a', 1, 1), title: 'Goldberg Aria' }
    const second = { ...track('b', 1, 2), title: 'Goldberg Variation 1' }
    const byTrack = {
      a: metadata({ parentWorkMbid: 'goldberg', parentWorkTitle: 'Goldberg Variations' }),
      b: metadata({ parentWorkMbid: 'goldberg', parentWorkTitle: 'Goldberg Variations' })
    }
    const group = projectClassicalTracks(projectDiscGroups([first, second]), byTrack)[0].groups[0]
    expect(group.movements.map((movement) => movement.movementLabel)).toEqual([
      first.title,
      second.title
    ])
  })

  it('preserves PlexTrack identity through work projection', () => {
    const input = [track('a', 1, 1), track('b', 1, 2)]
    const byTrack = {
      a: metadata({ parentWorkMbid: 'work', parentWorkTitle: 'Work' }),
      b: metadata({ parentWorkMbid: 'work', parentWorkTitle: 'Work' })
    }
    const output = projectClassicalTracks(projectDiscGroups(input), byTrack)
      .flatMap((disc) => disc.groups)
      .flatMap((group) => group.movements)
      .map((movement) => movement.track)
    expect(output[0]).toBe(input[0])
    expect(output[1]).toBe(input[1])
  })
})
