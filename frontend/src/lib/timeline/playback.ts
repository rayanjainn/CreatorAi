/**
 * Pure playback maths: timeline time -> (video item, source time), what captions/overlays/audio are live, crop mapping,
 * frame stepping and timecodes. The playback engine (components/editor/engine.ts) is built on top of these; they need no
 * DOM and no decoding, so the transport can be tested (and driven by a clock when the browser cannot decode the proxy).
 */
import { EPS, active, durationOf } from './ops'
import type { Aspect, AudioItem, CaptionItem, CaptionStyle, OverlayItem, Timeline, VideoItem } from './types'
import { clamp } from './util'

export const FPS = 30
export const FRAME = 1 / FPS

export interface Segment {
  item: VideoItem
  /** Position among the ACTIVE video items. */
  index: number
  start: number
  end: number
}

/** Active (non-rejected) video items with their timeline spans, in order. */
export function buildSegments(t: Timeline): Segment[] {
  return active(t.tracks.video).map((item, index) => ({ item, index, start: item.tl_start, end: item.tl_start + durationOf(item) }))
}

export interface Located {
  segment: Segment
  /** Source time inside `segment.item.src_in..src_out`. */
  srcTime: number
}

/** Which video item is on screen at timeline `time`, and where in its source. At/after the end it is the last frame. */
export function locate(segments: readonly Segment[], time: number): Located | null {
  if (!segments.length) return null
  const t = Math.max(0, time)
  for (const seg of segments) {
    if (t >= seg.start - 1e-9 && t < seg.end - 1e-9) return { segment: seg, srcTime: seg.item.src_in + (t - seg.start) }
  }
  const last = segments[segments.length - 1]
  return { segment: last, srcTime: Math.max(last.item.src_in, last.item.src_out - FRAME / 2) }
}

/** The following segment, or null. */
export const nextSegment = (segments: readonly Segment[], seg: Segment): Segment | null => segments[seg.index + 1] ?? null

/** True when `b` continues `a` in the source (a split): the same <video> can keep playing across the cut. */
export function isContinuous(a: VideoItem, b: VideoItem): boolean {
  return a.asset_id !== null && a.asset_id === b.asset_id && Math.abs(b.src_in - a.src_out) < 0.05
}

export const captionStyleOf = (c: CaptionItem, t: Timeline): CaptionStyle => c.style_override ?? t.caption_style

/** Captions that are visible at `time` (rejected ones are not rendered). */
export function captionsAt(t: Timeline, time: number): CaptionItem[] {
  return active(t.tracks.captions).filter((c) => time >= c.tl_start - 1e-9 && time < c.tl_end - 1e-9)
}
export function overlaysAt(t: Timeline, time: number): OverlayItem[] {
  return active(t.tracks.overlays).filter((o) => time >= o.tl_start - 1e-9 && time < o.tl_end - 1e-9)
}

export interface LiveAudio {
  item: AudioItem
  /** Seek position inside the audio source. */
  srcTime: number
}
/** Audio layers that should be sounding at `time`. */
export function audioAt(t: Timeline, time: number): LiveAudio[] {
  const out: LiveAudio[] = []
  for (const item of active(t.tracks.audio)) {
    const end = item.tl_start + durationOf(item)
    if (time >= item.tl_start - 1e-9 && time < end - 1e-9) out.push({ item, srcTime: item.src_in + (time - item.tl_start) })
  }
  return out
}

/** Index of the word being spoken at `time` (karaoke highlight), -1 before the first word. */
export function karaokeIndex(c: CaptionItem, time: number): number {
  if (!c.words?.length) return -1
  let idx = -1
  for (let i = 0; i < c.words.length; i++) if (time >= c.words[i].t0 - 1e-9) idx = i
  return idx
}

/** dB -> HTMLMediaElement volume (0..1; an element cannot be louder than 0 dB, the render applies the full gain). */
export const gainToVolume = (db: number) => clamp(Math.pow(10, db / 20), 0, 1)

/**
 * `object-position` X percentage that centres the face (`cropX`, 0..1 of the source width) the way the render does:
 * window left = clamp(cropX*srcW - outW/2, 0, srcW-outW) with outW = srcH*outAspect. 50% when the source is not wider.
 */
export function cropPositionX(cropX: number, srcW: number | null | undefined, srcH: number | null | undefined, aspect: Aspect): number {
  if (aspect !== '9:16' || !srcW || !srcH) return 50
  const outW = srcH * (9 / 16)
  if (srcW <= outW + 1e-6) return 50
  const left = clamp(cropX * srcW - outW / 2, 0, srcW - outW)
  return clamp((left / (srcW - outW)) * 100, 0, 100)
}

export const clampTime = (t: Timeline, time: number) => clamp(time, 0, t.duration)

/** Snap to the 1/30 s frame grid. */
export const toFrame = (time: number) => Math.round(time * FPS) / FPS

/** Move by whole frames, staying inside the timeline. */
export function stepFrames(t: Timeline, time: number, frames: number): number {
  const next = Math.round(time * FPS) + frames
  return clamp(next / FPS, 0, t.duration)
}

/** `HH:MM:SS:FF` at 30 fps (the editor's timecode readout). */
export function timecode(sec: number, fps = FPS): string {
  const total = Math.max(0, Math.round(sec * fps))
  const f = total % fps
  const s = Math.floor(total / fps)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}:${pad(f)}`
}

/** `M:SS.cc` readout used in numeric inputs. */
export function clock(sec: number): string {
  const v = Math.max(0, sec)
  const m = Math.floor(v / 60)
  return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`
}

/** Parse `12.5`, `0:12.5`, `1:02:03` or `00:00:12:15` (frames) into seconds; null when it is not a time. */
export function parseTime(raw: string, fps = FPS): number | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const parts = s.split(':')
  if (parts.length < 2 || parts.length > 4 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  const nums = parts.map(Number)
  if (parts.length === 4) return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  return nums[0] * 60 + nums[1]
}

/** Times a drag may snap to: item edges, the playhead, 0 and the end. */
export function snapPoints(t: Timeline, opts: { playhead?: number; exclude?: string } = {}): number[] {
  const pts = new Set<number>([0, t.duration])
  if (opts.playhead !== undefined) pts.add(opts.playhead)
  for (const v of active(t.tracks.video)) {
    if (v.id === opts.exclude) continue
    pts.add(v.tl_start)
    pts.add(v.tl_start + durationOf(v))
  }
  for (const l of [...active(t.tracks.captions), ...active(t.tracks.overlays)]) {
    if (l.id === opts.exclude) continue
    pts.add(l.tl_start)
    pts.add(l.tl_end)
  }
  for (const a of active(t.tracks.audio)) {
    if (a.id === opts.exclude) continue
    pts.add(a.tl_start)
    pts.add(a.tl_start + durationOf(a))
  }
  return [...pts].sort((a, b) => a - b)
}

/** Nearest snap point within `threshold` seconds, else null. */
export function snapTo(time: number, points: readonly number[], threshold: number): number | null {
  let best: number | null = null
  let dist = threshold
  for (const p of points) {
    const d = Math.abs(p - time)
    if (d <= dist) {
      best = p
      dist = d
    }
  }
  return best
}

/** Greedy lane packing for items that may overlap (captions/overlays/audio): returns lane index per item id. */
export function packLanes(items: readonly { id: string; start: number; end: number }[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => it.start >= end - EPS)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = it.end
    lanes.set(it.id, lane)
  }
  return { lanes, count: Math.max(1, laneEnds.length) }
}
