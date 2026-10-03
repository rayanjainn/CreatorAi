/**
 * Three-way merge for a `REVISION_CONFLICT`: `base` is the revision my edits started from, `theirs` the latest server
 * revision and `mine` the local timeline. A rebase is offered only when it is provably safe:
 *   - neither side changed the video cut (item order, source ranges, status) unless the other side changed nothing, and
 *   - the two sides touched different items and different global fields, and
 *   - the merged timeline passes the same invariants the server checks.
 * Anything else answers `ok: false` with a readable reason and the UI offers "Reload latest" only.
 */
import { validate } from './validate'
import { cloneTimeline, LAYER_TRACKS, type AnyItem, type Timeline, type TrackName } from './types'

export type MergeResult = { ok: true; timeline: Timeline } | { ok: false; reason: string }

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const GLOBAL_KEYS = ['aspect', 'width', 'height', 'caption_style'] as const

export interface TimelineDiff {
  structural: boolean
  globals: string[]
  items: Map<string, 'added' | 'removed' | 'changed'>
  empty: boolean
}

/** What changed from `a` to `b`, by item id. */
export function diffTimelines(a: Timeline, b: Timeline): TimelineDiff {
  const globals = GLOBAL_KEYS.filter((k) => a[k] !== b[k]) as string[]
  const items = new Map<string, 'added' | 'removed' | 'changed'>()
  for (const track of LAYER_TRACKS) {
    const ma = new Map((a.tracks[track] as AnyItem[]).map((i) => [i.id, i]))
    const mb = new Map((b.tracks[track] as AnyItem[]).map((i) => [i.id, i]))
    for (const [id, item] of mb) {
      const old = ma.get(id)
      if (!old) items.set(id, 'added')
      else if (!deepEqual(old, item)) items.set(id, 'changed')
    }
    for (const id of ma.keys()) if (!mb.has(id)) items.set(id, 'removed')
  }
  const shape = (t: Timeline) => t.tracks.video.map((v) => [v.id, v.asset_id, v.src_in, v.src_out, v.status])
  const structural = !deepEqual(shape(a), shape(b))
  return { structural, globals, items, empty: !globals.length && !items.size }
}

export function rebase(base: Timeline, mine: Timeline, theirs: Timeline, assetDurations?: Record<string, number>): MergeResult {
  const T = diffTimelines(base, theirs)
  const M = diffTimelines(base, mine)
  if (M.empty) return { ok: true, timeline: cloneTimeline(theirs) }
  if (T.empty) return { ok: true, timeline: cloneTimeline(mine) }
  if (T.structural || M.structural) {
    return { ok: false, reason: `${T.structural ? 'The other change' : 'Your change'} re-cut the video, which moves captions and overlays, so the two edits cannot be combined automatically.` }
  }
  const clash = [...M.items.keys()].filter((id) => T.items.has(id))
  if (clash.length) return { ok: false, reason: `Both edits changed the same layer${clash.length > 1 ? 's' : ''} (${clash.slice(0, 3).join(', ')}${clash.length > 3 ? ', ...' : ''}).` }
  const globalClash = M.globals.filter((g) => T.globals.includes(g) && mine[g as keyof Timeline] !== theirs[g as keyof Timeline])
  if (globalClash.length) return { ok: false, reason: `Both edits changed ${globalClash.join(', ').replace('_', ' ')}.` }

  const out = cloneTimeline(theirs)
  for (const g of M.globals) if (!T.globals.includes(g)) (out as unknown as Record<string, unknown>)[g] = mine[g as keyof Timeline]
  for (const track of LAYER_TRACKS) {
    const list = out.tracks[track] as AnyItem[]
    const mineList = mine.tracks[track] as AnyItem[]
    for (const [id, kind] of M.items) {
      const mi = mineList.find((i) => i.id === id)
      const at = list.findIndex((i) => i.id === id)
      if (kind === 'removed' && base.tracks[track as TrackName].some((i) => i.id === id)) {
        if (at >= 0) list.splice(at, 1)
      } else if (mi && (kind === 'added' || kind === 'changed')) {
        if (at >= 0) list[at] = structuredClone(mi)
        else list.push(structuredClone(mi))
      }
    }
  }
  out.tracks.captions.sort((a, b) => a.tl_start - b.tl_start)
  const violations = validate(out, assetDurations)
  if (violations.length) return { ok: false, reason: `The combined timeline would be invalid (${violations[0].message}).` }
  return { ok: true, timeline: out }
}
