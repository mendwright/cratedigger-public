import { describe, it, expect } from 'vitest'
import {
  classifyPaste,
  parseAppleMusicHtml,
  parseSpotifyEmbedHtml,
  parseTrackLines
} from './playlist-url'

describe('classifyPaste', () => {
  it('spots a Spotify playlist link, with share junk and surrounding text', () => {
    const r = classifyPaste(
      'check this https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123&pi=x'
    )
    expect(r).toEqual({
      kind: 'spotify',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
    })
  })

  it('accepts intl-prefixed and embed Spotify links and spotify: URIs', () => {
    expect(classifyPaste('https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M').kind).toBe('spotify')
    expect(classifyPaste('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M').kind).toBe('spotify')
    expect(classifyPaste('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toMatchObject({ kind: 'spotify', id: '37i9dQZF1DXcBWIGoYBM5M' })
  })

  it('spots an Apple Music playlist link and keeps the storefront', () => {
    expect(
      classifyPaste('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb')
    ).toEqual({
      kind: 'apple',
      storefront: 'us',
      id: 'pl.f4d106fed2bd41149aaacabb233eb5eb',
      url: 'https://music.apple.com/us/playlist/pl.f4d106fed2bd41149aaacabb233eb5eb'
    })
    expect(classifyPaste('https://music.apple.com/gb/playlist/pl.u-abc123DEF')).toMatchObject({ kind: 'apple', storefront: 'gb', id: 'pl.u-abc123DEF' })
  })

  it('reads anything else as song lines, or empty', () => {
    expect(classifyPaste('Big Thief - Not\nMitski — Geyser')).toMatchObject({ kind: 'text' })
    expect(classifyPaste('   \n')).toEqual({ kind: 'empty' })
    expect(classifyPaste('no separators here')).toEqual({ kind: 'empty' })
  })
})

describe('parseTrackLines', () => {
  it('parses Artist - Title with any dash and first-separator rule', () => {
    expect(parseTrackLines('Low - Days Like These\nSault – Wildfires\nLambchop — Up with People - Zero 7 remix')).toEqual([
      { artist: 'Low', title: 'Days Like These', album: '', durationMs: null, isLocal: false },
      { artist: 'Sault', title: 'Wildfires', album: '', durationMs: null, isLocal: false },
      { artist: 'Lambchop', title: 'Up with People - Zero 7 remix', album: '', durationMs: null, isLocal: false }
    ])
  })

  it('shaves list numbering and trailing durations, keeps hyphenated names intact', () => {
    const t = parseTrackLines('1. Jean-Michel Blais - Roses 4:12\n2) Ty Segall- Fanny Dog (3:01)\n• Mdou Moctar - Afrique Victime')
    expect(t.map((x) => `${x.artist}|${x.title}`)).toEqual([
      'Jean-Michel Blais|Roses',
      'Ty Segall|Fanny Dog',
      'Mdou Moctar|Afrique Victime'
    ])
  })

  it('skips blank lines and lines without a separator', () => {
    expect(parseTrackLines('\nMy Playlist\nBeak> - Brean Down\n\n')).toHaveLength(1)
  })
})

function nextData(entity: unknown): string {
  const json = JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`
}

describe('parseSpotifyEmbedHtml', () => {
  it('pulls name and tracks from the embed page JSON', () => {
    const html = nextData({
      name: 'Today’s Top Hits',
      trackList: [
        { title: 'Patient Zero', subtitle: 'Taylor Swift', duration: 225868 },
        { title: 'Golden', subtitle: 'HUNTR/X, EJAE, AUDREY NUNA', duration: 194000 },
        { title: '', subtitle: 'nobody' }
      ]
    })
    const r = parseSpotifyEmbedHtml(html, 'abc')
    expect(r).toMatchObject({
      name: 'Today’s Top Hits',
      source: 'spotify',
      url: 'https://open.spotify.com/playlist/abc',
      truncated: false
    })
    expect(r!.tracks).toEqual([
      { artist: 'Taylor Swift', title: 'Patient Zero', album: '', durationMs: 225868, isLocal: false },
      { artist: 'HUNTR/X, EJAE, AUDREY NUNA', title: 'Golden', album: '', durationMs: 194000, isLocal: false }
    ])
  })

  it('flags the 100-track embed cap and rejects pages without a track list', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ title: `t${i}`, subtitle: 'a', duration: 1000 }))
    expect(parseSpotifyEmbedHtml(nextData({ name: 'Long', trackList: many }), 'x')!.truncated).toBe(true)
    expect(parseSpotifyEmbedHtml('<html>nothing</html>', 'x')).toBeNull()
    expect(parseSpotifyEmbedHtml(nextData({ name: 'Private', trackList: [] }), 'x')).toBeNull()
  })
})

function appleHtml(trackCount: number, tracks: unknown[]): string {
  const json = JSON.stringify({
    data: [
      {
        data: {
          sections: [
            { itemKind: 'containerDetailHeaderLockup', items: [{ title: 'A-List Pop', trackCount }] },
            { itemKind: 'trackLockup', items: tracks },
            { itemKind: 'bubbleLockup', items: [{ title: 'ignored artist' }] }
          ]
        }
      }
    ]
  })
  return `<html><script type="application/json" id="serialized-server-data">${json}</script></html>`
}

describe('parseAppleMusicHtml', () => {
  it('pulls name, artist, album and duration from the server data', () => {
    const r = parseAppleMusicHtml(
      appleHtml(2, [
        { title: 'Solar Eclipse', artistName: 'Drake & Don Toliver', duration: 218389, tertiaryLinks: [{ title: 'HABIBTI (FOMO)' }] },
        { title: 'Ordinary', artistName: 'Alex Warren', duration: 186000, tertiaryLinks: [] }
      ]),
      'US',
      'pl.5ee8'
    )
    expect(r).toMatchObject({ name: 'A-List Pop', source: 'apple', url: 'https://music.apple.com/us/playlist/pl.5ee8', truncated: false })
    expect(r!.tracks).toEqual([
      { artist: 'Drake & Don Toliver', title: 'Solar Eclipse', album: 'HABIBTI (FOMO)', durationMs: 218389, isLocal: false },
      { artist: 'Alex Warren', title: 'Ordinary', album: '', durationMs: 186000, isLocal: false }
    ])
  })

  it('flags a page that holds fewer tracks than the header declares', () => {
    const r = parseAppleMusicHtml(appleHtml(300, [{ title: 'x', artistName: 'y' }]), 'us', 'pl.1')
    expect(r!.truncated).toBe(true)
    expect(parseAppleMusicHtml('<html/>', 'us', 'pl.1')).toBeNull()
  })
})
