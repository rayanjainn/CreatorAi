// Revisions: the Editing Agent reads the timeline version the request was made on plus
// the instruction and returns edits (remove / trim / add / move) to the main video track.
// applyRevision() applies them with deterministic code, so clips the edits do not name
// (human edits included) are carried over untouched; the result is saved through the
// timeline service as an `ai` version on that base version (409 if the head moved).
import { getAssetIndex, getAssetsByIds } from '../../media/service.js';
import { checkTimelineDoc, clipEndMs, collectAssetIds, createVersion, getVersion } from '../../timeline/service.js';
import { AgentOutputError } from '../service.js';
import { JobError } from './jobs.js';
import { runOrFail } from './moments.js';
import { RevisionDecisions } from './schemas.js';

const MAX_TRANSCRIPT_SEGMENTS = 400;

export class RevisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RevisionError';
  }
}

const mainTrackIndex = (doc) => {
  const preferred = doc.tracks.findIndex((t) => t.type === 'video' && t.id === 'v1');
  return preferred >= 0 ? preferred : doc.tracks.findIndex((t) => t.type === 'video');
};

function freshId(prefix, taken) {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  taken.add(id);
  return id;
}

// applyRevision(doc, edits, { sourceAssetId, durations }) -> new doc. Pure.
// - durations: Map assetId -> durationMs (trim / add ranges are clamped to the asset).
// - edits run in order on the main video track (track 'v1', else the first video track,
//   created when missing); the track is then laid out back to back from 0 in its new order.
// - caption clips that sat on a main-track clip follow it (cut to its new source range,
//   dropped with it); other tracks are left as they are.
// Throws RevisionError for an edit naming an unknown clip, an add without a source asset,
// a range left empty by clamping, or a revision that removes every clip.
export function applyRevision(doc, edits, { sourceAssetId = null, durations = new Map() } = {}) {
  const next = structuredClone(doc);
  let ti = mainTrackIndex(next);
  if (ti < 0) {
    const ids = new Set(next.tracks.map((t) => t.id));
    next.tracks.unshift({ id: ids.has('v1') ? freshId('v', ids) : 'v1', type: 'video', clips: [] });
    ti = 0;
  }
  const track = next.tracks[ti];
  const before = new Map(track.clips.map((c) => [c.id, { ...c }]));
  const taken = new Set(next.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  let clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);

  const find = (id, op) => {
    const i = clips.findIndex((c) => c.id === id);
    if (i < 0) throw new RevisionError(`${op}: no clip "${id}" on track "${track.id}" (clips: ${clips.map((c) => c.id).join(', ') || 'none'}).`);
    return i;
  };
  const insertAt = (afterClipId, op) => (afterClipId == null ? 0 : find(afterClipId, op) + 1);
  const clampRange = (assetId, inMs, outMs, op) => {
    const limit = durations.get(assetId) ?? Infinity;
    const s = Math.max(0, Math.round(inMs));
    const e = Math.min(limit, Math.round(outMs));
    if (!(e > s)) throw new RevisionError(`${op}: the range ${inMs}-${outMs} ms is outside the asset (${limit} ms long).`);
    return [s, e];
  };

  for (const [n, edit] of edits.entries()) {
    const op = `edits[${n}] ${edit.op}`;
    if (edit.op === 'remove') {
      clips.splice(find(edit.clipId, op), 1);
    } else if (edit.op === 'trim') {
      const i = find(edit.clipId, op);
      const [s, e] = clampRange(clips[i].assetId, edit.sourceInMs, edit.sourceOutMs, op);
      clips[i] = { ...clips[i], sourceInMs: s, sourceOutMs: e };
    } else if (edit.op === 'move') {
      const [clip] = clips.splice(find(edit.clipId, op), 1);
      if (edit.afterClipId === clip.id) throw new RevisionError(`${op}: a clip cannot move after itself.`);
      clips.splice(insertAt(edit.afterClipId, op), 0, clip);
    } else if (edit.op === 'add') {
      if (!sourceAssetId) throw new RevisionError(`${op}: this timeline has no source asset to add footage from.`);
      const [s, e] = clampRange(sourceAssetId, edit.sourceInMs, edit.sourceOutMs, op);
      const at = edit.afterClipId === undefined ? clips.length : insertAt(edit.afterClipId, op);
      const clip = { id: freshId('ai', taken), assetId: sourceAssetId, sourceInMs: s, sourceOutMs: e, startMs: 0, volume: 1 };
      if (edit.label) clip.label = edit.label;
      clips.splice(at, 0, clip);
    }
  }
  if (!clips.length) throw new RevisionError('The revision removes every clip; keep at least one.');

  let at = 0;
  clips = clips.map((c) => {
    const placed = { ...c, startMs: at };
    at += c.sourceOutMs - c.sourceInMs;
    return placed;
  });
  track.clips = clips;
  const after = new Map(clips.map((c) => [c.id, c]));

  // Captions: re-anchor the ones that sat on a main-track clip.
  const oldSpans = [...before.values()];
  for (const t of next.tracks) {
    if (t.type !== 'caption') continue;
    const mapped = [];
    for (const cap of t.clips) {
      const host = oldSpans.find((c) => cap.startMs >= c.startMs && cap.startMs < clipEndMs('video', c));
      if (!host) {
        mapped.push(cap);
        continue;
      }
      const moved = after.get(host.id);
      if (!moved) continue;
      const srcStart = host.sourceInMs + (cap.startMs - host.startMs);
      const srcEnd = host.sourceInMs + (Math.min(cap.endMs, clipEndMs('video', host)) - host.startMs);
      const s = Math.max(srcStart, moved.sourceInMs);
      const e = Math.min(srcEnd, moved.sourceOutMs);
      if (e > s) mapped.push({ ...cap, startMs: moved.startMs + s - moved.sourceInMs, endMs: moved.startMs + e - moved.sourceInMs });
    }
    mapped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const resolved = [];
    for (const cap of mapped) {
      const startMs = Math.max(cap.startMs, resolved.at(-1)?.endMs ?? 0);
      if (cap.endMs > startMs) resolved.push({ ...cap, startMs });
    }
    t.clips = resolved;
  }
  return next;
}

