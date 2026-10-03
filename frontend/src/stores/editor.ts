'use client'

import { create } from 'zustand'
import {
  OpError,
  breakCoalescing,
  cloneTimeline,
  deepEqual,
  emptyHistory,
  emptyTimeline,
  findItem,
  recordChange,
  redo as redoHistory,
  undo as undoHistory,
  type History,
  type TrackName,
  type Timeline,
  type Violation,
} from '@/lib/timeline'
import type { EditAsset, EditAssets, EditPayload, RevisionDetail, SaveStatus, Tool } from '@/lib/editor/types'
import { toast } from '@/stores/toasts'

export const ZOOM_MIN = 8
export const ZOOM_MAX = 480

export interface Conflict {
  currentRevision: number
  /** Server updated_at of the latest revision, when the API said so. */
  updatedAt?: string | null
}

export interface EditorState {
  clipId: string | null
  loaded: boolean
  timeline: Timeline
  /** The timeline as it is stored at `revision` on the server (base of a three-way merge). */
  serverTimeline: Timeline
  revision: number
  assets: EditAssets
  selection: string[]
  playhead: number
  playing: boolean
  zoom: number
  tool: Tool
  snap: boolean
  locked: Record<TrackName, boolean>
  /** video: mute sound; audio: mute layers; captions/overlays: hide in the monitor. */
  muted: Record<TrackName, boolean>
  volume: number
  masterMuted: boolean
  history: History<Timeline>
  dirty: boolean
  /** Bumped on every edit, so the autosaver can tell "changed again while saving". */
  version: number
  save: { status: SaveStatus; error?: string; violations?: Violation[]; at?: number; note?: string }
  conflict: Conflict | null
  /** Read-only view of an older revision (header dropdown "Preview"). */
  preview: RevisionDetail | null
  mode: 'edit' | 'preview'
  /** The user's note for the next save (set by actions, e.g. "Split clip"). */
  pendingNote: string
  /** Name of a server operation in flight (the timeline is locked meanwhile). */
  busy: string | null

  load: (payload: EditPayload) => void
  reset: () => void
  /** Apply a pure timeline edit; returns false (and toasts) when the op is refused. */
  apply: (fn: (t: Timeline) => Timeline, opts?: { key?: string; note?: string; select?: string[] | null }) => boolean
  endGesture: () => void
  undo: () => void
  redo: () => void
  /** Replace the timeline with a server result (op / restore / reload), recorded in history unless `fresh`. */
  adopt: (timeline: Timeline, revision: number, opts?: { fresh?: boolean; assets?: EditAssets }) => void
  markSaved: (revision: number, version: number, timeline?: Timeline) => void
  setSave: (s: EditorState['save']) => void
  setConflict: (c: Conflict | null) => void
  mergeAssets: (assets: Record<string, EditAsset>) => void
  setAssets: (assets: EditAssets) => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (ids: string[], additive?: boolean) => void
  toggleSelect: (id: string) => void
  setZoom: (z: number) => void
  setTool: (t: Tool) => void
  setSnap: (s: boolean) => void
  toggleLock: (track: TrackName) => void
  toggleMute: (track: TrackName) => void
  setVolume: (v: number) => void
  toggleMasterMute: () => void
  setPreview: (p: RevisionDetail | null) => void
  setMode: (m: 'edit' | 'preview') => void
  setBusy: (b: string | null) => void
}

const initial = () => ({
  clipId: null as string | null,
  loaded: false,
  timeline: emptyTimeline(),
  serverTimeline: emptyTimeline(),
  revision: 0,
  assets: {} as EditAssets,
  selection: [] as string[],
  playhead: 0,
  playing: false,
  zoom: 60,
  tool: 'select' as Tool,
  snap: true,
  locked: { video: false, captions: false, audio: false, overlays: false } as Record<TrackName, boolean>,
  muted: { video: false, captions: false, audio: false, overlays: false } as Record<TrackName, boolean>,
  volume: 1,
  masterMuted: false,
  history: emptyHistory<Timeline>(),
  dirty: false,
  version: 0,
  save: { status: 'saved' as SaveStatus },
  conflict: null as Conflict | null,
  preview: null as RevisionDetail | null,
  mode: 'edit' as const,
  pendingNote: '',
  busy: null as string | null,
})

const ids = (t: Timeline): Set<string> => {
  const s = new Set<string>()
  for (const track of ['video', 'captions', 'audio', 'overlays'] as const) for (const i of t.tracks[track]) s.add(i.id)
  return s
}

