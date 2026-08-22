import { describe, it, expect } from 'vitest'
import { parseCsv, parseExportifyCsv, parsePlaylistFile, parseSpotifyDumpJson } from './playlist-file'

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\n1,2,3')
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3']
    ])
  })

  it('handles CRLF and skips blank lines', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,"line1\nline2"\n1,2')).toEqual([
      ['a', 'line1\nline2'],
      ['1', '2']
    ])
  })
})

const EXPORTIFY = `Track URI,Track Name,Artist URI(s),Artist Name(s),Album Name,Track Duration (ms)
spotify:track:1,Norf Norf,spotify:artist:1,Vince Staples,Summertime '06,183000
spotify:track:2,"Accordion",spotify:artist:2,"Madvillain, MF DOOM",Madvillainy,118000
spotify:track:3,No Title Artist,,,"",0`

describe('parseExportifyCsv', () => {
  it('maps the standard Exportify columns', () => {
    const pl = parseExportifyCsv(EXPORTIFY, 'rap_heaters-2019.csv')!
    expect(pl.name).toBe('rap heaters 2019')
    expect(pl.tracks[0]).toEqual({
      title: 'Norf Norf',
      artist: 'Vince Staples',
      album: "Summertime '06",
      durationMs: 183000,
      isLocal: false
    })
    expect(pl.tracks[1].artist).toBe('Madvillain, MF DOOM')
    // 0 / missing duration → null
    expect(pl.tracks[2].durationMs).toBeNull()
  })

  it('rejects a CSV without track/artist columns', () => {
    expect(parseExportifyCsv('foo,bar\n1,2', 'x.csv')).toBeNull()
  })
})

const DUMP = JSON.stringify({
  playlists: [
    {
      name: 'sunday morning',
      items: [
        { track: { trackName: 'Pink Moon', artistName: 'Nick Drake', albumName: 'Pink Moon' } },
        { track: null, episode: { name: 'some podcast' } },
        { localTrack: { title: 'basement tape', artist: 'unknown' } }
      ]
    },
    { name: 'empty one', items: [] }
  ]
})

describe('parseSpotifyDumpJson', () => {
  it('maps playlists and flags local tracks, skipping episodes and empties', () => {
    const lists = parseSpotifyDumpJson(DUMP)
    expect(lists).toHaveLength(1)
    expect(lists[0].name).toBe('sunday morning')
    expect(lists[0].tracks).toHaveLength(2)
    expect(lists[0].tracks[0]).toMatchObject({ title: 'Pink Moon', artist: 'Nick Drake', durationMs: null })
    expect(lists[0].tracks[1]).toMatchObject({ title: 'basement tape', isLocal: true })
  })

  it('returns empty on malformed JSON', () => {
    expect(parseSpotifyDumpJson('not json')).toEqual([])
  })
})

describe('uniquifyNames', () => {
  it('suffixes duplicate playlist names', async () => {
    const { uniquifyNames } = await import('./playlist-file')
    const t = { title: 'x', artist: '', album: '', durationMs: null, isLocal: false }
    const out = uniquifyNames([
      { name: 'Grieg Lyric Pieces', tracks: [t] },
      { name: 'Grieg Lyric Pieces', tracks: [t] },
      { name: 'other', tracks: [t] }
    ])
    expect(out.map((p) => p.name)).toEqual(['Grieg Lyric Pieces', 'Grieg Lyric Pieces (2)', 'other'])
  })
})

describe('parsePlaylistFile', () => {
  it('routes JSON to the dump parser and CSV to exportify', () => {
    expect(parsePlaylistFile(DUMP, 'Playlist1.json')).toHaveLength(1)
    expect(parsePlaylistFile(EXPORTIFY, 'list.csv')).toHaveLength(1)
    expect(parsePlaylistFile('garbage', 'x.txt')).toEqual([])
  })
})
