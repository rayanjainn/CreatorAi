import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpError, addAudio, addCaption, addOverlay, moveLayer, patchLayer, resizeLayer, setAspect, setSourceRange, setTransition, trimEdge, setIdGenerator, validate, validateSchema } from './index'
import { DURATIONS, baseTimeline, counterIds } from './testing'

beforeEach(() => counterIds(7000))
afterEach(() => setIdGenerator(null))
const ok = (t: ReturnType<typeof baseTimeline>) => {
  expect(validate(t, DURATIONS)).toEqual([])
  expect(validateSchema(t)).toEqual([])
}

describe('trimEdge / setSourceRange', () => {
  it('trimming the start edge ripples later items', () => {
    const t = trimEdge(baseTimeline(), 'v_base0', 'start', 2, DURATIONS)
    expect(t.tracks.video[0].src_in).toBe(7)
    expect(t.tracks.video[1].tl_start).toBeCloseTo(8)
    expect(t.duration).toBeCloseTo(22)
    ok(t)
  })
  it('extends the end edge but never past the asset, and never below 0.1 s', () => {
    expect(trimEdge(baseTimeline(), 'v_base2', 'end', 99, DURATIONS).tracks.video[2].src_out).toBe(30)
    const short = trimEdge(baseTimeline(), 'v_base1', 'end', -99, DURATIONS)
    expect(short.tracks.video[1].src_out - short.tracks.video[1].src_in).toBeCloseTo(0.1)
    ok(short)
  })
  it('the start edge cannot go before the start of the source', () => {
    expect(trimEdge(baseTimeline(), 'v_base2', 'start', -99, DURATIONS).tracks.video[2].src_in).toBe(0)
  })
  it('captions follow the footage when an earlier item is trimmed', () => {
    const base = baseTimeline()
    const t = trimEdge(base, 'v_base0', 'end', -4, DURATIONS) // item 0 now 5..11
    const c = t.tracks.captions.find((x) => x.id === 'c_base2')!
    const was = base.tracks.captions.find((x) => x.id === 'c_base2')!
    expect(c.tl_start).toBeCloseTo(was.tl_start - 4)
  })
  it('setSourceRange sets both edges', () => {
    const t = setSourceRange(baseTimeline(), 'v_base0', 6, 12, DURATIONS)
    expect([t.tracks.video[0].src_in, t.tracks.video[0].src_out]).toEqual([6, 12])
    ok(t)
    expect(() => setSourceRange(baseTimeline(), 'v_base0', 6, 6.05, DURATIONS)).toThrow(OpError)
  })
  it('refuses non-video items', () => {
    expect(() => trimEdge(baseTimeline(), 'c_base0', 'start', 1)).toThrow(OpError)
  })
})

