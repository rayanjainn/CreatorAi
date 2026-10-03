/** Helpers shared by the unit tests (not imported by app code). */
import { normalizeTimeline, setIdGenerator, type ApiTimeline, type Timeline, type AudioItem, type CaptionItem, type OverlayItem, type VideoItem } from './types'
import { relayout } from './ops'
import { emptyTimeline } from './types'

export function counterIds(start = 1000) {
  let n = start
  setIdGenerator((prefix) => `${prefix.replace(/_+$/, '')}_${(n++).toString(16).padStart(10, '0')}`)
}

/** Small deterministic PRNG (mulberry32) for the randomized checks. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo) * next()),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  }
}

const A = 'asset-a'
const B = 'asset-b'
export const DURATIONS: Record<string, number> = { [A]: 60, [B]: 30, 'music-1': 120 }

export const vid = (id: string, srcIn: number, srcOut: number, asset: string | null = A, extra: Partial<VideoItem> = {}): VideoItem => ({
  id,
  source: 'ai',
  status: 'suggested',
  reason: null,
  kind: 'clip',
  asset_id: asset,
  src_in: srcIn,
  src_out: srcOut,
  tl_start: 0,
  crop_x: 0.5,
  transition_in: null,
  speed: 1,
  placeholder: false,
  text: null,
  ...extra,
})
export const cap = (id: string, t0: number, t1: number, text = 'hello there'): CaptionItem => ({
  id,
  source: 'ai',
  status: 'suggested',
  reason: null,
  tl_start: t0,
  tl_end: t1,
  text,
  words: null,
  style_override: null,
})
export const aud = (id: string, kind: AudioItem['kind'], start: number, len: number, extra: Partial<AudioItem> = {}): AudioItem => ({
  id,
  source: 'ai',
  status: 'suggested',
  reason: null,
  kind,
  asset_id: 'music-1',
  src_in: 0,
  src_out: len,
  tl_start: start,
  gain_db: -18,
  ...extra,
})
export const ovl = (id: string, t0: number, t1: number, extra: Partial<OverlayItem> = {}): OverlayItem => ({
  id,
  source: 'user',
  status: 'accepted',
  reason: null,
  kind: 'text',
  tl_start: t0,
  tl_end: t1,
  text: 'Hi',
  asset_id: null,
  placeholder: false,
  sponsor_slot_id: null,
  ...extra,
})

/** A 5-15, A 20-26, B 2-10 (24 s) with captions, music and overlays, like the backend's own test timeline. */
export function baseTimeline(): Timeline {
  const t = emptyTimeline()
  t.tracks.video = [vid('v_base0', 5, 15), vid('v_base1', 20, 26), vid('v_base2', 2, 10, B)]
  relayout(t)
  t.tracks.captions = [cap('c_base0', 1, 3), cap('c_base1', 12, 14), cap('c_base2', 18, 21)]
  t.tracks.audio = [aud('a_base0', 'music', 0, 24), aud('a_base1', 'sfx', 9, 2, { source: 'user', status: 'accepted', gain_db: -6 })]
  t.tracks.overlays = [ovl('o_base0', 2, 5), ovl('o_base1', 11, 15, { source: 'ai', status: 'suggested', kind: 'lower_third', text: 'Name' })]
  return t
}

export const fromJson = (j: unknown): Timeline => normalizeTimeline(j as ApiTimeline)

/** Deep equality with a tolerance on numbers. */
export function closeTo(actual: unknown, expected: unknown, path = '$', tol = 2e-6): string | null {
  if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(actual - expected) <= tol ? null : `${path}: ${actual} != ${expected}`
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return actual === expected ? null : `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return `${path}: array length ${Array.isArray(actual) ? actual.length : typeof actual} != ${expected.length}`
    for (let i = 0; i < expected.length; i++) {
      const r = closeTo(actual[i], expected[i], `${path}[${i}]`, tol)
      if (r) return r
    }
    return null
  }
  const ek = Object.keys(expected as object).sort()
  const ak = Object.keys(actual as object).sort()
  if (ek.join() !== ak.join()) return `${path}: keys ${ak.join()} != ${ek.join()}`
  for (const k of ek) {
    const r = closeTo((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`, tol)
    if (r) return r
  }
  return null
}
