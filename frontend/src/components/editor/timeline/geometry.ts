import type { TrackName } from '@/lib/timeline'

export const HEADER_W = 124
export const RULER_H = 28
export const TRACK_H: Record<TrackName, number> = { overlays: 34, captions: 34, video: 70, audio: 46 }
export const TRACK_ORDER: TrackName[] = ['overlays', 'captions', 'video', 'audio']
export const TRACK_LABEL: Record<TrackName, { code: string; name: string }> = {
  overlays: { code: 'FX', name: 'Overlays' },
  captions: { code: 'CC', name: 'Captions' },
  video: { code: 'V1', name: 'Video' },
  audio: { code: 'A1', name: 'Audio' },
}
export const MIN_PPS = 8
export const MAX_PPS = 480
export const SNAP_PX = 7

/** Pointer drag helper: calls `onMove` once the pointer moved `threshold` px, `onEnd(moved)` on release. */
export function startDrag(
  e: { clientX: number; clientY: number; button?: number },
  h: { threshold?: number; cursor?: string; onStart?: () => void; onMove: (dx: number, dy: number, ev: PointerEvent) => void; onEnd?: (moved: boolean, ev: PointerEvent) => void },
) {
  const x0 = e.clientX
  const y0 = e.clientY
  const threshold = h.threshold ?? 3
  let moved = false
  const prevSelect = document.body.style.userSelect
  const prevCursor = document.body.style.cursor
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0
    const dy = ev.clientY - y0
    if (!moved) {
      if (Math.hypot(dx, dy) < threshold) return
      moved = true
      document.body.style.userSelect = 'none'
      if (h.cursor) document.body.style.cursor = h.cursor
      h.onStart?.()
    }
    h.onMove(dx, dy, ev)
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.style.userSelect = prevSelect
    document.body.style.cursor = prevCursor
    h.onEnd?.(moved, ev)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/** Ruler tick spacing: the smallest step from a friendly ladder that keeps labels >= ~84 px apart. */
export function rulerStep(pps: number): { major: number; minor: number } {
  const ladder = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const major = ladder.find((s) => s * pps >= 84) ?? 600
  const minor = major / (major === 0.1 || major === 1 || major === 10 || major === 60 ? 5 : major === 15 ? 3 : 4)
  return { major, minor: major === 0.2 ? 0.1 : minor }
}

export function rulerLabel(t: number, major: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  if (major < 1) return `${m}:${s.toFixed(1).padStart(4, '0')}`
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`
}
