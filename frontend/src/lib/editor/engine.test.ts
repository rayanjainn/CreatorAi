import { describe, expect, it } from 'vitest'
import { PlaybackEngine, type MediaLike } from './engine'
import type { EditAssets } from './types'
import { baseTimeline, vid, aud } from '@/lib/timeline/testing'
import { relayout, splitItem } from '@/lib/timeline'

class FakeMedia implements MediaLike {
  src = ''
  currentTime = 0
  readyState = 0
  paused = true
  error: unknown = null
  muted = false
  volume = 1
  preload = ''
  loads = 0
  plays = 0
  private handlers = new Map<string, Set<() => void>>()
  play() {
    this.paused = false
    this.plays++
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  load() {
    this.loads++
    this.readyState = 0
  }
  addEventListener(t: string, cb: () => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set())
    this.handlers.get(t)!.add(cb)
  }
  removeEventListener(t: string, cb: () => void) {
    this.handlers.get(t)?.delete(cb)
  }
  fire(t: string) {
    this.handlers.get(t)?.forEach((cb) => cb())
  }
  /** The browser finished loading: metadata and enough data to play. */
  becomeReady() {
    this.readyState = 4
    this.fire('loadedmetadata')
    this.fire('canplay')
  }
  fail() {
    this.error = { code: 4 }
    this.fire('error')
  }
}

const asset = (url: string | null, extra = {}) => ({ filename: 'x.mp4', kind: 'video', duration_sec: 60, width: 640, height: 360, proxy_url: url, audio_url: null, thumb_url: null, energy: [], energy_window_sec: 0.5, silences: [], words: [], word_ranges: [], ...extra })
const ASSETS: EditAssets = { 'asset-a': asset('/media/a.mp4'), 'asset-b': asset('/media/b.mp4'), 'music-1': asset(null, { kind: 'audio', audio_url: '/media/m.mp3' }) }

function setup(assets: EditAssets = ASSETS, timeline = baseTimeline()) {
  const a = new FakeMedia()
  const b = new FakeMedia()
  const audios: FakeMedia[] = []
  let now = 0
  const rafs: ((t: number) => void)[] = []
  const engine = new PlaybackEngine(a, b, {
    now: () => now,
    raf: (cb) => rafs.push(cb),
    caf: () => undefined,
    createAudio: () => {
      const el = new FakeMedia()
      el.becomeReady()
      audios.push(el)
      return el
    },
  })
  engine.setTimeline(timeline, assets)
  /** advance the wall clock by `sec` in 20 ms ticks (what requestAnimationFrame would do) */
  const run = (sec: number) => {
    const steps = Math.round(sec / 0.02)
    for (let i = 0; i < steps; i++) {
      now += 20
      engine.tick()
    }
  }
  return { engine, a, b, audios, run }
}

describe('transport without any media (clock-driven)', () => {
  it('advances with the clock and stops at the end', () => {
    const { engine, run } = setup({ 'asset-a': asset(null), 'asset-b': asset(null), 'music-1': asset(null) })
    engine.play()
    expect(engine.playing).toBe(true)
    run(2)
    expect(engine.time).toBeCloseTo(2, 1)
    expect(engine.getState().failed).toBe(true) // honest: nothing to decode
    run(30)
    expect(engine.playing).toBe(false)
    expect(engine.time).toBe(24)
    expect(engine.getState().ended).toBe(true)
    // pressing play at the end restarts from 0
    engine.play()
    expect(engine.time).toBe(0)
  })
  it('seek, step and pause', () => {
    const { engine, run } = setup({ 'asset-a': asset(null), 'asset-b': asset(null), 'music-1': asset(null) })
    engine.seek(5)
    expect(engine.time).toBe(5)
    engine.step(1)
    expect(engine.time).toBeCloseTo(5 + 1 / 30, 4)
    engine.step(-3)
    expect(engine.time).toBeCloseTo(5 - 2 / 30, 4)
    engine.seek(999)
    expect(engine.time).toBe(24)
    engine.seek(-4)
    expect(engine.time).toBe(0)
    engine.play()
    run(1)
    engine.pause()
    const t = engine.time
    run(1)
    expect(engine.time).toBe(t)
  })
  it('notifies time and state listeners', () => {
    const { engine, run } = setup()
    const times: number[] = []
    const states: boolean[] = []
    engine.onTime((t) => times.push(t))
    engine.onState((s) => states.push(s.playing))
    engine.play()
    run(0.1)
    engine.pause()
    expect(times.length).toBeGreaterThan(3)
    expect(states[0]).toBe(true)
    expect(states[states.length - 1]).toBe(false)
  })
  it('ignores play on an empty timeline', () => {
    const { engine } = setup(ASSETS, { ...baseTimeline(), duration: 0, tracks: { video: [], captions: [], audio: [], overlays: [] } })
    engine.play()
    expect(engine.playing).toBe(false)
  })
})

