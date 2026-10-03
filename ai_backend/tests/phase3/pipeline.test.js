// P3.T1 orchestration: media.process -> transcription || scenes -> faces, analysis ->
// embeddings -> indexed, recorded per step in processing_jobs. The Track B steps
// (scenes, faces, analysis) are replaced by the fakes in ./helpers.js.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { query } from '../../src/db/pool.js';
import { NonRetryableError } from '../../src/lib/errors.js';
import { JOBS } from '../../src/queue/jobs.js';
import { PIPELINE, resetPipeline, setStepRunner } from '../../src/workers/process.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { assetStatus, countRows, fakeScenes, registerOriginal, stepRows, team, useFakeTrackB } from './helpers.js';

const app = createApp({ log: { error() {} } });
const STEP_NAMES = ['analysis', 'embeddings', 'faces', 'scenes', 'transcription'];

let t;
beforeEach(async () => {
  await resetDb();
  await clearQueues();
  getStorage().reset();
  getTranscription().reset();
  getEmbeddings().reset();
  resetPipeline();
  useFakeTrackB();
  t = await team(app);
});
afterEach(resetPipeline);
afterAll(closeAll);

describe('pipeline topology', () => {
  it('declares the five steps with their dependencies and job names', () => {
    const byStep = Object.fromEntries(PIPELINE.map((s) => [s.step, s]));
    expect(Object.keys(byStep).sort()).toEqual(STEP_NAMES);
    expect(byStep.transcription.after).toEqual([]);
    expect(byStep.scenes.after).toEqual([]);
    expect(byStep.faces.after).toEqual(['scenes']);
    expect(byStep.analysis.after).toEqual(['scenes']);
    expect([...byStep.embeddings.after].sort()).toEqual(['analysis', 'faces', 'scenes', 'transcription']);
    expect(byStep.transcription.job).toBe(JOBS.MEDIA_TRANSCRIPTION);
    expect(byStep.embeddings.job).toBe(JOBS.MEDIA_EMBEDDINGS);
  });
});

describe('media.process', () => {
  it('register -> drainQueue -> asset indexed with every step done, one job per step', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    const results = await drainQueue();

    expect(await assetStatus(asset.id)).toBe('indexed');
    const steps = await stepRows(asset.id);
    expect(steps.map((s) => s.step)).toEqual(STEP_NAMES);
    for (const s of steps) expect(s).toMatchObject({ status: 'done', error: null, attempts: 1 });

    const ran = results.map((r) => r.name);
    expect(ran[0]).toBe(JOBS.MEDIA_PROCESS);
    for (const job of [JOBS.MEDIA_TRANSCRIPTION, JOBS.MEDIA_SCENES, JOBS.MEDIA_FACES, JOBS.MEDIA_ANALYSIS, JOBS.MEDIA_EMBEDDINGS]) {
      expect(ran.filter((n) => n === job)).toHaveLength(1);
    }
    expect(results.every((r) => r.state === 'completed')).toBe(true);
    // dependencies ran first
    expect(ran.indexOf(JOBS.MEDIA_FACES)).toBeGreaterThan(ran.indexOf(JOBS.MEDIA_SCENES));
    expect(ran.indexOf(JOBS.MEDIA_EMBEDDINGS)).toBeGreaterThan(ran.indexOf(JOBS.MEDIA_ANALYSIS));
    expect(ran.indexOf(JOBS.MEDIA_EMBEDDINGS)).toBeGreaterThan(ran.indexOf(JOBS.MEDIA_TRANSCRIPTION));
  });

  it('the asset is processing while the steps run', async () => {
    await registerOriginal(app, t.project, t.editor.token);
    let seen;
    setStepRunner('scenes', async (input) => {
      seen = await assetStatus(input.assetId);
      return fakeScenes(input);
    });
    await drainQueue();
    expect(seen).toBe('processing');
  });

  it('transcript segments are ordered, non-overlapping and within the asset duration', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token, { durationMs: 20_000 });
    await drainQueue();
    const { rows } = await query(
      'SELECT start_ms, end_ms, text FROM transcript_segments WHERE asset_id = $1 ORDER BY start_ms',
      [asset.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    let lastEnd = 0;
    for (const r of rows) {
      expect(r.start_ms).toBeGreaterThanOrEqual(lastEnd);
      expect(r.end_ms).toBeGreaterThan(r.start_ms);
      expect(r.end_ms).toBeLessThanOrEqual(20_000);
      lastEnd = r.end_ms;
    }
    // the transcription step asked for the project's audio-only URL
    expect(getTranscription().calls[0].url).toBe(getStorage().audioUrl(asset.publicId));
  });

  it('a missing asset (deleted before the job ran) completes the job without side effects', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await query('DELETE FROM assets WHERE id = $1', [asset.id]);
    const results = await drainQueue();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: JOBS.MEDIA_PROCESS, state: 'completed' });
    expect(await stepRows(asset.id)).toEqual([]);
  });
});

