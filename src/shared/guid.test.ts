import { describe, expect, it } from 'vitest'
import { parseMusicBrainzReleaseInput } from './guid'

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
