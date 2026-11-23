import { describe, expect, it, vi } from 'vitest'

vi.mock('./store.js', () => ({ getTautulliUrl: () => '', getTautulliApiKey: () => '' }))

import { ESTIMATED_PLAY_SECONDS, MAX_PLAY_SECONDS, playSeconds } from './tautulli.js'

describe('playSeconds', () => {
  it('counts real play time', () => {
    expect(playSeconds({ duration: 124 })).toBe(124)
  })
  it('caps a stuck session at 90 minutes', () => {
    expect(playSeconds({ duration: 15_500_000 })).toBe(MAX_PLAY_SECONDS)
  })
  it('estimates rows with no play time', () => {
    expect(playSeconds({ duration: null })).toBe(ESTIMATED_PLAY_SECONDS)
  })
})
