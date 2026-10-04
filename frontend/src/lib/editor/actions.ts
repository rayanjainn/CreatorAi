/**
 * Editor commands shared by the toolbar, keyboard shortcuts, inspector and history panel. Each one reads the editor store
 * (and the engine for the playhead), honours track locks and the preview/busy state, and goes through `store.apply` so it is
 * undoable and autosaved.
 */
import {
  acceptAll,
  addAudio,
  addCaption,
  addOverlay,
  addVideoMedia,
  buildSegments,
  deleteItem,
  findItem,
  locate,
  rebuildCaptions,
  reorder,
  setStatus,
  splitItem,
  trimEdge,
  type AnyItem,
  type AudioKind,
  type LayerStatus,
  type OverlayKind,
  type Timeline,
  type TrackName,
  type VideoItem,
} from '@/lib/timeline'
import { useEditor } from '@/stores/editor'
import { toast, useToasts } from '@/stores/toasts'
import { assetDurations, runServerOp } from './controller'
import { getEngine } from './engine-store'

const st = () => useEditor.getState()

export function isLockedTrack(track: TrackName): boolean {
  return st().locked[track]
}

function guard(track: TrackName): boolean {
  if (st().locked[track]) {
    toast.info(`The ${track} track is locked`, 'Unlock it with the lock button next to the track name.')
    return false
  }
  return true
}

export function seekTo(t: number) {
  const e = getEngine()
  if (e) e.seek(t)
  else st().setPlayhead(Math.max(0, Math.min(st().timeline.duration, t)))
}

const trackOfItem = (t: Timeline, id: string) => findItem(t, id)?.track ?? null

/** The video item the playhead is on (preferring a selected one that spans it). */
export function videoUnderPlayhead(): { item: VideoItem; srcTime: number } | null {
  const s = st()
  const loc = locate(buildSegments(s.timeline), s.playhead)
  if (!loc || s.playhead >= s.timeline.duration - 1e-6) return null
  const selected = s.selection.map((id) => findItem(s.timeline, id)).find((h) => h && h.track === 'video' && h.item.id === loc.segment.item.id)
  return { item: (selected?.item as VideoItem) ?? loc.segment.item, srcTime: loc.srcTime }
}

export function splitAtPlayhead(): boolean {
  const s = st()
  if (!guard('video')) return false
  const hit = videoUnderPlayhead()
  if (!hit) {
    toast.info('Nothing to split here', 'Put the playhead inside a video clip, at least 0.1 s from its edges.')
    return false
  }
  const before = new Set(s.timeline.tracks.video.map((v) => v.id))
  let tail: string | null = null
  const ok = s.apply(
    (t) => {
      const out = splitItem(t, s.playhead, { itemId: hit.item.id })
      tail = out.tracks.video.find((v) => !before.has(v.id))?.id ?? null
      return out
    },
    { note: 'Split clip' },
  )
  if (ok && tail) st().select([tail])
  return ok
}

/** Delete the selection (video ripples gapless; captions/overlays/audio just go). */
export function deleteSelection(): boolean {
  const s = st()
  const ids = s.selection.filter((id) => {
    const tr = trackOfItem(s.timeline, id)
    return tr && !s.locked[tr]
  })
  if (!ids.length) {
    if (s.selection.length) toast.info('Locked track', 'Unlock the track to delete its items.')
    return false
  }
  const before = s.timeline
  const ok = s.apply((t) => ids.reduce((acc, id) => deleteItem(acc, id), t), { note: ids.length > 1 ? `Deleted ${ids.length} items` : 'Deleted an item', select: [] })
  if (ok) {
    useToasts.getState().push({
      tone: 'info',
      title: ids.length > 1 ? `Deleted ${ids.length} items` : 'Deleted',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (st().timeline !== before) st().undo()
        },
      },
    })
  }
  return ok
}

/** Cut the selected (or playhead) video item so it starts/ends at the playhead; later items ripple. */
export function trimToPlayhead(edge: 'start' | 'end'): boolean {
  const s = st()
  if (!guard('video')) return false
  const hit = videoUnderPlayhead()
  if (!hit) {
    toast.info('Playhead is not on a clip')
    return false
  }
  const delta = edge === 'start' ? hit.srcTime - hit.item.src_in : hit.srcTime - hit.item.src_out
  if (Math.abs(delta) < 0.1 && edge === 'start') {
    toast.info('Playhead is at the clip start')
    return false
  }
  return s.apply((t) => trimEdge(t, hit.item.id, edge, delta, assetDurations(s.assets)), { note: edge === 'start' ? 'Trim start' : 'Trim end' })
}

export function reorderVideo(id: string, activeIndex: number): boolean {
  const s = st()
  if (!guard('video')) return false
  return s.apply(
    (t) => {
      const rest = t.tracks.video.filter((v) => v.id !== id)
      const act = rest.filter((v) => v.status !== 'rejected')
      const target = activeIndex < act.length ? rest.indexOf(act[activeIndex]) : rest.length
      return reorder(t, id, target)
    },
    { note: 'Reordered clips' },
  )
}

