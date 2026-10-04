'use client'

import { CommentsPanel } from '@/components/team/comments-panel'
import { useMemo, useState } from 'react'
import { useResettable } from '@/lib/editor/use-resettable'
import { Check, Clapperboard, Layers, MessageSquare, Music, RotateCcw, Scissors, SlidersHorizontal, Sparkles, Trash2, Type, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/field'
import { Segmented } from '@/components/common/segmented'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LayerBadge } from './layer-badge'
import { NumField, Row, Section, TimeField } from './fields'
import { TextStyleSection } from './text-style-section'
import { Waveform } from './timeline/waveform'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { acceptAllLayers, addCaptionAtPlayhead, deleteSelection, regenerateCaptions, setItemStatus, splitAtPlayhead, tightenPausesOnServer, trimToPlayhead } from '@/lib/editor/actions'
import { assetDurations } from '@/lib/editor/controller'
import {
  durationOf,
  patchLayer,
  setAspect,
  setCaptionStyle,
  setCropX,
  setSourceRange,
  setTransition,
  toggleMusic,
  totals,
  type AudioItem,
  type CaptionItem,
  type CaptionStyle,
  type OverlayItem,
  type VideoItem,
} from '@/lib/timeline'
import { cropPositionX } from '@/lib/timeline'
import { useEditor, viewTimeline } from '@/stores/editor'
import type { Clip } from '@/lib/api/types'

const STYLE_LABEL: Record<CaptionStyle, string> = { bold_center: 'Bold center', minimal_bottom: 'Minimal bottom', karaoke: 'Karaoke' }

