// Job names and payload schemas. A job can only be enqueued once its payload schema
// exists here; each phase adds the schemas for the names it reserves below.
import { z } from 'zod';

export const JOBS = Object.freeze({
  NOOP: 'noop', // P0 smoke job
  MEDIA_PROCESS: 'media.process', // P2/P3 orchestration fan-out
  MEDIA_TRANSCRIPTION: 'media.transcription', // P3
  MEDIA_SCENES: 'media.scenes', // P3
  MEDIA_FACES: 'media.faces', // P3
  MEDIA_ANALYSIS: 'media.analysis', // P3
  MEDIA_EMBEDDINGS: 'media.embeddings', // P3
  AGENT_RUN: 'agent.run', // P4
  MEDIA_MOMENTS: 'media.moments', // P6
  EDITING_REELS: 'editing.reels', // P6
  EDITING_REVISE: 'editing.revise', // P6
  RENDER_RUN: 'render.run', // P7
});

function StepPayload() {
  return z.object({ assetId: z.uuid(), projectId: z.uuid(), runId: z.uuid() }).strict();
}

export const PAYLOADS = {
  [JOBS.NOOP]: z.object({ message: z.string().max(200).optional() }).strict(),
  // P2: enqueued once per registered original; the P3 orchestrator fans it out.
  [JOBS.MEDIA_PROCESS]: z.object({ assetId: z.uuid(), projectId: z.uuid() }).strict(),
  // P3: one job per pipeline step (src/workers/process.js). runId is the pipeline run the
  // job belongs to; a job from a superseded run (reprocess) is skipped.
  [JOBS.MEDIA_TRANSCRIPTION]: StepPayload(),
  [JOBS.MEDIA_SCENES]: StepPayload(),
  [JOBS.MEDIA_FACES]: StepPayload(),
  [JOBS.MEDIA_ANALYSIS]: StepPayload(),
  [JOBS.MEDIA_EMBEDDINGS]: StepPayload(),
  // P4: run one queued agent_runs row (the run row carries the agent name and input).
  [JOBS.AGENT_RUN]: z.object({ runId: z.uuid() }).strict(),
};

export function parsePayload(name, data) {
  const schema = PAYLOADS[name];
  if (!schema) throw new Error(`Unknown job "${name}": add its payload schema to src/queue/jobs.js`);
  return schema.parse(data ?? {});
}
