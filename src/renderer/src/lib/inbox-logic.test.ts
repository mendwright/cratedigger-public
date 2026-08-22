import { describe, it, expect } from 'vitest'
import type {
  InboxFile,
  InboxFolder,
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
  duplicateTrackNumbers,
  isReadyToApply,
  lowerQualityCopies,
  missingTrackNumbers,
  performanceConflict
} from './inbox-logic'

function audio(name: string, tracknumber: string | null = null): InboxFile {
  return {
    path: `/inbox/${name}`,
    name,
    ext: name.slice(name.lastIndexOf('.')).toLowerCase(),
    size: 1,
    read_error: null,
    duration_ms: null,
    tags: {
      title: null,
      artist: null,
      albumartist: null,
      composer: null,
      album: null,
      tracknumber,
      discnumber: null,
      date: null,
      musicbrainz_albumid: null,
      musicbrainz_trackid: null
    }
  }
}

describe('inbox file preparation', () => {
  it('marks Opus twins for deletion when matching FLAC files exist', () => {
    const files = [
      audio('01 - Mars [The Planets].flac', '1'),
      audio('01 - Mars [The Planets].opus', null),
      audio('02 - Venus [The Planets].flac', '2'),
      audio('02 - Venus [The Planets].opus', null)
    ]
    expect(lowerQualityCopies(files).map((f) => f.name)).toEqual([
      '01 - Mars [The Planets].opus',
      '02 - Venus [The Planets].opus'
    ])
  })

  it('does not delete a lower-quality file without a same-track twin', () => {
    expect(lowerQualityCopies([audio('01 - Mars.flac'), audio('02 - Venus.opus')])).toEqual([])
  })

  it('reports gaps in tagged track numbers', () => {
    const files = [
      audio('one.flac', '1/7'),
      audio('two.flac', '2/7'),
      audio('three.flac', '3/7'),
      audio('five.flac', '5/7'),
      audio('six.flac', '6/7')
    ]
    expect(missingTrackNumbers(files)).toEqual([4, 7])
  })
})

