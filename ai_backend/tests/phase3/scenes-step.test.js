// Scenes + keyframes step (P3.T2) with REAL FFmpeg on the fixture. The step is pointed at
// the local file through configureScenes(); storage stays the in-memory fake (no network).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as realFfmpeg from '../../src/adapters/ffmpeg/real.js';
import { getFfmpeg } from '../../src/adapters/ffmpeg/index.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { query } from '../../src/db/pool.js';
import { derivedFolder } from '../../src/modules/media/service.js';
import { configureScenes, resetScenes, run } from '../../src/workers/steps/scenes.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { FIXTURE, makeFixture } from '../fixtures/make-fixture.js';
import { insertOriginal, keyframesOf, makeProject, scenesOf } from './helpers-b.js';

const storage = getStorage();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let tmpRoot;

beforeAll(async () => {
  makeFixture();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'p3b-scenes-'));
});
beforeEach(async () => {
  await resetDb();
  storage.reset();
  getFfmpeg().reset();
  configureScenes({ ffmpeg: realFfmpeg, resolveInput: () => FIXTURE.path, tmpRoot });
});
afterEach(() => resetScenes());
afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await closeAll();
});

function expectContiguous(scenes, durationMs) {
  expect(scenes[0].start_ms).toBe(0);
  expect(scenes.at(-1).end_ms).toBe(durationMs);
  scenes.forEach((s, i) => {
    expect(s.idx).toBe(i);
    expect(s.end_ms).toBeGreaterThan(s.start_ms);
    if (i > 0) expect(s.start_ms).toBe(scenes[i - 1].end_ms);
  });
}

describe('scenes step (real FFmpeg, fixture)', () => {
  it('finds the 2 known cuts within 500 ms; scenes are contiguous and cover the full duration', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);

    const out = await run({ assetId: asset.id, projectId });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);

    const scenes = await scenesOf(asset.id);
    expect(scenes).toHaveLength(3);
    expectContiguous(scenes, FIXTURE.durationMs);
    FIXTURE.cutsMs.forEach((cut, i) => expect(Math.abs(scenes[i + 1].start_ms - cut)).toBeLessThanOrEqual(500));
    expect(out).toMatchObject({ scenes: 3, keyframes: 3 });
  });

  it('one keyframe asset per scene: a JPEG uploaded to derived/keyframes, parent = the original', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    await run({ assetId: asset.id, projectId });

    const scenes = await scenesOf(asset.id);
    const keyframes = await keyframesOf(asset.id);
    expect(keyframes).toHaveLength(scenes.length);
    expect(new Set(scenes.map((s) => s.keyframe_asset_id))).toEqual(new Set(keyframes.map((k) => k.id)));
    for (const kf of keyframes) {
      expect(kf.cloudinary_public_id.startsWith(`${derivedFolder(projectId)}/keyframes/`)).toBe(true);
      expect(kf.status).toBe('uploaded');
      const resource = await storage.getResource(kf.cloudinary_public_id);
      expect(resource).toMatchObject({ resourceType: 'image', format: 'jpg' });
      expect(resource.bytes).toBeGreaterThan(100);
    }
  });

  it('re-run replaces its rows: no duplicate scenes or keyframes', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    await run({ assetId: asset.id, projectId });
    const first = await scenesOf(asset.id);
    await run({ assetId: asset.id, projectId });

    const again = await scenesOf(asset.id);
    expect(again.map(({ idx, start_ms, end_ms }) => [idx, start_ms, end_ms])).toEqual(
      first.map(({ idx, start_ms, end_ms }) => [idx, start_ms, end_ms]),
    );
    expect(await keyframesOf(asset.id)).toHaveLength(again.length);
  });

  it('keyframes of an earlier run that were not reused are deleted (rows and storage)', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    await run({ assetId: asset.id, projectId });
    // The real storage gives every upload a new public_id: simulate a leftover from a
    // previous run under another id.
    const stalePublicId = `${derivedFolder(projectId)}/keyframes/stale-upload`;
    storage.putResource({ publicId: stalePublicId, resourceType: 'image', format: 'jpg' });
    await query(
      `INSERT INTO assets (project_id, kind, parent_asset_id, cloudinary_public_id, status) VALUES ($1, 'keyframe', $2, $3, 'uploaded')`,
      [projectId, asset.id, stalePublicId],
    );

    await run({ assetId: asset.id, projectId });
    const keyframes = await keyframesOf(asset.id);
    expect(keyframes).toHaveLength(3);
    expect(keyframes.map((k) => k.cloudinary_public_id)).not.toContain(stalePublicId);
    expect(storage.destroyed).toContain(stalePublicId);
  });

  it('removes its temp files, on success and on failure', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    await run({ assetId: asset.id, projectId });
    expect(await fs.readdir(tmpRoot)).toEqual([]);

    configureScenes({ resolveInput: () => path.join(tmpRoot, 'missing.mp4') });
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow();
    expect(await fs.readdir(tmpRoot)).toEqual([]);

    configureScenes({ resolveInput: () => FIXTURE.path });
    const failing = { ...realFfmpeg, extractFrame: async (input, atMs, out) => {
      await realFfmpeg.extractFrame(input, atMs, out);
      throw new Error('disk full');
    } };
    configureScenes({ ffmpeg: failing });
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow('disk full');
    expect(await fs.readdir(tmpRoot)).toEqual([]);
  });

  it('missing asset or another project -> NonRetryableError', async () => {
    const { projectId } = await makeProject();
    const other = await makeProject('other');
    const asset = await insertOriginal(projectId);
    await expect(run({ assetId: asset.id, projectId: other.projectId })).rejects.toMatchObject({ retryable: false });
    await expect(run({ assetId: MISSING_ID, projectId })).rejects.toMatchObject({ retryable: false });
  });

  it('duration falls back to probe when the asset row has none', async () => {
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId, { durationMs: null });
    await run({ assetId: asset.id, projectId });
    const scenes = await scenesOf(asset.id);
    expect(scenes).toHaveLength(3);
    expect(Math.abs(scenes.at(-1).end_ms - FIXTURE.durationMs)).toBeLessThanOrEqual(200);
    expectContiguous(scenes, scenes.at(-1).end_ms);
  });
});

describe('scenes step with default config (ADAPTERS=fake)', () => {
  it('reads the storage proxy URL and uses the fake ffmpeg (cuts 7 s, 14 s)', async () => {
    resetScenes();
    const { projectId } = await makeProject();
    const asset = await insertOriginal(projectId);
    const out = await run({ assetId: asset.id, projectId });
    expect(out).toMatchObject({ scenes: 3, keyframes: 3, cutsMs: [7_000, 14_000] });
    expect(getFfmpeg().frames.map((f) => f.input)).toEqual(Array(3).fill(storage.proxyUrl(asset.publicId)));
    expectContiguous(await scenesOf(asset.id), 20_000);
  });
});
