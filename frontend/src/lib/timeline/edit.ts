/**
 * Editor-only operations: edits the server has no dedicated op for (moving/resizing captions, overlays and audio,
 * adding layers, field patches). They are pure like the mirrored ops and keep every invariant: the video track is
 * only touched through `trim`, and captions/overlays are clamped to `[0, duration]`.
 */
import { MIN_PIECE_SEC, OpError, trim } from './ops'
import { wordsForEditedText } from './captions'
import {
  DEFAULT_MUSIC_GAIN_DB,
  SIZES,
  cloneTimeline,
  findItem,
  newItemId,
  type Aspect,
  type AudioItem,
  type AudioKind,
  type CaptionItem,
  type CaptionStyle,
  type OverlayItem,
  type OverlayKind,
  type Timeline,
  type Transition,
  type VideoItem,
} from './types'
import { rippleInsert } from './ops'
import { clamp, pyRound } from './util'

export const MIN_EDIT_LAYER_SEC = 0.2
export const DEFAULT_OVERLAY_SEC = 3
const r3 = (n: number) => pyRound(n, 3)

const bad = (op: string, message: string, details: Record<string, unknown> = {}) => new OpError('VALIDATION_ERROR', message, { op, ...details })

/** Trim one edge of a video item by dragging it: `delta` is the change of that edge in source seconds. Ripples. */
export function trimEdge(t: Timeline, itemId: string, edge: 'start' | 'end', delta: number, assetDurations?: Record<string, number>): Timeline {
  const hit = findItem(t, itemId)
  if (!hit || hit.track !== 'video') throw bad('trim_edge', 'only video items can be trimmed', { item_id: itemId })
  const v = hit.item as VideoItem
  const limit = v.asset_id ? assetDurations?.[v.asset_id] : undefined
  let d = delta
  if (edge === 'start') d = clamp(d, -v.src_in, v.src_out - v.src_in - MIN_PIECE_SEC)
  else d = clamp(d, -(v.src_out - v.src_in - MIN_PIECE_SEC), limit !== undefined ? Math.max(0, limit - v.src_out) : d)
  if (Math.abs(d) < 1e-9) return cloneTimeline(t)
  return edge === 'start' ? trim(t, d, 0, { itemId, assetDurations }) : trim(t, 0, d, { itemId, assetDurations })
}

/** Set a video item's source range directly (inspector numeric fields). Ripples like a trim. */
export function setSourceRange(t: Timeline, itemId: string, srcIn: number, srcOut: number, assetDurations?: Record<string, number>): Timeline {
  const hit = findItem(t, itemId)
  if (!hit || hit.track !== 'video') throw bad('set_source_range', 'only video items have a source range', { item_id: itemId })
  const v = hit.item as VideoItem
  const limit = v.asset_id ? assetDurations?.[v.asset_id] : undefined
  const a = Math.max(0, srcIn)
  const b = limit !== undefined ? Math.min(srcOut, limit) : srcOut
  if (b - a < MIN_PIECE_SEC) throw bad('set_source_range', 'a clip must be at least 0.1 s long', { item_id: itemId })
  return trim(t, r3(a) - v.src_in, r3(b) - v.src_out, { itemId, assetDurations })
}

type Layer = CaptionItem | OverlayItem

/** Move a caption or overlay so it starts at `newStart`, keeping its length (clamped to `[0, duration]`). */
export function moveLayer(t: Timeline, itemId: string, newStart: number): Timeline {
  const out = cloneTimeline(t)
  const hit = findItem(out, itemId)
  if (!hit) throw new OpError('NOT_FOUND', `Timeline item ${itemId} not found`, { item_id: itemId })
  if (hit.track === 'audio') {
    const a = hit.item as AudioItem
    a.tl_start = r3(clamp(newStart, 0, Math.max(0, out.duration - MIN_PIECE_SEC)))
    return out
  }
  if (hit.track !== 'captions' && hit.track !== 'overlays') throw bad('move_layer', 'video items are moved with reorder', { item_id: itemId })
  const l = hit.item as Layer
  const len = Math.min(l.tl_end - l.tl_start, out.duration)
  const start = r3(clamp(newStart, 0, Math.max(0, out.duration - len)))
  const shift = start - l.tl_start
  l.tl_start = start
  l.tl_end = r3(start + len)
  if (hit.track === 'captions') {
    const c = l as CaptionItem
    if (c.words) c.words = c.words.map((w) => ({ w: w.w, t0: r3(w.t0 + shift), t1: r3(w.t1 + shift) }))
  }
  return out
}

