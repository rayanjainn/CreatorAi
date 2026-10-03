// timeline schemas: Timeline JSON v1 (THE only definition anywhere), the pure semantic
// validator, request bodies and output shapes. No DB or other-module imports here, so
// the editing agent (P6) and the renderer (P7) can rely on it as plain data rules.
// Other modules import these through service.js, which re-exports them.
import { z } from 'zod';

// ---- Timeline JSON v1 ---------------------------------------------------------------
// All times are integer milliseconds. A video clip plays [sourceInMs, sourceOutMs) of its
// asset starting at startMs on the timeline, so it occupies
// [startMs, startMs + sourceOutMs - sourceInMs). A caption occupies [startMs, endMs).
// Shape rules live in the Zod schema; cross-field rules (ranges, overlap, unique ids,
// assets) live in validateTimeline() below.

export const TIMELINE_SCHEMA_VERSION = 1;

const ms = z.number().int().nonnegative();
const id = z.string().min(1).max(64);
// Even sizes: H.264 with yuv420p (the renderer's output) needs both dimensions even.
const dimension = z.number().int().min(2).max(4096).multipleOf(2);

export const TimelineOutput = z.strictObject({
  width: dimension,
  height: dimension,
  fps: z.number().int().min(1).max(120),
});

export const VideoClip = z.strictObject({
  id,
  assetId: z.uuid(),
  sourceInMs: ms,
  sourceOutMs: ms,
  startMs: ms,
  volume: z.number().min(0).max(2),
  label: z.string().max(200).optional(),
});

export const CaptionClip = z.strictObject({
  id,
  startMs: ms,
  endMs: ms,
  text: z.string().min(1).max(500),
});

export const VideoTrack = z.strictObject({
  id,
  type: z.literal('video'),
  clips: z.array(VideoClip).max(2000),
});

export const CaptionTrack = z.strictObject({
  id,
  type: z.literal('caption'),
  clips: z.array(CaptionClip).max(2000),
});

export const TimelineTrack = z.discriminatedUnion('type', [VideoTrack, CaptionTrack]);

export const TimelineDoc = z.strictObject({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
  output: TimelineOutput,
  tracks: z.array(TimelineTrack).max(50),
});

// The doc a timeline starts with when it is created without one: 9:16 at 30 fps, no tracks.
export function emptyTimelineDoc() {
  return { schemaVersion: TIMELINE_SCHEMA_VERSION, output: { width: 1080, height: 1920, fps: 30 }, tracks: [] };
}

// End of a clip on the timeline (exclusive).
export function clipEndMs(trackType, clip) {
  return trackType === 'video' ? clip.startMs + (clip.sourceOutMs - clip.sourceInMs) : clip.endMs;
}

// Every asset id a doc references (deduplicated, in first-seen order). Tolerates a doc
// that has not passed the shape check, so callers can load assets before validating.
export function collectAssetIds(doc) {
  const ids = new Set();
  for (const track of Array.isArray(doc?.tracks) ? doc.tracks : []) {
    for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
      if (typeof clip?.assetId === 'string') ids.add(clip.assetId);
    }
  }
  return [...ids];
}

const issue = (path, code, message) => ({ code, path, message });

const lookup = (assetsById, assetId) =>
  assetsById instanceof Map ? assetsById.get(assetId) : Object.hasOwn(assetsById ?? {}, assetId) ? assetsById[assetId] : undefined;

// validateTimeline(doc, assetsById, { projectId }?) -> issues: [{ code, path, message }],
// empty when the doc is valid. Pure: no I/O, the input is never mutated.
// - assetsById: Map or plain object of id -> { projectId, durationMs } (the shape media
//   getAssetsByIds returns). An id that is absent is an unknown asset.
// - projectId: when given, an asset whose projectId differs is rejected.
// Shape errors (Zod issues, same { code, path, message }) are returned alone: semantic
// rules only run on a doc with a valid shape. Otherwise every semantic issue is reported.
// Paths are relative to the doc, e.g. ['tracks', 0, 'clips', 1, 'startMs'].
export function validateTimeline(doc, assetsById = new Map(), { projectId } = {}) {
  const parsed = TimelineDoc.safeParse(doc);
  if (!parsed.success) {
    return parsed.error.issues.map(({ code, path, message }) => issue(path, code, message));
  }

  const issues = [];
  const trackIds = new Set();
  const clipIds = new Set();

  parsed.data.tracks.forEach((track, t) => {
    if (trackIds.has(track.id)) issues.push(issue(['tracks', t, 'id'], 'duplicate_id', `Duplicate track id "${track.id}"`));
    trackIds.add(track.id);

    const spans = [];
    track.clips.forEach((clip, c) => {
      const at = ['tracks', t, 'clips', c];
      if (clipIds.has(clip.id)) issues.push(issue([...at, 'id'], 'duplicate_id', `Duplicate clip id "${clip.id}"`));
      clipIds.add(clip.id);

      let rangeOk = true;
      if (track.type === 'video') {
        if (clip.sourceOutMs <= clip.sourceInMs) {
          rangeOk = false;
          issues.push(issue([...at, 'sourceOutMs'], 'invalid_range', 'sourceOutMs must be greater than sourceInMs'));
        }
        const asset = lookup(assetsById, clip.assetId);
        if (!asset) {
          issues.push(issue([...at, 'assetId'], 'asset_not_found', `Asset ${clip.assetId} not found in this project`));
        } else if (projectId !== undefined && asset.projectId !== projectId) {
          issues.push(issue([...at, 'assetId'], 'asset_wrong_project', `Asset ${clip.assetId} belongs to another project`));
        } else if (typeof asset.durationMs !== 'number') {
          issues.push(issue([...at, 'assetId'], 'asset_duration_unknown', `Asset ${clip.assetId} has no known duration yet`));
        } else if (clip.sourceOutMs > asset.durationMs) {
          issues.push(issue([...at, 'sourceOutMs'], 'source_out_of_range',
            `Source range ends at ${clip.sourceOutMs} ms, past the asset duration of ${asset.durationMs} ms`));
        }
      } else if (clip.endMs <= clip.startMs) {
        rangeOk = false;
        issues.push(issue([...at, 'endMs'], 'invalid_range', 'endMs must be greater than startMs'));
      }
      if (rangeOk) spans.push({ index: c, id: clip.id, start: clip.startMs, end: clipEndMs(track.type, clip) });
    });

    // Overlap: sort by start (ties by list order); each clip must start at or after the
    // furthest end seen so far. The later-starting clip of a pair carries the issue.
    spans.sort((a, b) => a.start - b.start || a.index - b.index);
    let furthest = null;
    for (const span of spans) {
      if (furthest && span.start < furthest.end) {
        issues.push(issue(['tracks', t, 'clips', span.index, 'startMs'], 'overlap',
          `Clip "${span.id}" overlaps clip "${furthest.id}" on track "${track.id}"`));
      }
      if (!furthest || span.end > furthest.end) furthest = span;
    }
  });

  return issues;
}
