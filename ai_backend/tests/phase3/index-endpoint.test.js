// P3.T5: GET /projects/:projectId/media/:assetId/index (viewer+) -> { asset, transcript,
// scenes, faces, analysis, steps } and POST .../reprocess (editor+).
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { query } from '../../src/db/pool.js';
import { NonRetryableError } from '../../src/lib/errors.js';
import { createDerivedAsset, derivedFolder } from '../../src/modules/media/service.js';
import { resetPipeline, setStepRunner } from '../../src/workers/process.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { createProject, FAKE_CAPTIONS, registerOriginal, team, useFakeTrackB } from './helpers.js';

const app = createApp({ log: { error() {} } });
const STEP_NAMES = ['analysis', 'embeddings', 'faces', 'scenes', 'transcription'];

const getIndex = (projectId, assetId, token) =>
  request(app).get(`/projects/${projectId}/media/${assetId}/index`).set(authHeader(token));

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

describe('GET /media/:assetId/index', () => {
  it('returns the asset, ordered transcript, scenes, faces, analysis and every step done', async () => {
    getTranscription().queueResult({
      language: 'en',
      durationMs: 20_000,
      segments: [
        { startMs: 6_000, endMs: 9_000, text: 'second' },
        { startMs: 0, endMs: 5_000, text: 'first' },
      ],
    });
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await drainQueue();

    const res = await getIndex(t.project.id, asset.id, t.viewer.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body;
    expect(body.asset).toMatchObject({ id: asset.id, projectId: t.project.id, kind: 'original', status: 'indexed' });
    expect(body.transcript).toEqual([
      { startMs: 0, endMs: 5_000, text: 'first', speaker: null },
      { startMs: 6_000, endMs: 9_000, text: 'second', speaker: null },
    ]);
    expect(body.scenes).toEqual([
      { idx: 0, startMs: 0, endMs: 10_000, keyframeAssetId: null, caption: FAKE_CAPTIONS[0] },
      { idx: 1, startMs: 10_000, endMs: 20_000, keyframeAssetId: null, caption: FAKE_CAPTIONS[1] },
    ]);
    expect(body.faces).toEqual([{ sceneIdx: 0, atMs: 0, bbox: { x: 10, y: 20, width: 30, height: 40 } }]);
    expect(body.analysis).toMatchObject({ summary: 'A short talking-head clip', topics: ['hooks', 'retention'] });
    expect(Object.keys(body.steps).sort()).toEqual(STEP_NAMES);
    for (const s of Object.values(body.steps)) {
      expect(s).toMatchObject({ status: 'done', error: null, attempts: 1 });
      expect(Number.isNaN(Date.parse(s.updatedAt))).toBe(false);
    }
    // no embedding vectors leak into the response
    for (const row of [...body.transcript, ...body.scenes]) expect(row).not.toHaveProperty('embedding');
  });

  it('before processing: empty index, no steps; while failed: the error per step', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    const before = await getIndex(t.project.id, asset.id, t.owner.token);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ transcript: [], scenes: [], faces: [], analysis: null, steps: {} });
    expect(before.body.asset.status).toBe('uploaded');

    setStepRunner('scenes', async () => {
      throw new NonRetryableError('no video stream');
    });
    await drainQueue();
    const failed = await getIndex(t.project.id, asset.id, t.owner.token);
    expect(failed.body.asset.status).toBe('failed');
    expect(failed.body.steps.scenes).toMatchObject({ status: 'failed', error: 'no video stream', attempts: 1 });
    expect(failed.body.steps.transcription.status).toBe('done');
    expect(failed.body.steps.faces.status).toBe('queued');
  });

  it('cross-project, unknown and malformed asset ids -> 404', async () => {
    const other = await createProject(app, t.outsider.token, 'Other');
    const foreign = await registerOriginal(app, other, t.outsider.token);
    const mine = await registerOriginal(app, t.project, t.editor.token);

    // an asset of another project, asked through this project
    expect((await getIndex(t.project.id, foreign.id, t.owner.token)).status).toBe(404);
    // this project's asset asked through a project the caller cannot see
    expect((await getIndex(other.id, mine.id, t.owner.token)).status).toBe(404);
    expect((await getIndex(t.project.id, '00000000-0000-4000-8000-000000000000', t.owner.token)).status).toBe(404);
    expect((await getIndex(t.project.id, 'not-a-uuid', t.owner.token)).status).toBe(404);
  });
});

describe('POST /media/:assetId/reprocess', () => {
  it('202: every step queued, the asset processing, exactly one new media.process job', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await drainQueue();
    const res = await request(app).post(`/projects/${t.project.id}/media/${asset.id}/reprocess`).set(authHeader(t.editor.token));
    expect(res.status).toBe(202);
    expect(res.body.asset).toMatchObject({ id: asset.id, status: 'processing' });
    expect(Object.keys(res.body.steps).sort()).toEqual(STEP_NAMES);
    for (const s of Object.values(res.body.steps)) expect(s).toMatchObject({ status: 'queued', attempts: 0, error: null });

    const results = await drainQueue();
    expect(results.filter((r) => r.name === 'media.process')).toHaveLength(1);
    expect((await getIndex(t.project.id, asset.id, t.viewer.token)).body.asset.status).toBe('indexed');
  });

  it('derived assets cannot be reprocessed (400); other projects -> 404', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    const kf = await createDerivedAsset(t.project.id, {
      kind: 'keyframe',
      parentAssetId: asset.id,
      publicId: `${derivedFolder(t.project.id)}/kf`,
      url: 'https://res.fake-cloudinary.test/demo/image/upload/kf.jpg',
    });
    const derived = await request(app).post(`/projects/${t.project.id}/media/${kf.id}/reprocess`).set(authHeader(t.owner.token));
    expect(derived.status).toBe(400);

    const other = await createProject(app, t.outsider.token, 'Other');
    const foreign = await registerOriginal(app, other, t.outsider.token);
    const cross = await request(app).post(`/projects/${t.project.id}/media/${foreign.id}/reprocess`).set(authHeader(t.owner.token));
    expect(cross.status).toBe(404);
    const { rows } = await query('SELECT status FROM assets WHERE id = $1', [foreign.id]);
    expect(rows[0].status).toBe('uploaded');
  });
});
