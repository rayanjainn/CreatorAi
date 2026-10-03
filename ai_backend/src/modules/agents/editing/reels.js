// Reels: moments (generated first when the asset has none) -> top `count` candidates that
// can reach the target length -> one Editing Agent run per candidate. The agent returns
// cut decisions; buildTimelineDoc() turns them into Timeline JSON, saved through the
// timeline service as an `ai` v1 in the same step that marks the run succeeded.
import { getAssetIndex } from '../../media/service.js';
import { createTimeline } from '../../timeline/service.js';
import { getScript } from '../script/service.js';
import { AgentOutputError, runAgent } from '../service.js';
import { buildTimelineDoc, keptLength, normaliseKeep } from './builder.js';
import { getEditingConfig } from './config.js';
import { JobError } from './jobs.js';
import { generateMoments } from './moments.js';
import * as repo from './repo.js';
import { CutDecisions } from './schemas.js';
import { selectCandidates } from './selection.js';

const overlaps = (a, startMs, endMs) => a.startMs < endMs && startMs < a.endMs;

// Kept-length bounds for a target: target * (1 -/+ tolerance), in whole ms.
export function reelBounds(targetMs, tolerance = getEditingConfig().reelTolerance) {
  return { minMs: Math.ceil(targetMs * (1 - tolerance)), maxMs: Math.floor(targetMs * (1 + tolerance)) };
}

export const reelAgent = {
  name: 'editing.reel',
  outputSchema: CutDecisions,
  system:
    'You are the Editing Agent of a short-form video studio. You cut one vertical reel out of ' +
    'a moment of a longer video by choosing which source ranges to keep. You never write a ' +
    'timeline: only cut decisions.',
  instructions: (input) =>
    [
      `Cut a reel of about ${input.targetMs} ms (between ${input.minMs} and ${input.maxMs} ms in total) ` +
        `from the moment "${input.moment.title}", which spans ${input.window.startMs}-${input.window.endMs} ms of the source.`,
      'keep: source ranges { startMs, endMs } in milliseconds, inside the moment window, in playback order. ' +
        'Start and end on sentence boundaries: use the startMs / endMs of the transcript segments. ' +
        'Open on the strongest line (the hook) and drop filler, repetition and dead air.',
      'captions (optional): { startMs, endMs, text } in source time for on-screen text.',
      input.script ? 'Follow the creator script in input.script where the footage allows.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  refine(output, { input }) {
    const lo = input.window.startMs;
    const hi = Math.min(input.window.endMs, input.durationMs);
    const keep = normaliseKeep(output.keep, { lo, hi });
    if (!keep.length) throw new AgentOutputError(`No keep range lies inside the moment window ${lo}-${hi} ms.`);
    const total = keptLength(keep);
    if (total < input.minMs || total > input.maxMs) {
      throw new AgentOutputError(
        `The kept ranges add up to ${total} ms inside the window ${lo}-${hi} ms; they must add up to between ` +
          `${input.minMs} and ${input.maxMs} ms (target ${input.targetMs} ms).`,
      );
    }
    return { ...output, keep };
  },
  async persist(_client, { output, input, runId, projectId, userId }) {
    const doc = buildTimelineDoc({
      assetId: input.assetId,
      durationMs: input.durationMs,
      keep: output.keep,
      captions: output.captions,
      window: input.window,
    });
    const { timeline } = await createTimeline(projectId, {
      title: input.title,
      sourceAssetId: input.assetId,
      doc,
      summary: `AI reel: ${input.moment.hookLine}`.slice(0, 500),
      authorType: 'ai',
      authorId: userId ?? null,
      agentRunId: runId,
    });
    return { type: 'timeline', id: timeline.id };
  },
};

const scriptBrief = (doc) => (doc ? { hooks: doc.hooks, script: doc.script, cta: doc.cta } : null);

// generateReels({ projectId, userId, assetId, count, targetSeconds, scriptId?, jobId, runIds })
// -> { timelineIds, momentIds }. Throws a JobError (with .result) when a reel fails.
export async function generateReels({ projectId, userId, assetId, count, targetSeconds, scriptId, jobId, runIds }) {
  const cfg = getEditingConfig();
  const { asset, segments, scenes } = await getAssetIndex(projectId, assetId);
  if (asset.status !== 'indexed') throw new JobError('conflict', 'Asset is not indexed', { status: asset.status });
  const script = scriptId ? scriptBrief((await getScript(projectId, scriptId)).doc) : null;

  let rows = await repo.listMoments(projectId, assetId);
  if (!rows.length) {
    await generateMoments({ projectId, userId, assetId, jobId, runIds });
    rows = await repo.listMoments(projectId, assetId);
  }
  const moments = rows.map((r) => ({
    id: r.id,
    startMs: r.start_ms,
    endMs: r.end_ms,
    title: r.title,
    hookLine: r.hook_line,
    summary: r.summary,
    score: Number(r.score),
  }));

  const targetMs = targetSeconds * 1000;
  const bounds = reelBounds(targetMs, cfg.reelTolerance);
  const picks = selectCandidates(moments, {
    k: count,
    minMs: Math.max(cfg.candidates.minMs, bounds.minMs),
    maxMs: cfg.candidates.maxMs,
  });
  if (picks.length < count) {
    throw new JobError(
      'not_enough_moments',
      `Only ${picks.length} non-overlapping moment(s) can make a ${targetSeconds} s reel; ${count} requested`,
      { available: picks.length, requested: count },
    );
  }

  const timelineIds = [];
  const momentIds = [];
  for (const [i, m] of picks.entries()) {
    const input = {
      assetId,
      durationMs: asset.durationMs,
      title: `Reel ${i + 1}: ${m.title}`.slice(0, 200),
      targetMs,
      ...bounds,
      window: { startMs: m.startMs, endMs: m.endMs },
      moment: { id: m.id, title: m.title, hookLine: m.hookLine, summary: m.summary },
      transcript: segments
        .filter((s) => overlaps(s, m.startMs, m.endMs))
        .map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
      scenes: scenes
        .filter((s) => overlaps(s, m.startMs, m.endMs))
        .map((s) => ({ startMs: s.startMs, endMs: s.endMs, caption: s.caption })),
      script,
    };
    const { run, artifact } = await runAgent({ ...reelAgent, input, projectId, userId });
    runIds.push(run.id);
    if (run.status !== 'succeeded') {
      const err = new JobError(run.error?.code ?? 'agent_failed', run.error?.message ?? 'Reel run failed', run.error?.details);
      err.result = { timelineIds, momentIds };
      throw err;
    }
    timelineIds.push(artifact.id);
    momentIds.push(m.id);
  }
  return { timelineIds, momentIds };
}
