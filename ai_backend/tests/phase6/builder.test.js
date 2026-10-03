// P6.T2 cut decisions -> Timeline JSON builder (pure), through agents/editing/service.js.
// Property test: random valid cut decisions always give a timeline that passes the P5
// validator, with contiguous startMs on the video track.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildTimelineDoc } from '../../src/modules/agents/editing/service.js';
import { clipEndMs, validateTimeline } from '../../src/modules/timeline/service.js';

const projectId = randomUUID();
const assetId = randomUUID();
const assets = (durationMs) => new Map([[assetId, { id: assetId, projectId, durationMs }]]);

// mulberry32: small seeded PRNG so failures are reproducible.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Total length of the union of [startMs, endMs) ranges (integers).
function unionLength(ranges) {
  const sorted = ranges.map((r) => [Math.round(r.startMs), Math.round(r.endMs)]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [s, e] of sorted) {
    if (!cur || s > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    } else cur[1] = Math.max(cur[1], e);
  }
  return cur ? total + cur[1] - cur[0] : 0;
}

function expectContiguous(doc) {
  const video = doc.tracks.find((t) => t.type === 'video');
  expect(video.clips[0].startMs).toBe(0);
  for (let i = 1; i < video.clips.length; i++) {
    expect(video.clips[i].startMs).toBe(clipEndMs('video', video.clips[i - 1]));
  }
  return video;
}

describe('buildTimelineDoc property: random valid cuts -> valid, contiguous timeline', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i (40 cases each)', (seed) => {
    const rand = prng(seed);
    for (let n = 0; n < 40; n++) {
      const durationMs = int(rand, 5_000, 600_000);
      const keep = Array.from({ length: int(rand, 1, 12) }, () => {
        const startMs = rand() < 0.5 ? int(rand, 0, durationMs - 500) : int(rand, 0, durationMs - 500) + rand();
        const endMs = Math.min(durationMs, startMs + 500 + rand() * 30_000);
        return { startMs, endMs };
      });
      // captions inside a kept range or straddling its end
      const captions = keep.slice(0, int(rand, 0, keep.length)).map((k, i) => ({
        startMs: k.startMs,
        endMs: Math.min(durationMs, k.startMs + 200 + rand() * 6_000),
        text: `caption ${i}`,
      }));

      const doc = buildTimelineDoc({ assetId, durationMs, keep, captions });
      const issues = validateTimeline(doc, assets(durationMs), { projectId });
      expect(issues, JSON.stringify({ seed, n, keep, issues })).toEqual([]);
      const video = expectContiguous(doc);
      for (const clip of video.clips) expect(clip.assetId).toBe(assetId);
      const total = clipEndMs('video', video.clips.at(-1));
      expect(total).toBe(unionLength(keep));
      const cap = doc.tracks.find((t) => t.type === 'caption');
      for (const c of cap?.clips ?? []) expect(c.endMs).toBeLessThanOrEqual(total);
    }
  });
});

describe('buildTimelineDoc rules', () => {
  it('lays kept ranges out in source order, merging overlaps, with the default 9:16 output', () => {
    const doc = buildTimelineDoc({
      assetId,
      durationMs: 60_000,
      keep: [
        { startMs: 30_000, endMs: 35_000 },
        { startMs: 1_000, endMs: 4_000 },
        { startMs: 3_000, endMs: 6_000 },
      ],
    });
    expect(doc.output).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(doc.tracks).toHaveLength(1);
    expect(doc.tracks[0].clips).toEqual([
      { id: 'c1', assetId, sourceInMs: 1_000, sourceOutMs: 6_000, startMs: 0, volume: 1 },
      { id: 'c2', assetId, sourceInMs: 30_000, sourceOutMs: 35_000, startMs: 5_000, volume: 1 },
    ]);
  });

  it('clamps cuts that run past the asset end, drops cuts wholly outside it', () => {
    const doc = buildTimelineDoc({
      assetId,
      durationMs: 20_000,
      keep: [
        { startMs: 18_000, endMs: 26_000 },
        { startMs: 30_000, endMs: 40_000 },
        { startMs: 2_000, endMs: 5_000 },
      ],
    });
    expect(validateTimeline(doc, assets(20_000), { projectId })).toEqual([]);
    expect(doc.tracks[0].clips.map((c) => [c.sourceInMs, c.sourceOutMs])).toEqual([
      [2_000, 5_000],
      [18_000, 20_000],
    ]);
  });

  it('clamps to a window when one is given', () => {
    const doc = buildTimelineDoc({
      assetId,
      durationMs: 120_000,
      window: { startMs: 10_000, endMs: 40_000 },
      keep: [{ startMs: 5_000, endMs: 15_000 }, { startMs: 38_000, endMs: 50_000 }],
    });
    expect(doc.tracks[0].clips.map((c) => [c.sourceInMs, c.sourceOutMs])).toEqual([
      [10_000, 15_000],
      [38_000, 40_000],
    ]);
  });

  it('rejects cut decisions with nothing left inside the asset', () => {
    expect(() => buildTimelineDoc({ assetId, durationMs: 20_000, keep: [{ startMs: 25_000, endMs: 30_000 }] })).toThrow(
      /nothing to keep/i,
    );
    expect(() => buildTimelineDoc({ assetId, durationMs: 20_000, keep: [] })).toThrow(/nothing to keep/i);
  });

  it('maps source-time captions onto the timeline, splitting at cuts and dropping cut-away text', () => {
    const doc = buildTimelineDoc({
      assetId,
      durationMs: 60_000,
      keep: [{ startMs: 10_000, endMs: 14_000 }, { startMs: 20_000, endMs: 25_000 }],
      captions: [
        { startMs: 10_500, endMs: 12_000, text: 'inside the first range' },
        { startMs: 13_000, endMs: 21_000, text: 'spans the cut' },
        { startMs: 16_000, endMs: 18_000, text: 'cut away' },
      ],
    });
    const cap = doc.tracks.find((t) => t.type === 'caption');
    expect(cap.clips).toEqual([
      { id: 't1', startMs: 500, endMs: 2_000, text: 'inside the first range' },
      { id: 't2', startMs: 3_000, endMs: 4_000, text: 'spans the cut' },
      { id: 't3', startMs: 4_000, endMs: 5_000, text: 'spans the cut' },
    ]);
    expect(validateTimeline(doc, assets(60_000), { projectId })).toEqual([]);
  });

  it('never mutates its input', () => {
    const keep = [{ startMs: 3_000.4, endMs: 1e9 }];
    const copy = structuredClone(keep);
    buildTimelineDoc({ assetId, durationMs: 10_000, keep });
    expect(keep).toEqual(copy);
  });
});
