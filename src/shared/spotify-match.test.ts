import { describe, it, expect } from 'vitest'
import { bestPlexMatch, plexQueryFor, scoreCandidate } from './spotify-match'
import type { SearchTrack } from './plex'
import type { SpotifyTrack } from './spotify'

function sp(over: Partial<SpotifyTrack>): SpotifyTrack {
  return {
    artist: 'Vince Staples',
    title: 'Norf Norf',
    album: 'Summertime ’06',
    durationMs: 183000,
    isLocal: false,
    ...over
  }
}

function px(over: Partial<SearchTrack>): SearchTrack {
  return {
    ratingKey: 'rk',
    title: 'Norf Norf',
    duration: 183000,
    album: 'Summertime ’06',
    albumRatingKey: 'ark',
    artist: 'Vince Staples',
    thumb: null,
    ...over
  }
}

describe('scoreCandidate', () => {
  it('scores a clean exact match highest (title+artist+duration+album)', () => {
    expect(scoreCandidate(sp({}), px({}))).toBe(4 + 3 + 2 + 1)
  })

  it('rejects when the title differs', () => {
    expect(scoreCandidate(sp({}), px({ title: 'Lift Me Up' }))).toBeNull()
  })

  it('rejects a same-titled track by an unrelated artist', () => {
    expect(scoreCandidate(sp({}), px({ artist: 'Bon Iver' }))).toBeNull()
  })

  it('survives feat-credit parentheticals and remaster suffixes', () => {
    const s = sp({ title: 'Norf Norf (feat. Kilo Kish)' })
    const c = px({ title: 'Norf Norf' })
    expect(scoreCandidate(s, c)).not.toBeNull()
    const s2 = sp({ title: 'Norf Norf' })
    const c2 = px({ title: 'Norf Norf (2019 Remaster)' })
    expect(scoreCandidate(s2, c2)).not.toBeNull()
  })

  // Regression: 13 K-Tel gaps included dash-suffixed Spotify titles that could
  // never equal the plain Plex title — parenthetical stripping doesn't touch
  // " - Remastered 2003" style qualifiers.
  it('survives dash-suffix remaster qualifiers', () => {
    const s = sp({ title: 'Every Little Thing She Does Is Magic - Remastered 2003' })
    const c = px({ title: 'Every Little Thing She Does Is Magic' })
    expect(scoreCandidate(s, c)).not.toBeNull()
    const s2 = sp({ title: 'Someday, Someway - Remastered' })
    const c2 = px({ title: 'Someday, Someway' })
    expect(scoreCandidate(s2, c2)).not.toBeNull()
  })

  it('accepts multi-artist Spotify credits via containment', () => {
    const s = sp({ artist: 'Vince Staples, Kilo Kish' })
    expect(scoreCandidate(s, px({}))).not.toBeNull()
  })

  // Regression: the K-Tel re-import left this filed single in the gap list —
  // "&" vs "and" in the artist plus a junk artist-repeat parenthetical in the
  // file's title tag. Real strings from Plex Singles section / Exportify CSV.
  it('matches "&" against "and" in the artist (Huey Lewis single)', () => {
    const s = sp({
      artist: 'Huey Lewis & The News',
      title: 'Do You Believe In Love',
      album: 'Picture This'
    })
    const c = px({
      artist: 'Huey Lewis and the News',
      title: 'Do You Believe in Love (Huey Lewis And The News)',
      album: 'Singles'
    })
    expect(scoreCandidate(s, c)).not.toBeNull()
  })

  it('penalizes a wildly different duration', () => {
    const near = scoreCandidate(sp({}), px({}))!
    const far = scoreCandidate(sp({}), px({ duration: 183000 + 60000 }))!
    expect(far).toBeLessThan(near)
  })

  it('tolerates missing durations', () => {
    expect(scoreCandidate(sp({ durationMs: null }), px({ duration: null }))).toBe(4 + 3 + 1)
  })
})

describe('bestPlexMatch', () => {
  it('prefers the album version over a compilation when durations tie', () => {
    const s = sp({})
    const albumCut = px({ ratingKey: 'a' })
    const compCut = px({ ratingKey: 'b', album: 'Now That’s What I Call Rap' })
    expect(bestPlexMatch(s, [compCut, albumCut])?.track.ratingKey).toBe('a')
  })

  it('returns null when nothing passes the floor (a gap)', () => {
    expect(bestPlexMatch(sp({}), [px({ artist: 'Someone Else' })])).toBeNull()
    expect(bestPlexMatch(sp({}), [])).toBeNull()
  })

  it('picks the closest-duration candidate among same-title matches', () => {
    const s = sp({ durationMs: 183000 })
    const close = px({ ratingKey: 'close', duration: 184000, album: 'Live at the Fillmore' })
    const far = px({ ratingKey: 'far', duration: 251000, album: 'Live at the Fillmore' })
    expect(bestPlexMatch(s, [far, close])?.track.ratingKey).toBe('close')
  })
})

describe('plexQueryFor', () => {
  it('strips parentheticals and punctuation for the search query', () => {
    expect(plexQueryFor(sp({ title: 'Norf Norf (feat. Kilo Kish)' }))).toBe('norf norf')
    expect(plexQueryFor(sp({ title: "Ain't It Funny" }))).toBe('ain t it funny')
  })

  it('strips dash-suffix qualifiers for the search query', () => {
    expect(plexQueryFor(sp({ title: 'Someday, Someway - Remastered' }))).toBe('someday someway')
    expect(plexQueryFor(sp({ title: 'Jump to It - 12" Mix' }))).toBe('jump to it')
  })

  it('falls back to the raw title when normalization empties it', () => {
    expect(plexQueryFor(sp({ title: '!!!' }))).toBe('!!!')
  })
})
