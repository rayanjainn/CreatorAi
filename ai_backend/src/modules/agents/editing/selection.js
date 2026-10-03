// Pure moment logic: transcript windows snapped to sentence / scene edges, weighted
// scoring and greedy candidate selection. No I/O; re-exported through service.js.
import { getEditingConfig } from './config.js';

export const SCORE_KEYS = ['hook', 'selfContained', 'energy', 'topicMatch'];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// scoreMoment(scores, weights?) -> sum(w_k * s_k) / sum(w_k), rounded to 4 decimals,
// always in [0, 1] (weights are normalised; a zero weight sum scores 0).
export function scoreMoment(scores, weights = getEditingConfig().weights) {
  let total = 0;
  let sum = 0;
  for (const key of SCORE_KEYS) {
    const w = Math.max(0, Number(weights[key]) || 0);
    total += w;
    sum += w * clamp01(Number(scores[key]) || 0);
  }
  if (total === 0) return 0;
  return Math.round(clamp01(sum / total) * 10_000) / 10_000;
}

// selectCandidates(moments, { k, minMs, maxMs }?) -> up to k moments, best score first
// (ties: earlier start first), each minMs-maxMs long and none overlapping another
// (half-open spans, so touching is fine). Greedy: walk by score, keep what fits.
// Missing options come from the config's candidate limits. The input is not mutated.
export function selectCandidates(moments, options = {}) {
  const { k, minMs, maxMs } = { ...getEditingConfig().candidates, ...options };
  const ranked = [...moments].sort((a, b) => b.score - a.score || a.startMs - b.startMs);
  const picked = [];
  for (const moment of ranked) {
    if (picked.length >= k) break;
    const length = moment.endMs - moment.startMs;
    if (length < minMs || length > maxMs) continue;
    if (picked.some((p) => moment.startMs < p.endMs && p.startMs < moment.endMs)) continue;
    picked.push(moment);
  }
  return picked;
}

const validSpans = (items, durationMs) =>
  items
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs && s.startMs < durationMs)
    .map((s) => ({ ...s, startMs: Math.max(0, s.startMs), endMs: Math.min(s.endMs, durationMs) }))
    .sort((a, b) => a.startMs - b.startMs);

// Nearest edge in [lo, hi] to `at`, at most snapMs away; else null.
function nearestEdge(edges, at, lo, hi, snapMs) {
  let best = null;
  for (const e of edges) {
    if (e < lo || e > hi || Math.abs(e - at) > snapMs) continue;
    if (best === null || Math.abs(e - at) < Math.abs(best - at)) best = e;
  }
  return best;
}

// buildWindows({ segments, scenes, durationMs }, windowConfig?) -> [{ startMs, endMs,
// first, last }] where first..last index the transcript units (segments, or scenes
// when there is no transcript). Every edge is a unit edge or a scene edge inside
// [0, durationMs]: a window grows unit by unit towards targetMs (never past maxMs),
// then each edge moves to a scene cut within snapMs, but only into the silence next to
// it (never into a neighbouring sentence). Windows shorter than minMs are dropped; when
// none is long enough the whole transcript becomes one window.
export function buildWindows({ segments = [], scenes = [], durationMs }, windowConfig = getEditingConfig().window) {
  const { minMs, targetMs, maxMs, strideMs, snapMs } = windowConfig;
  const sceneSpans = validSpans(scenes, durationMs);
  const segs = validSpans(segments, durationMs);
  const units = segs.length ? segs : sceneSpans;
  if (!units.length || !(durationMs > 0)) return [];
  const edges = [...new Set(sceneSpans.flatMap((s) => [s.startMs, s.endMs]))];

  const span = (first, last) => {
    let startMs = units[first].startMs;
    let endMs = units[last].endMs;
    const prevEnd = first > 0 ? units[first - 1].endMs : 0;
    const nextStart = last < units.length - 1 ? units[last + 1].startMs : durationMs;
    const s = nearestEdge(edges, startMs, Math.min(prevEnd, startMs), startMs, snapMs);
    const e = nearestEdge(edges, endMs, endMs, Math.max(nextStart, endMs), snapMs);
    if (s !== null && endMs - s <= maxMs) startMs = s;
    if (e !== null && e - startMs <= maxMs) endMs = e;
    return { startMs, endMs, first, last };
  };

  const windows = [];
  let lastStart = -Infinity;
  for (let i = 0; i < units.length; i++) {
    if (units[i].startMs < lastStart + strideMs) continue;
    let j = i;
    while (
      j + 1 < units.length &&
      units[j].endMs - units[i].startMs < targetMs &&
      units[j + 1].endMs - units[i].startMs <= maxMs
    ) {
      j++;
    }
    const w = span(i, j);
    if (w.endMs - w.startMs < minMs) continue;
    if (windows.some((x) => x.startMs === w.startMs && x.endMs === w.endMs)) continue;
    windows.push(w);
    lastStart = units[i].startMs;
  }
  if (!windows.length) {
    let last = 0;
    while (last + 1 < units.length && units[last + 1].endMs - units[0].startMs <= maxMs) last++;
    windows.push(span(0, last));
  }
  return windows;
}
