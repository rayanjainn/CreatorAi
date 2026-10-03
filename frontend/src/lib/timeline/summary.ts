import { LAYER_TRACKS, type AnyItem, type LayerStatus, type Timeline, type TrackName } from './types'

/** One row of the "AI changes" checklist: a kind of layer with its status counts. */
export interface LayerGroup {
  key: string
  label: string
  track: TrackName
  kind: string
  items: AnyItem[]
  counts: Record<LayerStatus, number>
  ai: number
}

const LABELS: Record<string, string> = {
  'video:clip': 'Video cuts',
  'video:sponsor': 'Sponsor segments',
  captions: 'Captions',
  'audio:music': 'Music',
  'audio:sfx': 'Sound effects',
  'audio:voiceover': 'Voiceover',
  'overlays:text': 'Text overlays',
  'overlays:lower_third': 'Lower thirds',
  'overlays:sponsor_card': 'Sponsor cards',
}

/** Layers grouped by type for the history panel, in track order (empty groups omitted). */
export function layerGroups(t: Timeline): LayerGroup[] {
  const map = new Map<string, LayerGroup>()
  for (const track of LAYER_TRACKS) {
    for (const item of t.tracks[track] as AnyItem[]) {
      const kind = 'kind' in item ? String(item.kind) : track
      const key = track === 'captions' ? 'captions' : `${track}:${kind}`
      let g = map.get(key)
      if (!g) {
        g = { key, label: LABELS[key] ?? key, track, kind, items: [], counts: { suggested: 0, accepted: 0, rejected: 0 }, ai: 0 }
        map.set(key, g)
      }
      g.items.push(item)
      g.counts[item.status]++
      if (item.source === 'ai') g.ai++
    }
  }
  return [...map.values()]
}

export function totals(t: Timeline): { suggested: number; accepted: number; rejected: number; ai: number; user: number } {
  const out = { suggested: 0, accepted: 0, rejected: 0, ai: 0, user: 0 }
  for (const track of LAYER_TRACKS) {
    for (const item of t.tracks[track] as AnyItem[]) {
      out[item.status]++
      out[item.source]++
    }
  }
  return out
}

/** Timeline seconds covered by an item (rejected video takes no time, so it spans nothing). */
export function itemSpan(item: AnyItem): [number, number] {
  if ('tl_end' in item) return [item.tl_start, item.tl_end]
  if (item.status === 'rejected' && 'transition_in' in item) return [item.tl_start, item.tl_start]
  return [item.tl_start, item.tl_start + (item.src_out - item.src_in)]
}