export function Inspector({ clip }: { clip?: Clip }) {
  const selection = useEditor((s) => s.selection)
  const timeline = useEditor(viewTimeline)
  const hasSel = selection.length > 0
  // jump to the selection when something gets selected, back to the project when it is cleared
  const [tab, setTab] = useResettable<'selection' | 'project' | 'comments'>(hasSel ? 'selection' : 'project', hasSel)
  const t = totals(timeline)
  return (
    <aside className="inspector" aria-label="Inspector" data-testid="inspector">
      <div className="insp-tabs" role="tablist" aria-label="Inspector">
        <button type="button" role="tab" aria-selected={tab === 'selection'} className={tab === 'selection' ? 'active' : ''} onClick={() => setTab('selection')} data-testid="inspector-tab-selection">
          <SlidersHorizontal size={13} /> Selection {hasSel && <span className="insp-count">{selection.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'active' : ''} onClick={() => setTab('project')} data-testid="inspector-tab-project">
          <Layers size={13} /> Project {t.suggested > 0 && <span className="insp-count amber">{t.suggested}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')} data-testid="inspector-tab-comments">
          <MessageSquare size={13} /> Notes
        </button>
      </div>
      <div className="insp-body">
        {tab === 'selection' ? <SelectionPanel /> : tab === 'comments' ? <EditorComments clip={clip} /> : <ProjectPanel clip={clip} />}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------------------------------------ */
function SelectionPanel() {
  const selection = useEditor((s) => s.selection)
  const timeline = useEditor(viewTimeline)
  const items = useMemo(() => {
    const out: { track: 'video' | 'captions' | 'audio' | 'overlays'; item: VideoItem | CaptionItem | AudioItem | OverlayItem }[] = []
    for (const id of selection) {
      for (const track of ['video', 'captions', 'audio', 'overlays'] as const) {
        const f = (timeline.tracks[track] as { id: string }[]).find((i) => i.id === id)
        if (f) out.push({ track, item: f as never })
      }
    }
    return out
  }, [selection, timeline])
  if (!items.length) return <Hint />
  if (items.length > 1) return <MultiPanel ids={items.map((i) => i.item.id)} count={items.length} />
  const { track, item } = items[0]
  if (track === 'video') return <VideoPanel item={item as VideoItem} />
  if (track === 'captions') return <CaptionPanel item={item as CaptionItem} />
  if (track === 'audio') return <AudioPanel item={item as AudioItem} />
  return <OverlayPanel item={item as OverlayItem} />
}

function Hint() {
  return (
    <div className="insp-hint-card">
      <SlidersHorizontal size={18} />
      <b>Nothing selected</b>
      <p>Click a clip, caption, overlay or audio layer on the timeline to edit it here. Shift-click selects several.</p>
    </div>
  )
}

function useReadOnly(track: 'video' | 'captions' | 'audio' | 'overlays') {
  return useEditor((s) => !!s.preview || !!s.busy || s.viewOnly || s.locked[track])
}

function ItemHead({ icon, title, item, track }: { icon: React.ReactNode; title: string; item: VideoItem | CaptionItem | AudioItem | OverlayItem; track: 'video' | 'captions' | 'audio' | 'overlays' }) {
  const ro = useReadOnly(track)
  const locked = useEditor((s) => s.locked[track])
  return (
    <>
      <div className="insp-head">
        <span className="insp-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <small className="mono">{item.id}</small>
        </div>
        <LayerBadge source={item.source} status={item.status} reason={item.reason} />
      </div>
      {locked && <p className="insp-lock">This track is locked. Unlock it with the lock button on the timeline to edit.</p>}
      <div className="insp-status" data-testid="status-controls" data-status={item.status}>
        {item.status !== 'accepted' && (
          <Button size="sm" disabled={ro} onClick={() => setItemStatus([item.id], 'accepted')} data-testid="accept-item">
            <Check size={13} /> {item.status === 'rejected' ? 'Restore' : 'Accept'}
          </Button>
        )}
        {item.status !== 'rejected' && (
          <Button size="sm" variant="secondary" disabled={ro} onClick={() => setItemStatus([item.id], 'rejected')} data-testid="reject-item">
            <X size={13} /> Reject
          </Button>
        )}
        {item.status === 'accepted' && item.source === 'ai' && (
          <Button size="sm" variant="ghost" disabled={ro} onClick={() => setItemStatus([item.id], 'suggested')} data-testid="unaccept-item" title="Back to suggested">
            <RotateCcw size={13} /> Undo accept
          </Button>
        )}
      </div>
      <div className="insp-reason" data-testid="item-reason">
        <span>{item.source === 'ai' ? 'Why the Agent made this' : 'Made by you'}</span>
        {item.reason ? <p>{item.reason}</p> : <p className="muted">{item.source === 'ai' ? 'The Agent gave no reason.' : 'No reason is recorded for layers you create.'}</p>}
        {item.status === 'rejected' && <p className="insp-note">Rejected layers are left out of the preview and of renders{track === 'video' ? ' and take no timeline time' : ''}.</p>}
      </div>
    </>
  )
}

/* ---- video ----------------------------------------------------------------------------------- */
function VideoPanel({ item }: { item: VideoItem }) {
  const apply = useEditor((s) => s.apply)
  const assets = useEditor((s) => s.assets)
  const aspect = useEditor((s) => s.timeline.aspect)
  const ro = useReadOnly('video')
  const asset = item.asset_id ? assets[item.asset_id] : undefined
  const limit = asset?.duration_sec ?? undefined
  const dur = durationOf(item)
  const durations = useMemo(() => assetDurations(assets), [assets])
  const crop = Math.round(item.crop_x * 100)
  const pos = cropPositionX(item.crop_x, asset?.width, asset?.height, aspect)
  const tr = item.transition_in ?? { type: 'cut' as const, dur: 0 }
  const winPct = aspect === '9:16' && asset?.width && asset?.height ? Math.min(100, ((asset.height * 9) / 16 / asset.width) * 100) : 32
  return (
    <div className="insp-stack" data-testid="inspector-video">
      <ItemHead icon={<Clapperboard size={15} />} title={item.kind === 'sponsor' ? 'Sponsor segment' : 'Video clip'} item={item} track="video" />
      <Section title="Source">
        <Row label="File">
          <span className="truncate insp-file" title={asset?.filename}>{asset?.filename ?? (item.asset_id ? 'Unknown asset' : 'Sponsor placeholder')}</span>
        </Row>
        <Row label="In">
          <TimeField label="Source in" value={item.src_in} min={0} max={item.src_out - 0.1} disabled={ro || item.asset_id === null} onCommit={(v) => apply((t) => setSourceRange(t, item.id, v, item.src_out, durations), { note: 'Trimmed a clip', key: `in:${item.id}` })} testid="in-field" />
        </Row>
        <Row label="Out">
          <TimeField label="Source out" value={item.src_out} min={item.src_in + 0.1} max={limit} disabled={ro || item.asset_id === null} onCommit={(v) => apply((t) => setSourceRange(t, item.id, item.src_in, v, durations), { note: 'Trimmed a clip', key: `out:${item.id}` })} testid="out-field" />
        </Row>
        <Row label="Length">
          <span className="mono insp-ro" data-testid="clip-length">{dur.toFixed(2)} s</span>
        </Row>
        <Row label="On timeline">
          <span className="mono insp-ro">{item.tl_start.toFixed(2)} s</span>
        </Row>
        <div className="insp-btns">
          <Button size="sm" variant="secondary" disabled={ro} onClick={() => trimToPlayhead('start')} title="[ trim the start to the playhead">
            Trim start to playhead
          </Button>
          <Button size="sm" variant="secondary" disabled={ro} onClick={() => trimToPlayhead('end')} title="] trim the end to the playhead">
            Trim end to playhead
          </Button>
        </div>
      </Section>
      <Section title="Reframe (9:16)" aside={aspect === '16:9' ? <small>Not used in 16:9</small> : undefined}>
        <Row label="Crop centre">
          <input type="range" className="slider" min={0} max={100} step={1} value={crop} disabled={ro || item.asset_id === null} aria-label="Crop X" data-testid="crop-slider" onChange={(e) => apply((t) => setCropX(t, item.id, Number(e.target.value) / 100), { key: `crop:${item.id}`, note: 'Moved the crop' })} onPointerUp={() => useEditor.getState().endGesture()} />
          <span className="mono insp-val">{crop}%</span>
        </Row>
        <div className="crop-preview" aria-hidden>
          <div className="crop-src">
            <i style={{ left: `${pos}%`, width: `${winPct}%`, transform: `translateX(-${pos}%)` }} />
          </div>
          <small>The lit window is what the 9:16 frame shows from the source. Face detection set the first guess.</small>
        </div>
      </Section>
      <Section title="Transition in">
        <Row label="Type">
          <Select aria-label="Transition type" value={tr.type} disabled={ro || item.asset_id === null} onChange={(e) => apply((t) => setTransition(t, item.id, { type: e.target.value as 'cut' | 'fade' | 'dissolve', dur: e.target.value === 'cut' ? 0 : tr.dur >= 0.1 ? tr.dur : 0.3 }), { note: 'Changed a transition' })} data-testid="transition-type">
            <option value="cut">Cut</option>
            <option value="fade">Fade</option>
            <option value="dissolve">Dissolve</option>
          </Select>
        </Row>
        {tr.type !== 'cut' && (
          <Row label="Length">
            <input type="range" className="slider" min={0.1} max={0.5} step={0.05} value={tr.dur} disabled={ro} aria-label="Transition length" onChange={(e) => apply((t) => setTransition(t, item.id, { type: tr.type, dur: Number(e.target.value) }), { key: `tr:${item.id}`, note: 'Changed a transition' })} onPointerUp={() => useEditor.getState().endGesture()} />
            <span className="mono insp-val">{tr.dur.toFixed(2)}s</span>
          </Row>
        )}
        <small className="insp-hint-line">Previews show a hard cut; renders overlap the clips for fades and dissolves.</small>
      </Section>
      <div className="insp-btns">
        <Button size="sm" variant="secondary" disabled={ro || item.asset_id === null} onClick={() => splitAtPlayhead()}>
          <Scissors size={13} /> Split at playhead
        </Button>
        <Button size="sm" variant="danger" disabled={ro} onClick={() => deleteSelection()} data-testid="delete-item">
          <Trash2 size={13} /> Delete (ripple)
        </Button>
      </div>
    </div>
  )
}

/* ---- captions -------------------------------------------------------------------------------- */
function CaptionPanel({ item }: { item: CaptionItem }) {
  const apply = useEditor((s) => s.apply)
  const projectStyle = useEditor((s) => s.timeline.caption_style)
  const duration = useEditor((s) => s.timeline.duration)
  const ro = useReadOnly('captions')
  const [text, setText] = useResettable(item.text, `${item.id}:${item.text}`)
  const commitText = () => {
    const v = text.replace(/\s+/g, ' ').trim()
    if (!v) return setText(item.text)
    if (v !== item.text) apply((t) => patchLayer(t, item.id, { text: v }), { note: 'Edited a caption', key: `text:${item.id}` })
  }
  return (
    <div className="insp-stack" data-testid="inspector-caption">
      <ItemHead icon={<Type size={15} />} title="Caption" item={item} track="captions" />
      <Section title="Text">
        <Textarea value={text} disabled={ro} rows={3} aria-label="Caption text" onChange={(e) => setText(e.target.value)} onBlur={commitText} data-testid="caption-text" />
        {item.words && item.words.length > 0 && (
          <div className="insp-words" aria-label="Words">
            {item.words.map((w, i) => (
              <span key={i} className="insp-word mono" title={`${w.t0.toFixed(2)} s to ${w.t1.toFixed(2)} s`}>
                {w.w}
              </span>
            ))}
          </div>
        )}
        <small className="insp-hint-line">Word timings drive the karaoke highlight. Changing the number of words re-spreads them evenly.</small>
      </Section>
      <Section title="Timing">
        <Row label="Start">
          <TimeField label="Caption start" value={item.tl_start} min={0} max={item.tl_end - 0.2} disabled={ro} onCommit={(v) => apply((t) => patchLayer(t, item.id, { tl_start: v }), { note: 'Retimed a caption', key: `cs:${item.id}` })} />
        </Row>
        <Row label="End">
          <TimeField label="Caption end" value={item.tl_end} min={item.tl_start + 0.2} max={duration} disabled={ro} onCommit={(v) => apply((t) => patchLayer(t, item.id, { tl_end: v }), { note: 'Retimed a caption', key: `ce:${item.id}` })} />
        </Row>
      </Section>
      <Section title="Style">
        <Row label="Look">
          <Select aria-label="Caption style override" value={item.style_override ?? ''} disabled={ro} onChange={(e) => apply((t) => patchLayer(t, item.id, { style_override: (e.target.value || null) as CaptionStyle | null }), { note: 'Changed a caption style' })} data-testid="style-override">
            <option value="">Project style ({STYLE_LABEL[projectStyle]})</option>
            {(Object.keys(STYLE_LABEL) as CaptionStyle[]).map((s) => (
              <option key={s} value={s}>
                {STYLE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Row>
      </Section>
      <div className="insp-btns">
        <Button size="sm" variant="danger" disabled={ro} onClick={() => deleteSelection()}>
          <Trash2 size={13} /> Delete caption
        </Button>
      </div>
    </div>
  )
}

/* ---- audio ----------------------------------------------------------------------------------- */
function AudioPanel({ item }: { item: AudioItem }) {
  const apply = useEditor((s) => s.apply)
  const assets = useEditor((s) => s.assets)
  const ro = useReadOnly('audio')
  const asset = assets[item.asset_id]
  const durations = useMemo(() => assetDurations(assets), [assets])
  const len = durationOf(item)
  return (
    <div className="insp-stack" data-testid="inspector-audio">
      <ItemHead icon={<Music size={15} />} title={item.kind === 'music' ? 'Music' : item.kind === 'sfx' ? 'Sound effect' : 'Voiceover'} item={item} track="audio" />
      <Section title="Source">
        <Row label="File">
          <span className="truncate insp-file" title={asset?.filename}>{asset?.filename ?? item.asset_id}</span>
        </Row>
        {asset && (
          <div className="insp-wave">
            <Waveform energy={asset.energy} windowSec={asset.energy_window_sec} srcIn={item.src_in} srcOut={item.src_out} width={248} height={42} />
          </div>
        )}
        <Row label="Kind">
          <Select aria-label="Audio kind" value={item.kind} disabled={ro} onChange={(e) => apply((t) => patchLayer(t, item.id, { kind: e.target.value as AudioItem['kind'] }), { note: 'Changed an audio kind' })}>
            <option value="music">Music</option>
            <option value="sfx">Sound effect</option>
            <option value="voiceover">Voiceover</option>
          </Select>
        </Row>
      </Section>
      <Section title="Level">
        <Row label="Gain">
          <input type="range" className="slider" min={-60} max={12} step={1} value={item.gain_db} disabled={ro} aria-label="Gain" data-testid="gain-slider" onChange={(e) => apply((t) => patchLayer(t, item.id, { gain_db: Number(e.target.value) }), { key: `gain:${item.id}`, note: 'Changed the volume' })} onPointerUp={() => useEditor.getState().endGesture()} />
          <NumField label="Gain in dB" value={item.gain_db} min={-60} max={12} step={1} unit="dB" disabled={ro} digits={0} onCommit={(v) => apply((t) => patchLayer(t, item.id, { gain_db: v }), { note: 'Changed the volume', key: `gain:${item.id}` })} testid="gain-field" />
        </Row>
        <small className="insp-hint-line">The preview plays up to 0 dB; a render applies the full gain.</small>
      </Section>
      <Section title="Timing">
        <Row label="Starts at">
          <TimeField label="Audio start on the timeline" value={item.tl_start} min={0} disabled={ro} onCommit={(v) => apply((t) => patchLayer(t, item.id, { tl_start: v }), { note: 'Moved audio', key: `as:${item.id}` })} />
        </Row>
        <Row label="Length">
          <span className="mono insp-ro">{len.toFixed(2)} s</span>
        </Row>
        <Row label="In">
          <span className="mono insp-ro">{item.src_in.toFixed(2)} s</span>
        </Row>
        <Row label="Out">
          <TimeField label="Audio source out" value={item.src_out} min={item.src_in + 0.1} max={asset?.duration_sec ?? undefined} disabled={ro} onCommit={(v) => apply((t) => {
            const out = structuredClone(t)
            const a = out.tracks.audio.find((x) => x.id === item.id)
            if (a) a.src_out = Math.min(Math.round(v * 1000) / 1000, durations[a.asset_id] ?? v)
            return out
          }, { note: 'Resized audio', key: `ao:${item.id}` })} />
        </Row>
      </Section>
      <div className="insp-btns">
        <Button size="sm" variant="danger" disabled={ro} onClick={() => deleteSelection()}>
          <Trash2 size={13} /> Delete layer
        </Button>
      </div>
    </div>
  )
}

/* ---- overlays -------------------------------------------------------------------------------- */
function OverlayPanel({ item }: { item: OverlayItem }) {
  const apply = useEditor((s) => s.apply)
  const duration = useEditor((s) => s.timeline.duration)
  const ro = useReadOnly('overlays')
  const [text, setText] = useResettable(item.text, `${item.id}:${item.text}`)
  return (
    <div className="insp-stack" data-testid="inspector-overlay">
      <ItemHead icon={<Type size={15} />} title={item.kind === 'lower_third' ? 'Lower third' : item.kind === 'sponsor_card' ? 'Sponsor card' : 'Text overlay'} item={item} track="overlays" />
      <Section title="Content">
        <Row label="Type">
          <Select aria-label="Overlay type" value={item.kind} disabled={ro} onChange={(e) => apply((t) => patchLayer(t, item.id, { kind: e.target.value as OverlayItem['kind'] }), { note: 'Changed an overlay type' })}>
            <option value="text">Text</option>
            <option value="lower_third">Lower third</option>
            <option value="sponsor_card">Sponsor card</option>
          </Select>
        </Row>
        <Textarea value={text} rows={2} disabled={ro} aria-label="Overlay text" onChange={(e) => setText(e.target.value)} onBlur={() => text !== item.text && apply((t) => patchLayer(t, item.id, { text }), { note: 'Edited overlay text', key: `otext:${item.id}` })} data-testid="overlay-text" />
        {item.placeholder && <small className="insp-hint-line">A placeholder card: renders as a title card until a real segment is linked.</small>}
      </Section>
      {item.kind !== 'sponsor_card' && <TextStyleSection item={item} disabled={ro} />}
      <Section title="Timing">
        <Row label="Start">
          <TimeField label="Overlay start" value={item.tl_start} min={0} max={item.tl_end - 0.2} disabled={ro} onCommit={(v) => apply((t) => patchLayer(t, item.id, { tl_start: v }), { note: 'Retimed an overlay', key: `os:${item.id}` })} />
        </Row>
        <Row label="End">
          <TimeField label="Overlay end" value={item.tl_end} min={item.tl_start + 0.2} max={duration} disabled={ro} onCommit={(v) => apply((t) => patchLayer(t, item.id, { tl_end: v }), { note: 'Retimed an overlay', key: `oe:${item.id}` })} />
        </Row>
      </Section>
      <div className="insp-btns">
        <Button size="sm" variant="danger" disabled={ro} onClick={() => deleteSelection()}>
          <Trash2 size={13} /> Delete overlay
        </Button>
      </div>
    </div>
  )
}

/* ---- several selected ------------------------------------------------------------------------ */
function MultiPanel({ ids, count }: { ids: string[]; count: number }) {
  const preview = useEditor((s) => !!s.preview || !!s.busy || s.viewOnly)
  return (
    <div className="insp-stack" data-testid="inspector-multi">
      <div className="insp-head">
        <span className="insp-icon">
          <Layers size={15} />
        </span>
        <div>
          <h3>{count} layers selected</h3>
          <small>Shift-click to add or remove</small>
        </div>
      </div>
      <div className="insp-btns">
        <Button size="sm" disabled={preview} onClick={() => setItemStatus(ids, 'accepted')}>
          <Check size={13} /> Accept
        </Button>
        <Button size="sm" variant="secondary" disabled={preview} onClick={() => setItemStatus(ids, 'rejected')}>
          <X size={13} /> Reject
        </Button>
        <Button size="sm" variant="danger" disabled={preview} onClick={() => deleteSelection()}>
          <Trash2 size={13} /> Delete
        </Button>
      </div>
    </div>
  )
}

/* ---- project / global ------------------------------------------------------------------------ */
function ProjectPanel({ clip }: { clip?: Clip }) {
  const provenance = useEditor((s) => s.provenance)
  const timeline = useEditor(viewTimeline)
  const apply = useEditor((s) => s.apply)
  const assets = useEditor((s) => s.assets)
  const ro = useEditor((s) => !!s.preview || !!s.busy || s.viewOnly)
  const busy = useEditor((s) => s.busy)
  const [keep, setKeep] = useState(0.15)
  const [confirm, setConfirm] = useState(false)
  const [clearOverrides, setClearOverrides] = useState(false)
  const t = totals(timeline)
  const hasMusic = timeline.tracks.audio.some((a) => a.kind === 'music')
  const musicOn = timeline.tracks.audio.some((a) => a.kind === 'music' && a.status !== 'rejected')
  const silences = Object.values(assets).reduce((n, a) => n + a.silences.length, 0)
  const hasVideo = timeline.tracks.video.length > 0
  const overrides = timeline.tracks.captions.filter((c) => c.style_override).length
  return (
    <div className="insp-stack" data-testid="inspector-project">
      <div className="insp-head">
        <span className="insp-icon">
          <Layers size={15} />
        </span>
        <div>
          <h3>{clip ? clip.title.replace(/^\[DEMO\]\s*/i, '') : 'Project'}</h3>
          <small>
            {timeline.aspect} · {timeline.width}×{timeline.height} · {timeline.duration.toFixed(1)} s
          </small>
        </div>
      </div>
      {provenance && (
        <div className="insp-prov">
          <span>Clip copy &amp; score</span>
          <ProvenanceBadge source={provenance.source as never} provider={provenance.provider} model={provenance.model} />
        </div>
      )}
      <Section title="Layers" aside={t.suggested > 0 ? <span className="insp-pill amber">{t.suggested} to review</span> : <span className="insp-pill green">All reviewed</span>}>
        <div className="insp-stats">
          <div>
            <b>{t.ai}</b>
            <span>by the Agent</span>
          </div>
          <div>
            <b>{t.user}</b>
            <span>by you</span>
          </div>
          <div>
            <b>{t.rejected}</b>
            <span>rejected</span>
          </div>
        </div>
        <Button size="sm" disabled={ro || t.suggested === 0} onClick={() => acceptAllLayers()} data-testid="accept-all-project">
          <Check size={13} /> Accept all suggested ({t.suggested})
        </Button>
      </Section>
      <Section title="Format">
        <Row label="Aspect" stacked>
          <Segmented<'9:16' | '16:9'> label="Aspect ratio" value={timeline.aspect} onChange={(v) => apply((tl) => setAspect(tl, v), { note: `Aspect ${v}` })} options={[{ value: '9:16', label: '9:16 vertical' }, { value: '16:9', label: '16:9 wide' }]} />
        </Row>
        <small className="insp-hint-line">
          {timeline.width}×{timeline.height}. Presets set their own size when you export; this is the editing canvas.
        </small>
      </Section>
      <Section title="Captions">
        <Row label="Style" stacked>
          <Segmented<CaptionStyle> label="Caption style" value={timeline.caption_style} onChange={(v) => apply((tl) => setCaptionStyle(tl, v, { clearOverrides }), { note: `Caption style ${STYLE_LABEL[v]}` })} options={(Object.keys(STYLE_LABEL) as CaptionStyle[]).map((s) => ({ value: s, label: STYLE_LABEL[s] }))} />
        </Row>
        <label className="insp-check">
          <input type="checkbox" checked={clearOverrides} onChange={(e) => setClearOverrides(e.target.checked)} />
          <span>Also reset per-caption style overrides{overrides ? ` (${overrides})` : ''}</span>
        </label>
        <Button size="sm" variant="secondary" disabled={ro || !hasVideo || !!busy} loading={busy === 'rebuild_captions'} onClick={() => (timeline.tracks.captions.length ? setConfirm(true) : void regenerateCaptions())} data-testid="regenerate-captions">
          <WandSparkles size={13} /> Regenerate captions
        </Button>
        <Button size="sm" variant="ghost" disabled={ro || !hasVideo} onClick={() => addCaptionAtPlayhead()}>
          <Type size={13} /> Add a caption at the playhead
        </Button>
        <small className="insp-hint-line">Built from the transcript with the same rules as the server: 3 words a line (7 for minimal), 2 s at most. The new captions are Agent suggestions.</small>
      </Section>
      <Section title="Pauses">
        <Row label="Keep">
          <input type="range" className="slider" min={0.05} max={0.4} step={0.05} value={keep} onChange={(e) => setKeep(Number(e.target.value))} aria-label="Pause to keep" />
          <span className="mono insp-val">{keep.toFixed(2)}s</span>
        </Row>
        <Button size="sm" variant="secondary" disabled={ro || !hasVideo || silences === 0} loading={busy === 'tighten_pauses'} onClick={() => void tightenPausesOnServer(keep)} data-testid="tighten-pauses">
          <Sparkles size={13} /> Tighten pauses
        </Button>
        <small className="insp-hint-line">{silences === 0 ? 'No silences were detected in this footage.' : `${silences} silences detected. Runs on the server and saves a revision; undo brings the pauses back.`}</small>
      </Section>
      <Section title="Music">
        <div className="insp-toggle">
          <div>
            <b>{hasMusic ? (musicOn ? 'Music is on' : 'Music is off') : 'No music layer'}</b>
            <small>{hasMusic ? 'Accept or reject every music layer at once.' : 'Add music from your library with the music button in the timeline toolbar.'}</small>
          </div>
          <Button size="sm" variant="secondary" disabled={ro || !hasMusic} onClick={() => apply((tl) => toggleMusic(tl, !musicOn), { note: musicOn ? 'Music off' : 'Music on' })} data-testid="toggle-music">
            {musicOn ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </Section>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Replace the captions?"
        description="This rebuilds every caption from the transcript, replacing the ones on the timeline, including any you edited. You can undo it."
        confirmLabel="Regenerate"
        onConfirm={() => {
          setConfirm(false)
          void regenerateCaptions()
        }}
      />
    </div>
  )
}


function EditorComments({ clip }: { clip?: Clip }) {
  const playhead = useEditor((s) => s.playhead)
  if (!clip) return null
  return <CommentsPanel itemId={clip.content_item_id} clipId={clip.id} atSec={playhead} onSeek={(t) => useEditor.getState().setPlayhead(t)} />
}
