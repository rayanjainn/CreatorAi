// Faces step (P3.T3) and storage.detectFaces: the fake's contract, the real Cloudinary
// call (fetch stubbed, no network), and the step writing faces rows per keyframe.
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnv } from '../../src/config/env.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { FaceBoxes } from '../../src/adapters/storage/contract.js';
import * as realStorage from '../../src/adapters/storage/real.js';
import { run } from '../../src/workers/steps/faces.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { facesOf, insertOriginal, makeProject, seedScenes } from './helpers-b.js';

const storage = getStorage();
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

afterAll(closeAll);

describe('fake storage.detectFaces', () => {
  beforeEach(() => storage.reset());

  it('returns schema-valid, deterministic boxes; setFaces() pins them', async () => {
    const a = FaceBoxes.parse(await storage.detectFaces('proj/p/derived/keyframes/a'));
    expect(await storage.detectFaces('proj/p/derived/keyframes/a')).toEqual(a);
    storage.setFaces('proj/p/derived/keyframes/b', [{ x: 1, y: 2, width: 30, height: 40 }]);
    expect(await storage.detectFaces('proj/p/derived/keyframes/b')).toEqual([{ x: 1, y: 2, width: 30, height: 40 }]);
    storage.setFaces('proj/p/derived/keyframes/c', []);
    expect(await storage.detectFaces('proj/p/derived/keyframes/c')).toEqual([]);
  });
});

describe('real storage.detectFaces (Cloudinary explicit faces=true), no network', () => {
  const ENV = { CLOUDINARY_CLOUD_NAME: 'demo-cloud', CLOUDINARY_API_KEY: '1234', CLOUDINARY_API_SECRET: 'shh-secret' };
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, ENV);
    resetEnv();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnv();
    vi.unstubAllGlobals();
  });

  it('signs an explicit call and maps faces [[x,y,w,h]] to boxes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ public_id: 'k/1', faces: [[10, 20, 30, 40], [50, 60, 70, 80]] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const boxes = await realStorage.detectFaces('k/1');
    expect(boxes).toEqual([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 50, y: 60, width: 70, height: 80 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/explicit');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body);
    expect(body.get('public_id')).toBe('k/1');
    expect(body.get('type')).toBe('upload');
    expect(body.get('faces')).toBe('true');
    expect(body.get('api_key')).toBe('1234');
    const ts = body.get('timestamp');
    expect(body.get('signature')).toBe(sha1(`faces=true&public_id=k/1&timestamp=${ts}&type=upload` + 'shh-secret'));
  });

  it('no faces field -> []; HTTP error -> throws with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ public_id: 'k/1' }), { status: 200 })));
    expect(await realStorage.detectFaces('k/1')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Resource not found' } }), { status: 404 })));
    await expect(realStorage.detectFaces('k/1')).rejects.toThrow(/404 Resource not found/);
  });
});

describe('faces step', () => {
  beforeEach(async () => {
    await resetDb();
    storage.reset();
  });

  it('stores one row per detected face: scene, keyframe time (mid-point) and bbox from the fake', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    const scenes = await seedScenes(projectId, asset.id, [[0, 7000], [7000, 14000], [14000, 20000]]);
    storage.setFaces(scenes[0].keyframePublicId, [{ x: 10, y: 20, width: 30, height: 40 }]);
    storage.setFaces(scenes[1].keyframePublicId, []);
    storage.setFaces(scenes[2].keyframePublicId, [
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
    ]);

    const out = await run({ assetId: asset.id, projectId });
    expect(out).toMatchObject({ keyframes: 3, faces: 3 });

    const rows = await facesOf(asset.id);
    expect(rows.map((r) => [r.scene_id, r.at_ms])).toEqual([
      [scenes[0].sceneId, 3500],
      [scenes[2].sceneId, 17000],
      [scenes[2].sceneId, 17000],
    ]);
    expect(rows[0].bbox).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(rows.slice(1).map((r) => r.bbox)).toEqual(
      expect.arrayContaining([{ x: 1, y: 2, width: 3, height: 4 }, { x: 5, y: 6, width: 7, height: 8 }]),
    );
  });

  it('re-run replaces its rows (no duplicates); scenes without a keyframe are skipped', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    const scenes = await seedScenes(projectId, asset.id, [[0, 10000], [10000, 20000]]);
    storage.setFaces(scenes[0].keyframePublicId, [{ x: 1, y: 1, width: 10, height: 10 }]);
    storage.setFaces(scenes[1].keyframePublicId, [{ x: 2, y: 2, width: 20, height: 20 }]);
    await run({ assetId: asset.id, projectId });
    await run({ assetId: asset.id, projectId });
    expect(await facesOf(asset.id)).toHaveLength(2);

    const { query } = await import('../../src/db/pool.js');
    await query('UPDATE scenes SET keyframe_asset_id = NULL WHERE id = $1', [scenes[1].sceneId]);
    const out = await run({ assetId: asset.id, projectId });
    expect(out).toMatchObject({ keyframes: 1, faces: 1 });
    expect((await facesOf(asset.id)).map((r) => r.scene_id)).toEqual([scenes[0].sceneId]);
  });

  it('a storage failure fails the step and keeps the previous rows', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    const scenes = await seedScenes(projectId, asset.id, [[0, 20000]]);
    storage.setFaces(scenes[0].keyframePublicId, [{ x: 1, y: 1, width: 10, height: 10 }]);
    await run({ assetId: asset.id, projectId });
    storage.setFaces(scenes[0].keyframePublicId, new Error('Cloudinary 503'));
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow('Cloudinary 503');
    expect(await facesOf(asset.id)).toHaveLength(1);
  });

  it('missing asset -> NonRetryableError', async () => {
    const { projectId } = await makeProject();
    await expect(run({ assetId: '00000000-0000-4000-8000-000000000000', projectId })).rejects.toMatchObject({ retryable: false });
  });
});
