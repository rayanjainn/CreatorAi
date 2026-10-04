'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { mediaUrl } from '@/lib/api/client'
import { PlaybackEngine, type MediaLike } from '@/lib/editor/engine'
import { useEngine } from '@/lib/editor/engine-store'
import type { Frames } from '@/lib/editor/use-frames'
import {
  captionStyleOf,
  captionsAt,
  cropPositionX,
  karaokeIndex,
  locate,
  buildSegments,
  overlaysAt,
  patchLayer,
  timecode,
  type CaptionItem,
  type OverlayItem,
  type Timeline,
  type VideoItem,
} from '@/lib/timeline'
import { useEditor, viewTimeline } from '@/stores/editor'
import { IconButton } from '@/components/ui/button'

/** Program monitor: the timeline played back from the signed proxies, with captions and overlays rendered over it. */
export function Monitor({ frames, large }: { frames: Frames; large?: boolean }) {
  const a = useRef<HTMLVideoElement>(null)
  const b = useRef<HTMLVideoElement>(null)
  const timeline = useEditor(viewTimeline)
  const assets = useEditor((s) => s.assets)
  const volume = useEditor((s) => s.volume)
  const masterMuted = useEditor((s) => s.masterMuted)
  const mutedVideo = useEditor((s) => s.muted.video)
  const mutedAudio = useEditor((s) => s.muted.audio)
  const engineState = useEngine((s) => s.state)
  const engine = useEngine((s) => s.engine)

  // one engine for the lifetime of the monitor
  useEffect(() => {
    if (!a.current || !b.current) return
    const eng = new PlaybackEngine(a.current as unknown as MediaLike, b.current as unknown as MediaLike, {
      createAudio: () => {
        const el = new Audio()
        el.preload = 'auto'
        return el as unknown as MediaLike
      },
      resolveUrl: (u) => mediaUrl(u) ?? u,
    })
    const offT = eng.onTime((t) => useEditor.getState().setPlayhead(t))
    const offS = eng.onState((s) => {
      useEngine.setState({ state: s })
      if (useEditor.getState().playing !== s.playing) useEditor.getState().setPlaying(s.playing)
    })
    useEngine.setState({ engine: eng, state: eng.getState() })
    return () => {
      offT()
      offS()
      eng.destroy()
      useEngine.setState({ engine: null, state: null })
    }
  }, [])

  useEffect(() => {
    engine?.setTimeline(timeline, assets)
  }, [engine, timeline, assets])

  useEffect(() => {
    engine?.setVolume(masterMuted ? 0 : volume, masterMuted || mutedVideo, masterMuted || mutedAudio)
  }, [engine, volume, masterMuted, mutedVideo, mutedAudio])

  const items = useMemo(() => new Map(timeline.tracks.video.map((v) => [v.id, v])), [timeline])
  const slotStyle = (i: 0 | 1) => {
    const it = engineState?.slots[i].itemId ? items.get(engineState.slots[i].itemId as string) : undefined
    const asset = it?.asset_id ? assets[it.asset_id] : undefined
    return { objectPosition: `${it ? cropPositionX(it.crop_x, asset?.width, asset?.height, timeline.aspect) : 50}% 50%` }
  }
  const activeSlot = engineState?.activeSlot ?? 0

  return (
    <section className={`monitor ${large ? 'monitor-large' : ''}`} aria-label="Program monitor" data-testid="monitor">
      <div className="monitor-stage">
        <div className="monitor-frame" data-aspect={timeline.aspect} data-testid="monitor-frame">
          <FrameUnderlay frames={frames} />
          <video ref={a} className="monitor-video" data-slot="0" data-active={activeSlot === 0} style={slotStyle(0)} playsInline preload="auto" aria-hidden tabIndex={-1} />
          <video ref={b} className="monitor-video" data-slot="1" data-active={activeSlot === 1} style={slotStyle(1)} playsInline preload="auto" aria-hidden tabIndex={-1} />
          <SponsorPlaceholder timeline={timeline} />
          <MonitorLayers timeline={timeline} />
          <EngineNotice timeline={timeline} />
        </div>
      </div>
      <Transport timeline={timeline} />
    </section>
  )
}

