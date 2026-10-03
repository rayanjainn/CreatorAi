'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AlertTriangle, Pause, Play } from 'lucide-react'
import { mediaUrl } from '@/lib/api/client'
import { formatTimecode } from '@/lib/format'
import { cn } from '@/lib/utils'

export type PlayerHandle = {
  /** Jump to `t` seconds (queued until metadata is loaded). `play` starts playback afterwards. */
  seek: (t: number, play?: boolean) => void
  play: () => void
  pause: () => void
  element: () => HTMLVideoElement | HTMLAudioElement | null
}

export type VideoPlayerProps = {
  /** Signed `/media/...` URL (API origin is added here). Range requests make seeking instant. */
  src: string | null | undefined
  poster?: string | null
  media?: 'video' | 'audio'
  /** Initial position, and the window start when `end` is given. */
  start?: number
  /** Play only `[start, end]` (clip previews): pauses at `end`. */
  end?: number
  autoPlay?: boolean
  /** Show a custom play button + timecode chip instead of native controls (used by compact previews). */
  compact?: boolean
  onTime?: (t: number) => void
  className?: string
  label?: string
}

/**
 * <video>/<audio> on a signed proxy URL. Seeks with `ref.seek(t)`; reports time through `onTime` (4 Hz);
 * can be restricted to a window (clip preview). Shows an honest error panel if the browser cannot decode the file
 * (the proxy is H.264/AAC; Chromium builds without proprietary codecs cannot play it).
 */
export const VideoPlayer = forwardRef<PlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, poster, media = 'video', start = 0, end, autoPlay, compact, onTime, className, label = 'Media player' },
  ref,
) {
  const el = useRef<HTMLVideoElement | null>(null)
  const pending = useRef<{ t: number; play: boolean } | null>(start > 0 ? { t: start, play: !!autoPlay } : null)
  const [time, setTime] = useState(start)
  const [target, setTarget] = useState<number | null>(start > 0 ? start : null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = mediaUrl(src)

  const apply = useCallback((t: number, play: boolean) => {
    const v = el.current
    if (!v) return
    try {
      v.currentTime = Math.max(0, t)
    } catch {
      /* metadata not ready: handled by `pending` */
    }
    setTime(Math.max(0, t))
    if (play) void v.play().catch(() => undefined)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      seek: (t, play = false) => {
        setTarget(t)
        const v = el.current
        if (v && v.readyState >= 1) apply(t, play)
        else {
          pending.current = { t, play }
          setTime(Math.max(0, t))
        }
      },
      play: () => void el.current?.play().catch(() => undefined),
      pause: () => el.current?.pause(),
      element: () => el.current,
    }),
    [apply],
  )

  useEffect(() => {
    setFailed(false)
  }, [url])

  const onLoaded = () => {
    const p = pending.current
    pending.current = null
    if (p) apply(p.t, p.play)
    else if (start > 0) apply(start, !!autoPlay)
  }

  const onTimeUpdate = () => {
    const v = el.current
    if (!v) return
    if (end != null && v.currentTime >= end) {
      v.pause()
      apply(start, false)
      return
    }
    setTime(v.currentTime)
    onTime?.(v.currentTime)
  }

  if (!url) {
    return (
      <div className={cn('player player-empty', className)}>
        <AlertTriangle size={18} aria-hidden /> No playable file yet.
      </div>
    )
  }

  const common = {
    ref: el as never,
    src: url,
    preload: 'metadata' as const,
    onLoadedMetadata: onLoaded,
    onTimeUpdate,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setFailed(true),
    'aria-label': label,
  }

  return (
    <div className={cn('player', media === 'audio' && 'player-audio', compact && 'player-compact', className)} data-testid="player" data-seek-target={target ?? ''}>
      {media === 'video' ? (
        <video {...common} poster={mediaUrl(poster) ?? undefined} controls={!compact} playsInline onClick={compact ? () => (playing ? el.current?.pause() : void el.current?.play()) : undefined} />
      ) : (
        <audio {...common} controls />
      )}
      {media === 'video' && (
        <span className="player-time mono" data-testid="player-time">
          {formatTimecode(time, true)}
        </span>
      )}
      {compact && !failed && (
        <button type="button" className="player-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? el.current?.pause() : void el.current?.play())}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
      )}
      {failed && (
        <div className="player-error" role="alert" data-testid="player-error">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <b>This browser cannot play the preview</b>
            <span>The proxy is H.264/AAC. Chrome, Edge and Safari play it; some Chromium builds do not. The position above still follows your clicks.</span>
          </div>
        </div>
      )}
    </div>
  )
})