describe('media switching', () => {
  it('loads the first item on play and pre-buffers the next on the other slot', () => {
    const { engine, a, b } = setup()
    engine.play()
    const s = engine.getState()
    const first = s.activeSlot === 0 ? a : b
    const other = s.activeSlot === 0 ? b : a
    expect(first.src).toBe('/media/a.mp4')
    expect(other.src).toBe('/media/a.mp4') // item 1 is also asset A (a different range): pre-buffered on the idle slot
    first.becomeReady()
    other.becomeReady()
    expect(s.slots[s.activeSlot].itemId).toBe('v_base0')
    expect(s.slots[s.activeSlot === 0 ? 1 : 0].itemId).toBe('v_base1')
  })
  it('swaps slots at the cut (gapless) and starts the next item at its src_in', () => {
    const { engine, a, b, run } = setup()
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    const firstSlot = engine.getState().activeSlot
    run(9.9)
    expect(engine.getState().activeSlot).toBe(firstSlot)
    run(0.3)
    const s = engine.getState()
    expect(s.activeSlot).not.toBe(firstSlot)
    expect(s.itemId).toBe('v_base1')
    const now = s.activeSlot === 0 ? a : b
    expect(now.paused).toBe(false)
    expect(now.currentTime).toBeCloseTo(20, 0)
    const old = s.activeSlot === 0 ? b : a
    expect(old.paused).toBe(true)
    // item 2 (asset B) is being pre-buffered on the slot that just stopped
    run(5.5)
    expect(old.src).toBe('/media/b.mp4')
  })
  it('keeps playing on the same element across a split', () => {
    const t = splitItem(baseTimeline(), 4)
    const { engine, a, b, run } = setup(ASSETS, t)
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    const slot = engine.getState().activeSlot
    const el = slot === 0 ? a : b
    const plays = el.plays
    run(4.2)
    expect(engine.getState().activeSlot).toBe(slot)
    expect(engine.getState().itemId).toBe(t.tracks.video[1].id)
    expect(el.plays).toBe(plays) // never restarted
  })
  it('skips rejected items', () => {
    const t = baseTimeline()
    t.tracks.video[1].status = 'rejected'
    relayout(t)
    const { engine, a, b, run } = setup(ASSETS, t)
    expect(t.duration).toBe(18)
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(10.3)
    expect(engine.getState().itemId).toBe('v_base2')
    const now = engine.getState().activeSlot === 0 ? a : b
    expect(now.src).toBe('/media/b.mp4')
  })
  it('seeking while paused shows the right frame', () => {
    const { engine, a, b } = setup()
    engine.seek(12)
    const s = engine.getState()
    expect(s.itemId).toBe('v_base1')
    const el = s.activeSlot === 0 ? a : b
    el.becomeReady()
    expect(el.currentTime).toBeCloseTo(22, 1)
    expect(el.paused).toBe(true)
  })
  it('corrects drift between the video and the clock', () => {
    const { engine, a, b, run } = setup()
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    const el = engine.getState().activeSlot === 0 ? a : b
    run(1)
    el.currentTime = 40 // browser jumped
    run(0.1)
    expect(el.currentTime).toBeCloseTo(5 + 1.1, 0)
  })
})

