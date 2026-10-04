import { api, unwrap } from '@/lib/api/client'
import { normalizeTimeline, toApiTimeline, type Timeline } from '@/lib/timeline'
import type { EditAsset, EditAssets, EditPayload, OpResult, RevisionDetail, RevisionSummary, Saved } from './types'

function toAsset(raw: Record<string, unknown>, ranges: [number, number][]): EditAsset {
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    filename: String(raw.filename ?? ''),
    kind: String(raw.kind ?? ''),
    duration_sec: num(raw.duration_sec),
    width: num(raw.width),
    height: num(raw.height),
    proxy_url: str(raw.proxy_url),
    audio_url: str(raw.audio_url),
    thumb_url: str(raw.thumb_url),
    energy: Array.isArray(raw.energy) ? (raw.energy as number[]) : [],
    energy_window_sec: num(raw.energy_window_sec) ?? 0.5,
    silences: Array.isArray(raw.silences) ? (raw.silences as [number, number][]) : [],
    words: Array.isArray(raw.words) ? (raw.words as EditAsset['words']) : [],
    word_ranges: ranges,
  }
}

/** Per-asset info; `timeline` tells which source ranges the transcript words cover. */
export function toAssets(raw: Record<string, Record<string, unknown>>, timeline: Timeline): EditAssets {
  return Object.fromEntries(
    Object.entries(raw).map(([id, v]) => [
      id,
      toAsset(
        v,
        timeline.tracks.video.filter((x) => x.asset_id === id).map((x) => [x.src_in, x.src_out] as [number, number]),
      ),
    ]),
  )
}

export async function fetchEdit(clipId: string): Promise<EditPayload> {
  const d = await unwrap(api.GET('/api/v1/clips/{clip_id}/edit', { params: { path: { clip_id: clipId } } }))
  const timeline = normalizeTimeline(d.timeline)
  return {
    clip_id: d.clip_id,
    edit_id: d.edit_id,
    revision: d.revision,
    timeline,
    updated_at: d.updated_at,
    assets: toAssets(d.assets, timeline),
    violations: (d.violations ?? []) as EditPayload['violations'],
    provenance: d.provenance,
  }
}

export async function saveEdit(clipId: string, timeline: Timeline, baseRevision: number, note: string): Promise<Saved> {
  const d = await unwrap(api.PUT('/api/v1/clips/{clip_id}/edit', { params: { path: { clip_id: clipId } }, body: { timeline: toApiTimeline(timeline), base_revision: baseRevision, note } }))
  return { revision: d.revision, timeline: normalizeTimeline(d.timeline), updated_at: d.updated_at }
}

export async function applyServerOp(clipId: string, op: string, params: Record<string, unknown>, baseRevision: number, note: string): Promise<OpResult> {
  const d = await unwrap(api.POST('/api/v1/clips/{clip_id}/edit/ops', { params: { path: { clip_id: clipId } }, body: { op, params, base_revision: baseRevision, note } }))
  return { op: d.op, revision: d.revision, timeline: normalizeTimeline(d.timeline), updated_at: d.updated_at, changed_layers: d.changed_layers as OpResult['changed_layers'] }
}

export async function fetchRevisions(clipId: string): Promise<RevisionSummary[]> {
  return unwrap(api.GET('/api/v1/clips/{clip_id}/edit/revisions', { params: { path: { clip_id: clipId } } })) as Promise<RevisionSummary[]>
}

export async function fetchRevision(clipId: string, revision: number): Promise<RevisionDetail> {
  const d = await unwrap(api.GET('/api/v1/clips/{clip_id}/edit/revisions/{revision}', { params: { path: { clip_id: clipId, revision } } }))
  return { revision: d.revision, note: d.note, created_at: d.created_at, timeline: normalizeTimeline(d.timeline) }
}

export async function restoreRevision(clipId: string, revision: number, baseRevision: number): Promise<Saved> {
  const d = await unwrap(
    api.POST('/api/v1/clips/{clip_id}/edit/revisions/{revision}/restore', { params: { path: { clip_id: clipId, revision } }, body: { base_revision: baseRevision } }),
  )
  return { revision: d.revision, timeline: normalizeTimeline(d.timeline), updated_at: d.updated_at }
}

/** Build the editor's per-asset info from a library asset (used when a new audio asset is added to the timeline). */
export function assetToEditAsset(d: {
  filename: string
  kind: string
  duration_sec: number | null
  width: number | null
  height: number | null
  thumb_url: string | null
  urls: { original?: string | null; proxy?: string | null; thumb?: string | null; audio?: string | null }
  analysis: Record<string, unknown>
}): EditAsset {
  const energy = Array.isArray(d.analysis.energy) ? (d.analysis.energy as number[]) : []
  const silences = Array.isArray(d.analysis.silences) ? (d.analysis.silences as [number, number][]) : []
  return {
    filename: d.filename,
    kind: d.kind,
    duration_sec: d.duration_sec,
    width: d.width,
    height: d.height,
    proxy_url: d.urls.proxy ?? null,
    audio_url: d.urls.audio ?? (d.kind === 'audio' ? (d.urls.original ?? null) : null),
    thumb_url: d.thumb_url ?? d.urls.thumb ?? null,
    image_url: d.kind === 'image' ? (d.urls.original ?? null) : null,
    energy,
    energy_window_sec: 0.5,
    silences,
    words: [],
    word_ranges: [],
  }
}
