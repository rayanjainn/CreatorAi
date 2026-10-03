import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffTimelines, patchLayer, rebase, setCaptionStyle, setStatus, setIdGenerator, splitItem, validate, addOverlay, moveLayer, deleteItem, setCropX, deepEqual } from './index'
import { DURATIONS, baseTimeline, counterIds } from './testing'

beforeEach(() => counterIds(9000))
afterEach(() => setIdGenerator(null))

describe('rebase after REVISION_CONFLICT', () => {
  const base = baseTimeline()
  it('takes theirs when I changed nothing, mine when they changed nothing', () => {
    const theirs = setCaptionStyle(base, 'karaoke')
    const a = rebase(base, base, theirs)
    expect(a.ok && a.timeline.caption_style).toBe('karaoke')
    const mine = setCaptionStyle(base, 'minimal_bottom')
    const b = rebase(base, mine, base)
    expect(b.ok && b.timeline.caption_style).toBe('minimal_bottom')
  })
  it('combines edits to different layers', () => {
    const mine = patchLayer(base, 'c_base0', { text: 'mine' })
    const theirs = patchLayer(base, 'c_base1', { text: 'theirs' })
    const r = rebase(base, mine, theirs, DURATIONS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.timeline.tracks.captions.find((c) => c.id === 'c_base0')!.text).toBe('mine')
      expect(r.timeline.tracks.captions.find((c) => c.id === 'c_base1')!.text).toBe('theirs')
      expect(validate(r.timeline, DURATIONS)).toEqual([])
    }
  })
  it('combines an added layer with a status change and a global change', () => {
    const mine = addOverlay(setCaptionStyle(base, 'karaoke'), 'text', 3, 'new').timeline
    const theirs = setStatus(base, 'a_base0', 'rejected')
    const r = rebase(base, mine, theirs, DURATIONS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.timeline.caption_style).toBe('karaoke')
      expect(r.timeline.tracks.overlays).toHaveLength(3)
      expect(r.timeline.tracks.audio[0].status).toBe('rejected')
    }
  })
  it('applies my deletions to their timeline', () => {
    const r = rebase(base, deleteItem(base, 'c_base2'), setCropX(base, 'v_base0', 0.1), DURATIONS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.timeline.tracks.captions.map((c) => c.id)).toEqual(['c_base0', 'c_base1'])
      expect(r.timeline.tracks.video[0].crop_x).toBe(0.1)
    }
  })
  it('refuses when both sides touched the same layer', () => {
    const r = rebase(base, patchLayer(base, 'c_base0', { text: 'a' }), patchLayer(base, 'c_base0', { text: 'b' }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('same layer')
  })
  it('refuses when both sides changed the same global field differently', () => {
    const r = rebase(base, setCaptionStyle(base, 'karaoke'), setCaptionStyle(base, 'minimal_bottom'))
    expect(r.ok).toBe(false)
  })
  it('refuses when one side re-cut the video and the other changed anything', () => {
    const cut = splitItem(base, 4)
    expect(rebase(base, cut, patchLayer(base, 'c_base1', { text: 'x' })).ok).toBe(false)
    expect(rebase(base, moveLayer(base, 'c_base1', 5), cut).ok).toBe(false)
    expect(rebase(base, base, cut).ok).toBe(true) // nothing local: just theirs
  })
  it('diff reports added/removed/changed and structural changes', () => {
    const d = diffTimelines(base, splitItem(base, 4))
    expect(d.structural).toBe(true)
    expect(d.items.get('v_base0')).toBe('changed')
    expect([...d.items.values()]).toContain('added')
    expect(diffTimelines(base, base).empty).toBe(true)
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
  })
})