describe('failures and retries', () => {
  it('a step that keeps failing -> asset failed, error stored, downstream never runs, other assets unaffected', async () => {
    const bad = await registerOriginal(app, t.project, t.editor.token);
    const good = await registerOriginal(app, t.project, t.editor.token);
    setStepRunner('scenes', async (input) => {
      if (input.assetId === bad.id) throw new Error('ffmpeg exploded');
      return fakeScenes(input);
    });

    await drainQueue();

    expect(await assetStatus(bad.id)).toBe('failed');
    const steps = Object.fromEntries((await stepRows(bad.id)).map((s) => [s.step, s]));
    expect(steps.scenes).toMatchObject({ status: 'failed', error: 'ffmpeg exploded', attempts: 3 });
    expect(steps.faces.status).toBe('queued');
    expect(steps.analysis.status).toBe('queued');
    expect(steps.embeddings.status).toBe('queued');
    expect(steps.transcription.status).toBe('done');

    expect(await assetStatus(good.id)).toBe('indexed');
    expect((await stepRows(good.id)).every((s) => s.status === 'done')).toBe(true);
  });

  it('a NonRetryableError fails the step on the first attempt', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    setStepRunner('faces', async () => {
      throw new NonRetryableError('keyframe missing');
    });
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('failed');
    const faces = (await stepRows(asset.id)).find((s) => s.step === 'faces');
    expect(faces).toMatchObject({ status: 'failed', error: 'keyframe missing', attempts: 1 });
  });

  it('a transient failure succeeds on the second attempt', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    getTranscription().queueResult(new Error('Groq 503'));
    const results = await drainQueue();

    expect(await assetStatus(asset.id)).toBe('indexed');
    const tr = (await stepRows(asset.id)).find((s) => s.step === 'transcription');
    expect(tr).toMatchObject({ status: 'done', attempts: 2, error: null });
    const transcriptionJobs = results.filter((r) => r.name === JOBS.MEDIA_TRANSCRIPTION);
    expect(transcriptionJobs.map((r) => r.state)).toEqual(['failed', 'completed']);
  });

  it('reprocess (editor) recovers a failed asset and the rerun does not duplicate rows', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    let broken = true;
    setStepRunner('analysis', async (input) => {
      if (broken) throw new NonRetryableError('vision model down');
      const { fakeAnalysis } = await import('./helpers.js');
      return fakeAnalysis(input);
    });
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('failed');

    broken = false;
    const res = await request(app)
      .post(`/projects/${t.project.id}/media/${asset.id}/reprocess`)
      .set(authHeader(t.editor.token));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.asset.status).toBe('processing');
    for (const s of Object.values(res.body.steps)) expect(s.status).toBe('queued');

    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('indexed');
    const once = await countRows(asset.id);

    // a second full rerun leaves the same number of rows
    const again = await request(app)
      .post(`/projects/${t.project.id}/media/${asset.id}/reprocess`)
      .set(authHeader(t.owner.token));
    expect(again.status).toBe(202);
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('indexed');
    expect(await countRows(asset.id)).toEqual(once);
    expect(once.transcript_segments).toBeGreaterThan(0);
    expect(once.scenes).toBe(2);
    expect(once.faces).toBe(1);
    expect(once.asset_analysis).toBe(1);
  });

  it('a job from a superseded run is skipped', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    // Run media.process only: the first two step jobs are now queued for run #1.
    await drainQueue({ names: [JOBS.MEDIA_PROCESS] });
    const { rows } = await query('SELECT run_id FROM processing_jobs WHERE asset_id = $1 LIMIT 1', [asset.id]);
    const firstRun = rows[0].run_id;

    // Reprocess starts run #2 before run #1's jobs ran.
    const res = await request(app)
      .post(`/projects/${t.project.id}/media/${asset.id}/reprocess`)
      .set(authHeader(t.editor.token));
    expect(res.status).toBe(202);
    const results = await drainQueue();

    expect(await assetStatus(asset.id)).toBe('indexed');
    const skipped = results.filter((r) => r.output?.skipped);
    expect(skipped.length).toBe(2);
    const { rows: after } = await query('SELECT DISTINCT run_id FROM processing_jobs WHERE asset_id = $1', [asset.id]);
    expect(after).toHaveLength(1);
    expect(after[0].run_id).not.toBe(firstRun);
    for (const s of await stepRows(asset.id)) expect(s).toMatchObject({ status: 'done', attempts: 1 });
  });
});
