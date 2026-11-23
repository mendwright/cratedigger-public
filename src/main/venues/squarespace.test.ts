import { describe, expect, it } from 'vitest'
import { cleanFourStarTitle } from './squarespace'
import { splitArtists } from './types'

describe('cleanFourStarTitle', () => {
  it('keeps LIVE MUSIC rows and strips presenter + time tail', () => {
    expect(
      cleanFourStarTitle(
        "LIVE MUSIC: @ (Presented by THROWIN' BO'S) ~ Doors at 7:00 PM & Music at 8:00 PM"
      )
    ).toBe('@')
  })

  it('strips inline parentheticals and keeps the comma bill', () => {
    const t = cleanFourStarTitle(
      'LIVE MUSIC: Stephen Steinbrink (Record Release), April Magazine, ersa ~ Doors at 7:00 PM & Music at 8:00 PM'
    )
    expect(t).toBe('Stephen Steinbrink, April Magazine, ersa')
    expect(splitArtists(t!)).toEqual({
      headliner: 'Stephen Steinbrink',
      supports: ['April Magazine', 'ersa']
    })
  })

  it('drops films and other non-music rows', () => {
    expect(cleanFourStarTitle('Fantastic Mr. Fox ~ 10:00 AM (Popcorn Palace - FREE!)')).toBeNull()
    expect(
      cleanFourStarTitle('NEIL YOUNG CELEBRATION: Live Music Tribute & Screening of Rust Never Sleeps ~ 7:30 PM')
    ).toBeNull()
  })
})
