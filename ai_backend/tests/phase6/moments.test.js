// P6.T1 moments worker over HTTP: POST /media/:assetId/moments (202) -> drainQueue ->
// GET /media/:assetId/moments and GET /agents/editing/jobs/:jobId.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { query } from '../../src/db/pool.js';
import { getAssetIndex } from '../../src/modules/media/service.js';
import { getEditingConfig, resetEditing } from '../../src/modules/agents/editing/service.js';
import { resetPipeline } from '../../src/workers/process.js';
import { resetScenes } from '../../src/workers/steps/scenes.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import {
  analysisReply,
  getJob,
  getMoments,
  momentsReply,
  registerOriginal,
  requestMoments,
  seedIndexedAsset,
  team,
  times,
} from './helpers.js';

const app = createApp({ log: { error() {} } });
const SCORE_KEYS = ['energy', 'hook', 'selfContained', 'topicMatch'];

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  getStorage().reset();
  getTranscription().reset();
  getEmbeddings().reset();
  getLlm().reset();
  resetScenes();
  resetPipeline();
  resetEditing();
});
afterEach(resetScenes);
afterAll(closeAll);

const inUnit = (v) => v >= 0 && v <= 1;

describe('moments on the indexed fixture', () => {
  it('generates moments aligned to segment / scene edges, inside the duration, scores in [0, 1]', async () => {
    const t = await team(app);
    const asset = await registerOriginal(app, t.project, t.editor.token);
    getLlm().queueResponse(analysisReply, analysisReply);
    await drainQueue();
    const index = await getAssetIndex(t.project.id, asset.id);
    expect(index.asset.status).toBe('indexed');

    const { jobId, status } = await requestMoments(app, t.project.id, t.editor.token, asset.id);
    expect(status).toBe('queued');
    getLlm().queueResponse(momentsReply);
    await drainQueue();

    const job = await getJob(app, t.project.id, t.viewer.token, jobId);
    expect(job).toMatchObject({ id: jobId, kind: 'moments', status: 'succeeded', error: null });
    expect(job.runIds).toHaveLength(1);

    const moments = await getMoments(app, t.project.id, t.viewer.token, asset.id);
    expect(moments.length).toBeGreaterThan(0);
    const edges = new Set([
      ...index.segments.flatMap((s) => [s.startMs, s.endMs]),
      ...index.scenes.flatMap((s) => [s.startMs, s.endMs]),
    ]);
    for (const mo of moments) {
      expect(mo.assetId).toBe(asset.id);
      expect(mo.startMs).toBeGreaterThanOrEqual(0);
      expect(mo.endMs).toBeLessThanOrEqual(index.asset.durationMs);
      expect(mo.endMs).toBeGreaterThan(mo.startMs);
      expect(edges.has(mo.startMs), `start ${mo.startMs}`).toBe(true);
      expect(edges.has(mo.endMs), `end ${mo.endMs}`).toBe(true);
      expect(Object.keys(mo.scores.subScores).sort()).toEqual(SCORE_KEYS);
      for (const v of Object.values(mo.scores.subScores)) expect(inUnit(v)).toBe(true);
      expect(inUnit(mo.score)).toBe(true);
      expect(mo.title).toBeTruthy();
      expect(mo.hookLine).toBeTruthy();
    }
  });
});

