/** Client mirror of `timeline_service.validate` (Plan 6.1 invariants) plus the structural rules Pydantic enforces. */
import { EPS, active } from './ops'
import { ID_PREFIX, LAYER_TRACKS, SIZES, type AnyItem, type Timeline, type Violation } from './types'

/** Every broken cross-item invariant (empty list = valid). Same codes and order as the backend. */
export function validate(t: Timeline, assetDurations?: Record<string, number> | null): Violation[] {
  const out: Violation[] = []
  const add = (code: string, message: string, path: string, itemId: string | null = null) => out.push({ code, message, path, item_id: itemId })
  const g = (n: number) => String(Number(n.toPrecision(6)))

  const size = SIZES[t.aspect]
  if (!size || size[0] !== t.width || size[1] !== t.height) {
    const [w, h] = SIZES[t.aspect] ?? [0, 0]
    add('DIMENSIONS', `${t.aspect} must be ${w}x${h}`, 'width')
  }

  const seen = new Set<string>()
  for (const track of LAYER_TRACKS) {
    ;(t.tracks[track] as AnyItem[]).forEach((item, n) => {
      const path = `tracks.${track}[${n}]`
      if (seen.has(item.id)) add('DUPLICATE_ID', `id '${item.id}' is used more than once`, path, item.id)
      seen.add(item.id)
      if (!item.id.startsWith(ID_PREFIX[track])) add('ID_PREFIX', `id must start with '${ID_PREFIX[track]}'`, path, item.id)
    })
  }

  let cursor = 0
  let previous: (typeof t.tracks.video)[number] | null = null
  t.tracks.video.forEach((item, n) => {
    const path = `tracks.video[${n}]`
    const length = item.src_out - item.src_in
    if (length <= 0) add('SRC_RANGE', 'src_out must be greater than src_in', path, item.id)
    if (item.kind === 'sponsor' && item.asset_id !== null && item.placeholder) add('SPONSOR_PLACEHOLDER', 'a linked sponsor segment is not a placeholder', path, item.id)
    if (item.asset_id !== null && assetDurations) {
      const limit = assetDurations[item.asset_id]
      if (limit === undefined) add('SRC_BEYOND_ASSET', `unknown asset ${item.asset_id}`, path, item.id)
      else if (item.src_out > limit + EPS) add('SRC_BEYOND_ASSET', `src_out ${g(item.src_out)} is past the end of the asset (${g(limit)} s)`, path, item.id)
    }
    if (item.status === 'rejected') return
    if (previous === null) {
      if (Math.abs(item.tl_start) > EPS) add('VIDEO_START', 'the first video item must start at 0', path, item.id)
    } else if (item.tl_start < previous.tl_start - EPS) add('VIDEO_ORDER', 'video items must be sorted by tl_start', path, item.id)
    else if (item.tl_start < cursor - EPS) add('VIDEO_OVERLAP', `overlaps the previous item (ends ${g(cursor)})`, path, item.id)
    else if (item.tl_start > cursor + EPS) add('VIDEO_GAP', `gap before this item (previous ends ${g(cursor)})`, path, item.id)
    cursor = item.tl_start + length
    previous = item
  })
  const total = active(t.tracks.video).reduce((s, i) => s + (i.src_out - i.src_in), 0)
  if (Math.abs(t.duration - total) > EPS) add('DURATION_MISMATCH', `duration is ${g(t.duration)} but the video track adds up to ${g(total)}`, 'duration')

  for (const track of ['captions', 'overlays'] as const) {
    ;(t.tracks[track] as { id: string; tl_start: number; tl_end: number }[]).forEach((layer, n) => {
      const path = `tracks.${track}[${n}]`
      if (layer.tl_start < -EPS || layer.tl_end <= layer.tl_start + 1e-9) add('LAYER_RANGE', 'needs 0 <= tl_start < tl_end', path, layer.id)
      else if (layer.tl_end > t.duration + EPS) add('LAYER_RANGE', `tl_end ${g(layer.tl_end)} is past the timeline duration ${g(t.duration)}`, path, layer.id)
    })
  }
  t.tracks.audio.forEach((audio, n) => {
    const path = `tracks.audio[${n}]`
    if (audio.src_out <= audio.src_in) add('SRC_RANGE', 'src_out must be greater than src_in', path, audio.id)
    const limit = assetDurations?.[audio.asset_id]
    if (limit !== undefined && audio.src_out > limit + EPS) add('SRC_BEYOND_ASSET', `src_out is past the end of the asset (${g(limit)} s)`, path, audio.id)
  })
  return out
}

/** Structural rules the server's Pydantic models enforce (ranges, ids, transitions). Reported as `SCHEMA`. */
export function validateSchema(t: Timeline): Violation[] {
  const out: Violation[] = []
  const add = (message: string, path: string, itemId: string | null) => out.push({ code: 'SCHEMA', message, path, item_id: itemId })
  for (const track of LAYER_TRACKS) {
    ;(t.tracks[track] as AnyItem[]).forEach((item, n) => {
      const path = `tracks.${track}[${n}]`
      if (item.id.length < 3) add('id is too short', path, item.id)
      if ('tl_start' in item && item.tl_start < 0) add('tl_start must be >= 0', path, item.id)
    })
  }
  t.tracks.video.forEach((v, n) => {
    const path = `tracks.video[${n}]`
    if (v.src_in < 0) add('src_in must be >= 0', path, v.id)
    if (v.src_out <= 0) add('src_out must be > 0', path, v.id)
    if (v.crop_x < 0 || v.crop_x > 1) add('crop_x must be between 0 and 1', path, v.id)
    if (v.asset_id === null && !(v.kind === 'sponsor' && v.placeholder)) add('asset_id may be null only for a sponsor placeholder', path, v.id)
    if (v.kind === 'clip' && v.placeholder) add('only sponsor items can be placeholders', path, v.id)
    const tr = v.transition_in
    if (tr) {
      if (tr.dur < 0 || tr.dur > 0.5) add('transition dur must be between 0 and 0.5', path, v.id)
      if (tr.type !== 'cut' && tr.dur < 0.1) add('fade and dissolve transitions need dur between 0.1 and 0.5', path, v.id)
    }
  })
  t.tracks.captions.forEach((c, n) => {
    const path = `tracks.captions[${n}]`
    if (c.tl_end <= 0) add('tl_end must be > 0', path, c.id)
    if (!c.text.length) add('text must not be empty', path, c.id)
  })
  t.tracks.audio.forEach((a, n) => {
    const path = `tracks.audio[${n}]`
    if (a.src_in < 0) add('src_in must be >= 0', path, a.id)
    if (a.src_out <= 0) add('src_out must be > 0', path, a.id)
    if (a.gain_db < -60 || a.gain_db > 12) add('gain_db must be between -60 and 12', path, a.id)
  })
  t.tracks.overlays.forEach((o, n) => {
    if (o.tl_end <= 0) add('tl_end must be > 0', `tracks.overlays[${n}]`, o.id)
  })
  return out
}

export const validateAll = (t: Timeline, assetDurations?: Record<string, number> | null) => [...validateSchema(t), ...validate(t, assetDurations)]
