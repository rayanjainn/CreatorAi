// P3.T4: the embeddings step (every segment and scene gets an EMBED_DIM vector) and
// POST /projects/:projectId/search (viewer+, project-scoped, cosine-ranked).
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { createEmbeddingsClient } from '../../src/adapters/embeddings/real.js';
import { getEnv } from '../../src/config/env.js';
import { query } from '../../src/db/pool.js';
import { createDerivedAsset, derivedFolder } from '../../src/modules/media/service.js';
import { resetPipeline } from '../../src/workers/process.js';
import { run as runEmbeddings } from '../../src/workers/steps/embeddings.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { assetStatus, createProject, FAKE_CAPTIONS, registerOriginal, stepRows, team, useFakeTrackB } from './helpers.js';

const app = createApp({ log: { error() {} } });
const DIM = getEnv().EMBED_DIM;

// One-hot-ish unit vector on `axis` (plus `mix` of axis + 1).
function axisVector(axis, mix = 0) {
  const v = Array.from({ length: DIM }, (_, i) => (i === axis ? 1 : i === axis + 1 ? mix : 0));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

const transcript = (texts) => ({
  language: 'en',
  durationMs: 20_000,
  segments: texts.map((text, i) => ({ startMs: i * 5_000, endMs: i * 5_000 + 4_000, text })),
});

async function embeddingsOf(table, assetId) {
  const { rows } = await query(`SELECT embedding FROM ${table} WHERE asset_id = $1`, [assetId]);
  return rows.map((r) => (typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding));
}

const search = (projectId, token, body) =>
  request(app).post(`/projects/${projectId}/search`).set(authHeader(token)).send(body);

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

describe('embeddings step', () => {
  it('every transcript segment and scene has a non-null embedding of EMBED_DIM after the pipeline', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('indexed');

    const segs = await embeddingsOf('transcript_segments', asset.id);
    const scenes = await embeddingsOf('scenes', asset.id);
    expect(segs.length).toBeGreaterThan(0);
    expect(scenes).toHaveLength(2);
    for (const e of [...segs, ...scenes]) {
      expect(e).not.toBeNull();
      expect(e).toHaveLength(DIM);
      expect(e.every(Number.isFinite)).toBe(true);
    }
  });

  it('scenes with a keyframe are embedded as images; without one, as caption text', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await drainQueue();
    const keyframe = await createDerivedAsset(t.project.id, {
      kind: 'keyframe',
      parentAssetId: asset.id,
      publicId: `${derivedFolder(t.project.id)}/kf-0`,
      url: 'https://res.fake-cloudinary.test/demo/image/upload/kf-0.jpg',
    });
    await query('UPDATE scenes SET keyframe_asset_id = $2 WHERE asset_id = $1 AND idx = 0', [asset.id, keyframe.id]);
    getEmbeddings().reset();

    const out = await runEmbeddings({ assetId: asset.id, projectId: t.project.id });
    expect(out).toMatchObject({ scenes: 2, imageScenes: 1, dim: DIM });
    const calls = getEmbeddings().calls;
    expect(calls.find((c) => c.fn === 'embedImages').inputs).toEqual([keyframe.url]);
    expect(calls.some((c) => c.fn === 'embedTexts' && c.inputs.includes(FAKE_CAPTIONS[1]))).toBe(true);

    // a text-only model: the keyframe scene falls back to its caption
    getEmbeddings().reset();
    getEmbeddings().setImageSupport(false);
    const textOnly = await runEmbeddings({ assetId: asset.id, projectId: t.project.id });
    expect(textOnly.imageScenes).toBe(0);
    expect(getEmbeddings().calls.some((c) => c.fn === 'embedImages')).toBe(false);
    expect(getEmbeddings().calls.some((c) => c.fn === 'embedTexts' && c.inputs.includes(FAKE_CAPTIONS[0]))).toBe(true);
    for (const e of await embeddingsOf('scenes', asset.id)) expect(e).toHaveLength(DIM);
  });

  it('an embeddings outage is retried and then succeeds', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    // query-free pipeline: the first embedTexts call is the embeddings step's
    getEmbeddings().failNext(new Error('Gemini 503'));
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('indexed');
    expect((await stepRows(asset.id)).find((s) => s.step === 'embeddings')).toMatchObject({ status: 'done', attempts: 2 });
  });
});

