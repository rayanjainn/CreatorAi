// agents/editing schemas: request bodies, agent outputs (moment labels, cut decisions,
// revision edits) and response shapes. Agent outputs are validated here; the Timeline
// JSON itself is only ever defined by modules/timeline (the LLM never writes it).
import { z } from 'zod';

export const Uuid = z.uuid();

// ---- request bodies -------------------------------------------------------------------

export const MomentsBody = z.strictObject({
  // What the moments should be about (feeds the topicMatch sub-score).
  topic: z.string().trim().min(1).max(200).optional(),
});

export const ReelsBody = z.strictObject({
  assetId: z.uuid(),
  count: z.number().int().min(1).max(10),
  targetSeconds: z.number().int().min(15).max(60),
  scriptId: z.uuid().optional(),
});

export const ReviseBody = z.strictObject({
  timelineId: z.uuid(),
  instruction: z.string().trim().min(1).max(2000),
});

// ---- agent outputs ----------------------------------------------------------------------

const unit = z.number().min(0).max(1);

export const MomentSubScores = z.object({
  hook: unit,
  selfContained: unit,
  energy: unit,
  topicMatch: unit,
});

export const MomentLabel = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(120),
  hookLine: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(1000),
  scores: MomentSubScores,
});

export const MomentLabels = z.object({ moments: z.array(MomentLabel).min(1).max(100) });

const sourceMs = z.number().nonnegative();

// Source-time range [startMs, endMs) of the asset to keep.
export const KeepRange = z
  .object({ startMs: sourceMs, endMs: sourceMs })
  .refine((r) => r.endMs > r.startMs, { message: 'endMs must be greater than startMs', path: ['endMs'] });

// A caption in source time; it is mapped onto the timeline through the kept ranges.
export const CutCaption = z
  .object({ startMs: sourceMs, endMs: sourceMs, text: z.string().trim().min(1).max(500) })
  .refine((c) => c.endMs > c.startMs, { message: 'endMs must be greater than startMs', path: ['endMs'] });

export const CutDecisions = z.object({
  keep: z.array(KeepRange).min(1).max(50),
  captions: z.array(CutCaption).max(100).optional(),
});

const clipId = z.string().min(1).max(64);

// Edits to the current head's main video track. Clips the edits do not name stay as
// they are (human edits included); the track is then re-laid out back to back.
export const RevisionEdit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('remove'), clipId }),
  z
    .object({ op: z.literal('trim'), clipId, sourceInMs: sourceMs, sourceOutMs: sourceMs })
    .refine((e) => e.sourceOutMs > e.sourceInMs, { message: 'sourceOutMs must be greater than sourceInMs', path: ['sourceOutMs'] }),
  z
    .object({
      op: z.literal('add'),
      sourceInMs: sourceMs,
      sourceOutMs: sourceMs,
      afterClipId: clipId.nullable().optional(),
      label: z.string().trim().min(1).max(200).optional(),
    })
    .refine((e) => e.sourceOutMs > e.sourceInMs, { message: 'sourceOutMs must be greater than sourceInMs', path: ['sourceOutMs'] }),
  z.object({ op: z.literal('move'), clipId, afterClipId: clipId.nullable() }),
]);

export const RevisionDecisions = z.object({
  edits: z.array(RevisionEdit).max(50),
  summary: z.string().trim().min(1).max(500),
});

// ---- outputs ----------------------------------------------------------------------------

export const MOMENT_STATUSES = ['scored', 'candidate'];

export const Moment = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string(),
  hookLine: z.string(),
  summary: z.string(),
  scores: z.object({ subScores: MomentSubScores, weights: z.record(z.string(), z.number()) }),
  score: unit,
  status: z.enum(MOMENT_STATUSES),
  jobId: z.uuid().nullable(),
  createdAt: z.string(),
});

export const JOB_KINDS = ['moments', 'reels', 'revise'];
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'];

export const EditingJob = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdBy: z.uuid().nullable(),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUSES),
  assetId: z.uuid().nullable(),
  timelineId: z.uuid().nullable(),
  input: z.unknown(),
  result: z.unknown().nullable(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).nullable(),
  runIds: z.array(z.uuid()),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
