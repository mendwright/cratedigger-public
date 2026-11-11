import { describe, expect, it } from 'vitest'
import { extractArtistMbid } from './library'

describe('extractArtistMbid', () => {
  const mbid = '893b6621-4877-4671-8a7c-b9971f723837'

  it('takes the untagged mbid:// GUID Plex writes on artist items', () => {
    // This is the shape on 1,700 of 1,880 library artists — the agent never
    // writes an `artist/` tag. Rejecting it emptied Release Radar entirely.
    expect(extractArtistMbid([{ id: 'plex://artist/5d07bbfd403c640290b95e0d' }, { id: `mbid://${mbid}` }])).toBe(mbid)
  })

  it('takes an explicitly tagged artist GUID', () => {
    expect(extractArtistMbid([{ id: `mbid://artist/${mbid}` }])).toBe(mbid)
  })

  it('ignores GUIDs explicitly tagged as a release or release-group', () => {
    expect(
      extractArtistMbid([{ id: `mbid://release/${mbid}` }, { id: `mbid://release-group/${mbid}` }])
    ).toBeNull()
    expect(extractArtistMbid([])).toBeNull()
  })
})