export const reviseAgent = {
  name: 'editing.revise',
  outputSchema: RevisionDecisions,
  system:
    'You are the Editing Agent of a short-form video studio. You revise an existing reel ' +
    'timeline by returning edits to its main video track. You never write a timeline.',
  instructions: (input) =>
    [
      `Revise the timeline (version ${input.baseVersion}) following this instruction: "${input.instruction}".`,
      `input.head is the current timeline; its main video track is "${input.mainTrackId}". Times are milliseconds.`,
      'edits (applied in order): { op: "remove", clipId } | { op: "trim", clipId, sourceInMs, sourceOutMs } | ' +
        '{ op: "add", sourceInMs, sourceOutMs, afterClipId?, label? } (footage of the source asset; ' +
        'afterClipId null = at the start, omitted = at the end) | { op: "move", clipId, afterClipId } ' +
        '(null = to the start). Clips are laid out back to back afterwards.',
      'Only touch what the instruction asks for: clips you do not name are kept exactly as they are, ' +
        'including clips a human added. Use input.transcript to find sentence boundaries.',
      'summary: one sentence describing the change.',
    ].join('\n'),
  async refine(output, { input }) {
    let doc;
    try {
      doc = applyRevision(input.head, output.edits, {
        sourceAssetId: input.sourceAsset?.id ?? null,
        durations: new Map(input.assets.map((a) => [a.id, a.durationMs])),
      });
    } catch (err) {
      if (err instanceof RevisionError) throw new AgentOutputError(err.message);
      throw err;
    }
    const issues = await checkTimelineDoc(input.projectId, doc);
    if (issues.length) {
      const list = issues.slice(0, 10).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new AgentOutputError(`The edits produce an invalid timeline:\n${list}`);
    }
    return output;
  },
  async persist(_client, { output, input, runId, projectId, userId }) {
    const doc = applyRevision(input.head, output.edits, {
      sourceAssetId: input.sourceAsset?.id ?? null,
      durations: new Map(input.assets.map((a) => [a.id, a.durationMs])),
    });
    const version = await createVersion(projectId, input.timelineId, {
      baseVersion: input.baseVersion,
      doc,
      summary: output.summary,
      authorType: 'ai',
      authorId: userId ?? null,
      agentRunId: runId,
    });
    return { type: 'timeline_version', id: `${input.timelineId}:${version.version}` };
  },
};

// generateRevision({ projectId, userId, timelineId, baseVersion, sourceAssetId, instruction,
// runIds }) -> { timelineId, version, baseVersion }. A head that moved since baseVersion
// fails the job with code 'conflict' { headVersion } and writes nothing.
export async function generateRevision({ projectId, userId, timelineId, baseVersion, sourceAssetId, instruction, runIds }) {
  const base = await getVersion(projectId, timelineId, baseVersion);
  const ids = collectAssetIds(base.doc);
  if (sourceAssetId && !ids.includes(sourceAssetId)) ids.push(sourceAssetId);
  const assets = (await getAssetsByIds(projectId, ids)).map((a) => ({ id: a.id, durationMs: a.durationMs }));
  const source = sourceAssetId ? assets.find((a) => a.id === sourceAssetId) ?? null : null;
  let transcript = [];
  if (source) {
    const index = await getAssetIndex(projectId, source.id);
    transcript = index.segments.slice(0, MAX_TRANSCRIPT_SEGMENTS).map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }));
  }
  const input = {
    projectId,
    timelineId,
    baseVersion,
    instruction,
    mainTrackId: base.doc.tracks[mainTrackIndex(base.doc)]?.id ?? 'v1',
    sourceAsset: source,
    assets,
    head: base.doc,
    transcript,
  };
  const { artifact } = await runOrFail(reviseAgent, { input, projectId, userId, runIds });
  const version = Number(artifact.id.split(':')[1]);
  if (!Number.isInteger(version)) throw new JobError('job_error', 'Revision saved without a version number');
  return { timelineId, version, baseVersion };
}
