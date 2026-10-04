/**
 * Timeline playback engine (no React, no direct DOM access).
 *
 * The clock is the master: `time` advances with `now()` while playing, and the media elements are slaved to it. That is
 * what makes the transport testable and keeps the playhead, captions and overlays running when a browser cannot decode
 * the H.264 proxy (Playwright's Chromium cannot): decode errors and stalls only switch the affected media to "clock-only"
 * and are reported in `state.failed` so the monitor can say so honestly.
 *
 * Two video slots A/B: while item N plays on the active slot, item N+1 is pre-loaded and pre-seeked on the idle slot, then
 * the slots swap at the cut (gapless). A cut that continues the same source (a split) keeps playing on the same element.
 * Audio items (music/sfx/voiceover) get one element each, started and stopped as they enter and leave the timeline.
 */
import { active } from '@/lib/timeline/ops'
import { FRAME, audioAt, buildSegments, gainToVolume, isContinuous, locate, nextSegment, type Segment } from '@/lib/timeline/playback'
import type { Timeline, VideoItem } from '@/lib/timeline/types'
import type { EditAssets } from './types'

/** The slice of HTMLMediaElement the engine uses (tests pass fakes). */
export interface MediaLike {
  src: string
  currentTime: number
  readyState: number
  paused: boolean
  error: unknown
  muted: boolean
  volume: number
  preload: string
  play(): Promise<void> | void
  pause(): void
  load(): void
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

export interface EngineOptions {
  now?: () => number
  raf?: (cb: (t: number) => void) => number
  caf?: (h: number) => void
  /** Creates the element for an audio layer. */
  createAudio?: () => MediaLike
  /** Absolute URL for a signed API path. */
  resolveUrl?: (url: string) => string
}

export interface SlotInfo {
  itemId: string | null
  url: string | null
}

export interface EngineState {
  playing: boolean
  ended: boolean
  /** Current segment's media is buffering. */
  stalled: boolean
  /** The current segment's media can not be decoded or loaded: playback is clock-driven. */
  failed: boolean
  failedAssets: string[]
  audioFailed: string[]
  activeSlot: 0 | 1
  slots: [SlotInfo, SlotInfo]
  itemId: string | null
}

type Slot = { el: MediaLike; url: string | null; itemId: string | null; pending: number | null }

const DRIFT_SEC = 0.3
const PREBUFFER_SEC = 2.5
const STALL_FAIL_SEC = 4
const MAX_DT = 0.1
const READY = 2 // HAVE_CURRENT_DATA

export class PlaybackEngine {
  private slots: [Slot, Slot]
  private active: 0 | 1 = 0
  private timeline: Timeline | null = null
  private assets: EditAssets = {}
  private segments: Segment[] = []
  private time_ = 0
  private playing_ = false
  private ended_ = false
  private stalled_ = false
  private stallFor = 0
  private last = 0
  private raf = 0
  private volume = 1
  private mutedVideo = false
  private mutedAudio = false
  /** Files the browser could not load/decode (error event). */
  private failedUrls = new Set<string>()
  /** Files that stayed unready for too long; cleared again when the browser reports `canplay`. */
  private slowUrls = new Set<string>()
  private failedAudio = new Set<string>()
  private audio = new Map<string, { el: MediaLike; url: string }>()
  private timeListeners = new Set<(t: number) => void>()
  private stateListeners = new Set<(s: EngineState) => void>()
  private cleanups: (() => void)[] = []
  private readonly now: () => number
  private readonly rafFn: (cb: (t: number) => void) => number
  private readonly cafFn: (h: number) => void
  private readonly makeAudio: (() => MediaLike) | null
  private readonly resolve: (u: string) => string

  constructor(videoA: MediaLike, videoB: MediaLike, opts: EngineOptions = {}) {
    this.now = opts.now ?? (() => performance.now())
    this.rafFn = opts.raf ?? ((cb) => requestAnimationFrame(cb))
    this.cafFn = opts.caf ?? ((h) => cancelAnimationFrame(h))
    this.makeAudio = opts.createAudio ?? null
    this.resolve = opts.resolveUrl ?? ((u) => u)
    this.slots = [this.mkSlot(videoA), this.mkSlot(videoB)]
  }

