import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { estimateWords, groupLines, normWords, rebuildCaptions, redistributeWords, setIdGenerator, validate } from './index'
import { DURATIONS, baseTimeline, counterIds } from './testing'

beforeEach(() => counterIds(100))
afterEach(() => setIdGenerator(null))

const W = (spec: [string, number, number][]) => spec.map(([word, start, end]) => ({ word, start, end }))
const SPEECH = W([['one', 5.0, 5.3], ['two', 5.4, 5.7], ['three', 5.8, 6.1], ['four.', 6.2, 6.5], ['five', 9.0, 9.3], ['six', 9.4, 9.7], ['outside', 40, 40.4]])

describe('caption building (Plan 8.9)', () => {
  it('groups three words per line for bold_center and karaoke, seven for minimal_bottom', () => {
    const words = normWords(W(Array.from({ length: 10 }, (_, i) => [`w${i}`, i * 0.3, i * 0.3 + 0.2] as [string, number, number])))
    expect(groupLines(words, 'bold_center').map((l) => l.length)).toEqual([3, 3, 3, 1])
    expect(groupLines(words, 'karaoke').map((l) => l.length)).toEqual([3, 3, 3, 1])
    expect(groupLines(words, 'minimal_bottom').map((l) => l.length)).toEqual([7, 3])
    expect(groupLines(words, 'bold_center', 5).map((l) => l.length)).toEqual([5, 5])
  })
  it('splits a line that would run longer than 2 s', () => {
    const words = normWords(W([['a', 0, 0.3], ['b', 0.4, 0.7], ['c', 2.6, 2.9]]))
    expect(groupLines(words, 'bold_center').map((l) => l.length)).toEqual([2, 1])
  })
  it('maps source words to timeline time, extends line ends and clamps to the item', () => {
    const t = rebuildCaptions(baseTimeline(), (id) => (id === 'asset-a' ? SPEECH : []))
    const caps = t.tracks.captions
    expect(caps.map((c) => c.text)).toEqual(['one two three', 'four.', 'five six'])
    // item 0 is src 5..15 at tl 0: word "one" (5.0) is at 0
    expect(caps[0].tl_start).toBe(0)
    expect(caps[0].tl_end).toBeCloseTo(1.18) // the next line starts at 1.2 s, minus the 0.02 s gap
    expect(caps.every((c) => c.source === 'ai' && c.status === 'suggested')).toBe(true)
    expect(caps[0].reason).toBe('from transcript')
    expect(validate(t, DURATIONS)).toEqual([])
    for (const c of caps) for (const w of c.words ?? []) expect(w.t0).toBeGreaterThanOrEqual(c.tl_start - 1e-6)
  })
  it('skips rejected items and ignores words outside the source range', () => {
    const base = baseTimeline()
    base.tracks.video[0].status = 'rejected'
    base.tracks.video[1].tl_start = 0
    base.tracks.video[2].tl_start = 6
    base.duration = 14
    const t = rebuildCaptions(base, (id) => (id === 'asset-a' ? SPEECH : []))
    expect(t.tracks.captions).toHaveLength(0)
  })
  it('estimates sponsor-placeholder lines at 2.5 words per second', () => {
    expect(estimateWords('a b c d e', 1.2)).toEqual([['a', 0, 0.4], ['b', 0.4, 0.8], ['c', 0.8, 1.2]])
    expect(redistributeWords('x y', 0, 1)).toEqual([{ w: 'x', t0: 0, t1: 0.5 }, { w: 'y', t0: 0.5, t1: 1 }])
    expect(redistributeWords('   ', 0, 1)).toBeNull()
  })
})
