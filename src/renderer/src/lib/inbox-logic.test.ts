import { describe, it, expect } from 'vitest'
import type {
  MbCanonicalRelease,
  PreviewResponse,
  ReconciledRow,
  RowDecision
} from '../../../shared/tagger'
import {
  defaultDecision,
  decisionForRow,
  trackForRow,
  countOverrides,
  isReadyToApply
} from './inbox-logic'

function row(opts: {
  path: string
  default_choice: 'matcher' | 'acoustid' | 'manual'
  matcherIndex?: number
  acoustidIndex?: number
}): ReconciledRow {
  return {
    path: opts.path,
    name: opts.path,
    duration_ms: null,
    matcher_pick:
      opts.matcherIndex !== undefined
        ? { track_index: opts.matcherIndex, title: `t${opts.matcherIndex}`, cost: 0.01, confident: true }
        : null,
    acoustid_pick:
      opts.acoustidIndex !== undefined
        ? { track_index: opts.acoustidIndex, title: `t${opts.acoustidIndex}`, recording_mbid: 'r', score: 0.9 }
        : null,
    agree: false,
    disagree: false,
    default_choice: opts.default_choice
  }
}

function preview(rows: ReconciledRow[]): PreviewResponse {
  return {
    ok: true,
    mode: 'preview',
    album: 'A',
    albumartist: 'AA',
    release_mbid: 'rel',
    total_tracks: rows.length,
    file_count: rows.length,
    rows,
    clean: false,
    warnings: []
  }
}

function release(trackCount: number): MbCanonicalRelease {
  return {
    album: 'A',
    albumartist: 'AA',
    albumartist_ids: [],
    release_mbid: 'rel',
    releasegroup_mbid: 'rg',
    date: '1977',
    country: 'US',
    status: 'Official',
    total_discs: 1,
    tracks: Array.from({ length: trackCount }, (_, i) => ({
      disc: 1,
      track: i + 1,
      title: `Track ${i + 1}`,
      artist: 'AA',
      recording_mbid: `rec${i + 1}`,
      track_mbid: `tr${i + 1}`,
      length_ms: null
    }))
  }
}

describe('defaultDecision / decisionForRow', () => {
  it('falls back to the matcher/acoustid default pick', () => {
    expect(decisionForRow(row({ path: 'a', default_choice: 'matcher', matcherIndex: 3 }), {})).toBe(3)
    expect(decisionForRow(row({ path: 'b', default_choice: 'acoustid', acoustidIndex: 2 }), {})).toBe(2)
  })

  it('manual rows have no default', () => {
    expect(defaultDecision(row({ path: 'a', default_choice: 'manual' }))).toBeNull()
  })

  it('a default_choice pointing at a missing pick yields null', () => {
    expect(defaultDecision(row({ path: 'a', default_choice: 'matcher' }))).toBeNull()
  })

  it('an explicit decision wins over the default, including "skip"', () => {
    const r = row({ path: 'a', default_choice: 'matcher', matcherIndex: 3 })
    expect(decisionForRow(r, { a: 5 })).toBe(5)
    expect(decisionForRow(r, { a: 'skip' })).toBe('skip')
  })
})

describe('trackForRow', () => {
  const rel = release(3)

  it('maps the 1-based decision to the release track', () => {
    const r = row({ path: 'a', default_choice: 'matcher', matcherIndex: 2 })
    expect(trackForRow(r, {}, rel)?.title).toBe('Track 2')
  })

  it('returns null for skip, unresolved, missing release, and out-of-range', () => {
    const r = row({ path: 'a', default_choice: 'matcher', matcherIndex: 2 })
    expect(trackForRow(r, { a: 'skip' }, rel)).toBeNull()
    expect(trackForRow(row({ path: 'b', default_choice: 'manual' }), {}, rel)).toBeNull()
    expect(trackForRow(r, {}, null)).toBeNull()
    expect(trackForRow(r, { a: 99 }, rel)).toBeNull()
  })
})

describe('countOverrides', () => {
  it('counts only explicit decisions that differ from the default', () => {
    const p = preview([
      row({ path: 'a', default_choice: 'matcher', matcherIndex: 1 }),
      row({ path: 'b', default_choice: 'matcher', matcherIndex: 2 }),
      row({ path: 'c', default_choice: 'manual' })
    ])
    const decisions: Record<string, RowDecision> = {
      a: 1, // explicit but same as default — not an override
      b: 'skip', // differs — override
      c: 3 // manual default is null — override
    }
    expect(countOverrides(p, decisions)).toBe(2)
  })

  it('is 0 with no preview or no explicit decisions', () => {
    expect(countOverrides(null, { a: 1 })).toBe(0)
    expect(countOverrides(preview([row({ path: 'a', default_choice: 'matcher', matcherIndex: 1 })]), {})).toBe(0)
  })
})

describe('isReadyToApply — gates the destructive file move', () => {
  it('false with no preview at all', () => {
    expect(isReadyToApply(null, {})).toBe(false)
    expect(isReadyToApply(null, { a: 1 })).toBe(false)
  })

  it('true when every row has a default pick', () => {
    const p = preview([
      row({ path: 'a', default_choice: 'matcher', matcherIndex: 1 }),
      row({ path: 'b', default_choice: 'acoustid', acoustidIndex: 2 })
    ])
    expect(isReadyToApply(p, {})).toBe(true)
  })

  it('false while any manual row is unresolved', () => {
    const p = preview([
      row({ path: 'a', default_choice: 'matcher', matcherIndex: 1 }),
      row({ path: 'b', default_choice: 'manual' })
    ])
    expect(isReadyToApply(p, {})).toBe(false)
    expect(isReadyToApply(p, { b: 2 })).toBe(true)
  })

  it('a "skip" decision counts as resolved', () => {
    const p = preview([row({ path: 'a', default_choice: 'manual' })])
    expect(isReadyToApply(p, { a: 'skip' })).toBe(true)
  })

  it('an explicit null-equivalent (no entry) on a defaultless row blocks apply', () => {
    // default_choice says matcher but the pick is missing — row has no usable
    // default, so without an explicit decision apply must stay blocked.
    const p = preview([row({ path: 'a', default_choice: 'matcher' })])
    expect(isReadyToApply(p, {})).toBe(false)
  })

  it('vacuously true for a preview with zero rows', () => {
    expect(isReadyToApply(preview([]), {})).toBe(true)
  })
})
