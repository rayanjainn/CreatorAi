import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpError, addVideoMedia, setIdGenerator, validate, validateSchema, DEFAULT_IMAGE_SEC } from './index'
import { DURATIONS, baseTimeline, counterIds } from './testing'

beforeEach(() => counterIds(9000))
afterEach(() => setIdGenerator(null))

const valid = (t: ReturnType<typeof baseTimeline>) => {
  expect(validateSchema(t)).toEqual([])
  expect(validate(t, DURATIONS)).toEqual([])
}

describe('addVideoMedia', () => {
  it('appends a whole library video at the end and keeps the track gapless', () => {
    const base = baseTimeline()
    const t = addVideoMedia(base, { assetId: 'asset-b', kind: 'video', at: base.duration, duration: 12 }).timeline
    const last = t.tracks.video[t.tracks.video.length - 1]
    expect(last.kind).toBe('clip')
    expect([last.src_in, last.src_out]).toEqual([0, 12])
    expect(last.tl_start).toBeCloseTo(base.duration)
    expect(t.duration).toBeCloseTo(base.duration + 12)
  })

  it('splits the clip under the drop point and pushes the rest later', () => {
    const base = baseTimeline()
    const before = base.tracks.video.length
    const r = addVideoMedia(base, { assetId: 'asset-b', kind: 'video', at: 4, duration: 5 })
    expect(r.timeline.tracks.video.length).toBe(before + 2) // one split + the new item
    expect(r.timeline.duration).toBeCloseTo(base.duration + 5)
    expect(r.timeline.tracks.video.some((v) => v.id === r.id)).toBe(true)
    valid(r.timeline)
  })

  it('an image is shown for a few seconds and has no source duration to exceed', () => {
    const base = baseTimeline()
    const t = addVideoMedia(base, { assetId: 'a-still', kind: 'image', at: 0 }).timeline
    const first = t.tracks.video[0]
    expect(first.kind).toBe('image')
    expect(first.src_out - first.src_in).toBeCloseTo(DEFAULT_IMAGE_SEC)
    // the still's asset has no duration: validation must not call it unknown or too short
    expect(validate(t, DURATIONS)).toEqual([])
    expect(t.duration).toBeCloseTo(base.duration + DEFAULT_IMAGE_SEC)
  })

  it('refuses a video whose length is not known yet', () => {
    expect(() => addVideoMedia(baseTimeline(), { assetId: 'asset-b', kind: 'video', at: 0, duration: null })).toThrow(OpError)
  })

  it('does not mutate the timeline it was given', () => {
    const base = baseTimeline()
    const snapshot = structuredClone(base)
    addVideoMedia(base, { assetId: 'a-still', kind: 'image', at: 2 })
    expect(base).toEqual(snapshot)
  })
})
