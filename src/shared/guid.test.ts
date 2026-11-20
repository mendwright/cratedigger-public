import { describe, expect, it } from 'vitest'
import { extractMbidFromGuid, parseMusicBrainzReleaseInput } from './guid'

describe('parseMusicBrainzReleaseInput', () => {
  const mbid = '150723cb-f214-4359-b272-84f543b64012'

  it('accepts a bare release MBID', () => {
    expect(parseMusicBrainzReleaseInput(`  ${mbid.toUpperCase()}  `)).toBe(mbid)
  })

  it('accepts a copied MusicBrainz release URL', () => {
    expect(
      parseMusicBrainzReleaseInput(`https://musicbrainz.org/release/${mbid}`)
    ).toBe(mbid)
  })

  it('rejects malformed IDs and non-release URLs', () => {
    expect(parseMusicBrainzReleaseInput('not-an-id')).toBeNull()
    expect(
      parseMusicBrainzReleaseInput(`https://musicbrainz.org/release-group/${mbid}`)
    ).toBeNull()
  })
})

describe('extractMbidFromGuid', () => {
  const mbid = '893b6621-4877-4671-8a7c-b9971f723837'

  it('reports whether the entity tag was explicit', () => {
    expect(extractMbidFromGuid(`mbid://artist/${mbid}`)).toEqual({
      entity: 'artist',
      mbid,
      explicit: true
    })
    expect(extractMbidFromGuid(`mbid://${mbid.toUpperCase()}`)).toEqual({
      entity: 'release',
      mbid,
      explicit: false
    })
    expect(extractMbidFromGuid('plex://artist/5d07bbfd403c640290b95e0d')).toBeNull()
  })
})
