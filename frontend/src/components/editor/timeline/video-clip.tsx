'use client'

import { memo, useMemo } from 'react'
import { Crop, Shuffle } from 'lucide-react'
import { LayerBadge } from '../layer-badge'
import { TRACK_H } from './geometry'
import { durationOf, type VideoItem } from '@/lib/timeline'
import type { Frames } from '@/lib/editor/use-frames'
import type { EditAsset } from '@/lib/editor/types'

const TILE_W = Math.round((TRACK_H.video * 16) / 9)

export const VideoClip = memo(function VideoClip({
  item,
  index,
  pps,
  selected,
  locked,
  trimMode,
  frames,
  asset,
  aspect,
  dragging,
  dx,
  onPointerDown,
  onTrimDown,
}: {
  item: VideoItem
  index: number
  pps: number
  selected: boolean
  locked: boolean
  trimMode: boolean
  frames: Frames
  asset?: EditAsset
  aspect: '9:16' | '16:9'
  dragging: boolean
  dx: number
  onPointerDown: (e: React.PointerEvent, item: VideoItem) => void
  onTrimDown: (e: React.PointerEvent, item: VideoItem, edge: 'start' | 'end') => void
}) {
  const dur = durationOf(item)
  const width = Math.max(8, dur * pps)
  const tiles = useMemo(() => {
    const n = Math.max(1, Math.ceil(width / TILE_W))
    return Array.from({ length: n }, (_, i) => {
      const center = (Math.min(width, (i + 0.5) * TILE_W) / width) * dur
      return frames.frameAt(item.asset_id, item.src_in + Math.min(dur, center))
    })
  }, [width, dur, item.asset_id, item.src_in, frames])
  const ai = item.source === 'ai'
  const placeholder = item.asset_id === null
  return (
    <div
      className="tl-clip tl-video"
      data-testid="tl-video-item"
      data-id={item.id}
      data-status={item.status}
      data-source={item.source}
      data-selected={selected}
      data-locked={locked}
      data-trim={trimMode}
      data-dragging={dragging}
      style={{ left: item.tl_start * pps, width, transform: dragging ? `translateX(${dx}px)` : undefined }}
      onPointerDown={(e) => onPointerDown(e, item)}
      role="button"
      tabIndex={0}
      aria-label={`Video clip ${index + 1}, ${dur.toFixed(1)} seconds, ${ai ? 'Agent' : 'You'}, ${item.status}`}
      aria-pressed={selected}
    >
      <div className="tl-thumbs" aria-hidden>
        {placeholder ? <span className="tl-thumb-ph">Sponsor placeholder</span> : tiles.map((url, i) => <span key={i} style={{ width: TILE_W, backgroundImage: url ? `url(${url})` : undefined }} />)}
      </div>
      <div className="tl-clip-top">
        <span className="tl-clip-name">{item.kind === 'sponsor' ? 'Sponsor' : `Clip ${index + 1}`}</span>
        <span className="tl-clip-dur mono">{dur.toFixed(1)}s</span>
        {width > 96 && <LayerBadge source={item.source} status={item.status} reason={item.reason} compact={width < 150} />}
      </div>
      <div className="tl-clip-bottom">
        {aspect === '9:16' && !placeholder && width > 120 && (
          <span className="tl-chip" title={`Crop centre ${Math.round(item.crop_x * 100)}% across the source width (9:16 reframing)`}>
            <Crop size={10} aria-hidden /> {Math.round(item.crop_x * 100)}%
          </span>
        )}
        {item.transition_in && item.transition_in.type !== 'cut' && (
          <span className="tl-chip tl-chip-trans" title={`${item.transition_in.type} in, ${item.transition_in.dur}s`}>
            <Shuffle size={10} aria-hidden /> {item.transition_in.type} {item.transition_in.dur.toFixed(1)}
          </span>
        )}
        {asset && width > 220 && <span className="tl-chip tl-chip-file">{asset.filename}</span>}
      </div>
      {!locked && (
        <>
          <span className="tl-handle tl-handle-l" data-testid="trim-start" onPointerDown={(e) => onTrimDown(e, item, 'start')} title="Drag to trim the start (later clips ripple)" />
          <span className="tl-handle tl-handle-r" data-testid="trim-end" onPointerDown={(e) => onTrimDown(e, item, 'end')} title="Drag to trim the end (later clips ripple)" />
        </>
      )}
    </div>
  )
})