/** Drag a caption/overlay/audio edge to timeline time `time`. */
export function resizeLayer(t: Timeline, itemId: string, edge: 'start' | 'end', time: number, assetDurations?: Record<string, number>): Timeline {
  const out = cloneTimeline(t)
  const hit = findItem(out, itemId)
  if (!hit) throw new OpError('NOT_FOUND', `Timeline item ${itemId} not found`, { item_id: itemId })
  if (hit.track === 'audio') {
    const a = hit.item as AudioItem
    const limit = assetDurations?.[a.asset_id]
    if (edge === 'start') {
      // the left edge moves the source in-point and the timeline start together
      const maxDelta = a.src_out - a.src_in - MIN_PIECE_SEC
      const delta = clamp(time - a.tl_start, Math.max(-a.src_in, -a.tl_start), maxDelta)
      a.src_in = r3(a.src_in + delta)
      a.tl_start = r3(a.tl_start + delta)
    } else {
      const newLen = Math.max(MIN_PIECE_SEC, time - a.tl_start)
      const maxOut = limit !== undefined ? limit : Infinity
      a.src_out = r3(Math.min(a.src_in + newLen, maxOut))
    }
    return out
  }
  if (hit.track !== 'captions' && hit.track !== 'overlays') throw bad('resize_layer', 'video items are trimmed, not resized', { item_id: itemId })
  const l = hit.item as Layer
  if (edge === 'start') l.tl_start = r3(clamp(time, 0, l.tl_end - MIN_EDIT_LAYER_SEC))
  else l.tl_end = r3(clamp(time, l.tl_start + MIN_EDIT_LAYER_SEC, out.duration))
  if (hit.track === 'captions') {
    const c = l as CaptionItem
    if (c.words) {
      const kept = c.words.filter((w) => w.t1 > c.tl_start && w.t0 < c.tl_end)
      c.words = kept.length ? kept : null
    }
  }
  return out
}

export function addOverlay(t: Timeline, kind: OverlayKind, at: number, text: string, seconds = DEFAULT_OVERLAY_SEC): { timeline: Timeline; id: string } {
  if (t.duration <= 0) throw bad('add_overlay', 'add some video first: overlays live inside the timeline duration')
  const out = cloneTimeline(t)
  const len = Math.min(seconds, out.duration)
  const start = r3(clamp(at, 0, out.duration - len))
  const item: OverlayItem = {
    id: newItemId('o'),
    source: 'user',
    status: 'accepted',
    reason: null,
    kind,
    tl_start: start,
    tl_end: r3(start + len),
    text,
    asset_id: null,
    placeholder: false,
    sponsor_slot_id: null,
  }
  out.tracks.overlays.push(item)
  return { timeline: out, id: item.id }
}

export function addCaption(t: Timeline, at: number, text: string, seconds = 2): { timeline: Timeline; id: string } {
  if (t.duration <= 0) throw bad('add_caption', 'add some video first: captions live inside the timeline duration')
  const out = cloneTimeline(t)
  const len = Math.min(seconds, out.duration)
  const start = r3(clamp(at, 0, out.duration - len))
  const end = r3(start + len)
  const item: CaptionItem = {
    id: newItemId('c'),
    source: 'user',
    status: 'accepted',
    reason: null,
    tl_start: start,
    tl_end: end,
    text,
    words: wordsForEditedText(null, text, start, end),
    style_override: null,
  }
  out.tracks.captions.push(item)
  out.tracks.captions.sort((a, b) => a.tl_start - b.tl_start)
  return { timeline: out, id: item.id }
}

export function defaultGain(kind: AudioKind): number {
  return kind === 'music' ? DEFAULT_MUSIC_GAIN_DB : kind === 'sfx' ? -6 : 0
}

/** Add an audio layer from a library asset at timeline time `at` (music is cut at the end of the video). */
export function addAudio(
  t: Timeline,
  p: { assetId: string; kind: AudioKind; at: number; assetDuration: number; gainDb?: number },
): { timeline: Timeline; id: string } {
  if (!(p.assetDuration > MIN_PIECE_SEC)) throw bad('add_audio', 'this audio file has no known duration')
  const out = cloneTimeline(t)
  const start = r3(clamp(p.at, 0, Math.max(0, out.duration - MIN_PIECE_SEC)))
  let len = p.assetDuration
  if (p.kind === 'music' && out.duration > start) len = Math.min(len, out.duration - start)
  len = Math.max(MIN_PIECE_SEC, r3(len))
  const item: AudioItem = {
    id: newItemId('a'),
    source: 'user',
    status: 'accepted',
    reason: null,
    kind: p.kind,
    asset_id: p.assetId,
    src_in: 0,
    src_out: r3(Math.min(len, p.assetDuration)),
    tl_start: start,
    gain_db: clamp(p.gainDb ?? defaultGain(p.kind), -60, 12),
  }
  out.tracks.audio.push(item)
  return { timeline: out, id: item.id }
}

