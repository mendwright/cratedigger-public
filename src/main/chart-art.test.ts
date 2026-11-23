import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArtistBio } from '../shared/plex'
import type { ChartEntry } from '../shared/charts'
const mocks = vi.hoisted(() => ({ albums: [] as unknown[], cache: new Map<string, string[] | null>(), bio: vi.fn(async (): Promise<ArtistBio | null> => null), search: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./library-snapshot.js', () => ({ librarySnapshot: { allAlbums: async () => mocks.albums } }))
vi.mock('./bios.js', () => ({ getArtistBio: mocks.bio }))
vi.mock('./musicbrainz.js', () => ({ searchArtistByName: mocks.search, getReleaseGroupForRelease: vi.fn(async () => null) }))
vi.mock('./mb-cache.js', () => ({ JsonCache: class { async get(key: string) { return mocks.cache.get(key) } async set(key: string, value: string[]) { mocks.cache.set(key, value) } } }))
const entry: ChartEntry = { rank: 1, title: 'Album', subtitle: 'Artist', plays: 1, seconds: 210, ratingKey: '123', thumb: '/broken' }
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => { vi.resetModules(); mocks.cache.clear(); mocks.bio.mockReset().mockResolvedValue(null); mocks.search.mockReset().mockResolvedValue(null); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] }))); mocks.albums = [{ ratingKey: '123', title: 'Album', artist: 'Artist', artistRatingKey: '12', thumb: '/library/album-cover', guids: ['mbid://release-group/11111111-1111-1111-1111-111111111111'] }] })
it('returns the matched library cover before CAA after a chart thumb fails', async () => {
  const { chartArt } = await import('./chart-art')
  expect(await chartArt(entry, 'albums')).toEqual(['/library/album-cover', 'https://coverartarchive.org/release-group/11111111-1111-1111-1111-111111111111/front-500'])
})
it('matches a track by its retained album name when its Plex key is absent', async () => {
  const { chartArt } = await import('./chart-art')
  expect((await chartArt({ ...entry, title: 'Track', album: 'Album', ratingKey: null } as ChartEntry, 'tracks'))[0]).toBe('/library/album-cover')
})
it('can use release MBIDs for CAA without waiting behind artist biography lookups', async () => {
  mocks.albums = [{ ratingKey: '123', title: 'Album', artist: 'Artist', thumb: null, guids: ['mbid://release/22222222-2222-2222-2222-222222222222'] }]
  const { chartArt } = await import('./chart-art')
  expect(await chartArt(entry, 'albums')).toContain('https://coverartarchive.org/release/22222222-2222-2222-2222-222222222222/front-500')
})

it('does not let a pending artist-photo request block a local album cover', async () => {
  mocks.search.mockImplementationOnce(() => new Promise(() => {}))
  const { chartArt } = await import('./chart-art')
  void chartArt({ ...entry, title: 'Slow artist' }, 'artists')
  await Promise.resolve(); await Promise.resolve()
  const result = await Promise.race([chartArt(entry, 'albums'), new Promise(resolve => setTimeout(() => resolve('blocked'), 50))])
  expect(result).toEqual(['/library/album-cover', 'https://coverartarchive.org/release-group/11111111-1111-1111-1111-111111111111/front-500'])
})

const artist: ChartEntry = { ...entry, title: 'Phoebe Bridgers', subtitle: null, ratingKey: '12' }
const photo = 'https://cdn-images.dzcdn.net/images/artist/abc123/1000x1000.jpg'
function deezer(data: unknown[]) {
  const fetch = vi.fn(async (_url: URL) => Response.json({ data }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
it('orders Wikipedia, exact-name Deezer photo and library covers, and persists the photos', async () => {
  mocks.search.mockResolvedValue('mbid')
  mocks.bio.mockResolvedValue({ image: { source: 'wikipedia', url: 'https://wiki.test/photo.jpg' } } as ArtistBio)
  const fetch = deezer([{ name: 'Phoebe Bridgers Tribute', picture_xl: 'https://wrong.test/photo.jpg' }, { name: 'PHOEBE   BRIDGERS', picture_xl: photo }])
  const { chartArt } = await import('./chart-art')
  const expected = ['https://wiki.test/photo.jpg', photo, '/library/album-cover']
  expect(await chartArt(artist, 'artists')).toEqual(expected)
  const url = new URL(String(fetch.mock.calls[0][0]))
  expect(url.origin + url.pathname).toBe('https://api.deezer.com/search/artist')
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'Phoebe Bridgers', limit: '5' })
  expect(mocks.cache.get('artists|Phoebe Bridgers|')).toEqual(expected.slice(0, 2))
  expect(await chartArt(artist, 'artists')).toEqual(expected)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('rejects different artists, including prefix and accent differences', async () => {
  deezer([{ name: 'Phoebe Bridgers Tribute', picture_xl: photo }, { name: 'Phoebe', picture_xl: photo }, { name: 'Phoebé Bridgers', picture_xl: photo }])
  const { chartArt } = await import('./chart-art')
  expect(await chartArt(artist, 'artists')).toEqual(['/library/album-cover'])
})
it('skips the empty-hash placeholder and malformed URLs before another exact-name match', async () => {
  deezer([{ name: artist.title, picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000.jpg' }, { name: artist.title, picture_xl: 'invalid' }, { name: artist.title, picture_xl: photo }])
  const { chartArt } = await import('./chart-art')
  expect(await chartArt(artist, 'artists')).toEqual([photo, '/library/album-cover'])
})
it('keeps library covers on Deezer failure and retries rather than caching the outage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  const { chartArt } = await import('./chart-art')
  expect(await chartArt(artist, 'artists')).toEqual(['/library/album-cover'])
  expect(mocks.cache.size).toBe(0)
  deezer([{ name: artist.title, picture_xl: photo }])
  expect(await chartArt(artist, 'artists')).toEqual([photo, '/library/album-cover'])
})