/** The keyframe (or thumbnail) of the clip under the playhead; stays visible when the browser cannot decode the video. */
function FrameUnderlay({ frames }: { frames: Frames }) {
  const timeline = useEditor(viewTimeline)
  const assets = useEditor((s) => s.assets)
  const playhead = useEditor((s) => s.playhead)
  const segments = useMemo(() => buildSegments(timeline), [timeline])
  const loc = locate(segments, playhead)
  if (!loc) return <div className="monitor-empty" />
  const item = loc.segment.item
  if (item.asset_id === null) return null
  const asset = assets[item.asset_id]
  const url = item.kind === 'image' ? mediaUrl(asset?.image_url ?? asset?.thumb_url ?? null) : frames.frameAt(item.asset_id, loc.srcTime)
  if (!url) return <div className="monitor-empty" />
  return <img className="monitor-underlay" src={url} alt="" style={{ objectPosition: `${cropPositionX(item.crop_x, asset?.width, asset?.height, timeline.aspect)}% 50%` }} draggable={false} />
}

function SponsorPlaceholder({ timeline }: { timeline: Timeline }) {
  const playhead = useEditor((s) => s.playhead)
  const loc = locate(useMemo(() => buildSegments(timeline), [timeline]), playhead)
  const item = loc?.segment.item
  if (!item || item.asset_id !== null) return null
  return (
    <div className="monitor-sponsor" data-testid="sponsor-placeholder">
      <span>Sponsor segment</span>
      <p>{item.text || 'Placeholder: record the segment, then link it.'}</p>
    </div>
  )
}

const MonitorLayers = memo(function MonitorLayers({ timeline }: { timeline: Timeline }) {
  const playhead = useEditor((s) => s.playhead)
  const hideCaptions = useEditor((s) => s.muted.captions)
  const hideOverlays = useEditor((s) => s.muted.overlays)
  const captions = hideCaptions ? [] : captionsAt(timeline, playhead)
  const overlays = hideOverlays ? [] : overlaysAt(timeline, playhead)
  return (
    <>
      {overlays.map((o) => (
        <OverlayView key={o.id} o={o} />
      ))}
      {captions.map((c) => (
        <CaptionView key={c.id} c={c} style={captionStyleOf(c, timeline)} playhead={playhead} landscape={timeline.aspect === '16:9'} />
      ))}
    </>
  )
})

const FONT_STACK: Record<string, string> = {
  montserrat: 'Montserrat, Inter, ui-sans-serif, system-ui, sans-serif',
  inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "DejaVu Serif", "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", monospace',
}

/**
 * A text overlay. With a style it is positioned by its centre (x, y as a share of the frame) and can be dragged with the mouse
 * while it is selected; the same numbers drive the exported video, so what you place is what renders.
 */