describe('POST /projects/:projectId/search', () => {
  async function indexedWithTranscript(project, token, texts) {
    getTranscription().queueResult(transcript(texts));
    const asset = await registerOriginal(app, project, token);
    await drainQueue();
    expect(await assetStatus(asset.id)).toBe('indexed');
    return asset;
  }

  it('seeded embeddings: the expected segment ranks first; a viewer can search', async () => {
    const fake = getEmbeddings();
    fake.seed('text:intro about coffee', axisVector(10));
    fake.seed('text:grinding beans finer', axisVector(20));
    fake.seed('text:pulling the espresso shot', axisVector(30));
    fake.seed('text:how fine should I grind?', axisVector(20, 0.2));
    const asset = await indexedWithTranscript(t.project, t.editor.token, [
      'intro about coffee',
      'grinding beans finer',
      'pulling the espresso shot',
    ]);

    const res = await search(t.project.id, t.viewer.token, { query: 'how fine should I grind?', limit: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [top] = res.body.hits;
    expect(top).toMatchObject({ kind: 'transcript', assetId: asset.id, startMs: 5_000, endMs: 9_000, text: 'grinding beans finer' });
    expect(top.score).toBeGreaterThan(0.9);
    expect(res.body.hits.length).toBeLessThanOrEqual(5);
    const scores = res.body.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('never returns another project’s assets', async () => {
    const fake = getEmbeddings();
    fake.seed('text:secret recipe', axisVector(40));
    fake.seed('text:secret', axisVector(40));
    fake.seed('text:public talk', axisVector(41));
    const other = await createProject(app, t.outsider.token, 'Other');
    const foreign = await indexedWithTranscript(other, t.outsider.token, ['secret recipe']);
    const mine = await indexedWithTranscript(t.project, t.editor.token, ['public talk']);

    const res = await search(t.project.id, t.owner.token, { query: 'secret', limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.hits.length).toBeGreaterThan(0);
    expect(res.body.hits.every((h) => h.assetId === mine.id)).toBe(true);
    expect(res.body.hits.some((h) => h.assetId === foreign.id)).toBe(false);

    // and asking for the foreign asset by id finds nothing
    const byId = await search(t.project.id, t.owner.token, { query: 'secret', assetIds: [foreign.id] });
    expect(byId.body.hits).toEqual([]);
  });

  it('kinds and assetIds filter the hits; scene hits carry the caption', async () => {
    const a = await indexedWithTranscript(t.project, t.editor.token, ['one', 'two']);
    const b = await indexedWithTranscript(t.project, t.editor.token, ['three']);

    const scenes = await search(t.project.id, t.editor.token, { query: 'kitchen', kinds: ['scene'], limit: 50 });
    expect(scenes.body.hits).toHaveLength(4);
    for (const h of scenes.body.hits) {
      expect(h.kind).toBe('scene');
      expect(FAKE_CAPTIONS).toContain(h.caption);
      expect(h).toHaveProperty('keyframeAssetId');
    }

    const onlyB = await search(t.project.id, t.editor.token, { query: 'three', assetIds: [b.id], limit: 50 });
    expect(onlyB.body.hits.length).toBe(3); // 1 segment + 2 scenes
    expect(onlyB.body.hits.every((h) => h.assetId === b.id)).toBe(true);
    expect(onlyB.body.hits.some((h) => h.assetId === a.id)).toBe(false);

    const transcriptOnly = await search(t.project.id, t.editor.token, { query: 'one', kinds: ['transcript'], limit: 50 });
    expect(transcriptOnly.body.hits.map((h) => h.kind)).toEqual(['transcript', 'transcript', 'transcript']);
  });

  it('validates the body', async () => {
    for (const body of [{}, { query: '' }, { query: 'x', kinds: ['faces'] }, { query: 'x', limit: 0 }, { query: 'x', assetIds: ['nope'] }, { query: 'x', extra: 1 }]) {
      const res = await search(t.project.id, t.viewer.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('an empty project returns no hits', async () => {
    const res = await search(t.project.id, t.viewer.token, { query: 'anything' });
    expect(res.status).toBe(200);
    expect(res.body.hits).toEqual([]);
  });
});

describe('real embeddings adapter (Gemini, fetch stubbed)', () => {
  const env = { GEMINI_API_KEY: 'gem-key', EMBED_MODEL: 'gemini-embedding-test', EMBED_DIM: 4 };
  const noLimit = { take: async () => {} };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  afterEach(() => vi.unstubAllGlobals());

  it('batchEmbedContents with outputDimensionality from env; vectors normalised', async () => {
    const fetch = vi.fn(async () => json(200, { embeddings: [{ values: [3, 4, 0, 0] }, { values: [0, 0, 0, 2] }] }));
    vi.stubGlobal('fetch', fetch);
    const out = await createEmbeddingsClient({ env, limiter: noLimit }).embedTexts(['a', 'b']);
    expect(out).toEqual([
      [0.6, 0.8, 0, 0],
      [0, 0, 0, 1],
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-test:batchEmbedContents');
    expect(init.headers['x-goog-api-key']).toBe('gem-key');
    const body = JSON.parse(init.body);
    expect(body.requests).toEqual([
      { model: 'models/gemini-embedding-test', content: { parts: [{ text: 'a' }] }, outputDimensionality: 4 },
      { model: 'models/gemini-embedding-test', content: { parts: [{ text: 'b' }] }, outputDimensionality: 4 },
    ]);
  });

  it('images are fetched and sent inline; a text-only model reports unsupported', async () => {
    const fetch = vi.fn(async (url) =>
      String(url).startsWith('https://img.test/')
        ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
        : json(200, { embeddings: [{ values: [1, 0, 0, 0] }] }),
    );
    vi.stubGlobal('fetch', fetch);
    const client = createEmbeddingsClient({ env, limiter: noLimit });
    expect(client.supportsImages()).toBe(true);
    expect(await client.embedImages(['https://img.test/k.png'])).toEqual([[1, 0, 0, 0]]);
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.requests[0].content.parts[0]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AQID' } });

    const textOnly = createEmbeddingsClient({ env: { ...env, EMBED_MODEL: 'gemini-embedding-001' }, limiter: noLimit });
    expect(textOnly.supportsImages()).toBe(false);
    await expect(textOnly.embedImages(['https://img.test/k.png'])).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('a wrong dimension, a 429 then success, and a 400', async () => {
    const sleep = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { embeddings: [{ values: [1, 2] }] })));
    await expect(createEmbeddingsClient({ env, limiter: noLimit }).embedTexts(['a'])).rejects.toThrow(/expected 4/);

    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++n === 1 ? json(429, { error: { message: 'quota' } }) : json(200, { embeddings: [{ values: [0, 1, 0, 0] }] }))),
    );
    expect(await createEmbeddingsClient({ env, limiter: noLimit, sleep }).embedTexts(['a'])).toEqual([[0, 1, 0, 0]]);
    expect(sleep).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { message: 'bad request' } })));
    await expect(createEmbeddingsClient({ env, limiter: noLimit }).embedTexts(['a'])).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
  });
});