describe('failure handling (e.g. a browser without H.264)', () => {
  it('a decode error flips to clock-only and keeps the transport running', () => {
    const { engine, a, b, run } = setup()
    engine.play()
    const el = engine.getState().activeSlot === 0 ? a : b
    el.fail()
    expect(engine.getState().failed).toBe(true)
    run(3)
    expect(engine.time).toBeCloseTo(3, 1)
    run(30)
    expect(engine.getState().ended).toBe(true)
    expect(engine.getState().failedAssets).toContain('asset-a')
  })
  it('stalls while buffering, resumes when ready, and gives up after 4 s', () => {
    const { engine, a, b, run } = setup()
    engine.play()
    const el = engine.getState().activeSlot === 0 ? a : b
    run(1)
    expect(engine.time).toBe(0) // not ready: the clock waits
    expect(engine.getState().stalled).toBe(true)
    el.becomeReady()
    run(1)
    expect(engine.getState().stalled).toBe(false)
    expect(engine.time).toBeCloseTo(1, 1)
    // a different file that never becomes ready
    engine.seek(18.5)
    run(2)
    const t1 = engine.time
    run(3)
    expect(engine.time).toBeGreaterThan(t1) // after 4 s of stall it continues by clock
    expect(engine.getState().failed).toBe(true)
    // ... and recovers when the browser finally has data
    ;[a, b].forEach((m) => m.becomeReady())
    expect(engine.getState().failed).toBe(false)
  })
})

describe('audio layers', () => {
  it('plays music and sfx while they are inside the timeline, at their gain', () => {
    const { engine, a, b, audios, run } = setup()
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(0.2)
    expect(audios).toHaveLength(1) // music from 0
    expect(audios[0].paused).toBe(false)
    expect(audios[0].volume).toBeCloseTo(Math.pow(10, -18 / 20), 3)
    run(9)
    expect(audios).toHaveLength(2) // sfx from 9 s
    expect(audios[1].volume).toBeCloseTo(Math.pow(10, -6 / 20), 3)
    run(2.2)
    expect(audios[1].paused).toBe(true) // sfx ended at 11 s
    expect(audios[0].paused).toBe(false)
  })
  it('mute and volume apply to audio layers and to the video element', () => {
    const { engine, a, b, audios, run } = setup()
    engine.setVolume(0.5, false, true)
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(0.2)
    expect(audios[0].muted).toBe(true)
    const el = engine.getState().activeSlot === 0 ? a : b
    expect(el.muted).toBe(false)
    expect(el.volume).toBe(0.5)
    engine.setVolume(1, true, false)
    expect(el.muted).toBe(true)
    expect(audios[0].muted).toBe(false)
  })
  it('rejected audio is silent and gain above 0 dB is capped at full volume', () => {
    const t = baseTimeline()
    t.tracks.audio[0].status = 'rejected'
    t.tracks.audio.push(aud('a_loud', 'voiceover', 0, 5, { gain_db: 9, status: 'accepted' }))
    const { engine, a, b, audios, run } = setup(ASSETS, t)
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(0.2)
    expect(audios).toHaveLength(1)
    expect(audios[0].volume).toBe(1)
  })
  it('a failing audio file is reported and does not stop the transport', () => {
    const { engine, a, b, audios, run } = setup()
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(0.2)
    audios[0].fire('error')
    expect(engine.getState().audioFailed.length).toBe(1)
    run(1)
    expect(engine.playing).toBe(true)
  })
})

describe('timeline edits during playback', () => {
  it('re-syncs when the timeline changes under the playhead', () => {
    const { engine, a, b, run } = setup()
    engine.play()
    ;[a, b].forEach((m) => m.becomeReady())
    run(3)
    const t = baseTimeline()
    t.tracks.video = [vid('v_only', 30, 40)]
    relayout(t)
    engine.setTimeline(t, ASSETS)
    expect(engine.getState().itemId).toBe('v_only')
    run(0.1)
    expect(engine.time).toBeLessThanOrEqual(10)
  })
})