function OverlayView({ o }: { o: OverlayItem }) {
  const selected = useEditor((s) => s.selection.includes(o.id))
  const locked = useEditor((s) => !!s.preview || !!s.busy || s.viewOnly || s.locked.overlays)
  const apply = useEditor((s) => s.apply)
  const select = useEditor((s) => s.select)
  const st = o.style
  const styled = !!st && o.kind !== 'sponsor_card'

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!styled) return
    e.stopPropagation()
    select([o.id], e.shiftKey)
    if (locked) return
    const frame = e.currentTarget.closest('.monitor-frame') as HTMLElement | null
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const start = { px: e.clientX, py: e.clientY, x: st!.x, y: st!.y }
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const x = start.x + (ev.clientX - start.px) / rect.width
      const y = start.y + (ev.clientY - start.py) / rect.height
      apply((t) => patchLayer(t, o.id, { style: { x, y } }), { key: `opos:${o.id}`, note: 'Moved text' })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      useEditor.getState().endGesture()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  if (!styled) {
    return (
      <div className={`monitor-overlay mo-${o.kind}`} data-testid="monitor-overlay" data-kind={o.kind}>
        {o.kind === 'sponsor_card' && <small>Sponsor</small>}
        <span>{o.text || (o.kind === 'sponsor_card' ? 'Sponsor card' : '')}</span>
      </div>
    )
  }
  const bgOn = !!st!.bg
  return (
    <div
      className="monitor-overlay mo-styled"
      data-testid="monitor-overlay"
      data-kind={o.kind}
      data-selected={selected}
      data-locked={locked}
      onPointerDown={onPointerDown}
      style={{
        left: `${st!.x * 100}%`,
        top: `${st!.y * 100}%`,
        width: `${st!.width * 100}%`,
        fontFamily: FONT_STACK[st!.font],
        fontSize: `${st!.size * 100}cqh`,
        fontWeight: st!.font === 'inter' ? 500 : 800,
        color: st!.color,
        textAlign: st!.align,
        textShadow: st!.shadow ? '0 0.25cqh 1cqh #000a' : 'none',
      }}
    >
      <span
        style={{
          background: bgOn ? `${st!.bg}${Math.round(st!.bg_opacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
          padding: bgOn ? '0.45em 0.6em' : 0,
        }}
      >
        {o.text}
      </span>
    </div>
  )
}

function CaptionView({ c, style, playhead, landscape }: { c: CaptionItem; style: 'bold_center' | 'minimal_bottom' | 'karaoke'; playhead: number; landscape: boolean }) {
  const idx = style === 'karaoke' ? karaokeIndex(c, playhead) : -1
  const words = style === 'karaoke' && c.words?.length ? c.words : null
  return (
    <div className={`monitor-caption mc-${style}`} data-landscape={landscape} data-testid="monitor-caption" data-style={style}>
      <span>
        {words
          ? words.map((w, i) => (
              <span key={i} className="mc-word" data-on={i <= idx}>
                {w.w}{' '}
              </span>
            ))
          : c.text}
      </span>
    </div>
  )
}

function EngineNotice({ timeline }: { timeline: Timeline }) {
  const state = useEngine((s) => s.state)
  const assets = useEditor((s) => s.assets)
  const playhead = useEditor((s) => s.playhead)
  const loc = locate(useMemo(() => buildSegments(timeline), [timeline]), playhead)
  const item: VideoItem | undefined = loc?.segment.item
  if (!item || item.asset_id === null || item.kind === 'image') return null // a still has nothing to decode
  const asset = assets[item.asset_id]
  if (!asset?.proxy_url) {
    return (
      <div className="monitor-notice" role="status" data-testid="engine-notice" data-kind="no-proxy">
        <AlertTriangle size={14} aria-hidden />
        <div>
          <b>No preview file for this clip</b>
          <span>{asset?.filename ?? 'This asset'} has no proxy video yet. You see a still frame; timecode, captions and overlays still run.</span>
        </div>
      </div>
    )
  }
  if (state?.failedAssets.includes(item.asset_id)) {
    return (
      <div className="monitor-notice" role="status" data-testid="engine-notice" data-kind="decode">
        <AlertTriangle size={14} aria-hidden />
        <div>
          <b>This browser cannot decode the preview video</b>
          <span>Playback is clock-driven: timecode, captions and overlays run over still frames. Chrome, Edge and Safari play the H.264 proxy.</span>
        </div>
      </div>
    )
  }
  return null
}

function Transport({ timeline }: { timeline: Timeline }) {
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  const volume = useEditor((s) => s.volume)
  const masterMuted = useEditor((s) => s.masterMuted)
  const setVolume = useEditor((s) => s.setVolume)
  const toggleMute = useEditor((s) => s.toggleMasterMute)
  const engine = useEngine((s) => s.engine)
  const stalled = useEngine((s) => s.state?.stalled ?? false)
  const empty = timeline.duration <= 0
  const seek = (t: number) => (engine ? engine.seek(t) : useEditor.getState().setPlayhead(t))
  return (
    <div className="transport" role="group" aria-label="Transport">
      <span className="tc mono" data-testid="timecode" aria-label="Current time">
        {timecode(playhead)}
      </span>
      <div className="transport-main">
        <IconButton label="Go to start (Home)" onClick={() => seek(0)} disabled={empty} data-testid="go-start">
          <SkipBack size={15} />
        </IconButton>
        <IconButton label="Back one frame (Left)" onClick={() => engine?.step(-1)} disabled={empty} data-testid="frame-back">
          <ChevronLeft size={16} />
        </IconButton>
        <button type="button" className="play-button" onClick={() => engine?.toggle()} disabled={empty} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title={playing ? 'Pause (Space)' : 'Play (Space)'} data-testid="play-toggle" data-playing={playing} data-stalled={stalled}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <IconButton label="Forward one frame (Right)" onClick={() => engine?.step(1)} disabled={empty} data-testid="frame-forward">
          <ChevronRight size={16} />
        </IconButton>
        <IconButton label="Go to end (End)" onClick={() => seek(timeline.duration)} disabled={empty} data-testid="go-end">
          <SkipForward size={15} />
        </IconButton>
      </div>
      <div className="transport-side">
        <span className="tc tc-total mono" aria-label="Total duration" data-testid="timecode-total">
          {timecode(timeline.duration)}
        </span>
        <IconButton label={masterMuted ? 'Unmute' : 'Mute'} onClick={toggleMute} data-testid="master-mute">
          {masterMuted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </IconButton>
        <input type="range" className="volume" min={0} max={1} step={0.05} value={masterMuted ? 0 : volume} onChange={(e) => (masterMuted && toggleMute(), setVolume(Number(e.target.value)))} aria-label="Volume" />
      </div>
    </div>
  )
}

