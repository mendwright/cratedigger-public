import { describe, expect, it } from 'vitest'
import type { AlbumCredits, PlexTrack } from '../../../../shared/plex'
import { groupCredits, groupCreditsByPerson, trackCreditsByPerson } from './helpers'

const tek = { mbid: 'tek', name: 'Deniz Tek' }
const roky = { mbid: 'roky', name: 'Roky Erickson' }
const iggy = { mbid: 'iggy', name: 'Iggy Pop' }
const track = (ratingKey: string, title: string): PlexTrack =>
  ({ ratingKey, title, index: Number(ratingKey), parentIndex: 1, duration: null, originalTitle: null, guids: [] }) as PlexTrack
const writer = (person: { mbid: string; name: string }) => ({ role: 'writer', instrument: null, person })

describe('groupCredits — who is on which tracks', () => {
  const tracks = [track('1', 'Aloha Steve and Danno'), track('2', "You're Gonna Miss Me"), track('3', 'TV Eye')]
  const credits = {
    releaseLevel: [{ role: 'producer', person: { mbid: 'jw', name: 'Jason Whalley' } }],
    byTrack: { '1': [writer(tek)], '2': [writer(roky), writer(tek)], '3': [writer(iggy), writer(tek)] },
    trackArtists: {},
    members: [],
    releaseMbid: null,
    originalDate: null
  } as unknown as AlbumCredits

  it('annotates people credited on only some tracks, in album order', () => {
    const writers = groupCredits(credits, tracks).find((g) => g.role === 'writer')!
    expect(writers.onTracks.get('roky')).toEqual(["You're Gonna Miss Me"])
    expect(writers.onTracks.get('iggy')).toEqual(['TV Eye'])
    expect(writers.onTracks.has('tek')).toBe(false) // on every track
  })

  it('leaves release-level credits and callers without a track list alone', () => {
    const grouped = groupCredits(credits, tracks)
    expect(grouped.find((g) => g.role === 'producer')!.onTracks.size).toBe(0)
    expect(groupCredits(credits).every((g) => g.onTracks.size === 0)).toBe(true)
  })
})

describe('groupCreditsByPerson — one row per person', () => {
  const tracks = [track('1', 'Margaret vs. Pauline'), track('2', 'Star Witness'), track('3', 'Hold On, Hold On')]
  const neko = { mbid: 'neko', name: 'Neko Case' }
  const paul = { mbid: 'paul', name: 'Paul Rigby' }
  const garth = { mbid: 'garth', name: 'Garth Hudson' }
  const credits = {
    releaseLevel: [{ role: 'producer', person: neko }],
    byTrack: {
      '1': [
        { role: 'vocal', instrument: null, person: neko },
        { role: 'instrument', instrument: 'electric guitar', person: paul },
        { role: 'instrument', instrument: 'piano', person: garth }
      ],
      '2': [
        { role: 'vocal', instrument: null, person: neko },
        { role: 'instrument', instrument: 'electric guitar', person: paul },
        { role: 'instrument', instrument: '12-string guitar', person: paul }
      ],
      '3': [
        { role: 'vocal', instrument: null, person: neko },
        { role: 'instrument', instrument: 'acoustic guitar', person: paul }
      ]
    },
    trackArtists: {},
    members: [],
    releaseMbid: null,
    originalDate: null
  } as unknown as AlbumCredits

  it('folds every role a person holds into their one row', () => {
    const rows = groupCreditsByPerson(credits, tracks, { name: 'Neko Case' })
    const p = rows.find((r) => r.mbid === 'paul')!
    expect(p.roles).toEqual(['12-string guitar', 'acoustic guitar', 'electric guitar'])
    expect(p.trackCount).toBe(3)
    expect(p.onTracks).toBeNull() // on every track
  })

  it('puts the album artist first, then the people on the most tracks', () => {
    const rows = groupCreditsByPerson(credits, tracks, { name: 'Neko Case' })
    expect(rows.map((r) => r.mbid)).toEqual(['neko', 'paul', 'garth'])
    expect(rows[0].isAlbumArtist).toBe(true)
    expect(rows[0].roles).toEqual(['vocal', 'producer'])
  })

  it('names the tracks for a partial contributor', () => {
    const garthRow = groupCreditsByPerson(credits, tracks).find((r) => r.mbid === 'garth')!
    expect(garthRow.onTracks).toEqual(['Margaret vs. Pauline'])
    expect(garthRow.trackCount).toBe(1)
  })

  it('returns nothing without credits', () => {
    expect(groupCreditsByPerson(null, tracks)).toEqual([])
  })

  it('sinks MusicBrainz placeholder artists to the end and flags them', () => {
    const withTrad = {
      ...credits,
      releaseLevel: [...credits.releaseLevel, { role: 'composer', person: { mbid: 'trad', name: '[traditional]' } }]
    } as AlbumCredits
    const rows = groupCreditsByPerson(withTrad, tracks, { name: 'Neko Case' })
    expect(rows.at(-1)).toMatchObject({ mbid: 'trad', placeholder: true })
    expect(rows[0].placeholder).toBe(false)
  })
})

describe('trackCreditsByPerson', () => {
  it('groups one track’s credits by person', () => {
    const rows = trackCreditsByPerson([
      { role: 'instrument', instrument: 'electric guitar', person: { mbid: 'p', name: 'Paul Rigby' } },
      { role: 'instrument', instrument: '12-string guitar', person: { mbid: 'p', name: 'Paul Rigby' } },
      { role: 'vocal', instrument: null, person: { mbid: 'n', name: 'Neko Case' } }
    ])
    expect(rows).toEqual([
      { mbid: 'n', name: 'Neko Case', roles: ['vocal'] },
      { mbid: 'p', name: 'Paul Rigby', roles: ['12-string guitar', 'electric guitar'] }
    ])
  })
})