export function setAspect(t: Timeline, aspect: Aspect): Timeline {
  const out = cloneTimeline(t)
  out.aspect = aspect
  out.width = SIZES[aspect][0]
  out.height = SIZES[aspect][1]
  return out
}

export function setTransition(t: Timeline, itemId: string, tr: Transition | null): Timeline {
  const out = cloneTimeline(t)
  const hit = findItem(out, itemId)
  if (!hit || hit.track !== 'video') throw bad('set_transition', 'only video items have a transition', { item_id: itemId })
  const v = hit.item as VideoItem
  if (!tr || tr.type === 'cut') v.transition_in = tr ? { type: 'cut', dur: 0 } : null
  else v.transition_in = { type: tr.type, dur: r3(clamp(tr.dur, 0.1, 0.5)) }
  return out
}

export type LayerPatch = {
  text?: string
  style_override?: CaptionStyle | null
  gain_db?: number
  kind?: OverlayKind | AudioKind
  tl_start?: number
  tl_end?: number
}

/** Field-level edit of one layer (caption text/override, overlay text/kind, audio gain/kind, caption or overlay times). */
export function patchLayer(t: Timeline, itemId: string, patch: LayerPatch): Timeline {
  const out = cloneTimeline(t)
  const hit = findItem(out, itemId)
  if (!hit) throw new OpError('NOT_FOUND', `Timeline item ${itemId} not found`, { item_id: itemId })
  if (hit.track === 'video') throw bad('patch_layer', 'video items are edited with trim/crop/transition ops', { item_id: itemId })
  if (hit.track === 'captions') {
    const c = hit.item as CaptionItem
    if (patch.text !== undefined) {
      const text = patch.text.replace(/\s+/g, ' ').trim()
      if (!text) throw bad('patch_layer', 'a caption needs some text', { item_id: itemId })
      c.words = wordsForEditedText(c.words, text, c.tl_start, c.tl_end)
      c.text = text
    }
    if (patch.style_override !== undefined) c.style_override = patch.style_override
  } else if (hit.track === 'overlays') {
    const o = hit.item as OverlayItem
    if (patch.text !== undefined) o.text = patch.text
    if (patch.kind !== undefined) o.kind = patch.kind as OverlayKind
  } else {
    const a = hit.item as AudioItem
    if (patch.gain_db !== undefined) a.gain_db = clamp(pyRound(patch.gain_db, 1), -60, 12)
    if (patch.kind !== undefined) a.kind = patch.kind as AudioKind
  }
  if (hit.track === 'captions' || hit.track === 'overlays') {
    const l = hit.item as Layer
    const s = patch.tl_start ?? l.tl_start
    const e = patch.tl_end ?? l.tl_end
    if (patch.tl_start !== undefined || patch.tl_end !== undefined) {
      const start = r3(clamp(s, 0, Math.max(0, out.duration - MIN_EDIT_LAYER_SEC)))
      const end = r3(clamp(e, start + MIN_EDIT_LAYER_SEC, out.duration))
      if (end - start < MIN_EDIT_LAYER_SEC - 1e-9) throw bad('patch_layer', 'the timeline is too short for this layer', { item_id: itemId })
      l.tl_start = start
      l.tl_end = end
    }
  } else if (patch.tl_start !== undefined) {
    ;(hit.item as AudioItem).tl_start = r3(clamp(patch.tl_start, 0, Math.max(0, out.duration - MIN_PIECE_SEC)))
  }
  return out
}

export const DEFAULT_IMAGE_SEC = 3

/**
 * Put a whole library video, or a still image, on the video track at `at` (pushing everything after it later; a clip under
 * `at` is split first). A video plays in full; an image is shown for `imageSec`. Mirrors `ripple_insert` on the server.
 */
export function addVideoMedia(
  t: Timeline,
  p: { assetId: string; kind: 'video' | 'image'; at: number; duration?: number | null; imageSec?: number },
): { timeline: Timeline; id: string } {
  const image = p.kind === 'image'
  const length = image ? p.imageSec ?? DEFAULT_IMAGE_SEC : p.duration ?? 0
  if (!(length > 0)) throw bad('add_video', 'this file has no length yet: wait until it has finished processing')
  const item: VideoItem = {
    id: newItemId('v'),
    source: 'user',
    status: 'accepted',
    reason: null,
    kind: image ? 'image' : 'clip',
    asset_id: p.assetId,
    src_in: 0,
    src_out: r3(length),
    tl_start: 0,
    crop_x: 0.5,
    transition_in: null,
    speed: 1,
    placeholder: false,
    text: null,
  }
  return { timeline: rippleInsert(t, clamp(p.at, 0, Math.max(0, t.duration)), item), id: item.id }
}
