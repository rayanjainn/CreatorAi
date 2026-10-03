// Moments generation: transcript windows -> LLM labels + sub-scores (one agent run per
// batch of windows) -> weighted score -> top-K candidates -> moments rows (replacing the
// asset's previous ones). Nothing is written unless every batch succeeds.
import { getIndexView } from '../../media/service.js';
import { AgentOutputError, runAgent } from '../service.js';
import { getEditingConfig } from './config.js';
import { JobError } from './jobs.js';
import * as repo from './repo.js';
import { MomentLabels } from './schemas.js';
import { buildWindows, scoreMoment, selectCandidates } from './selection.js';

const overlaps = (a, startMs, endMs) => a.startMs < endMs && startMs < a.endMs;

export const momentsAgent = {
  name: 'editing.moments',
  outputSchema: MomentLabels,
  system:
    'You are the moments analyst of a short-form video studio. You read windows of a long ' +
    'video transcript and judge which ones would work as stand-alone vertical reels.',
  instructions: (input) =>
    [
      'Label every window in input.windows exactly once, using its index.',
      'title: a short reel title. hookLine: the strongest opening line, quoted or lightly edited ' +
        'from the window transcript. summary: one or two sentences.',
      'scores, each a number from 0 to 1: hook (how strongly the first seconds grab attention), ' +
        'selfContained (understandable without the rest of the video), energy (pace and delivery), ' +
        `topicMatch (relevance to ${input.topic ? `the topic "${input.topic}"` : "the video's main topics"}).`,
    ].join('\n'),
  refine(output, { input }) {
    const expected = new Set(input.windows.map((w) => w.index));
    const seen = new Set();
    const duplicate = [];
    const unexpected = [];
    for (const m of output.moments) {
      if (!expected.has(m.index)) unexpected.push(m.index);
      else if (seen.has(m.index)) duplicate.push(m.index);
      seen.add(m.index);
    }
    const missing = [...expected].filter((i) => !seen.has(i));
    if (missing.length || duplicate.length || unexpected.length) {
      const parts = [];
      if (missing.length) parts.push(`missing window index(es) ${missing.join(', ')}`);
      if (duplicate.length) parts.push(`window index(es) labelled twice: ${duplicate.join(', ')}`);
      if (unexpected.length) parts.push(`unknown window index(es) ${unexpected.join(', ')}`);
      throw new AgentOutputError(`Label every window exactly once: ${parts.join('; ')}.`);
    }
    return output;
  },
};

// Throws a JobError carrying the run's error when the agent run failed.
export async function runOrFail(def, { input, projectId, userId, runIds }) {
  const { run, output, artifact } = await runAgent({ ...def, input, projectId, userId });
  runIds.push(run.id);
  if (run.status !== 'succeeded') {
    throw new JobError(run.error?.code ?? 'agent_failed', run.error?.message ?? 'Agent run failed', run.error?.details);
  }
  return { run, output, artifact };
}

// generateMoments({ projectId, userId, assetId, topic?, jobId, runIds }) -> { moments, candidates }
export async function generateMoments({ projectId, userId, assetId, topic, jobId, runIds }) {
  const cfg = getEditingConfig();
  const index = await getIndexView(projectId, assetId);
  if (index.asset.status !== 'indexed') throw new JobError('conflict', 'Asset is not indexed', { status: index.asset.status });
  const durationMs = index.asset.durationMs;
  const windows = buildWindows({ segments: index.transcript, scenes: index.scenes, durationMs }, cfg.window);
  if (!windows.length) throw new JobError('no_transcript', 'The asset has no transcript or scenes to cut moments from');

  const described = windows.map((w, i) => ({
    index: i,
    startMs: w.startMs,
    endMs: w.endMs,
    transcript: index.transcript
      .filter((s) => overlaps(s, w.startMs, w.endMs))
      .map((s) => s.text)
      .join(' '),
    scenes: index.scenes.filter((s) => overlaps(s, w.startMs, w.endMs) && s.caption).map((s) => s.caption),
  }));

  const labels = new Map();
  for (let i = 0; i < described.length; i += cfg.labelBatch) {
    const input = {
      assetId,
      durationMs,
      topic: topic ?? null,
      analysis: index.analysis ? { summary: index.analysis.summary, topics: index.analysis.topics } : null,
      windows: described.slice(i, i + cfg.labelBatch),
    };
    const { output } = await runOrFail(momentsAgent, { input, projectId, userId, runIds });
    for (const label of output.moments) labels.set(label.index, label);
  }

  const scored = described.map((w) => {
    const label = labels.get(w.index);
    return {
      index: w.index,
      startMs: w.startMs,
      endMs: w.endMs,
      title: label.title,
      hookLine: label.hookLine,
      summary: label.summary,
      scores: { subScores: label.scores, weights: { ...cfg.weights } },
      score: scoreMoment(label.scores, cfg.weights),
    };
  });
  const picked = new Set(selectCandidates(scored, cfg.candidates).map((m) => m.index));
  const rows = await repo.replaceMoments(
    assetId,
    projectId,
    jobId,
    scored.map((m) => ({ ...m, status: picked.has(m.index) ? 'candidate' : 'scored' })),
  );
  return { moments: rows.length, candidates: picked.size };
}
