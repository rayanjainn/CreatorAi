import { describe, expect, it } from 'vitest'
import { audioAt, buildSegments, captionsAt, clock, cropPositionX, gainToVolume, isContinuous, karaokeIndex, locate, overlaysAt, packLanes, parseTime, snapPoints, snapTo, stepFrames, timecode, toFrame } from './index'
import { baseTimeline } from './testing'

describe('timeline time -> video item and source time', () => {
  const t = baseTimeline()
  const segs = buildSegments(t)
  it('locates items on their boundaries', () => {
    expect(locate(segs, 0)!.segment.item.id).toBe('v_base0')
    expect(locate(segs, 0)!.srcTime).toBe(5)
    expect(locate(segs, 9.999)!.segment.item.id).toBe('v_base0')
    expect(locate(segs, 10)!.segment.item.id).toBe('v_base1')
    expect(locate(segs, 10)!.srcTime).toBe(20)
    expect(locate(segs, 17.5)!.segment.item.id).toBe('v_base2')
    expect(locate(segs, 17.5)!.srcTime).toBeCloseTo(3.5)
  })
  it('holds the last frame at and after the end', () => {
    const l = locate(segs, 999)!
    expect(l.segment.item.id).toBe('v_base2')
    expect(l.srcTime).toBeLessThan(10)
    expect(l.srcTime).toBeGreaterThan(9.9)
  })
  it('skips rejected items (they take no time)', () => {
    const r = baseTimeline()
    r.tracks.video[1].status = 'rejected'
    r.tracks.video[1].tl_start = 10
    r.tracks.video[2].tl_start = 10
    r.duration = 18
    const s = buildSegments(r)
    expect(s).toHaveLength(2)
    expect(locate(s, 10)!.segment.item.id).toBe('v_base2')
    expect(locate(s, 10)!.srcTime).toBe(2)
  })
  it('detects continuous items (a split) so one <video> can play across the cut', () => {
    const a = { ...t.tracks.video[0] }
    const b = { ...t.tracks.video[0], id: 'v_x', src_in: a.src_out }
    expect(isContinuous(a, b)).toBe(true)
    expect(isContinuous(a, t.tracks.video[1])).toBe(false)
    expect(isContinuous(a, t.tracks.video[2])).toBe(false)
  })
  it('empty timelines locate nothing', () => {
    expect(locate([], 3)).toBeNull()
  })
})

describe('layers at a time', () => {
  const t = baseTimeline()
  it('captions, overlays and audio that are live', () => {
    expect(captionsAt(t, 2).map((c) => c.id)).toEqual(['c_base0'])
    expect(captionsAt(t, 3).map((c) => c.id)).toEqual([])
    expect(overlaysAt(t, 2).map((o) => o.id)).toEqual(['o_base0'])
    expect(overlaysAt(t, 12).map((o) => o.id)).toEqual(['o_base1'])
    expect(audioAt(t, 9.5).map((a) => a.item.id).sort()).toEqual(['a_base0', 'a_base1'])
    expect(audioAt(t, 11.5).find((a) => a.item.id === 'a_base1')).toBeUndefined()
    expect(audioAt(t, 10).find((a) => a.item.id === 'a_base0')!.srcTime).toBe(10)
  })
  it('rejected layers are not rendered', () => {
    const r = baseTimeline()
    r.tracks.captions[0].status = 'rejected'
    r.tracks.audio[0].status = 'rejected'
    expect(captionsAt(r, 2)).toEqual([])
    expect(audioAt(r, 2)).toEqual([])
  })
  it('karaoke highlight index', () => {
    const c = { ...t.tracks.captions[0], words: [{ w: 'a', t0: 1, t1: 1.3 }, { w: 'b', t0: 1.4, t1: 1.8 }] }
    expect(karaokeIndex(c, 0.9)).toBe(-1)
    expect(karaokeIndex(c, 1.1)).toBe(0)
    expect(karaokeIndex(c, 1.5)).toBe(1)
  })
})

describe('maths', () => {
  it('gain to volume caps at 1', () => {
    expect(gainToVolume(0)).toBe(1)
    expect(gainToVolume(12)).toBe(1)
    expect(gainToVolume(-20)).toBeCloseTo(0.1)
  })
  it('crop_x -> object-position', () => {
    expect(cropPositionX(0.5, 1920, 1080, '9:16')).toBeCloseTo(50)
    expect(cropPositionX(0, 1920, 1080, '9:16')).toBe(0)
    expect(cropPositionX(1, 1920, 1080, '9:16')).toBe(100)
    expect(cropPositionX(0.3, 640, 360, '9:16')).toBeCloseTo(((0.3 * 640 - 101.25) / (640 - 202.5)) * 100)
    expect(cropPositionX(0.2, 1920, 1080, '16:9')).toBe(50)
    expect(cropPositionX(0.2, 600, 1080, '9:16')).toBe(50)
    expect(cropPositionX(0.2, null, null, '9:16')).toBe(50)
  })
  it('frame stepping and timecodes', () => {
    const t = baseTimeline()
    expect(stepFrames(t, 1, 1)).toBeCloseTo(1 + 1 / 30)
    expect(stepFrames(t, 0, -1)).toBe(0)
    expect(stepFrames(t, t.duration, 1)).toBe(t.duration)
    expect(toFrame(1.02)).toBeCloseTo(1.0333, 3)
    expect(timecode(0)).toBe('00:00:00:00')
    expect(timecode(65.5)).toBe('00:01:05:15')
    expect(timecode(3600)).toBe('01:00:00:00')
    expect(clock(75.256)).toBe('1:15.26')
  })
  it('parses times', () => {
    expect(parseTime('12.5')).toBe(12.5)
    expect(parseTime('1:02.5')).toBe(62.5)
    expect(parseTime('0:01:02')).toBe(62)
    expect(parseTime('00:00:01:15')).toBeCloseTo(1.5)
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
  it('snapping', () => {
    const pts = snapPoints(baseTimeline(), { playhead: 7.3 })
    expect(pts).toContain(10)
    expect(pts).toContain(7.3)
    expect(snapTo(10.1, pts, 0.2)).toBe(10)
    expect(snapTo(10.5, pts, 0.2)).toBeNull()
  })
  it('lane packing puts overlapping items on different lanes', () => {
    const { lanes, count } = packLanes([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 3, end: 6 }, { id: 'c', start: 5, end: 8 }])
    expect(count).toBe(2)
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(1)
    expect(lanes.get('c')).toBe(0)
  })
})
