// P3 orchestrator: turns one media.process job into the processing pipeline
//
//   transcription ─────────────────────────────┐
//   scenes ──┬─► faces ─────────────────────────┼─► embeddings ─► asset 'indexed'
//            └─► analysis ──────────────────────┘
//
// Job topology: one pg-boss job per step (JOBS.MEDIA_<STEP>, payload { assetId,
// projectId, runId }). media.process starts a new run: it writes one processing_jobs row
// per step (status 'queued', fresh run_id), sets the asset 'processing' and schedules the
// steps without dependencies. When a step finishes, the steps whose dependencies are all
// 'done' are scheduled; the rows are locked (in step order) while that is decided, so two
// steps finishing at once never schedule the same step twice. The last step marks the
// asset 'indexed'.
//
// Failures: a step that throws is retried by the orchestrator itself (attempts counted in
// processing_jobs, a new job per attempt, pg-boss retries off) up to maxAttempts; a
// NonRetryableError (err.retryable === false) or the last attempt marks the step and the
// asset 'failed' with the error stored. Nothing downstream is scheduled after a failure,
// and other assets are unaffected. A job whose runId is no longer the row's run_id (the
// asset was reprocessed meanwhile, or deleted) is skipped.
//
// Steps are looked up in a registry at call time: tests replace a step with
// setStepRunner(step, run) and restore the real modules with resetPipeline().
import { randomUUID } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import { enqueue } from '../queue/boss.js';
import { JOBS } from '../queue/jobs.js';
import { getAsset, setAssetStatus } from '../modules/media/service.js';
import * as transcription from './steps/transcription.js';
import * as scenes from './steps/scenes.js';
import * as faces from './steps/faces.js';
import * as analysis from './steps/analysis.js';
import * as embeddings from './steps/embeddings.js';

export const PIPELINE = Object.freeze([
  { step: 'transcription', job: JOBS.MEDIA_TRANSCRIPTION, after: [] },
  { step: 'scenes', job: JOBS.MEDIA_SCENES, after: [] },
  { step: 'faces', job: JOBS.MEDIA_FACES, after: ['scenes'] },
  { step: 'analysis', job: JOBS.MEDIA_ANALYSIS, after: ['scenes'] },
  { step: 'embeddings', job: JOBS.MEDIA_EMBEDDINGS, after: ['transcription', 'scenes', 'faces', 'analysis'] },
]);

export const STEP_NAMES = Object.freeze(PIPELINE.map((s) => s.step));
const BY_STEP = new Map(PIPELINE.map((s) => [s.step, s]));

// ---- registry ---------------------------------------------------------------------

const DEFAULT_RUNNERS = Object.freeze({
  transcription: transcription.run,
  scenes: scenes.run,
  faces: faces.run,
  analysis: analysis.run,
  embeddings: embeddings.run,
});

const runners = { ...DEFAULT_RUNNERS };

const defaultConfig = () => ({
  maxAttempts: 3,
  // Delay before attempt n + 1 = retryDelayMs * 2^(n - 1). 0 in tests, so drainQueue()
  // picks the retry up in the same drain.
  retryDelayMs: getEnv().NODE_ENV === 'test' ? 0 : 10_000,
});

let config;
const cfg = () => (config ??= defaultConfig());

// setStepRunner(step, run): replaces one step's run({ assetId, projectId }) (tests).
export function setStepRunner(step, run) {
  if (!BY_STEP.has(step)) throw new Error(`Unknown pipeline step "${step}"`);
  runners[step] = run;
}

// configurePipeline({ maxAttempts?, retryDelayMs? }) (tests / tuning).
export function configurePipeline(options = {}) {
  config = { ...cfg(), ...options };
}

// Restores the real step modules and the default retry policy.
export function resetPipeline() {
  Object.assign(runners, DEFAULT_RUNNERS);
  config = undefined;
}

// ---- state ------------------------------------------------------------------------

const send = (db, job, data, startAfterMs = 0) =>
  enqueue(job, data, {
    db: { executeSql: (text, values) => db.query(text, values) },
    retryLimit: 0, // the orchestrator counts attempts itself
    ...(startAfterMs > 0 ? { startAfter: Math.ceil(startAfterMs / 1000) } : {}),
  });

// Locks every step row of the asset's current run, in a fixed order (no deadlocks).
async function lockRun(client, assetId, runId) {
  const { rows } = await client.query(
    `SELECT step, status, job_id FROM processing_jobs WHERE asset_id = $1 AND run_id = $2 ORDER BY step FOR UPDATE`,
    [assetId, runId],
  );
  return rows;
}

