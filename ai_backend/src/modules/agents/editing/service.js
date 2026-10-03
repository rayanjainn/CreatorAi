// agents/editing service (phase 6): moments, scoring and the Editing Agent.
// The module's public API: other modules import this file and nothing else from here.
//
// Requests (routes) queue an editing_jobs row and a pg-boss job and answer 202 { jobId };
// the job handlers (workers/editing.js) call the run*Job functions below.
import { conflict, notFound } from '../../../lib/errors.js';
import { JOBS } from '../../../queue/jobs.js';
import { getAsset } from '../../media/service.js';
import { queueJob, runJob, toJob } from './jobs.js';
import { getScript } from '../script/service.js';
import { generateMoments } from './moments.js';
import { getHead } from '../../timeline/service.js';
import { generateReels } from './reels.js';
import * as repo from './repo.js';
import { generateRevision } from './revision.js';
import { Moment, MomentsBody, ReelsBody, ReviseBody, Uuid } from './schemas.js';

export { configureEditing, getEditingConfig, resetEditing } from './config.js';
export { SCORE_KEYS, buildWindows, scoreMoment, selectCandidates } from './selection.js';
export { BuildError, buildTimelineDoc } from './builder.js';

const isUuid = (v) => Uuid.safeParse(v).success;
const iso = (v) => new Date(v).toISOString();

const toMoment = (row) =>
  Moment.parse({
    id: row.id,
    assetId: row.asset_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    title: row.title,
    hookLine: row.hook_line,
    summary: row.summary,
    scores: row.scores,
    score: Number(row.score),
    status: row.status,
    jobId: row.job_id ?? null,
    createdAt: iso(row.created_at),
  });

// The asset (404 when missing / other project), 409 unless it is indexed.
async function indexedAsset(projectId, assetId) {
  const asset = await getAsset(projectId, assetId);
  if (asset.status !== 'indexed') {
    throw conflict(`Asset is not indexed yet (status ${asset.status})`, { status: asset.status });
  }
  return asset;
}

// ---- moments ----------------------------------------------------------------------------

// requestMoments(projectId, userId, assetId, body) -> queued job. 404 unknown asset,
// 409 asset not indexed.
export async function requestMoments(projectId, userId, assetId, body = {}) {
  const { topic } = MomentsBody.parse(body ?? {});
  const asset = await indexedAsset(projectId, assetId);
  return queueJob(JOBS.MEDIA_MOMENTS, { projectId, userId, kind: 'moments', assetId: asset.id, input: { topic: topic ?? null } });
}

// listMoments(projectId, assetId) -> moments, best score first. 404 unknown asset.
export async function listMoments(projectId, assetId) {
  const asset = await getAsset(projectId, assetId);
  return (await repo.listMoments(projectId, asset.id)).map(toMoment);
}

export async function runMomentsJob(jobId) {
  return runJob(jobId, (job, runIds) =>
    generateMoments({
      projectId: job.projectId,
      userId: job.createdBy,
      assetId: job.assetId,
      topic: job.input.topic ?? undefined,
      jobId: job.id,
      runIds,
    }),
  );
}

// ---- reels ------------------------------------------------------------------------------

// requestReels(projectId, userId, { assetId, count, targetSeconds, scriptId? }) -> queued
// job. 404 unknown asset or script, 409 asset not indexed.
export async function requestReels(projectId, userId, body) {
  const input = ReelsBody.parse(body);
  const asset = await indexedAsset(projectId, input.assetId);
  if (input.scriptId) await getScript(projectId, input.scriptId);
  return queueJob(JOBS.EDITING_REELS, { projectId, userId, kind: 'reels', assetId: asset.id, input });
}

export async function runReelsJob(jobId) {
  return runJob(jobId, (job, runIds) =>
    generateReels({ ...job.input, projectId: job.projectId, userId: job.createdBy, jobId: job.id, runIds }),
  );
}

// ---- revise -----------------------------------------------------------------------------

// requestRevise(projectId, userId, { timelineId, instruction }) -> queued job. The head
// at request time is the base the revision is made on. 404 unknown timeline.
export async function requestRevise(projectId, userId, body) {
  const { timelineId, instruction } = ReviseBody.parse(body);
  const { timeline, head } = await getHead(projectId, timelineId);
  return queueJob(JOBS.EDITING_REVISE, {
    projectId,
    userId,
    kind: 'revise',
    timelineId: timeline.id,
    input: { timelineId: timeline.id, instruction, baseVersion: head.version, sourceAssetId: timeline.sourceAssetId },
  });
}

export async function runReviseJob(jobId) {
  return runJob(jobId, (job, runIds) =>
    generateRevision({ ...job.input, projectId: job.projectId, userId: job.createdBy, runIds }),
  );
}

// ---- jobs -------------------------------------------------------------------------------

// getJob(projectId, jobId) -> job. Malformed, missing or other project's id -> 404.
export async function getJob(projectId, jobId) {
  const row = isUuid(projectId) && isUuid(jobId) ? await repo.findJob(projectId, jobId) : null;
  if (!row) throw notFound('Editing job not found');
  return toJob(row);
}