  private mkSlot(el: MediaLike): Slot {
    const slot: Slot = { el, url: null, itemId: null, pending: null }
    const onMeta = () => {
      if (slot.pending !== null) {
        this.setTime(slot, slot.pending)
        slot.pending = null
      }
    }
    const onError = () => {
      if (slot.url) this.failedUrls.add(slot.url)
      this.emitState()
    }
    const onReady = () => {
      if (slot.url) this.slowUrls.delete(slot.url)
      this.emitState()
    }
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('error', onError)
    el.addEventListener('canplay', onReady)
    this.cleanups.push(() => {
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('error', onError)
      el.removeEventListener('canplay', onReady)
    })
    return slot
  }

  /* ------------------------------------------------------------------------------------------ */
  /* public API                                                                                  */
  /* ------------------------------------------------------------------------------------------ */
  get time() {
    return this.time_
  }
  get playing() {
    return this.playing_
  }
  get duration() {
    return this.timeline?.duration ?? 0
  }

  onTime(cb: (t: number) => void): () => void {
    this.timeListeners.add(cb)
    return () => this.timeListeners.delete(cb)
  }
  onState(cb: (s: EngineState) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  getState(): EngineState {
    const seg = this.currentSegment()
    const failed = seg ? this.isFailed(seg.item) : false
    const asset = (url: string | null) => Object.entries(this.assets).find(([, a]) => a.proxy_url && url && this.resolve(a.proxy_url) === url)?.[0]
    return {
      playing: this.playing_,
      ended: this.ended_,
      stalled: this.stalled_,
      failed,
      failedAssets: [...this.failedUrls, ...this.slowUrls].map(asset).filter((x): x is string => !!x),
      audioFailed: [...this.failedAudio],
      activeSlot: this.active,
      slots: [
        { itemId: this.slots[0].itemId, url: this.slots[0].url },
        { itemId: this.slots[1].itemId, url: this.slots[1].url },
      ],
      itemId: seg?.item.id ?? null,
    }
  }

  setTimeline(t: Timeline, assets: EditAssets): void {
    this.timeline = t
    this.assets = assets
    this.segments = buildSegments(t)
    // a changed timeline invalidates what was pre-buffered
    for (const s of this.slots) if (s.itemId && !this.segments.some((g) => g.item.id === s.itemId)) s.itemId = null
    if (this.time_ > t.duration) this.time_ = t.duration
    this.syncMedia(true)
    this.emitTime()
    this.emitState()
  }

  setVolume(volume: number, mutedVideo: boolean, mutedAudio: boolean): void {
    this.volume = Math.max(0, Math.min(1, volume))
    this.mutedVideo = mutedVideo
    this.mutedAudio = mutedAudio
    this.applyVolumes()
  }

  play(): void {
    if (!this.timeline || this.timeline.duration <= 0) return
    if (this.time_ >= this.timeline.duration - 1e-3) this.time_ = 0
    this.ended_ = false
    this.playing_ = true
    this.last = this.now()
    this.stalled_ = false
    this.stallFor = 0
    this.syncMedia(true)
    this.schedule()
    this.emitTime()
    this.emitState()
  }

  pause(): void {
    if (!this.playing_) return
    this.playing_ = false
    this.cancel()
    this.stalled_ = false
    for (const s of this.slots) s.el.pause()
    for (const a of this.audio.values()) a.el.pause()
    this.emitState()
  }

  toggle(): void {
    if (this.playing_) this.pause()
    else this.play()
  }

  seek(t: number): void {
    const d = this.timeline?.duration ?? 0
    this.time_ = Math.max(0, Math.min(d, t))
    this.ended_ = false
    this.stalled_ = false
    this.stallFor = 0
    this.last = this.now()
    this.syncMedia(true)
    this.emitTime()
    this.emitState()
  }

  step(frames: number): void {
    this.pause()
    const next = Math.round(this.time_ / FRAME) + frames
    this.seek(next * FRAME)
  }

  destroy(): void {
    this.cancel()
    this.playing_ = false
    for (const c of this.cleanups) c()
    for (const s of this.slots) {
      s.el.pause()
      s.el.src = ''
    }
    for (const a of this.audio.values()) {
      a.el.pause()
      a.el.src = ''
    }
    this.audio.clear()
    this.timeListeners.clear()
    this.stateListeners.clear()
  }

  /** One engine step (exposed for tests that drive the clock by hand). */
  tick(): void {
    if (!this.playing_ || !this.timeline) return
    const nowMs = this.now()
    const dt = Math.min(MAX_DT, Math.max(0, (nowMs - this.last) / 1000))
    this.last = nowMs
    const seg = this.currentSegment()
    const stalled = !!seg && this.isStalled(seg)
    if (stalled) {
      this.stallFor += dt
      if (this.stallFor >= STALL_FAIL_SEC) {
        const url = this.urlFor(seg!.item)
        if (url) this.slowUrls.add(url)
        this.stalled_ = false
        this.stallFor = 0
        this.emitState()
      } else if (!this.stalled_) {
        this.stalled_ = true
        this.emitState()
      }
    } else {
      if (this.stalled_) {
        this.stalled_ = false
        this.emitState()
      }
      this.stallFor = 0
      this.time_ += dt
    }
    if (this.time_ >= this.timeline.duration - 1e-6) {
      this.time_ = this.timeline.duration
      this.playing_ = false
      this.ended_ = true
      this.cancel()
      for (const s of this.slots) s.el.pause()
      for (const a of this.audio.values()) a.el.pause()
      this.syncMedia(false)
      this.emitTime()
      this.emitState()
      return
    }
    const before = this.snapshotKey()
    this.syncMedia(false)
    this.emitTime()
    if (this.snapshotKey() !== before) this.emitState()
  }

  /* ------------------------------------------------------------------------------------------ */
  /* internals                                                                                   */
  /* ------------------------------------------------------------------------------------------ */
  private schedule() {
    this.cancel()
    const loop = () => {
      this.raf = 0
      if (!this.playing_) return
      this.tick()
      if (this.playing_) this.raf = this.rafFn(loop)
    }
    this.raf = this.rafFn(loop)
  }
  private cancel() {
    if (this.raf) this.cafFn(this.raf)
    this.raf = 0
  }

  private currentSegment(): Segment | null {
    return locate(this.segments, this.time_)?.segment ?? null
  }

  private urlFor(item: VideoItem): string | null {
    const a = item.asset_id ? this.assets[item.asset_id] : undefined
    return a?.proxy_url ? this.resolve(a.proxy_url) : null
  }

  private isFailed(item: VideoItem): boolean {
    if (item.kind === 'image' || item.asset_id === null) return false // nothing to decode: the clock carries it
    const url = this.urlFor(item)
    return !url || this.failedUrls.has(url) || this.slowUrls.has(url)
  }

  private isStalled(seg: Segment): boolean {
    if (this.isFailed(seg.item)) return false
    const slot = this.slots[this.active]
    if (slot.itemId !== seg.item.id && !(slot.url && slot.url === this.urlFor(seg.item))) return false
    return slot.el.readyState < READY && !slot.el.error
  }

  private snapshotKey(): string {
    const s = this.getState()
    return `${s.itemId}|${s.activeSlot}|${s.failed}|${s.stalled}|${s.slots[0].itemId}|${s.slots[1].itemId}`
  }

  private setTime(slot: { el: MediaLike }, t: number) {
    try {
      slot.el.currentTime = Math.max(0, t)
    } catch {
      /* metadata not ready yet */
    }
  }

  private load(slot: Slot, item: VideoItem, srcTime: number) {
    const url = this.urlFor(item)
    slot.itemId = item.id
    if (!url) return
    if (slot.url !== url) {
      slot.url = url
      slot.pending = srcTime
      slot.el.preload = 'auto'
      slot.el.src = url
      slot.el.load()
    } else if (slot.el.readyState >= 1) {
      this.setTime(slot, srcTime)
    } else {
      slot.pending = srcTime
    }
  }

  /** Bring the media elements in line with `time_`: right item on the active slot, drift fixed, next item pre-buffered. */
  private syncMedia(hard: boolean) {
    const loc = locate(this.segments, this.time_)
    if (!loc) {
      for (const s of this.slots) s.el.pause()
      this.syncAudio(hard)
      return
    }
    const { segment: seg, srcTime } = loc
    const url = this.urlFor(seg.item)
    let slot = this.slots[this.active]
    const idle = this.slots[this.active === 0 ? 1 : 0]
    const onActive = slot.itemId === seg.item.id
    const continuing = !onActive && slot.itemId !== null && url !== null && slot.url === url && this.continuesFrom(slot.itemId, seg.item) && !hard
    if (onActive || continuing) {
      slot.itemId = seg.item.id
      // same element keeps playing; only correct drift
      const drift = Math.abs(slot.el.currentTime - srcTime)
      if (hard || (drift > DRIFT_SEC && slot.el.readyState >= 1)) {
        if (slot.el.readyState >= 1) this.setTime(slot, srcTime)
        else slot.pending = srcTime
      }
    } else if (idle.itemId === seg.item.id && idle.url === url && !hard) {
      // gapless swap to the pre-buffered slot
      slot.el.pause()
      this.active = this.active === 0 ? 1 : 0
      slot = idle
      this.setTime(slot, srcTime)
    } else if (url) {
      // not prepared (seek, edit or first play): load it on the idle slot unless the active one already holds the file
      if (slot.url === url) this.load(slot, seg.item, srcTime)
      else {
        slot.el.pause()
        this.active = this.active === 0 ? 1 : 0
        slot = idle
        this.load(slot, seg.item, srcTime)
      }
    } else {
      slot.el.pause()
    }
    // play / pause the active element
    if (this.playing_ && url && !this.failedUrls.has(url) && !this.slowUrls.has(url)) {
      if (slot.el.paused && slot.itemId === seg.item.id) void Promise.resolve(slot.el.play()).catch(() => undefined)
    } else {
      slot.el.pause()
    }
    // the other slot never plays
    const other = this.slots[this.active === 0 ? 1 : 0]
    other.el.pause()
    // pre-buffer the following item
    const nxt = nextSegment(this.segments, seg)
    if (nxt && !isContinuous(seg.item, nxt.item) && (hard || seg.end - this.time_ <= PREBUFFER_SEC || other.itemId === null)) {
      if (other.itemId !== nxt.item.id) this.load(other, nxt.item, nxt.item.src_in)
    }
    this.applyVolumes()
    this.syncAudio(hard)
  }

  private continuesFrom(prevItemId: string, next: VideoItem): boolean {
    const prev = this.segments.find((g) => g.item.id === prevItemId)?.item
    return !!prev && isContinuous(prev, next)
  }

  private audioUrl(assetId: string): string | null {
    const a = this.assets[assetId]
    const u = a?.audio_url ?? a?.proxy_url ?? null
    return u ? this.resolve(u) : null
  }

  private syncAudio(hard: boolean) {
    if (!this.timeline || !this.makeAudio) return
    const live = this.playing_ ? audioAt(this.timeline, this.time_) : []
    const liveIds = new Set(live.map((l) => l.item.id))
    for (const [id, a] of this.audio) if (!liveIds.has(id)) a.el.pause()
    for (const { item, srcTime } of live) {
      const url = this.audioUrl(item.asset_id)
      if (!url || this.failedAudio.has(item.id)) continue
      let entry = this.audio.get(item.id)
      if (!entry || entry.url !== url) {
        const el = entry?.el ?? this.makeAudio()
        el.src = url
        el.preload = 'auto'
        const id = item.id
        el.addEventListener('error', () => {
          this.failedAudio.add(id)
          this.emitState()
        })
        entry = { el, url }
        this.audio.set(item.id, entry)
        this.setTime({ el }, srcTime)
      }
      const { el } = entry
      el.volume = gainToVolume(item.gain_db) * this.volume
      el.muted = this.mutedAudio
      if (hard || Math.abs(el.currentTime - srcTime) > DRIFT_SEC) this.setTime({ el }, srcTime)
      if (el.paused) void Promise.resolve(el.play()).catch(() => undefined)
    }
  }

  private applyVolumes() {
    const a = this.slots[this.active]
    a.el.volume = this.volume
    a.el.muted = this.mutedVideo
    const other = this.slots[this.active === 0 ? 1 : 0]
    other.el.muted = true
    if (!this.timeline) return
    for (const [id, entry] of this.audio) {
      const item = this.timeline.tracks.audio.find((x) => x.id === id)
      if (!item) continue
      entry.el.volume = gainToVolume(item.gain_db) * this.volume
      entry.el.muted = this.mutedAudio
    }
  }

  private emitTime() {
    for (const cb of this.timeListeners) cb(this.time_)
  }
  private emitState() {
    const s = this.getState()
    for (const cb of this.stateListeners) cb(s)
  }

  /** The active video items in the timeline (used by tests). */
  get activeItems(): VideoItem[] {
    return this.timeline ? active(this.timeline.tracks.video) : []
  }
}