describe('performanceConflict — blocks wrong classical performances', () => {
  function classicalFolder(conductor: string, orchestra: string): InboxFolder {
    const file = audio('01.flac', '1')
    file.raw_tags = {
      conductor: [conductor],
      orchestra: [orchestra]
    }
    return {
      folder: 'Mahler 3',
      path: '/inbox/Mahler 3',
      file_count: 1,
      files: [file]
    }
  }

  it('accepts a release credit containing the tagged conductor and orchestra', () => {
    const rel = release(1)
    rel.albumartist =
      'Mahler; San Francisco Symphony, Michael Tilson Thomas, Michelle DeYoung'
    expect(
      performanceConflict(
        classicalFolder('Michael Tilson Thomas', 'San Francisco Symphony'),
        rel
      )
    ).toBeNull()
  })

  it('accepts the same pipe-separated classical credits in a different order', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist =
      'Schoenberg | Sibelius | Hilary Hahn | Swedish Radio Symphony Orchestra | Esa-Pekka Salonen'
    const folder: InboxFolder = {
      folder: 'Violin Concertos',
      path: '/inbox/Violin Concertos',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist =
      'Schoenberg, Sibelius; Hilary Hahn, Esa-Pekka Salonen, Swedish Radio Symphony Orchestra'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('treats an ampersand and MusicBrainz credit punctuation as the same performers', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Tenebrae & Nigel Short'
    const folder: InboxFolder = {
      folder: 'Miserere',
      path: '/inbox/Miserere',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Allegri; Tenebrae, Nigel Short'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('accepts comma-separated performers when MusicBrainz reverses their order', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'John Butt, Dunedin Consort'
    const folder: InboxFolder = {
      folder: 'Messiah',
      path: '/inbox/Messiah',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Handel; Dunedin Consort, John Butt'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('accepts a release that omits one weak fallback credit', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'The Tallis Scholars & Peter Phillips'
    const folder: InboxFolder = {
      folder: 'Spem in alium',
      path: '/inbox/Spem in alium',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'The Tallis Scholars'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('does not mistake a composer-only artist tag for performance evidence', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Johannes Brahms'
    const folder: InboxFolder = {
      folder: 'Symphony No. 4',
      path: '/inbox/Symphony No. 4',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Brahms; Wiener Philharmoniker, Carlos Kleiber'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('ignores a session conductor when the release is credited solely to the albumartist', () => {
    // King Gizzard's "Phantom Island" is a rock record made with a hired
    // orchestra; the rip tags the whole session, conductor included.
    const files = ['01.flac', '02.flac'].map((name, i) => {
      const file = audio(name, String(i + 1))
      file.tags.albumartist = 'King Gizzard & The Lizard Wizard'
      file.tags.artist = 'King Gizzard & The Lizard Wizard'
      file.raw_tags = {
        conductor: ['Brett Kelly'],
        violin: ['Ruby Paskas', 'Jos Jonker']
      }
      return file
    })
    const folder: InboxFolder = {
      folder: 'Phantom Island (2025)',
      path: '/inbox/Phantom Island (2025)',
      file_count: 2,
      files
    }
    const rel = release(2)
    rel.albumartist = 'King Gizzard & the Lizard Wizard'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('still blocks a different conductor when the release credit is a performance credit', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Ludwig van Beethoven'
    file.tags.artist = 'Ludwig van Beethoven'
    file.raw_tags = { conductor: ['Osmo Vänskä'] }
    const folder: InboxFolder = {
      folder: 'Symphony No. 5',
      path: '/inbox/Symphony No. 5',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Ludwig van Beethoven; Herbert von Karajan, Berliner Philharmoniker'

    expect(performanceConflict(folder, rel)).toContain('Performance mismatch')
  })

  it('ignores a scene-uploader stamp in the conductor tag', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Bill Callahan'
    file.tags.artist = 'Bill Callahan'
    file.raw_tags = { conductor: ['PMEDIA'] }
    const folder: InboxFolder = {
      folder: 'Blind Date Party',
      path: '/inbox/Blind Date Party',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Bill Callahan & Bonnie “Prince” Billy'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('ignores a scene-uploader albumartist stamp and trusts the artist tags', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'PMEDIA'
    file.tags.artist = 'Bill Callahan'
    const folder: InboxFolder = {
      folder: 'Blind Date Party',
      path: '/inbox/Blind Date Party',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Bill Callahan & Bonnie “Prince” Billy'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('still blocks when the artist tags behind an uploader stamp mismatch', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'PMEDIA'
    file.tags.artist = 'Smog'
    const folder: InboxFolder = {
      folder: 'Blind Date Party',
      path: '/inbox/Blind Date Party',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Bill Callahan & Bonnie “Prince” Billy'

    expect(performanceConflict(folder, rel)).toContain('Performance mismatch')
  })

  it('still blocks a wholly different unanimous fallback performance', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Royal Scottish Orchestra | Neeme Järvi'
    const folder: InboxFolder = {
      folder: 'Mahler 3',
      path: '/inbox/Mahler 3',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Mahler; San Francisco Symphony, Michael Tilson Thomas'

    expect(performanceConflict(folder, rel)).toContain('Performance mismatch')
  })

  it('accepts a sort-order albumartist tag for the same person', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Da Vila Martinho'
    const folder: InboxFolder = {
      folder: 'Maravilha De Cenario',
      path: '/inbox/Maravilha De Cenario',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Martinho da Vila'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('accepts a comma-inverted albumartist tag for the same person', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Vila, Martinho da'
    const folder: InboxFolder = {
      folder: 'Maravilha De Cenario',
      path: '/inbox/Maravilha De Cenario',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Martinho da Vila'

    expect(performanceConflict(folder, rel)).toBeNull()
  })

  it('still blocks a different artist that merely shares a surname', () => {
    const file = audio('01.flac', '1')
    file.tags.albumartist = 'Noel da Vila'
    const folder: InboxFolder = {
      folder: 'Maravilha De Cenario',
      path: '/inbox/Maravilha De Cenario',
      file_count: 1,
      files: [file]
    }
    const rel = release(1)
    rel.albumartist = 'Martinho da Vila'

    expect(performanceConflict(folder, rel)).toContain('Performance mismatch')
  })

  it('accepts the historical Minneapolis Symphony name for Minnesota Orchestra', () => {
    const rel = release(1)
    rel.albumartist =
      'Aaron Copland; London Symphony Orchestra, Minnesota Orchestra, Antal Doráti'
    expect(
      performanceConflict(
        classicalFolder('Antal Doráti', 'Minneapolis Symphony Orchestra'),
        rel
      )
    ).toBeNull()
  })

  it('accepts the common Vanksa misspelling for Osmo Vänskä', () => {
    const rel = release(1)
    rel.albumartist = 'Beethoven; Minnesota Orchestra; Osmo Vänskä'
    expect(
      performanceConflict(
        classicalFolder('Osmo Vanksa', 'Minnesota Orchestra'),
        rel
      )
    ).toBeNull()
  })

  it('accepts a surname-first conductor tag with an abbreviated given name', () => {
    const rel = release(1)
    rel.albumartist = 'Dvořák; Budapest Festival Orchestra, Iván Fischer'
    expect(
      performanceConflict(
        classicalFolder('Fischer I.', 'Budapest Festival Orchestra'),
        rel
      )
    ).toBeNull()
  })

  it('still blocks an abbreviated conductor with a different initial', () => {
    const rel = release(1)
    rel.albumartist = 'Dvořák; Budapest Festival Orchestra, Iván Fischer'
    expect(
      performanceConflict(
        classicalFolder('Fischer A.', 'Budapest Festival Orchestra'),
        rel
      )
    ).toContain('Performance mismatch')
  })

  it('blocks a same-work release by another conductor and orchestra', () => {
    const rel = release(1)
    rel.albumartist =
      'Gustav Mahler; Royal Scottish Orchestra, Neeme Järvi, Linda Finnie'
    expect(
      performanceConflict(
        classicalFolder('Michael Tilson Thomas', 'San Francisco Symphony'),
        rel
      )
    ).toContain('Performance mismatch')
  })

  it('does not invent a conflict when files carry no performer evidence', () => {
    expect(
      performanceConflict(
        {
          folder: 'Unknown',
          path: '/inbox/Unknown',
          file_count: 1,
          files: [audio('01.flac')]
        },
        release(1)
      )
    ).toBeNull()
  })
})

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

  it('false when the release has tracks missing from the folder', () => {
    const p = preview([
      row({ path: 'a', default_choice: 'matcher', matcherIndex: 1 }),
      row({ path: 'b', default_choice: 'matcher', matcherIndex: 2 })
    ])
    p.total_tracks = 3
    expect(isReadyToApply(p, {})).toBe(false)
  })

  it('a "skip" decision counts as resolved', () => {
    const p = preview([row({ path: 'a', default_choice: 'manual' })])
    expect(isReadyToApply(p, { a: 'skip' })).toBe(true)
  })

  it('false when two files are assigned to the same MusicBrainz track', () => {
    const p = preview([
      row({ path: 'a', default_choice: 'matcher', matcherIndex: 4 }),
      row({ path: 'b', default_choice: 'acoustid', acoustidIndex: 4 })
    ])
    expect(duplicateTrackNumbers(p, {})).toEqual([4])
    expect(isReadyToApply(p, {})).toBe(false)
    expect(duplicateTrackNumbers(p, { b: 5 })).toEqual([])
    expect(isReadyToApply(p, { b: 5 })).toBe(true)
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
