/**
 * Timeline operations, a line-for-line mirror of `backend/app/services/timeline_service.py` (Plan 6.1, 8.8, 8.9).
 * Pure functions: every op returns a NEW timeline (the input is never mutated), re-lays the video track out gapless,
 * recomputes `duration` and retimes captions/overlays through source time. A golden file generated from the Python
 * implementation (`golden.json`, see backend/scripts/dump_timeline_golden.py) keeps both sides identical.
 */
import { clamp, pyRound } from './util'
import {
  LAYER_TRACKS,
  cloneTimeline,
  findItem,
  newItemId,
  type AnyItem,
  type CaptionItem,
  type CaptionStyle,
  type CaptionWord,
  type LayerStatus,
  type OverlayItem,
  type Timeline,
  type TrackName,
  type VideoItem,
} from './types'

export const EPS = 1e-3 // tolerance (seconds) for every timeline comparison
export const MIN_PIECE_SEC = 0.1 // shortest video item an op may produce
export const MIN_LAYER_SEC = 0.04 // shortest caption/overlay kept after retiming

export type Interval = readonly [number, number]
export type Silences = Record<string, readonly Interval[]> | readonly Interval[]

/** Error shaped like the API's `422 VALIDATION_ERROR` / `404 NOT_FOUND` for an op that cannot run. */
export class OpError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'OpError'
    this.code = code
    this.details = details
  }
}
const bad = (op: string, message: string, details: Record<string, unknown> = {}) => new OpError('VALIDATION_ERROR', message, { op, ...details })

/** Items whose status is not `rejected` (these render and take timeline time). */
export function active<T extends { status: LayerStatus }>(items: readonly T[]): T[] {
  return items.filter((i) => i.status !== 'rejected')
}
export const durationOf = (i: { src_in: number; src_out: number }) => i.src_out - i.src_in
export const endOf = (i: VideoItem) => i.tl_start + (i.src_out - i.src_in)

/* ---------------------------------------------------------------------------------------------- */
/* internals                                                                                       */
/* ---------------------------------------------------------------------------------------------- */
/** Gapless layout of the video track and the derived duration (in place). */
export function relayout(t: Timeline): void {
  let cursor = 0
  for (const item of t.tracks.video) {
    item.tl_start = pyRound(cursor, 6)
    if (item.status !== 'rejected') cursor += item.src_out - item.src_in
  }
  t.duration = pyRound(cursor, 6)
}

function find(t: Timeline, id: string): { track: TrackName; index: number } {
  const hit = findItem(t, id)
  if (!hit) throw new OpError('NOT_FOUND', `Timeline item ${id} not found`, { item_id: id })
  return { track: hit.track, index: hit.index }
}

const sourceKey = (i: VideoItem) => i.asset_id ?? i.id

interface Anchor {
  owner: VideoItem
  s0: number
  s1: number
}

function ownerAt(items: readonly VideoItem[], t: number): VideoItem | null {
  let owner: VideoItem | null = null
  for (const item of items) {
    if (item.tl_start <= t + EPS && t < item.tl_start + durationOf(item) - EPS) owner = item
  }
  return owner
}

/** New `[t0, t1, shift]` for a source-anchored range, or null when its footage is gone. */
function place(anchor: Anchor, newItems: readonly VideoItem[]): [number, number, number] | null {
  const owner = anchor.owner
  const sorted = [...newItems].sort((a, b) => a.tl_start - b.tl_start) // stable
  const candidates = [...newItems.filter((i) => i.id === owner.id), ...sorted.filter((i) => i.id !== owner.id && sourceKey(i) === sourceKey(owner))]
  for (const item of candidates) {
    const a = Math.max(anchor.s0, item.src_in)
    const b = Math.min(anchor.s1, item.src_out)
    if (b - a >= MIN_LAYER_SEC) {
      const t0 = item.tl_start + (a - item.src_in)
      const oldT0 = owner.tl_start + (a - owner.src_in)
      return [t0, item.tl_start + (b - item.src_in), t0 - oldT0]
    }
  }
  return null
}