describe('moments on a seeded long asset', () => {
  it('labels windows in batches, stores weighted scores, marks top-K non-overlapping candidates', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const { jobId } = await requestMoments(app, t.project.id, t.editor.token, asset.id, { topic: 'hooks' });
    getLlm().queueResponse(...times(5, momentsReply));
    await drainQueue();

    const job = await getJob(app, t.project.id, t.editor.token, jobId);
    expect(job.status).toBe('succeeded');
    const cfg = getEditingConfig();
    const moments = await getMoments(app, t.project.id, t.editor.token, asset.id);
    // more windows than one batch -> several labelling calls
    expect(moments.length).toBeGreaterThan(cfg.labelBatch);
    expect(getLlm().calls.length).toBe(Math.ceil(moments.length / cfg.labelBatch));
    expect(getLlm().calls[0].prompt).toContain('hooks');

    const segEdges = new Set(asset.segments.flatMap((s) => [s.startMs, s.endMs]));
    const sceneEdges = new Set(asset.scenes.flatMap((s) => [s.startMs, s.endMs]));
    for (const mo of moments) {
      expect(segEdges.has(mo.startMs) || sceneEdges.has(mo.startMs)).toBe(true);
      expect(segEdges.has(mo.endMs) || sceneEdges.has(mo.endMs)).toBe(true);
      expect(mo.endMs).toBeLessThanOrEqual(asset.durationMs);
      const { subScores, weights } = mo.scores;
      expect(weights).toEqual(cfg.weights);
      const expected = SCORE_KEYS.reduce((sum, k) => sum + weights[k] * subScores[k], 0);
      expect(mo.score).toBeCloseTo(expected, 3);
    }

    const candidates = moments.filter((mo) => mo.status === 'candidate');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(cfg.candidates.k);
    const sorted = [...candidates].sort((a, b) => a.startMs - b.startMs);
    for (const [i, c] of sorted.entries()) {
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(cfg.candidates.minMs);
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(cfg.candidates.maxMs);
      if (i) expect(c.startMs).toBeGreaterThanOrEqual(sorted[i - 1].endMs);
    }
    // the best moment that fits the limits is always a candidate
    const fitting = moments.filter((mo) => mo.endMs - mo.startMs >= cfg.candidates.minMs);
    const best = fitting.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.status).toBe('candidate');
  });

  it('a rerun replaces the moments (no duplicates)', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 60_000 });
    await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse(...times(5, momentsReply));
    await drainQueue();
    const first = await getMoments(app, t.project.id, t.editor.token, asset.id);
    await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse(...times(5, momentsReply));
    await drainQueue();
    const second = await getMoments(app, t.project.id, t.editor.token, asset.id);
    expect(second).toHaveLength(first.length);
    const { rows } = await query('SELECT count(*)::int AS n FROM moments WHERE asset_id = $1', [asset.id]);
    expect(rows[0].n).toBe(first.length);
  });

  it('invalid labels once -> retried with the problem quoted -> succeeds', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 40_000 });
    const { jobId } = await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse({ moments: [{ index: 0, title: 'x' }] }, momentsReply);
    await drainQueue();
    expect((await getJob(app, t.project.id, t.editor.token, jobId)).status).toBe('succeeded');
    expect(getLlm().calls).toHaveLength(2);
    expect(getLlm().calls[1].prompt).toContain('previous reply was invalid');
  });

  it('labels missing a window are rejected too (index check), then retried', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 60_000 });
    const { jobId } = await requestMoments(app, t.project.id, t.editor.token, asset.id);
    const dropLast = (req) => {
      const reply = momentsReply(req);
      return { moments: reply.moments.slice(0, -1) };
    };
    getLlm().queueResponse(dropLast, momentsReply);
    await drainQueue();
    expect((await getJob(app, t.project.id, t.editor.token, jobId)).status).toBe('succeeded');
    expect(getLlm().calls[1].prompt).toMatch(/window/i);
  });

  it('invalid twice -> job failed with the error, no moments written', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 40_000 });
    const { jobId } = await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse({ nope: true }, 'not json at all');
    await drainQueue();
    const job = await getJob(app, t.project.id, t.editor.token, jobId);
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('invalid_output');
    expect(await getMoments(app, t.project.id, t.editor.token, asset.id)).toEqual([]);
  });
});

describe('moments request rules', () => {
  it('asset not indexed -> 409, nothing queued', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { status: 'processing' });
    const res = await request(app)
      .post(`/projects/${t.project.id}/media/${asset.id}/moments`)
      .set(authHeader(t.editor.token))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(await drainQueue()).toEqual([]);
  });

  it('viewer -> 403; unknown or other-project asset -> 404; bad body -> 400', async () => {
    const t = await team(app);
    const other = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const foreign = await seedIndexedAsset(other.project.id);
    const post = (id, token, body = {}) =>
      request(app).post(`/projects/${t.project.id}/media/${id}/moments`).set(authHeader(token)).send(body);
    expect((await post(asset.id, t.viewer.token)).status).toBe(403);
    expect((await post(foreign.id, t.editor.token)).status).toBe(404);
    expect((await post('not-a-uuid', t.editor.token)).status).toBe(404);
    expect((await post(asset.id, t.editor.token, { topic: 42 })).status).toBe(400);
    const get = await request(app).get(`/projects/${t.project.id}/media/${foreign.id}/moments`).set(authHeader(t.viewer.token));
    expect(get.status).toBe(404);
  });

  it('jobs are project-scoped', async () => {
    const t = await team(app);
    const other = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 40_000 });
    const { jobId } = await requestMoments(app, t.project.id, t.editor.token, asset.id);
    const res = await request(app).get(`/projects/${other.project.id}/agents/editing/jobs/${jobId}`).set(authHeader(other.owner.token));
    expect(res.status).toBe(404);
  });
});
