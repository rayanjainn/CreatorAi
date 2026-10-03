// agents/editing service (phase 6): moments, scoring and the Editing Agent.
// The module's public API: other modules import this file and nothing else from here.
//
// Requests (routes) queue an editing_jobs row and a pg-boss job and answer 202 { jobId };
// the job handlers (workers/editing.js) call the run*Job functions below.
import { conflict, notFound } from '../../../lib/errors.js';
import { JOBS } from '../../../queue/jobs.js';
import { getAsset } from '../../media/service.js';
import { queueJob, runJob, toJob } from './jobs.js';
import { generateMoments } from './moments.js';
import * as repo from './repo.js';
import { Moment, MomentsBody, Uuid } from './schemas.js';

export { configureEditing, getEditingConfig, resetEditing } from './config.js';
export { SCORE_KEYS, buildWindows, scoreMoment, selectCandidates } from './selection.js';

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

// ---- jobs -------------------------------------------------------------------------------

// getJob(projectId, jobId) -> job. Malformed, missing or other project's id -> 404.
export async function getJob(projectId, jobId) {
  const row = isUuid(projectId) && isUuid(jobId) ? await repo.findJob(projectId, jobId) : null;
  if (!row) throw notFound('Editing job not found');
  return toJob(row);
}