/** Re-place captions and overlays of `neu` (still on `old` times) after video moved. */
function retimeLayers(old: Timeline, neu: Timeline): void {
  const oldItems = active(old.tracks.video)
  const newItems = active(neu.tracks.video)
  if (!oldItems.length) {
    clampLayers(neu)
    return
  }
  const keepC: CaptionItem[] = []
  for (const cap of neu.tracks.captions) {
    const owner = ownerAt(oldItems, cap.tl_start)
    if (!owner) {
      keepC.push(cap)
      continue
    }
    const s0 = owner.src_in + (cap.tl_start - owner.tl_start)
    const s1 = owner.src_in + (Math.min(cap.tl_end, owner.tl_start + durationOf(owner)) - owner.tl_start)
    const placed = place({ owner, s0, s1 }, newItems)
    if (!placed) continue
    const [t0, t1, shift] = placed
    if (cap.words && cap.words.length) {
      const kept: CaptionWord[] = cap.words
        .filter((w) => t0 - EPS <= w.t0 + shift && w.t0 + shift < t1)
        .map((w) => ({ w: w.w, t0: pyRound(w.t0 + shift, 3), t1: pyRound(w.t1 + shift, 3) }))
      cap.words = kept.length ? kept : null
    }
    cap.tl_start = pyRound(t0, 6)
    cap.tl_end = pyRound(t1, 6)
    keepC.push(cap)
  }
  neu.tracks.captions = keepC
  const keepO: OverlayItem[] = []
  for (const over of neu.tracks.overlays) {
    const owner = ownerAt(oldItems, over.tl_start)
    if (!owner) {
      keepO.push(over)
      continue
    }
    const s0 = owner.src_in + (over.tl_start - owner.tl_start)
    const end = Math.min(over.tl_end, owner.tl_start + durationOf(owner))
    const placed = place({ owner, s0, s1: owner.src_in + (end - owner.tl_start) }, newItems)
    if (!placed) continue
    over.tl_start = pyRound(placed[0], 6)
    over.tl_end = pyRound(placed[1], 6)
    keepO.push(over)
  }
  neu.tracks.overlays = keepO
  clampLayers(neu)
}

/** Keep captions/overlays inside `[0, duration]`; drop the ones that vanish. */
export function clampLayers(t: Timeline): void {
  const end = t.duration
  for (const track of ['captions', 'overlays'] as const) {
    const kept = []
    for (const layer of t.tracks[track] as (CaptionItem | OverlayItem)[]) {
      layer.tl_start = Math.max(0, layer.tl_start)
      layer.tl_end = Math.min(end, layer.tl_end)
      if (layer.tl_end - layer.tl_start >= MIN_LAYER_SEC) kept.push(layer)
    }
    ;(t.tracks[track] as (CaptionItem | OverlayItem)[]) = kept
  }
}

/** Re-layout the video track and retime layers from `old`. */
function finish(old: Timeline, neu: Timeline): Timeline {
  relayout(neu)
  retimeLayers(old, neu)
  return neu
}
/** `finish` for editor-only operations that change a video item's length (see `linkSponsorFootage`). */
export const relayoutFrom = finish

/* ---------------------------------------------------------------------------------------------- */
/* operations                                                                                      */
/* ---------------------------------------------------------------------------------------------- */
/** Re-lay the video track out gapless and set `duration` (no layer retiming). */
export function recomputeDuration(t: Timeline): Timeline {
  const out = cloneTimeline(t)
  relayout(out)
  return out
}