export function setItemStatus(ids: string[], status: LayerStatus): boolean {
  const s = st()
  const ok = ids.filter((id) => {
    const tr = trackOfItem(s.timeline, id)
    return tr && !s.locked[tr]
  })
  if (!ok.length) return false
  return s.apply((t) => ok.reduce((acc, id) => setStatus(acc, id, status), t), { note: `${status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Reset'} ${ok.length > 1 ? `${ok.length} layers` : 'a layer'}` })
}

/** Accept / reject every layer of a kind (the history panel's "Accept all" / "Reject all"). */
export function setGroupStatus(items: AnyItem[], status: LayerStatus): boolean {
  const ids = items.filter((i) => (status === 'rejected' ? i.status !== 'rejected' : i.status !== status && !(status === 'accepted' && i.status === 'accepted'))).map((i) => i.id)
  return setItemStatus(ids, status)
}

export function acceptAllLayers(): boolean {
  const s = st()
  if (!s.timeline.tracks.video.length && !s.timeline.tracks.captions.length) return false
  return s.apply((t) => acceptAll(t), { note: 'Accepted all layers' })
}

export function addOverlayAtPlayhead(kind: OverlayKind): void {
  const s = st()
  if (!guard('overlays')) return
  let id: string | null = null
  const ok = s.apply(
    (t) => {
      const r = addOverlay(t, kind, s.playhead, kind === 'lower_third' ? 'Your name' : 'Your text')
      id = r.id
      return r.timeline
    },
    { note: kind === 'lower_third' ? 'Added a lower third' : 'Added text', select: undefined },
  )
  if (ok && id) st().select([id])
}

export function addCaptionAtPlayhead(): void {
  const s = st()
  if (!guard('captions')) return
  let id: string | null = null
  const ok = s.apply(
    (t) => {
      const r = addCaption(t, s.playhead, 'Your caption')
      id = r.id
      return r.timeline
    },
    { note: 'Added a caption' },
  )
  if (ok && id) st().select([id])
}

export function addAudioLayer(p: { assetId: string; kind: AudioKind; duration: number; at?: number }): void {
  const s = st()
  if (!guard('audio')) return
  let id: string | null = null
  const ok = s.apply(
    (t) => {
      const r = addAudio(t, { assetId: p.assetId, kind: p.kind, at: p.at ?? s.playhead, assetDuration: p.duration })
      id = r.id
      return r.timeline
    },
    { note: `Added ${p.kind}` },
  )
  if (ok && id) st().select([id])
}

/** True when the loaded transcript words cover every source range the timeline now uses (trims may have extended it). */
export function localWordsCoverEverything(): boolean {
  const s = st()
  return s.timeline.tracks.video.every((v) => {
    if (v.status === 'rejected' || !v.asset_id) return true
    const a = s.assets[v.asset_id]
    return !!a && a.word_ranges.some(([lo, hi]) => lo <= v.src_in + 1e-3 && hi >= v.src_out - 1e-3)
  })
}

/** Replace the caption track with captions built from the transcript (Plan 8.9). Local rules when possible, else the server op. */
export async function regenerateCaptions(): Promise<boolean> {
  const s = st()
  if (!guard('captions')) return false
  if (localWordsCoverEverything()) {
    return s.apply(
      (t) =>
        rebuildCaptions(t, (assetId) => s.assets[assetId]?.words ?? [], { source: 'ai', status: 'suggested' }),
      { note: 'Regenerated captions' },
    )
  }
  const res = await runServerOp('rebuild_captions', {}, 'Regenerated captions')
  return !!res
}

export async function tightenPausesOnServer(keepSec: number): Promise<boolean> {
  const before = st().timeline.duration
  const res = await runServerOp('tighten_pauses', { keep_sec: keepSec }, 'Tightened pauses')
  if (res) {
    const saved = before - res.timeline.duration
    toast.success(saved > 0.05 ? `Removed ${saved.toFixed(1)} s of pauses` : 'No pauses to remove', saved > 0.05 ? `The clip is now ${res.timeline.duration.toFixed(1)} s. Undo restores it.` : 'The cut is already tight at this setting.')
  }
  return !!res
}

/** Put a library video or still image on the video track at `at` (default: the playhead). */
export function addVideoAsset(p: { assetId: string; kind: 'video' | 'image'; duration: number | null; at?: number }): boolean {
  const s = st()
  if (!guard('video')) return false
  let id: string | null = null
  const ok = s.apply(
    (t) => {
      const r = addVideoMedia(t, { assetId: p.assetId, kind: p.kind, duration: p.duration, at: p.at ?? s.playhead })
      id = r.id
      return r.timeline
    },
    { note: p.kind === 'image' ? 'Added an image' : 'Added a video' },
  )
  if (ok && id) st().select([id])
  return ok
}
