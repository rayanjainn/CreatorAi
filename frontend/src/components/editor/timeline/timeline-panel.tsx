'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Maximize2, Volume2, VolumeX, ZoomIn, ZoomOut, Ban } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { TimelineToolbar } from './toolbar'
import { Ruler } from './ruler'
import { VideoClip } from './video-clip'
import { LayerClip } from './layer-clip'
import { AudioPicker } from './audio-picker'
import { HEADER_W, MAX_PPS, MIN_PPS, RULER_H, SNAP_PX, TRACK_H, TRACK_LABEL, TRACK_ORDER, startDrag } from './geometry'
import { assetDurations } from '@/lib/editor/controller'
import { reorderVideo, seekTo } from '@/lib/editor/actions'
import type { Frames } from '@/lib/editor/use-frames'
import {
  durationOf,
  moveLayer,
  packLanes,
  resizeLayer,
  snapPoints,
  snapTo,
  trimEdge,
  type AudioItem,
  type CaptionItem,
  type OverlayItem,
  type Timeline,
  type TrackName,
  type VideoItem,
} from '@/lib/timeline'
import { useEditor, viewTimeline } from '@/stores/editor'
import { clock } from '@/lib/timeline'

type Layer = CaptionItem | OverlayItem | AudioItem

export function TimelinePanel({ frames }: { frames: Frames }) {
  const timeline = useEditor(viewTimeline)
  const assets = useEditor((s) => s.assets)
  const selection = useEditor((s) => s.selection)
  const pps = useEditor((s) => s.zoom)
  const tool = useEditor((s) => s.tool)
  const locked = useEditor((s) => s.locked)
  const muted = useEditor((s) => s.muted)
  const readOnly = useEditor((s) => !!s.preview || !!s.busy)
  const setZoom = useEditor((s) => s.setZoom)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [drag, setDrag] = useState<{ id: string; dx: number; drop: number } | null>(null)
  const fitted = useRef<string | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const sel = useMemo(() => new Set(selection), [selection])
  const duration = timeline.duration
  const contentW = Math.max(viewW, HEADER_W + duration * pps + 180)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!viewW || duration <= 0) return
    setZoom(Math.max(MIN_PPS, Math.min(MAX_PPS, (viewW - HEADER_W - 70) / duration)))
    if (scroller.current) scroller.current.scrollLeft = 0
  }, [viewW, duration, setZoom])

  // fit once per loaded clip, as soon as we know both the width and the duration
  const clipId = useEditor((s) => s.clipId)
  useEffect(() => {
    if (clipId && viewW > 0 && duration > 0 && fitted.current !== clipId) {
      fitted.current = clipId
      fit()
    }
  }, [clipId, viewW, duration, fit])

  const getTime = useCallback(
    (clientX: number) => {
      const rect = content.current?.getBoundingClientRect()
      return rect ? (clientX - rect.left - HEADER_W) / useEditor.getState().zoom : 0
    },
    [],
  )

  // ctrl/cmd + wheel zooms around the cursor
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const s = useEditor.getState()
      const tAt = getTime(e.clientX)
      const next = Math.max(MIN_PPS, Math.min(MAX_PPS, s.zoom * Math.exp(-e.deltaY * 0.0025)))
      const rect = el.getBoundingClientRect()
      pendingScroll.current = HEADER_W + tAt * next - (e.clientX - rect.left)
      s.setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [getTime])

  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scroller.current) {
      scroller.current.scrollLeft = Math.max(0, pendingScroll.current)
      pendingScroll.current = null
    }
  }, [pps])

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const move = (clientX: number, alt: boolean) => {
      const s = useEditor.getState()
      const d = viewTimeline(s).duration
      let t = Math.max(0, Math.min(d, getTime(clientX)))
      if (s.snap && !alt) {
        const near = snapTo(t, snapPoints(viewTimeline(s)), SNAP_PX / s.zoom)
        if (near !== null) t = near
      }
      seekTo(t)
    }
    move(e.clientX, e.altKey)
    startDrag(e, { threshold: 0, onMove: (_dx, _dy, ev) => move(ev.clientX, ev.altKey) })
  }

  const select = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) => {
    const s = useEditor.getState()
    if (e.shiftKey || e.metaKey || e.ctrlKey) s.toggleSelect(id)
    else if (!s.selection.includes(id) || s.selection.length > 1) s.select([id])
  }
  /** Enter / Space select the focused item (keyboard access to the timeline). */
  const onItemKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    select(e, id)
  }

  /* ---- video: reorder by dragging the body ------------------------------------------------ */
  const activeVideo = useMemo(() => timeline.tracks.video.filter((v) => v.status !== 'rejected'), [timeline])
  const onVideoDown = (e: React.PointerEvent, item: VideoItem) => {
    if (e.button !== 0) return
    e.stopPropagation()
    select(e, item.id)
    const s = useEditor.getState()
    if (s.preview || s.busy || s.locked.video || s.tool === 'trim' || e.shiftKey || e.metaKey || e.ctrlKey) return
    const list = activeVideo
    const from = list.findIndex((v) => v.id === item.id)
    if (from < 0 || list.length < 2) return
    const bounds = [...list.map((v) => v.tl_start), list[list.length - 1].tl_start + durationOf(list[list.length - 1])]
    const nearest = (clientX: number) => {
      const t = getTime(clientX)
      let best = 0
      bounds.forEach((b, i) => {
        if (Math.abs(b - t) < Math.abs(bounds[best] - t)) best = i
      })
      return best
    }
    let drop = from
    startDrag(e, {
      threshold: 6,
      cursor: 'grabbing',
      onMove: (dx, _dy, ev) => {
        drop = nearest(ev.clientX)
        setDrag({ id: item.id, dx, drop })
      },
      onEnd: (moved) => {
        setDrag(null)
        if (!moved) return
        if (drop === from || drop === from + 1) return
        reorderVideo(item.id, drop > from ? drop - 1 : drop)
      },
    })
  }

  /* ---- video: trim handles ------------------------------------------------------------------ */
  const onTrimDown = (e: React.PointerEvent, item: VideoItem, edge: 'start' | 'end') => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    useEditor.getState().select([item.id])
    const s0 = useEditor.getState()
    if (s0.preview || s0.busy || s0.locked.video) return
    const snapshot = s0.timeline
    const durations = assetDurations(s0.assets)
    const base = edge === 'start' ? item.tl_start : item.tl_start + durationOf(item)
    startDrag(e, {
      threshold: 2,
      cursor: 'col-resize',
      onMove: (dx, _dy, ev) => {
        const s = useEditor.getState()
        let d = dx / s.zoom
        if (s.snap && !ev.altKey) {
          const near = snapTo(base + d, [s.playhead], SNAP_PX / s.zoom)
          if (near !== null) d = near - base
        }
        s.apply(() => trimEdge(snapshot, item.id, edge, d, durations), { key: `trim:${item.id}:${edge}`, note: 'Trimmed a clip' })
      },
      onEnd: () => useEditor.getState().endGesture(),
    })
  }

  /* ---- captions / overlays / audio: move and resize ---------------------------------------- */
  const onLayerDown = (e: React.PointerEvent, item: Layer, track: TrackName) => {
    if (e.button !== 0) return
    e.stopPropagation()
    select(e, item.id)
    const s0 = useEditor.getState()
    if (s0.preview || s0.busy || s0.locked[track] || e.shiftKey || e.metaKey || e.ctrlKey) return
    const snapshot = s0.timeline
    const len = 'tl_end' in item ? item.tl_end - item.tl_start : durationOf(item as AudioItem)
    const orig = item.tl_start
    startDrag(e, {
      threshold: 3,
      cursor: 'grabbing',
      onMove: (dx, _dy, ev) => {
        const s = useEditor.getState()
        let start = orig + dx / s.zoom
        if (s.snap && !ev.altKey) {
          const pts = snapPoints(snapshot, { playhead: s.playhead, exclude: item.id })
          const thr = SNAP_PX / s.zoom
          const a = snapTo(start, pts, thr)
          const b = snapTo(start + len, pts, thr)
          if (a !== null) start = a
          else if (b !== null) start = b - len
        }
        s.apply(() => moveLayer(snapshot, item.id, start), { key: `move:${item.id}`, note: 'Moved a layer' })
      },
      onEnd: () => useEditor.getState().endGesture(),
    })
  }
  const onResizeDown = (e: React.PointerEvent, item: Layer, edge: 'start' | 'end', track: TrackName) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    useEditor.getState().select([item.id])
    const s0 = useEditor.getState()
    if (s0.preview || s0.busy || s0.locked[track]) return
    const snapshot = s0.timeline
    const durations = assetDurations(s0.assets)
    startDrag(e, {
      threshold: 2,
      cursor: 'col-resize',
      onMove: (_dx, _dy, ev) => {
        const s = useEditor.getState()
        let t = getTime(ev.clientX)
        if (s.snap && !ev.altKey) {
          const near = snapTo(t, snapPoints(snapshot, { playhead: s.playhead, exclude: item.id }), SNAP_PX / s.zoom)
          if (near !== null) t = near
        }
        s.apply(() => resizeLayer(snapshot, item.id, edge, t, durations), { key: `resize:${item.id}:${edge}`, note: 'Resized a layer' })
      },
      onEnd: () => useEditor.getState().endGesture(),
    })
  }

  const laneBg = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    if (!e.shiftKey) useEditor.getState().select([])
    scrub(e)
  }

  const lanes = useMemo(() => {
    const mk = (items: { id: string; start: number; end: number }[]) => packLanes(items)
    return {
      captions: mk(timeline.tracks.captions.map((c) => ({ id: c.id, start: c.tl_start, end: c.tl_end }))),
      overlays: mk(timeline.tracks.overlays.map((c) => ({ id: c.id, start: c.tl_start, end: c.tl_end }))),
      audio: mk(timeline.tracks.audio.map((a) => ({ id: a.id, start: a.tl_start, end: a.tl_start + durationOf(a) }))),
    }
  }, [timeline])

  const hasVideo = timeline.tracks.video.length > 0
  const counts: Record<TrackName, number> = { video: timeline.tracks.video.length, captions: timeline.tracks.captions.length, audio: timeline.tracks.audio.length, overlays: timeline.tracks.overlays.length }

  return (
    <section className="tl" data-testid="timeline" aria-label="Timeline" data-readonly={readOnly}>
      <TimelineToolbar onAddAudio={() => setPickerOpen(true)} />
      <div className="tl-main">
        <div className="tl-head">
          <div className="tl-head-left">
            <b>Timeline</b>
            <span className="mono tl-dur" data-testid="timeline-duration">{clock(duration)}</span>
            <span className="tl-meta">
              {counts.video} clips · {counts.captions} captions · {counts.audio} audio · {counts.overlays} overlays
            </span>
          </div>
          <div className="tl-zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-button" onClick={() => setZoom(pps / 1.4)} aria-label="Zoom out (-)" title="Zoom out (-)" data-testid="zoom-out">
              <ZoomOut size={15} />
            </button>
            <input type="range" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} aria-label="Zoom level" data-testid="zoom-slider" />
            <button type="button" className="icon-button" onClick={() => setZoom(pps * 1.4)} aria-label="Zoom in (+)" title="Zoom in (+)" data-testid="zoom-in">
              <ZoomIn size={15} />
            </button>
            <button type="button" className="icon-button" onClick={fit} aria-label="Fit the timeline to the window" title="Fit to window" data-testid="zoom-fit">
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline-scroll">
          <div className="tl-content" ref={content} style={{ width: contentW }}>
            <Ruler duration={duration} pps={pps} width={contentW} onPointerDown={scrub} />
            {TRACK_ORDER.map((track) => {
              const lane = track === 'video' ? null : lanes[track]
              const h = track === 'video' ? TRACK_H.video : TRACK_H[track] * (lane?.count ?? 1)
              const meta = TRACK_LABEL[track]
              const isLocked = locked[track]
              return (
                <div className="tl-row" key={track} data-track={track} data-locked={isLocked} data-muted={muted[track]} style={{ height: h }}>
                  <div className="tl-head-cell" style={{ width: HEADER_W }}>
                    <span className="tl-track-code">{meta.code}</span>
                    <span className="tl-track-name">{meta.name}</span>
                    <TrackButtons track={track} />
                  </div>
                  <div className="tl-lane" style={{ left: HEADER_W, width: Math.max(0, contentW - HEADER_W) }} onPointerDown={laneBg} data-testid={`lane-${track}`}>
                    <div className="tl-lane-end" style={{ left: duration * pps }} aria-hidden />
                    {track === 'video' && (
                      <>
                        {timeline.tracks.video.map((v) => {
                          if (v.status === 'rejected') {
                            return (
                              <button
                                key={v.id}
                                type="button"
                                className="tl-ghost"
                                data-testid="tl-rejected-video"
                                data-selected={sel.has(v.id)}
                                style={{ left: v.tl_start * pps }}
                                onPointerDown={(e) => {
                                  e.stopPropagation()
                                  select(e, v.id)
                                }}
                                title={`A rejected cut (${durationOf(v).toFixed(1)} s) sits here. It takes no time. Select it to restore.`}
                                aria-label={`Rejected video clip, ${durationOf(v).toFixed(1)} seconds. Select to restore.`}
                              >
                                <Ban size={11} aria-hidden />
                              </button>
                            )
                          }
                          const idx = activeVideo.indexOf(v)
                          return (
                            <VideoClip
                              key={v.id}
                              item={v}
                              index={idx}
                              pps={pps}
                              selected={sel.has(v.id)}
                              locked={isLocked}
                              trimMode={tool === 'trim'}
                              frames={frames}
                              asset={v.asset_id ? assets[v.asset_id] : undefined}
                              aspect={timeline.aspect}
                              dragging={drag?.id === v.id}
                              dx={drag?.id === v.id ? drag.dx : 0}
                              onPointerDown={onVideoDown}
              onKeyDown={onItemKey}
                              onTrimDown={onTrimDown}
                            />
                          )
                        })}
                        {drag && <div className="tl-drop" style={{ left: (drag.drop < activeVideo.length ? activeVideo[drag.drop].tl_start : timeline.duration) * pps }} aria-hidden />}
                        {!hasVideo && (
                          <div className="tl-empty" data-testid="timeline-empty">
                            This clip has no video yet. Generate clips from the project&apos;s Clips tab, then open one here.
                          </div>
                        )}
                      </>
                    )}
                    {track !== 'video' && counts[track] === 0 && hasVideo && (
                      <div className="tl-lane-hint" aria-hidden>
                        {track === 'audio' ? 'No audio layers. Use the music tool to add some from your library.' : track === 'overlays' ? 'No overlays. Use the text or lower-third tool.' : 'No captions. Regenerate them from the Project tab.'}
                      </div>
                    )}
                    {track !== 'video' &&
                      (track === 'captions' ? timeline.tracks.captions : track === 'overlays' ? timeline.tracks.overlays : timeline.tracks.audio).map((item) => (
                        <LayerClip
                          key={item.id}
                          item={item}
                          track={track}
                          lane={lane!.lanes.get(item.id) ?? 0}
                          laneH={TRACK_H[track]}
                          pps={pps}
                          selected={sel.has(item.id)}
                          locked={isLocked}
                          hidden={(track === 'captions' || track === 'overlays') && muted[track]}
                          asset={'asset_id' in item && item.asset_id ? assets[item.asset_id] : undefined}
                          onPointerDown={(e, it) => onLayerDown(e, it, track)}
                          onKeyDown={onItemKey}
                          onResizeDown={(e, it, edge) => onResizeDown(e, it, edge, track)}
                        />
                      ))}
                  </div>
                </div>
              )
            })}
            <Playhead pps={pps} onScrub={scrub} />
            <FollowPlayhead scroller={scroller} pps={pps} />
          </div>
        </div>
      </div>
      <AudioPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </section>
  )
}