function intervalsFor(silences: Silences, assetId: string | null): Interval[] {
  const raw: readonly Interval[] = Array.isArray(silences) ? (silences as readonly Interval[]) : ((silences as Record<string, readonly Interval[]>)[assetId ?? ''] ?? [])
  return raw
    .filter(([s, e]) => e > s)
    .map(([s, e]) => [Number(s), Number(e)] as Interval)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** Source ranges left of `[srcIn, srcOut]` after dropping silences (Plan 8.8 step 7). */
export function pauseRanges(srcIn: number, srcOut: number, silences: readonly Interval[], keepSec: number): Interval[] {
  const half = Math.max(0, keepSec) / 2
  const removals: Interval[] = []
  for (const [s, e] of silences) {
    if (e <= srcIn || s >= srcOut) continue
    const lo = s <= srcIn ? srcIn : s + half
    const hi = e >= srcOut ? srcOut : e - half
    if (hi - lo > EPS && (e - s > keepSec + EPS || s <= srcIn || e >= srcOut)) {
      removals.push([Math.max(lo, srcIn), Math.min(hi, srcOut)])
    }
  }
  removals.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const pieces: Interval[] = []
  let cursor = srcIn
  for (const [lo, hi] of removals) {
    if (lo > cursor) pieces.push([cursor, lo])
    cursor = Math.max(cursor, hi)
  }
  if (cursor < srcOut) pieces.push([cursor, srcOut])
  return pieces.map(([a, b]) => [pyRound(a, 3), pyRound(b, 3)] as Interval).filter(([a, b]) => b - a >= MIN_PIECE_SEC)
}

/** Drop silences inside every active clip item, keeping `keepSec` of pause (half each side). */
export function tightenPauses(t: Timeline, silences: Silences, keepSec = 0.15, source: 'ai' | 'user' = 'ai'): Timeline {
  if (!(keepSec >= 0 && keepSec <= 2)) throw bad('tighten_pauses', 'keep_sec must be between 0 and 2', { keep_sec: keepSec })
  const out = cloneTimeline(t)
  const video: VideoItem[] = []
  for (const item of out.tracks.video) {
    if (item.status === 'rejected' || item.kind !== 'clip' || item.asset_id === null) {
      video.push(item)
      continue
    }
    const pieces = pauseRanges(item.src_in, item.src_out, intervalsFor(silences, item.asset_id), keepSec)
    if (pieces.length === 1 && pieces[0][0] === item.src_in && pieces[0][1] === item.src_out) {
      video.push(item)
      continue
    }
    if (!pieces.length) continue // nothing but silence: the item disappears
    pieces.forEach(([a, b], n) => {
      if (n === 0) {
        item.src_in = a
        item.src_out = b
        video.push(item)
        return
      }
      const piece = structuredClone(item)
      piece.id = newItemId('v')
      piece.src_in = a
      piece.src_out = b
      piece.transition_in = null
      piece.source = source === 'ai' ? 'ai' : 'user'
      piece.reason = 'pause removed'
      video.push(piece)
    })
  }
  out.tracks.video = video
  return finish(t, out)
}

/**
 * Move source edges: `src_in += startDelta` and `src_out += endDelta`. A positive `startDelta` or a negative
 * `endDelta` shortens. Without `itemId` the start applies to the first active video item and the end to the last.
 */
export function trim(
  t: Timeline,
  startDelta = 0,
  endDelta = 0,
  opts: { itemId?: string | null; assetDurations?: Record<string, number> } = {},
): Timeline {
  const out = cloneTimeline(t)
  const items = active(out.tracks.video)
  if (!items.length) throw bad('trim', 'the timeline has no video to trim')
  let first: VideoItem
  let last: VideoItem
  if (opts.itemId != null) {
    const { track, index } = find(out, opts.itemId)
    if (track !== 'video') throw bad('trim', 'only video items can be trimmed', { item_id: opts.itemId })
    first = last = out.tracks.video[index]
  } else {
    first = items[0]
    last = items[items.length - 1]
  }
  if (first.asset_id === null || last.asset_id === null) throw bad('trim', 'sponsor placeholders cannot be trimmed by source edge')
  first.src_in = pyRound(Math.max(0, first.src_in + startDelta), 3)
  last.src_out = pyRound(last.src_out + endDelta, 3)
  const touched = new Map<string, VideoItem>([
    [first.id, first],
    [last.id, last],
  ])
  for (const item of touched.values()) {
    const limit = opts.assetDurations?.[item.asset_id ?? '']
    if (limit !== undefined && item.src_out > limit) item.src_out = pyRound(limit, 3)
    if (item.src_out - item.src_in < MIN_PIECE_SEC) throw bad('trim', 'the trim would leave less than 0.1 s', { item_id: item.id })
  }
  return finish(t, out)
}

export function setCaptionStyle(t: Timeline, style: CaptionStyle, opts: { clearOverrides?: boolean } = {}): Timeline {
  const out = cloneTimeline(t)
  out.caption_style = style
  if (opts.clearOverrides) for (const cap of out.tracks.captions) cap.style_override = null
  return out
}

/** Accept (`on`) or reject the AI music layer(s). Error if the timeline has none. */
export function toggleMusic(t: Timeline, on: boolean): Timeline {
  const out = cloneTimeline(t)
  const music = out.tracks.audio.filter((a) => a.kind === 'music')
  if (!music.length) throw bad('toggle_music', 'this timeline has no music layer')
  for (const item of music) item.status = on ? 'accepted' : 'rejected'
  return out
}

/** Cut the clip item under timeline time `atTl` in two (the first keeps its id). Nothing else moves. */
export function splitItem(t: Timeline, atTl: number, opts: { itemId?: string | null } = {}): Timeline {
  const out = cloneTimeline(t)
  for (let n = 0; n < out.tracks.video.length; n++) {
    const item = out.tracks.video[n]
    if (item.status === 'rejected' || (opts.itemId != null && item.id !== opts.itemId)) continue
    if (item.tl_start + MIN_PIECE_SEC <= atTl && atTl <= item.tl_start + durationOf(item) - MIN_PIECE_SEC) {
      if (item.asset_id === null) throw bad('split_item', 'sponsor placeholders cannot be split', { item_id: item.id })
      const cut = pyRound(item.src_in + (atTl - item.tl_start), 3)
      const tail = structuredClone(item)
      tail.id = newItemId('v')
      tail.src_in = cut
      tail.transition_in = null
      tail.reason = null
      item.src_out = cut
      out.tracks.video.splice(n + 1, 0, tail)
      relayout(out)
      return out
    }
  }
  throw bad('split_item', 'no video item can be split there (the cut must be at least 0.1 s from its edges)', { at_tl: atTl, item_id: opts.itemId ?? null })
}

/** Remove any item. Deleting video ripples the track gapless and retimes the layers. */
export function deleteItem(t: Timeline, itemId: string): Timeline {
  const out = cloneTimeline(t)
  const { track, index } = find(out, itemId)
  ;(out.tracks[track] as AnyItem[]).splice(index, 1)
  if (track === 'video') return finish(t, out)
  return out
}

/** Move a video item to `toIndex` of the video list (clamped); layers follow it. */
export function reorder(t: Timeline, itemId: string, toIndex: number): Timeline {
  const out = cloneTimeline(t)
  const { track, index } = find(out, itemId)
  if (track !== 'video') throw bad('reorder', 'only video items can be reordered', { item_id: itemId })
  const [item] = out.tracks.video.splice(index, 1)
  out.tracks.video.splice(Math.max(0, Math.min(toIndex, out.tracks.video.length)), 0, item)
  return finish(t, out)
}

/** Set a layer's status. Rejecting/restoring video ripples the track and retimes the layers. */
export function setStatus(t: Timeline, itemId: string, status: LayerStatus): Timeline {
  const out = cloneTimeline(t)
  const { track, index } = find(out, itemId)
  const item = (out.tracks[track] as AnyItem[])[index]
  if (item.status === status) return out
  item.status = status
  if (track === 'video') return finish(t, out)
  return out
}

/** Every `suggested` layer becomes `accepted` (rejected ones stay rejected). */
export function acceptAll(t: Timeline): Timeline {
  const out = cloneTimeline(t)
  for (const track of LAYER_TRACKS) for (const item of out.tracks[track] as AnyItem[]) if (item.status === 'suggested') item.status = 'accepted'
  return out
}

/** Insert `item` at timeline time `atTl`, pushing everything after it later (a clip under `atTl` is split first). */
export function rippleInsert(t: Timeline, atTl: number, item: VideoItem): Timeline {
  let out = cloneTimeline(t)
  const neu = structuredClone(item)
  let index = out.tracks.video.length
  for (let n = 0; n < out.tracks.video.length; n++) {
    const existing = out.tracks.video[n]
    if (existing.status === 'rejected') continue
    const end = existing.tl_start + durationOf(existing)
    if (atTl <= existing.tl_start + EPS) {
      index = n
      break
    }
    if (atTl < end - EPS) {
      if (end - atTl < MIN_PIECE_SEC || atTl - existing.tl_start < MIN_PIECE_SEC) {
        index = atTl - existing.tl_start < end - atTl ? n : n + 1
        break
      }
      out = splitItem(out, atTl, { itemId: existing.id })
      index = n + 1
      break
    }
  }
  out.tracks.video.splice(index, 0, neu)
  return finish(t, out)
}

export function setCropX(t: Timeline, itemId: string, cropX: number): Timeline {
  const out = cloneTimeline(t)
  const { track, index } = find(out, itemId)
  if (track !== 'video') throw bad('set_crop_x', 'only video items have crop_x', { item_id: itemId })
  out.tracks.video[index].crop_x = cropX
  return out
}

/* ---------------------------------------------------------------------------------------------- */
/* dispatcher (the same op names as POST /clips/{id}/edit/ops)                                      */
/* ---------------------------------------------------------------------------------------------- */
export interface OpContext {
  assetDurations?: Record<string, number>
  silences?: Record<string, readonly Interval[]>
  /** asset_id -> `[{word,start,end}]` in source seconds (needed by `rebuild_captions`). */
  wordsProvider?: ((assetId: string) => readonly { word: string; start: number; end: number }[]) | null
}

type P = Record<string, unknown>
function num(op: string, p: P, key: string, opts: { min?: number; max?: number; def?: number } = {}): number {
  const v = p[key] ?? opts.def
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(op, `invalid params: ${key} must be a number`)
  if (opts.min !== undefined && v < opts.min) throw bad(op, `invalid params: ${key} must be >= ${opts.min}`)
  if (opts.max !== undefined && v > opts.max) throw bad(op, `invalid params: ${key} must be <= ${opts.max}`)
  return v
}
function str(op: string, p: P, key: string, required = true): string | null {
  const v = p[key]
  if (v === undefined || v === null) {
    if (required) throw bad(op, `invalid params: ${key} is required`)
    return null
  }
  if (typeof v !== 'string') throw bad(op, `invalid params: ${key} must be a string`)
  return v
}

export const OP_NAMES = [
  'tighten_pauses',
  'trim',
  'trim_clip',
  'set_caption_style',
  'toggle_music',
  'split_item',
  'delete_item',
  'reorder',
  'set_status',
  'accept_all',
  'rebuild_captions',
  'set_crop_x',
  'ripple_insert',
  'recompute_duration',
] as const

// `rebuild_captions` lives in captions.ts; it registers itself here to avoid a circular import.
let rebuildImpl: ((t: Timeline, ctx: OpContext, maxWords: number | null) => Timeline) | null = null
export function registerRebuildCaptions(fn: (t: Timeline, ctx: OpContext, maxWords: number | null) => Timeline) {
  rebuildImpl = fn
}

/** Validate `params` for `op` and run it (client mirror of the server dispatcher). Unknown ops and bad params throw. */
export function applyOp(t: Timeline, op: string, params: P, ctx: OpContext = {}): Timeline {
  const p = params ?? {}
  switch (op) {
    case 'tighten_pauses':
      return tightenPauses(t, ctx.silences ?? {}, num(op, p, 'keep_sec', { min: 0.05, max: 0.4, def: 0.15 }))
    case 'trim':
    case 'trim_clip':
      return trim(t, num(op, p, 'start_delta', { min: -10, max: 10, def: 0 }), num(op, p, 'end_delta', { min: -10, max: 10, def: 0 }), {
        itemId: str(op, p, 'item_id', false),
        assetDurations: ctx.assetDurations,
      })
    case 'set_caption_style': {
      const style = str(op, p, 'style') as CaptionStyle
      if (!['bold_center', 'minimal_bottom', 'karaoke'].includes(style)) throw bad(op, 'invalid params: unknown style')
      return setCaptionStyle(t, style, { clearOverrides: p.clear_overrides === true })
    }
    case 'toggle_music':
      if (typeof p.on !== 'boolean') throw bad(op, 'invalid params: on must be a boolean')
      return toggleMusic(t, p.on)
    case 'split_item':
      return splitItem(t, num(op, p, 'at_tl', { min: 0 }), { itemId: str(op, p, 'item_id', false) })
    case 'delete_item':
      return deleteItem(t, str(op, p, 'item_id') as string)
    case 'reorder':
      return reorder(t, str(op, p, 'item_id') as string, Math.trunc(num(op, p, 'to_index', { min: 0 })))
    case 'set_status': {
      const status = str(op, p, 'status') as LayerStatus
      if (!['suggested', 'accepted', 'rejected'].includes(status)) throw bad(op, 'invalid params: unknown status')
      return setStatus(t, str(op, p, 'item_id') as string, status)
    }
    case 'accept_all':
      return acceptAll(t)
    case 'rebuild_captions': {
      if (!ctx.wordsProvider) throw bad(op, 'no transcript words are available for this timeline')
      if (!rebuildImpl) throw bad(op, 'captions module not loaded')
      const mw = p.max_words === undefined || p.max_words === null ? null : Math.trunc(num(op, p, 'max_words', { min: 1, max: 12 }))
      return rebuildImpl(t, ctx, mw)
    }
    case 'set_crop_x':
      return setCropX(t, str(op, p, 'item_id') as string, num(op, p, 'crop_x', { min: 0, max: 1 }))
    case 'ripple_insert':
      return rippleInsert(t, num(op, p, 'at_tl', { min: 0 }), p.item as VideoItem)
    case 'recompute_duration':
      return recomputeDuration(t)
    default:
      throw bad(op, `unknown op '${op}'`, { allowed: [...OP_NAMES].sort() })
  }
}

export interface LayerChange {
  status: LayerStatus
  layer: TrackName
  kind: string
  item_ids: string[]
  sources: string[]
}

/** Layers whose status changed between two timelines (what the server logs as `layer_accepted` / `layer_rejected`). */
export function layerChanges(before: Timeline, after: Timeline): LayerChange[] {
  const prior = new Map<string, LayerStatus>()
  for (const track of LAYER_TRACKS) for (const item of before.tracks[track] as AnyItem[]) prior.set(item.id, item.status)
  const groups = new Map<string, LayerChange & { src: Set<string> }>()
  for (const track of LAYER_TRACKS) {
    for (const item of after.tracks[track] as AnyItem[]) {
      const old = prior.get(item.id)
      if (item.status === old || item.status === 'suggested' || (old === undefined && item.status === 'accepted' && item.source === 'user')) continue
      const kind = 'kind' in item ? String(item.kind) : track
      const key = `${item.status}|${track}|${kind}`
      let g = groups.get(key)
      if (!g) {
        g = { status: item.status, layer: track, kind, item_ids: [], sources: [], src: new Set() }
        groups.set(key, g)
      }
      g.item_ids.push(item.id)
      g.src.add(item.source)
    }
  }
  return [...groups.values()].map(({ src, ...g }) => ({ ...g, sources: [...src].sort() }))
}

export { clamp }
