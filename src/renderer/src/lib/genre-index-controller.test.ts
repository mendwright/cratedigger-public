import { describe, expect, it } from 'vitest'
import type { PlexAlbum } from '../../../shared/plex'
import { albumToGenreItem } from './genre-index-controller.svelte'

const album = (over: Partial<PlexAlbum>): PlexAlbum =>
  ({ ratingKey: '1', artist: 'Dr. Feelgood', title: 'Down by the Jetty', guids: [], artistRatingKey: 'art-1', ...over }) as PlexAlbum

describe('albumToGenreItem — artist MBID for the artist-genre tier', () => {
  it('maps the album to its artist MBID through the artist rating key', () => {
    const item = albumToGenreItem(album({}), new Map([['art-1', 'mbid-feelgood']]))
    expect(item.artistMbid).toBe('mbid-feelgood')
  })

  it('leaves the tier off when the artist has no MusicBrainz id or no rating key', () => {
    expect(albumToGenreItem(album({}), new Map()).artistMbid).toBeNull()
    expect(albumToGenreItem(album({ artistRatingKey: null }), new Map([['art-1', 'x']])).artistMbid).toBeNull()
  })
})
