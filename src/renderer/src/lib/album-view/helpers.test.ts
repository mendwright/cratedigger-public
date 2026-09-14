import { describe, expect, it } from 'vitest'
import type { AlbumCredits, PlexTrack } from '../../../../shared/plex'
import { groupCredits } from './helpers'

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