function TrackButtons({ track }: { track: TrackName }) {
  const locked = useEditor((s) => s.locked[track])
  const muted = useEditor((s) => s.muted[track])
  const toggleLock = useEditor((s) => s.toggleLock)
  const toggleMute = useEditor((s) => s.toggleMute)
  const sound = track === 'video' || track === 'audio'
  const muteLabel = sound ? (muted ? `Unmute ${track}` : `Mute ${track}`) : muted ? `Show ${track} in the monitor` : `Hide ${track} in the monitor`
  const MuteIcon = sound ? (muted ? VolumeX : Volume2) : muted ? EyeOff : Eye
  return (
    <span className="tl-track-btns">
      <Tooltip content={muteLabel}>
        <button type="button" className="tl-mini" aria-pressed={muted} onClick={() => toggleMute(track)} aria-label={muteLabel} data-testid={`mute-${track}`}>
          <MuteIcon size={12} />
        </button>
      </Tooltip>
      <Tooltip content={locked ? `Unlock ${track}` : `Lock ${track} (no edits)`}>
        <button type="button" className="tl-mini" aria-pressed={locked} onClick={() => toggleLock(track)} aria-label={locked ? `Unlock ${track}` : `Lock ${track}`} data-testid={`lock-${track}`}>
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </Tooltip>
    </span>
  )
}

/** Keeps the playhead in view while playing (its own component so the 60 fps playhead does not re-render the timeline). */
function FollowPlayhead({ scroller, pps }: { scroller: React.RefObject<HTMLDivElement | null>; pps: number }) {
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = HEADER_W + playhead * pps
    if (x < el.scrollLeft + HEADER_W || x > el.scrollLeft + el.clientWidth - 40) el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.3) })
  }, [playhead, playing, pps, scroller])
  return null
}

function Playhead({ pps, onScrub }: { pps: number; onScrub: (e: React.PointerEvent) => void }) {
  const t = useEditor((s) => s.playhead)
  return (
    <div className="tl-playhead" style={{ transform: `translateX(${HEADER_W + t * pps}px)`, top: 0 }} data-testid="playhead" data-time={t.toFixed(3)}>
      <span className="tl-playhead-head" onPointerDown={onScrub} style={{ height: RULER_H }} aria-hidden />
    </div>
  )
}

export type { Timeline }