export const useEditor = create<EditorState>((set, get) => ({
  ...initial(),

  load: (p) =>
    set({
      ...initial(),
      clipId: p.clip_id,
      loaded: true,
      timeline: p.timeline,
      serverTimeline: p.timeline,
      revision: p.revision,
      assets: p.assets,
      // keep per-viewer view prefs across reloads of the same clip
      zoom: get().clipId === p.clip_id ? get().zoom : initial().zoom,
      locked: get().clipId === p.clip_id ? get().locked : initial().locked,
      muted: get().clipId === p.clip_id ? get().muted : initial().muted,
      volume: get().volume,
      masterMuted: get().masterMuted,
      snap: get().snap,
    }),

  reset: () => set({ ...initial() }),

  apply: (fn, opts = {}) => {
    const s = get()
    if (s.preview) {
      toast.info('Previewing an old revision', 'Go back to the latest version to edit.')
      return false
    }
    if (s.busy) return false
    let next: Timeline
    try {
      next = fn(s.timeline)
    } catch (e) {
      if (e instanceof OpError) {
        toast.warning('Cannot do that', e.message)
        return false
      }
      throw e
    }
    if (deepEqual(next, s.timeline)) return true
    const history = recordChange(s.history, s.timeline, { key: opts.key ?? null })
    const live = ids(next)
    const selection = opts.select === undefined ? s.selection.filter((id) => live.has(id)) : (opts.select ?? [])
    set({
      timeline: next,
      history,
      selection,
      dirty: true,
      version: s.version + 1,
      playhead: Math.min(s.playhead, next.duration),
      pendingNote: s.pendingNote && opts.note && s.pendingNote !== opts.note ? 'Edited timeline' : (opts.note ?? s.pendingNote),
      save: s.save.status === 'conflict' ? s.save : { status: 'unsaved' },
    })
    return true
  },

  endGesture: () => set((s) => ({ history: breakCoalescing(s.history) })),

  undo: () => {
    const s = get()
    if (s.preview || s.busy) return
    const r = undoHistory(s.history, s.timeline)
    if (!r) return
    const live = ids(r.state)
    set({ timeline: r.state, history: r.history, selection: s.selection.filter((id) => live.has(id)), dirty: true, version: s.version + 1, playhead: Math.min(s.playhead, r.state.duration), pendingNote: 'Undo', save: s.save.status === 'conflict' ? s.save : { status: 'unsaved' } })
  },
  redo: () => {
    const s = get()
    if (s.preview || s.busy) return
    const r = redoHistory(s.history, s.timeline)
    if (!r) return
    const live = ids(r.state)
    set({ timeline: r.state, history: r.history, selection: s.selection.filter((id) => live.has(id)), dirty: true, version: s.version + 1, playhead: Math.min(s.playhead, r.state.duration), pendingNote: 'Redo', save: s.save.status === 'conflict' ? s.save : { status: 'unsaved' } })
  },

  adopt: (timeline, revision, opts = {}) => {
    const s = get()
    const live = ids(timeline)
    set({
      timeline,
      serverTimeline: timeline,
      revision,
      assets: opts.assets ?? s.assets,
      history: opts.fresh ? emptyHistory() : recordChange(s.history, s.timeline),
      selection: s.selection.filter((id) => live.has(id)),
      dirty: false,
      version: s.version + 1,
      playhead: Math.min(s.playhead, timeline.duration),
      save: { status: 'saved', at: Date.now() },
      conflict: null,
      preview: null,
      pendingNote: '',
    })
  },

  markSaved: (revision, version, timeline) => {
    const s = get()
    const unchanged = s.version === version
    set({
      revision,
      serverTimeline: timeline ?? s.timeline,
      dirty: !unchanged,
      save: unchanged ? { status: 'saved', at: Date.now() } : { status: 'unsaved' },
      pendingNote: unchanged ? '' : s.pendingNote,
    })
  },

  setSave: (save) => set({ save }),
  setConflict: (conflict) => set({ conflict, save: conflict ? { status: 'conflict' } : get().save }),
  mergeAssets: (assets) => set((s) => ({ assets: { ...s.assets, ...assets } })),
  setAssets: (assets) => set({ assets }),

  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),
  select: (selection, additive) => set((s) => ({ selection: additive ? Array.from(new Set([...s.selection, ...selection])) : selection })),
  toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  setZoom: (z) => set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }),
  setTool: (tool) => set({ tool }),
  setSnap: (snap) => set({ snap }),
  toggleLock: (track) => set((s) => ({ locked: { ...s.locked, [track]: !s.locked[track] } })),
  toggleMute: (track) => set((s) => ({ muted: { ...s.muted, [track]: !s.muted[track] } })),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  toggleMasterMute: () => set((s) => ({ masterMuted: !s.masterMuted })),
  setPreview: (preview) => set({ preview, mode: get().mode, selection: preview ? [] : get().selection }),
  setMode: (mode) => set({ mode }),
  setBusy: (busy) => set({ busy }),
}))

/** The timeline the UI shows: an older revision while previewing, else the working copy. */
export const viewTimeline = (s: EditorState): Timeline => s.preview?.timeline ?? s.timeline

export function selectedItems(s: EditorState) {
  const t = viewTimeline(s)
  return s.selection.map((id) => findItem(t, id)).filter((x): x is NonNullable<typeof x> => !!x)
}

export { cloneTimeline }
