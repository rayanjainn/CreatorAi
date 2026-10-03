import type { Timeline } from '@/lib/timeline'

/** Per-asset data `GET /clips/{id}/edit` returns for the editor (signed URLs, waveform energy, silences, words). */
export interface EditAsset {
  filename: string
  kind: string
  duration_sec: number | null
  width: number | null
  height: number | null
  proxy_url: string | null
  audio_url: string | null
  thumb_url: string | null
  /** Loudness curve in dB, one value per `energy_window_sec`. */
  energy: number[]
  energy_window_sec: number
  silences: [number, number][]
  words: { word: string; start: number; end: number }[]
  /** Source ranges `words` covers (the server only sends words inside the ranges the timeline used when it loaded). */
  word_ranges: [number, number][]
}
export type EditAssets = Record<string, EditAsset>

export interface EditPayload {
  clip_id: string
  edit_id: string
  revision: number
  timeline: Timeline
  updated_at: string
  assets: EditAssets
  violations: { code: string; message: string; path?: string; item_id?: string | null }[]
  provenance: { source: string; provider?: string | null; model?: string | null }
}

export interface RevisionSummary {
  revision: number
  note: string
  created_at: string
  duration: number
  video_items: number
}
export interface RevisionDetail {
  revision: number
  note: string
  created_at: string
  timeline: Timeline
}
export interface Saved {
  revision: number
  timeline: Timeline
  updated_at: string
}
export interface OpResult extends Saved {
  op: string
  changed_layers: { status: string; layer: string; kind: string; item_ids: string[]; count?: number }[]
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error' | 'offline'
export type Tool = 'select' | 'trim'
