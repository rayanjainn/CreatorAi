import type { components } from '@/lib/api/schema'

/**
 * Timeline contract (Plan.md 6.1). Hand-written strict types (every field present, no optional defaults) that
 * mirror `backend/app/schemas/timeline.py`. `normalizeTimeline` fills the defaults the API schema leaves optional,
 * and the assignability check at the bottom fails the type-check if the generated schema ever drifts.
 */
export type LayerSource = 'ai' | 'user'
export type LayerStatus = 'suggested' | 'accepted' | 'rejected'
export type CaptionStyle = 'bold_center' | 'minimal_bottom' | 'karaoke'
export type Aspect = '9:16' | '16:9'
export type TrackName = 'video' | 'captions' | 'audio' | 'overlays'
export type AudioKind = 'music' | 'sfx' | 'voiceover'
export type OverlayKind = 'sponsor_card' | 'lower_third' | 'text'

export const SIZES: Record<Aspect, readonly [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080] }
export const ID_PREFIX: Record<TrackName, string> = { video: 'v_', captions: 'c_', audio: 'a_', overlays: 'o_' }
export const LAYER_TRACKS: readonly TrackName[] = ['video', 'captions', 'audio', 'overlays']
export const DEFAULT_MUSIC_GAIN_DB = -18

export interface LayerBase {
  id: string
  source: LayerSource
  status: LayerStatus
  reason: string | null
}
export interface Transition {
  type: 'cut' | 'fade' | 'dissolve'
  dur: number
}
export interface VideoItem extends LayerBase {
  /** `image` is a still shown for `src_out - src_in` seconds (no source duration to exceed). */
  kind: 'clip' | 'sponsor' | 'image'
  asset_id: string | null
  src_in: number
  src_out: number
  tl_start: number
  crop_x: number
  transition_in: Transition | null
  speed: 1
  placeholder: boolean
  text: string | null
}
export interface CaptionWord {
  w: string
  t0: number
  t1: number
}
export interface CaptionItem extends LayerBase {
  tl_start: number
  tl_end: number
  text: string
  words: CaptionWord[] | null
  style_override: CaptionStyle | null
}
export interface AudioItem extends LayerBase {
  kind: AudioKind
  asset_id: string
  src_in: number
  src_out: number
  tl_start: number
  gain_db: number
}
export type TextFont = 'montserrat' | 'inter' | 'serif' | 'mono'
/** Look and position of a text overlay. x/y are the box centre as a share of the frame; size is a share of the frame height. */
export interface TextStyle {
  x: number
  y: number
  font: TextFont
  size: number
  color: string
  bg: string | null
  bg_opacity: number
  align: 'left' | 'center' | 'right'
  width: number
  shadow: boolean
}
export const DEFAULT_TEXT_STYLE: TextStyle = { x: 0.5, y: 0.25, font: 'montserrat', size: 0.045, color: '#FFFFFF', bg: null, bg_opacity: 0.6, align: 'center', width: 0.8, shadow: true }

export interface OverlayItem extends LayerBase {
  kind: OverlayKind
  tl_start: number
  tl_end: number
  text: string
  asset_id: string | null
  placeholder: boolean
  sponsor_slot_id: string | null
  /** Text look and position; null = the built-in look for this kind. */
  style?: TextStyle | null
}
export interface Tracks {
  video: VideoItem[]
  captions: CaptionItem[]
  audio: AudioItem[]
  overlays: OverlayItem[]
}
export interface Timeline {
  version: 1
  fps: 30
  aspect: Aspect
  width: number
  height: number
  duration: number
  caption_style: CaptionStyle
  tracks: Tracks
}
export type AnyItem = VideoItem | CaptionItem | AudioItem | OverlayItem

export interface Violation {
  code: string
  message: string
  path: string
  item_id: string | null
}

export type ApiTimeline = components['schemas']['Timeline']

