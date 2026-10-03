// Pure, deterministic cut decisions -> Timeline JSON v1. The LLM only ever says which
// source ranges to keep (and optional captions in source time); this code owns the
// Timeline JSON. No I/O; re-exported through service.js.
import { TIMELINE_SCHEMA_VERSION } from '../../timeline/service.js';
import { getEditingConfig } from './config.js';

// A kept range shorter than this after clamping is dropped (a sliver, not a cut).
export const MIN_CLIP_MS = 100;

export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
    this.code = 'empty_cut';
  }
}

// normaliseKeep(keep, { lo, hi }) -> sorted, merged, integer [startMs, endMs) ranges
// clamped to [lo, hi]. Ranges left shorter than MIN_CLIP_MS are dropped.
export function normaliseKeep(keep, { lo, hi }) {
  const ranges = [];
  for (const r of keep ?? []) {
    const s = Math.max(lo, Math.round(Number(r.startMs)));
    const e = Math.min(hi, Math.round(Number(r.endMs)));
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) ranges.push({ startMs: s, endMs: e });
  }
  ranges.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else merged.push({ ...r });
  }
  return merged.filter((r) => r.endMs - r.startMs >= MIN_CLIP_MS);
}

export const keptLength = (ranges) => ranges.reduce((sum, r) => sum + r.endMs - r.startMs, 0);

// Maps source-time captions onto the timeline: each caption is cut to the parts that fall
// inside kept ranges (one caption clip per part); text that was cut away is dropped and
// overlaps are resolved by starting a later caption where the previous one ends.
function mapCaptions(captions, ranges) {
  const pieces = [];
  let offset = 0;
  const placed = ranges.map((r) => {
    const at = offset;
    offset += r.endMs - r.startMs;
    return { ...r, at };
  });
  for (const c of captions ?? []) {
    const cs = Math.round(Number(c.startMs));
    const ce = Math.round(Number(c.endMs));
    const text = String(c.text ?? '').trim().slice(0, 500);
    if (!text || !(ce > cs)) continue;
    for (const r of placed) {
      const s = Math.max(cs, r.startMs);
      const e = Math.min(ce, r.endMs);
      if (e > s) pieces.push({ startMs: r.at + s - r.startMs, endMs: r.at + e - r.startMs, text });
    }
  }
  pieces.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out = [];
  for (const p of pieces) {
    const prevEnd = out.at(-1)?.endMs ?? 0;
    const startMs = Math.max(p.startMs, prevEnd);
    if (p.endMs > startMs) out.push({ id: `t${out.length + 1}`, startMs, endMs: p.endMs, text: p.text });
  }
  return out;
}

// buildTimelineDoc({ assetId, durationMs, keep, captions?, window?, output?, volume? }) -> doc
// - keep: [{ startMs, endMs }] source ranges of assetId. Clamped to [0, durationMs] (and to
//   window when given), rounded, sorted and merged; laid out back to back from 0.
// - captions: [{ startMs, endMs, text }] in source time (see mapCaptions).
// Throws BuildError when nothing is left to keep. The result passes validateTimeline for
// an asset of that duration in the project.
export function buildTimelineDoc({ assetId, durationMs, keep, captions, window, output, volume = 1 }) {
  const lo = Math.max(0, window?.startMs ?? 0);
  const hi = Math.min(durationMs, window?.endMs ?? durationMs);
  const ranges = normaliseKeep(keep, { lo, hi });
  if (!ranges.length) throw new BuildError('Cut decisions leave nothing to keep inside the source range');

  let startMs = 0;
  const clips = ranges.map((r, i) => {
    const clip = { id: `c${i + 1}`, assetId, sourceInMs: r.startMs, sourceOutMs: r.endMs, startMs, volume };
    startMs += r.endMs - r.startMs;
    return clip;
  });
  const tracks = [{ id: 'v1', type: 'video', clips }];
  const captionClips = mapCaptions(captions, ranges);
  if (captionClips.length) tracks.push({ id: 'cap', type: 'caption', clips: captionClips });

  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    output: { ...(output ?? getEditingConfig().output) },
    tracks,
  };
}
