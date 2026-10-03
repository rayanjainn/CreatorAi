import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OpError,
  active,
  addAudio,
  addOverlay,
  applyOp,
  moveLayer,
  patchLayer,
  rebuildCaptions,
  resizeLayer,
  setAspect,
  setSourceRange,
  setTransition,
  trimEdge,
  validate,
  validateSchema,
  setIdGenerator,
  type Timeline,
} from './index'
import { DURATIONS, baseTimeline, counterIds, rng } from './testing'

const WORDS = Array.from({ length: 80 }, (_, i) => ({ word: `w${i}`, start: 0.3 + i * 0.45, end: 0.55 + i * 0.45 }))
const ctx = {
  assetDurations: DURATIONS,
  silences: { 'asset-a': [[8, 12], [22, 24], [4.5, 5.6]] as [number, number][], 'asset-b': [[3, 4.5]] as [number, number][] },
  wordsProvider: () => WORDS,
}

beforeEach(() => counterIds(5000))
afterEach(() => setIdGenerator(null))

function invariants(t: Timeline) {
  expect(validate(t, DURATIONS)).toEqual([])
  expect(validateSchema(t)).toEqual([])
  const total = active(t.tracks.video).reduce((s, v) => s + (v.src_out - v.src_in), 0)
  expect(t.duration).toBeCloseTo(total, 5)
  // layers stay inside [0, duration]
  for (const l of [...t.tracks.captions, ...t.tracks.overlays]) {
    expect(l.tl_start).toBeGreaterThanOrEqual(-1e-9)
    expect(l.tl_end).toBeLessThanOrEqual(t.duration + 1e-6)
  }
}

describe('every op preserves the timeline invariants (randomized, seeded)', () => {
  for (let seed = 0; seed < 150; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed)
      let t = rebuildCaptions(baseTimeline(), () => WORDS)
      invariants(t)
      for (let step = 0; step < 18; step++) {
        const before = JSON.stringify(t)
        const vids = t.tracks.video
        const pick = vids.length ? r.pick(vids).id : 'v_none'
        try {
          switch (r.int(0, 18)) {
            case 0:
              t = applyOp(t, 'tighten_pauses', { keep_sec: r.pick([0.05, 0.15, 0.4]) }, ctx)
              break
            case 1:
              t = applyOp(t, 'trim', { start_delta: r.range(-1, 2), end_delta: r.range(-2, 1), ...(r.next() < 0.5 ? { item_id: pick } : {}) }, ctx)
              break
            case 2:
              t = applyOp(t, 'split_item', { at_tl: r.range(0, Math.max(t.duration, 0.1)) }, ctx)
              break
            case 3:
              if (vids.length > 1) t = applyOp(t, 'delete_item', { item_id: pick }, ctx)
              break
            case 4:
              t = applyOp(t, 'reorder', { item_id: pick, to_index: r.int(0, 6) }, ctx)
              break
            case 5:
              if (active(vids).length > 1) t = applyOp(t, 'set_status', { item_id: pick, status: r.pick(['rejected', 'accepted', 'suggested']) }, ctx)
              break
            case 6:
              t = applyOp(t, 'set_caption_style', { style: r.pick(['karaoke', 'bold_center', 'minimal_bottom']) }, ctx)
              break
            case 7:
              t = applyOp(t, 'rebuild_captions', {}, ctx)
              break
            case 8:
              t = trimEdge(t, pick, r.pick(['start', 'end'] as const), r.range(-3, 3), DURATIONS)
              break
            case 9:
              if (t.tracks.captions.length) t = moveLayer(t, r.pick(t.tracks.captions).id, r.range(-2, t.duration + 2))
              break
            case 10:
              if (t.tracks.captions.length) t = resizeLayer(t, r.pick(t.tracks.captions).id, r.pick(['start', 'end'] as const), r.range(-1, t.duration + 1))
              break
            case 11:
              t = addOverlay(t, r.pick(['text', 'lower_third'] as const), r.range(0, t.duration), 'Hello').timeline
              break
            case 12:
              if (t.tracks.overlays.length) t = resizeLayer(t, r.pick(t.tracks.overlays).id, r.pick(['start', 'end'] as const), r.range(0, t.duration))
              break
            case 13:
              t = addAudio(t, { assetId: 'music-1', kind: r.pick(['music', 'sfx', 'voiceover'] as const), at: r.range(0, t.duration), assetDuration: 120 }).timeline
              break
            case 14:
              if (t.tracks.audio.length) t = resizeLayer(t, r.pick(t.tracks.audio).id, r.pick(['start', 'end'] as const), r.range(0, t.duration + 5), DURATIONS)
              break
            case 15:
              t = setSourceRange(t, pick, r.range(0, 10), r.range(10.5, 40), DURATIONS)
              break
            case 16:
              t = setTransition(t, pick, r.pick([null, { type: 'fade', dur: r.range(0.1, 0.5) }, { type: 'cut', dur: 0 }] as const) as never)
              break
            case 17:
              t = patchLayer(t, t.tracks.captions.length ? r.pick(t.tracks.captions).id : 'c_none', { text: 'new words here now' })
              break
            default:
              t = setAspect(t, r.pick(['9:16', '16:9'] as const))
          }
        } catch (e) {
          // a refused op must leave the timeline untouched and be a clean OpError
          expect(e).toBeInstanceOf(OpError)
          expect(JSON.stringify(t)).toBe(before)
        }
        invariants(t)
      }
    })
  }
})

describe('ops never mutate their input', () => {
  it('returns new timelines', () => {
    const t = baseTimeline()
    const snap = JSON.stringify(t)
    for (const [op, params] of [
      ['tighten_pauses', { keep_sec: 0.1 }],
      ['trim', { start_delta: 1, end_delta: -1 }],
      ['split_item', { at_tl: 3 }],
      ['delete_item', { item_id: 'v_base1' }],
      ['reorder', { item_id: 'v_base0', to_index: 2 }],
      ['set_status', { item_id: 'v_base0', status: 'rejected' }],
      ['accept_all', {}],
      ['rebuild_captions', {}],
    ] as const) {
      applyOp(t, op, params, ctx)
      expect(JSON.stringify(t)).toBe(snap)
    }
  })
})
