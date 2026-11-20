import { describe, expect, it } from 'vitest'
import { describeDuplicatePlan, planDuplicateDrops } from './inbox-dupes'

function f(path: string) {
  const name = path.split('/').at(-1)!
  const dot = name.lastIndexOf('.')
  return { path, name, ext: dot >= 0 ? name.slice(dot) : '' }
}

describe('planDuplicateDrops', () => {
  it('drops slskd-suffixed re-downloads when the plain twin exists', () => {
    const plan = planDuplicateDrops([
      f('/inbox/A/01 - Foo.flac'),
      f('/inbox/A/01 - Foo_639249152667847103.flac'),
      f('/inbox/A/02 - Bar.flac'),
      f('/inbox/A/02 - Bar_639249152686219898.flac'),
      f('/inbox/A/cover.jpg'),
      f('/inbox/A/cover_639249152686219898.jpg')
    ])
    expect(plan.drop.map((d) => d.path)).toEqual([
      '/inbox/A/01 - Foo_639249152667847103.flac',
      '/inbox/A/02 - Bar_639249152686219898.flac',
      '/inbox/A/cover_639249152686219898.jpg'
    ])
    expect(plan.drop.every((d) => d.reason === 'slskd-suffix')).toBe(true)
    expect(plan.drop[0].keeps).toBe('/inbox/A/01 - Foo.flac')
    expect(plan.keep).toEqual(['/inbox/A/01 - Foo.flac', '/inbox/A/02 - Bar.flac', '/inbox/A/cover.jpg'])
  })

  it('keeps a suffixed file that has no plain twin — it is the only copy', () => {
    const plan = planDuplicateDrops([
      f('/inbox/A/01 - Foo_639249152667847103.flac'),
      f('/inbox/A/02 - Bar.flac')
    ])
    expect(plan.drop).toEqual([])
  })

  it('does not treat a short trailing number as a collision suffix', () => {
    // "_2" or a catalogue number is not slskd's 18-digit tick suffix.
    const plan = planDuplicateDrops([f('/inbox/A/Track_2.flac'), f('/inbox/A/Track.flac')])
    expect(plan.drop).toEqual([])
  })

  it('keeps the best encoding when the same stem is shared in several formats', () => {
    const plan = planDuplicateDrops([
      f("/inbox/B/01 Drinkin' Thing.opus"),
      f("/inbox/B/01 Drinkin' Thing.flac"),
      f("/inbox/B/02 Honky Tonkin'.flac"),
      f("/inbox/B/02 Honky Tonkin'.mp3"),
      f("/inbox/B/02 Honky Tonkin'.opus")
    ])
    expect(plan.drop.map((d) => d.path).sort()).toEqual([
      "/inbox/B/01 Drinkin' Thing.opus",
      "/inbox/B/02 Honky Tonkin'.mp3",
      "/inbox/B/02 Honky Tonkin'.opus"
    ])
    expect(plan.drop.every((d) => d.reason === 'lesser-encoding')).toBe(true)
    expect(plan.drop.find((d) => d.path.endsWith('.mp3'))?.keeps).toBe("/inbox/B/02 Honky Tonkin'.flac")
  })

  it('only pairs files within the same directory', () => {
    const plan = planDuplicateDrops([
      f('/inbox/C/Disc 1/01 Intro.flac'),
      f('/inbox/C/Disc 2/01 Intro.flac'),
      f('/inbox/C/Disc 1/01 Intro.opus'),
      f('/inbox/C/Disc 2/01 Intro_639249152667847103.flac')
    ])
    expect(plan.drop.map((d) => d.path).sort()).toEqual([
      '/inbox/C/Disc 1/01 Intro.opus',
      '/inbox/C/Disc 2/01 Intro_639249152667847103.flac'
    ])
  })

  it('ignores non-audio files for the encoding rule', () => {
    const plan = planDuplicateDrops([f('/inbox/D/folder.jpg'), f('/inbox/D/folder.png')])
    expect(plan.drop).toEqual([])
  })

  it('leaves genuinely different files alone', () => {
    const plan = planDuplicateDrops([
      f('/inbox/E/01 One.flac'),
      f('/inbox/E/02 Two.flac'),
      f('/inbox/E/11 One (Demo).flac')
    ])
    expect(plan.drop).toEqual([])
    expect(plan.keep).toHaveLength(3)
  })
})

describe('describeDuplicatePlan', () => {
  it('summarises both kinds of drop', () => {
    const plan = planDuplicateDrops([
      f('/inbox/A/01 - Foo.flac'),
      f('/inbox/A/01 - Foo_639249152667847103.flac'),
      f('/inbox/A/02 - Bar.flac'),
      f('/inbox/A/02 - Bar.opus')
    ])
    expect(describeDuplicatePlan(plan)).toBe('1 slskd re-download copy, 1 lesser-encoding twin')
  })
})