describe('layers', () => {
  it('moves a caption keeping its length and shifting its words', () => {
    let t = baseTimeline()
    t.tracks.captions[0].words = [{ w: 'a', t0: 1, t1: 1.5 }, { w: 'b', t0: 1.6, t1: 2 }]
    t = moveLayer(t, 'c_base0', 3)
    const c = t.tracks.captions.find((x) => x.id === 'c_base0')!
    expect([c.tl_start, c.tl_end]).toEqual([3, 5])
    expect(c.words![0].t0).toBeCloseTo(3)
    ok(t)
  })
  it('clamps moves to [0, duration]', () => {
    let t = moveLayer(baseTimeline(), 'c_base1', 999)
    const c = t.tracks.captions.find((x) => x.id === 'c_base1')!
    expect(c.tl_end).toBeCloseTo(t.duration)
    t = moveLayer(t, 'c_base1', -50)
    expect(t.tracks.captions.find((x) => x.id === 'c_base1')!.tl_start).toBe(0)
    ok(t)
  })
  it('resizes with a minimum length and the timeline end', () => {
    let t = resizeLayer(baseTimeline(), 'o_base0', 'end', 999)
    expect(t.tracks.overlays[0].tl_end).toBeCloseTo(t.duration)
    t = resizeLayer(t, 'o_base0', 'end', 2.01)
    expect(t.tracks.overlays[0].tl_end - t.tracks.overlays[0].tl_start).toBeCloseTo(0.2)
    ok(t)
  })
  it('audio: left edge moves the source in-point, right edge the out-point (capped by the asset)', () => {
    let t = resizeLayer(baseTimeline(), 'a_base1', 'start', 10, DURATIONS)
    const a = t.tracks.audio.find((x) => x.id === 'a_base1')!
    expect([a.tl_start, a.src_in]).toEqual([10, 1])
    t = resizeLayer(t, 'a_base1', 'end', 9999, DURATIONS)
    expect(t.tracks.audio.find((x) => x.id === 'a_base1')!.src_out).toBe(120)
    ok(t)
  })
  it('adds overlays inside the duration, as the user, accepted', () => {
    const { timeline, id } = addOverlay(baseTimeline(), 'lower_third', 23, 'Hi', 3)
    const o = timeline.tracks.overlays.find((x) => x.id === id)!
    expect(o.source).toBe('user')
    expect(o.status).toBe('accepted')
    expect(o.tl_end).toBeCloseTo(timeline.duration)
    expect(o.id.startsWith('o_')).toBe(true)
    ok(timeline)
    expect(() => addOverlay({ ...baseTimeline(), duration: 0, tracks: { ...baseTimeline().tracks, video: [] } }, 'text', 0, 'x')).toThrow(OpError)
  })
  it('adds captions with estimated words and keeps the track sorted', () => {
    const { timeline, id } = addCaption(baseTimeline(), 0.2, 'three small words')
    expect(timeline.tracks.captions[0].id).toBe(id)
    expect(timeline.tracks.captions[0].words).toHaveLength(3)
    ok(timeline)
  })
  it('adds music cut to the timeline and sfx at full length', () => {
    const m = addAudio(baseTimeline(), { assetId: 'music-1', kind: 'music', at: 4, assetDuration: 120 })
    const item = m.timeline.tracks.audio.find((x) => x.id === m.id)!
    expect(item.src_out).toBeCloseTo(20)
    expect(item.gain_db).toBe(-18)
    const s = addAudio(baseTimeline(), { assetId: 'music-1', kind: 'sfx', at: 4, assetDuration: 2 })
    expect(s.timeline.tracks.audio.find((x) => x.id === s.id)!.src_out).toBe(2)
    ok(m.timeline)
    ok(s.timeline)
  })
  it('patchLayer edits caption text (words kept when the count matches), gain and overrides', () => {
    let t = baseTimeline()
    t.tracks.captions[0].words = [{ w: 'hello', t0: 1, t1: 1.4 }, { w: 'there', t0: 1.5, t1: 2 }]
    t = patchLayer(t, 'c_base0', { text: 'good  bye' })
    expect(t.tracks.captions[0].text).toBe('good bye')
    expect(t.tracks.captions[0].words!.map((w) => w.w)).toEqual(['good', 'bye'])
    expect(t.tracks.captions[0].words![1].t1).toBe(2)
    t = patchLayer(t, 'c_base0', { text: 'one two three' })
    expect(t.tracks.captions[0].words).toHaveLength(3)
    expect(() => patchLayer(t, 'c_base0', { text: '   ' })).toThrow(OpError)
    t = patchLayer(t, 'c_base0', { style_override: 'karaoke' })
    expect(t.tracks.captions[0].style_override).toBe('karaoke')
    t = patchLayer(t, 'a_base0', { gain_db: -200 })
    expect(t.tracks.audio[0].gain_db).toBe(-60)
    ok(t)
  })
  it('setAspect keeps width/height consistent; setTransition enforces 0.1-0.5', () => {
    const w = setAspect(baseTimeline(), '16:9')
    expect([w.width, w.height]).toEqual([1920, 1080])
    ok(w)
    const t = setTransition(baseTimeline(), 'v_base1', { type: 'fade', dur: 9 })
    expect(t.tracks.video[1].transition_in).toEqual({ type: 'fade', dur: 0.5 })
    expect(setTransition(t, 'v_base1', null).tracks.video[1].transition_in).toBeNull()
    ok(t)
  })
})

describe('linkSponsorFootage', () => {
  it('turns a placeholder into the recorded footage, ripples, re-covers the lower third and drops script captions', async () => {
    const { linkSponsorFootage, rippleInsert, recomputeDuration } = await import('./index')
    const { vid, ovl, cap } = await import('./testing')
    const base = baseTimeline()
    const sponsor = vid('v_sp', 0, 12, null, { kind: 'sponsor', placeholder: true, text: 'This video is brought to you by Acme.' })
    let t = rippleInsert(base, 4, sponsor)
    const at = t.tracks.video.find((v) => v.id === 'v_sp')!.tl_start
    t.tracks.overlays.push(ovl('o_lt', at, at + 12, { kind: 'lower_third', text: 'Sponsored · Acme' }))
    t.tracks.captions.push({ ...cap('c_sp', at, at + 2, 'This video is'), reason: 'sponsor script' })
    t = recomputeDuration(t)
    const durations = { ...DURATIONS, rec: 20 }
    const out = linkSponsorFootage(t, 'v_sp', 'rec', 20)
    const item = out.tracks.video.find((v) => v.id === 'v_sp')!
    expect(item.asset_id).toBe('rec')
    expect(item.placeholder).toBe(false)
    expect(item.src_out).toBe(20)
    expect(out.duration).toBeCloseTo(t.duration + 8)
    const lt = out.tracks.overlays.find((o) => o.id === 'o_lt')!
    expect([lt.tl_start, lt.tl_end]).toEqual([item.tl_start, item.tl_start + 20])
    expect(out.tracks.captions.some((c) => c.id === 'c_sp')).toBe(false)
    expect(validate(out, durations)).toEqual([])
    expect(() => linkSponsorFootage(out, 'v_sp', 'rec', 20)).toThrow(OpError) // no longer a placeholder
  })
})
