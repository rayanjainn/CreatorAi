'use client'

import { memo } from 'react'
import { AudioLines, Captions, Music, PanelBottom, Type, Megaphone, Mic } from 'lucide-react'
import { LayerBadge } from '../layer-badge'
import { Waveform } from './waveform'
import { durationOf, type AudioItem, type CaptionItem, type OverlayItem } from '@/lib/timeline'
import type { EditAsset } from '@/lib/editor/types'

type Layer = CaptionItem | OverlayItem | AudioItem
const isAudio = (i: Layer): i is AudioItem => 'asset_id' in i && 'gain_db' in i
const isCaption = (i: Layer): i is CaptionItem => 'words' in i

export const LayerClip = memo(function LayerClip({
  item,
  track,
  lane,
  laneH,
  pps,
  selected,
  locked,
  asset,
  hidden,
  onPointerDown,
  onKeyDown,
  onResizeDown,
}: {
  item: Layer
  track: 'captions' | 'overlays' | 'audio'
  lane: number
  laneH: number
  pps: number
  selected: boolean
  locked: boolean
  asset?: EditAsset
  hidden: boolean
  onPointerDown: (e: React.PointerEvent, item: Layer) => void
  onKeyDown: (e: React.KeyboardEvent, id: string) => void
  onResizeDown: (e: React.PointerEvent, item: Layer, edge: 'start' | 'end') => void
}) {
  const len = isAudio(item) ? durationOf(item) : item.tl_end - item.tl_start
  const width = Math.max(8, len * pps)
  const h = laneH - 6
  const kind = isAudio(item) ? item.kind : isCaption(item) ? 'caption' : item.kind
  const label = isAudio(item) ? (asset?.filename ?? 'Audio') : item.text || (kind === 'sponsor_card' ? 'Sponsor card' : '…')
  const Icon = isCaption(item) ? Captions : isAudio(item) ? (item.kind === 'music' ? Music : item.kind === 'voiceover' ? Mic : AudioLines) : item.kind === 'lower_third' ? PanelBottom : item.kind === 'sponsor_card' ? Megaphone : Type
  return (
    <div
      className={`tl-clip tl-layer tl-${track}`}
      data-testid={`tl-${track === 'captions' ? 'caption' : track === 'overlays' ? 'overlay' : 'audio'}-item`}
      data-id={item.id}
      data-kind={kind}
      data-status={item.status}
      data-source={item.source}
      data-selected={selected}
      data-locked={locked}
      data-hidden={hidden}
      style={{ left: item.tl_start * pps, width, top: lane * laneH + 3, height: h }}
      onPointerDown={(e) => onPointerDown(e, item)}
      onKeyDown={(e) => onKeyDown(e, item.id)}
      role="button"
      tabIndex={0}
      aria-label={`${kind} layer: ${label}, ${item.source === 'ai' ? 'Agent' : 'You'}, ${item.status}`}
      aria-pressed={selected}
    >
      {isAudio(item) && asset && <Waveform energy={asset.energy} windowSec={asset.energy_window_sec} srcIn={item.src_in} srcOut={item.src_out} width={Math.round(width)} height={h} />}
      <div className="tl-layer-row">
        <Icon size={11} aria-hidden />
        <span className="tl-layer-label">{label}</span>
        {isAudio(item) && width > 110 && <span className="tl-chip mono">{item.gain_db > 0 ? '+' : ''}{item.gain_db} dB</span>}
        {width > 96 && <LayerBadge source={item.source} status={item.status} reason={item.reason} compact />}
      </div>
      {!locked && (
        <>
          <span className="tl-handle tl-handle-l" onPointerDown={(e) => onResizeDown(e, item, 'start')} title="Drag to resize" />
          <span className="tl-handle tl-handle-r" onPointerDown={(e) => onResizeDown(e, item, 'end')} title="Drag to resize" />
        </>
      )}
    </div>
  )
})