/** Fill the defaults the API schema marks optional (the server always sends them; this keeps the types strict). */
export function normalizeTimeline(raw: ApiTimeline): Timeline {
  const aspect: Aspect = raw.aspect ?? '9:16'
  const [w, h] = SIZES[aspect]
  const tr = raw.tracks ?? {}
  return {
    version: 1,
    fps: 30,
    aspect,
    width: raw.width ?? w,
    height: raw.height ?? h,
    duration: raw.duration ?? 0,
    caption_style: raw.caption_style ?? 'bold_center',
    tracks: {
      video: (tr.video ?? []).map((v) => ({
        id: v.id,
        source: v.source,
        status: v.status,
        reason: v.reason ?? null,
        kind: v.kind ?? 'clip',
        asset_id: v.asset_id ?? null,
        src_in: v.src_in,
        src_out: v.src_out,
        tl_start: v.tl_start,
        crop_x: v.crop_x ?? 0.5,
        transition_in: v.transition_in ? { type: v.transition_in.type ?? 'cut', dur: v.transition_in.dur ?? 0 } : null,
        speed: 1 as const,
        placeholder: v.placeholder ?? false,
        text: v.text ?? null,
      })),
      captions: (tr.captions ?? []).map((c) => ({
        id: c.id,
        source: c.source,
        status: c.status,
        reason: c.reason ?? null,
        tl_start: c.tl_start,
        tl_end: c.tl_end,
        text: c.text,
        words: c.words ? c.words.map((x) => ({ w: x.w, t0: x.t0, t1: x.t1 })) : null,
        style_override: c.style_override ?? null,
      })),
      audio: (tr.audio ?? []).map((a) => ({
        id: a.id,
        source: a.source,
        status: a.status,
        reason: a.reason ?? null,
        kind: a.kind,
        asset_id: a.asset_id,
        src_in: a.src_in,
        src_out: a.src_out,
        tl_start: a.tl_start,
        gain_db: a.gain_db ?? DEFAULT_MUSIC_GAIN_DB,
      })),
      overlays: (tr.overlays ?? []).map((o) => ({
        id: o.id,
        source: o.source,
        status: o.status,
        reason: o.reason ?? null,
        kind: o.kind,
        tl_start: o.tl_start,
        tl_end: o.tl_end,
        text: o.text ?? '',
        asset_id: o.asset_id ?? null,
        placeholder: o.placeholder ?? false,
        sponsor_slot_id: o.sponsor_slot_id ?? null,
        style: o.style ? ({ ...DEFAULT_TEXT_STYLE, ...o.style } as TextStyle) : null,
      })),
    },
  }
}

/** Compile-time guard: a strict `Timeline` must be accepted by the generated API schema. */
export const toApiTimeline = (t: Timeline): ApiTimeline => t

export function emptyTimeline(aspect: Aspect = '9:16', captionStyle: CaptionStyle = 'bold_center'): Timeline {
  const [width, height] = SIZES[aspect]
  return { version: 1, fps: 30, aspect, width, height, duration: 0, caption_style: captionStyle, tracks: { video: [], captions: [], audio: [], overlays: [] } }
}

export function cloneTimeline(t: Timeline): Timeline {
  return structuredClone(t)
}

let idGen: (prefix: string) => string = (prefix) => {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return `${prefix.replace(/_+$/, '')}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
/** `"v_1a2b3c4d5e"`-style id; `prefix` is `v`, `c`, `a` or `o`. */
export function newItemId(prefix: string): string {
  return idGen(prefix)
}
/** Tests swap the generator for a deterministic counter (the golden file is generated the same way). */
export function setIdGenerator(fn: ((prefix: string) => string) | null) {
  idGen =
    fn ??
    ((prefix) => {
      const bytes = new Uint8Array(5)
      globalThis.crypto.getRandomValues(bytes)
      return `${prefix.replace(/_+$/, '')}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
    })
}

export function findItem(t: Timeline, id: string): { track: TrackName; index: number; item: AnyItem } | null {
  for (const track of LAYER_TRACKS) {
    const list = t.tracks[track] as AnyItem[]
    const index = list.findIndex((i) => i.id === id)
    if (index >= 0) return { track, index, item: list[index] }
  }
  return null
}

export function trackOf(id: string): TrackName | null {
  const p = id.slice(0, 2)
  return (Object.entries(ID_PREFIX).find(([, v]) => v === p)?.[0] as TrackName | undefined) ?? null
}
