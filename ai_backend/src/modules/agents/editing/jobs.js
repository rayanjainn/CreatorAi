// editing_jobs lifecycle: queue a job (row + pg-boss job in one transaction), run it
// (queued -> running -> succeeded | failed) and render it. A job's failure is recorded on
// its row and the pg-boss job completes, so a decided outcome is never retried.
import { withTransaction } from '../../../db/pool.js';
import { HttpError } from '../../../lib/errors.js';
import { enqueue } from '../../../queue/boss.js';
import * as repo from './repo.js';
import { EditingJob } from './schemas.js';

// A failure recorded on the job: { code, message, details? }.
export class JobError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'JobError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const iso = (v) => (v == null ? null : new Date(v).toISOString());

export const toJob = (row) =>
  EditingJob.parse({
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by ?? null,
    kind: row.kind,
    status: row.status,
    assetId: row.asset_id ?? null,
    timelineId: row.timeline_id ?? null,
    input: row.input,
    result: row.result ?? null,
    error: row.error ?? null,
    runIds: row.run_ids ?? [],
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  });

// queueJob(jobName, { projectId, userId, kind, assetId?, timelineId?, input }) -> job.
export async function queueJob(jobName, fields) {
  const row = await withTransaction(async (client) => {
    const inserted = await repo.insertJob(fields, client);
    const db = { executeSql: (text, values) => client.query(text, values) };
    await enqueue(jobName, { jobId: inserted.id }, { db });
    return inserted;
  });
  return toJob(row);
}

function toJobErrorBody(err) {
  if (err instanceof JobError || err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return body;
  }
  return { code: 'job_error', message: err?.message || 'Job failed' };
}

// runJob(jobId, work): work(job, runIds) -> result. Skips a job that is missing or no
// longer queued. Returns { jobId, status }.
export async function runJob(jobId, work) {
  const row = await repo.markJobRunning(jobId);
  if (!row) return { jobId, status: 'skipped', skipped: true };
  const runIds = [];
  try {
    const result = await work(toJob(row), runIds);
    await repo.finishJob(jobId, { status: 'succeeded', result, runIds });
    return { jobId, status: 'succeeded' };
  } catch (err) {
    await repo.finishJob(jobId, { status: 'failed', error: toJobErrorBody(err), result: err.result ?? null, runIds });
    return { jobId, status: 'failed' };
  }
}
