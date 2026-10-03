import { Clapperboard, FileText, Image as ImageIcon, Music, type LucideIcon } from 'lucide-react'
import type { Asset, AssetKind } from '@/lib/api/types'

export const KIND_META: Record<AssetKind, { label: string; Icon: LucideIcon }> = {
  video: { label: 'Video', Icon: Clapperboard },
  audio: { label: 'Audio', Icon: Music },
  image: { label: 'Image', Icon: ImageIcon },
  document: { label: 'Document', Icon: FileText },
}

export function kindOf(a: { kind: string }): AssetKind {
  return (a.kind in KIND_META ? a.kind : 'document') as AssetKind
}

/** Stages of `asset.process` in order (backend/app/services/ingest/plan.py). */
export const PIPELINE: { id: string; label: string; hint: string }[] = [
  { id: 'probe', label: 'Probe', hint: 'Read duration, size and streams' },
  { id: 'audio', label: 'Extract audio', hint: 'Pull a clean audio track' },
  { id: 'proxy', label: 'Make proxy', hint: 'Small file for smooth previews' },
  { id: 'silence', label: 'Find silences', hint: 'Detect pauses and loudness' },
  { id: 'transcribe', label: 'Transcribe', hint: 'Speech to text with word times' },
  { id: 'segments', label: 'Build segments', hint: 'Group words into sentences' },
  { id: 'shots', label: 'Detect shots', hint: 'Split the video at scene changes' },
  { id: 'keyframes', label: 'Keyframes', hint: 'One frame per shot' },
  { id: 'caption', label: 'Caption shots', hint: 'Describe what each shot shows (AI)' },
  { id: 'embed', label: 'Index for search', hint: 'Embeddings for semantic search' },
  { id: 'finalize', label: 'Finalize', hint: 'Save and mark ready' },
]

/** The stages that apply to a kind (mirror of `stages_for`). */
export function stagesFor(kind: string, hasAudio = true): typeof PIPELINE {
  let wanted: string[]
  if (kind === 'video') wanted = ['probe', 'proxy', 'shots', 'keyframes', 'caption', 'embed', 'finalize', ...(hasAudio ? ['audio', 'silence', 'transcribe', 'segments'] : [])]
  else if (kind === 'audio') wanted = ['probe', 'audio', 'silence', 'transcribe', 'segments', 'embed', 'finalize']
  else if (kind === 'image') wanted = ['probe', 'keyframes', 'caption', 'embed', 'finalize']
  else wanted = ['probe', 'finalize']
  return PIPELINE.filter((s) => wanted.includes(s.id))
}

export type StageState = 'done' | 'active' | 'pending' | 'failed' | 'skipped'

/**
 * Checklist state for every stage of an asset. `doneEntries` is `asset.stages_done` (entries may carry a note,
 * e.g. "caption: skipped (llm unavailable)"); `current` is the running job's `stage`.
 */
export function stageStates(
  kind: string,
  opts: { doneEntries: string[]; current?: string | null; failedStage?: string | null; jobDone?: boolean; hasAudio?: boolean },
): { id: string; label: string; hint: string; state: StageState; note?: string }[] {
  const done = new Map(opts.doneEntries.map((e) => [e.split(':')[0].trim(), e.includes(':') ? e.split(':').slice(1).join(':').trim() : '']))
  return stagesFor(kind, opts.hasAudio ?? true).map((s) => {
    const note = done.get(s.id)
    if (done.has(s.id)) return { ...s, state: note?.startsWith('skipped') ? ('skipped' as const) : ('done' as const), note }
    if (opts.failedStage === s.id) return { ...s, state: 'failed' as const }
    if (!opts.jobDone && opts.current === s.id) return { ...s, state: 'active' as const }
    return { ...s, state: 'pending' as const }
  })
}

export function isProcessing(a: Pick<Asset, 'status'>): boolean {
  return a.status === 'uploaded' || a.status === 'processing'
}

export const STATUS_LABEL: Record<string, string> = { uploaded: 'Queued', processing: 'Processing', ready: 'Ready', failed: 'Failed' }

/** Wrap each case-insensitive occurrence of a query word in `[start, end, matched]` segments for highlighting. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = Array.from(new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)))
  if (!words.length) return [{ text, hit: false }]
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: words.includes(part.toLowerCase()) }))
}

/** The default clip source: the longest ready video (same rule as the backend). */
export function longestReadyVideo(assets: Asset[]): Asset | undefined {
  return assets.filter((a) => a.kind === 'video' && a.status === 'ready').sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0))[0]
}