// Schedules every queued, unscheduled step whose dependencies are done. Returns true
// when every step of the run is done.
async function advance(client, { assetId, projectId, runId }) {
  const rows = await lockRun(client, assetId, runId);
  if (!rows.length || rows.some((r) => r.status === 'failed')) return false;
  const status = new Map(rows.map((r) => [r.step, r]));
  for (const { step, job, after } of PIPELINE) {
    const row = status.get(step);
    if (!row || row.status !== 'queued' || row.job_id) continue;
    if (!after.every((dep) => status.get(dep)?.status === 'done')) continue;
    const jobId = await send(client, job, { assetId, projectId, runId });
    await client.query(
      `UPDATE processing_jobs SET job_id = $3, updated_at = now() WHERE asset_id = $1 AND step = $2`,
      [assetId, step, jobId],
    );
  }
  return rows.every((r) => r.status === 'done');
}

// media.process handler: starts a new run for the asset.
export async function processAsset({ assetId, projectId }) {
  try {
    await getAsset(projectId, assetId);
  } catch (err) {
    if (err?.status === 404) return { skipped: 'asset not found' };
    throw err;
  }
  const runId = randomUUID();
  await withTransaction(async (client) => {
    // Locks the asset row, so two runs for one asset start one after the other.
    const { rowCount } = await client.query(
      `UPDATE assets SET status = 'processing', updated_at = now() WHERE id = $1 AND project_id = $2`,
      [assetId, projectId],
    );
    if (!rowCount) return;
    for (const step of STEP_NAMES) {
      await client.query(
        `INSERT INTO processing_jobs (asset_id, step, status, run_id) VALUES ($1, $2, 'queued', $3)
         ON CONFLICT (asset_id, step) DO UPDATE SET status = 'queued', error = NULL, attempts = 0,
           run_id = EXCLUDED.run_id, job_id = NULL, output = NULL, updated_at = now()`,
        [assetId, step, runId],
      );
    }
    await advance(client, { assetId, projectId, runId });
  });
  return { runId, steps: STEP_NAMES.length };
}

const errorText = (err) => String(err?.message || err || 'step failed').slice(0, 2000);

// The handler of one step job.
export async function runStep(step, { assetId, projectId, runId }) {
  // Claim: only the current run's scheduled row moves to running.
  const { rows } = await query(
    `UPDATE processing_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE asset_id = $1 AND step = $2 AND run_id = $3 AND status IN ('queued', 'running')
     RETURNING attempts`,
    [assetId, step, runId],
  );
  if (!rows.length) return { skipped: 'superseded run' };
  const attempt = rows[0].attempts;

  let output;
  try {
    output = (await runners[step]({ assetId, projectId })) ?? {};
  } catch (err) {
    await onFailure(step, { assetId, projectId, runId }, attempt, err);
    throw err;
  }

  const finished = await withTransaction(async (client) => {
    const locked = await lockRun(client, assetId, runId);
    if (!locked.some((r) => r.step === step && r.status === 'running')) return null;
    await client.query(
      `UPDATE processing_jobs SET status = 'done', error = NULL, output = $3, updated_at = now()
       WHERE asset_id = $1 AND step = $2`,
      [assetId, step, JSON.stringify(output)],
    );
    return advance(client, { assetId, projectId, runId });
  });
  if (finished === null) return { skipped: 'superseded run' };
  if (finished) await setAssetStatus(assetId, 'indexed');
  return { step, attempt, ...(typeof output === 'object' && !Array.isArray(output) ? output : { output }) };
}

async function onFailure(step, { assetId, projectId, runId }, attempt, err) {
  const { maxAttempts, retryDelayMs } = cfg();
  const retry = err?.retryable !== false && attempt < maxAttempts;
  const failedRun = await withTransaction(async (client) => {
    const locked = await lockRun(client, assetId, runId);
    if (!locked.some((r) => r.step === step && r.status === 'running')) return false;
    if (retry) {
      const jobId = await send(client, BY_STEP.get(step).job, { assetId, projectId, runId }, retryDelayMs * 2 ** (attempt - 1));
      await client.query(
        `UPDATE processing_jobs SET status = 'queued', error = $3, job_id = $4, updated_at = now()
         WHERE asset_id = $1 AND step = $2`,
        [assetId, step, errorText(err), jobId],
      );
      return false;
    }
    await client.query(
      `UPDATE processing_jobs SET status = 'failed', error = $3, updated_at = now() WHERE asset_id = $1 AND step = $2`,
      [assetId, step, errorText(err)],
    );
    return true;
  });
  if (failedRun) await setAssetStatus(assetId, 'failed');
}

// Job name -> handler, registered in workers/index.js.
export const stepHandlers = Object.fromEntries(PIPELINE.map(({ step, job }) => [job, (data) => runStep(step, data)]));
