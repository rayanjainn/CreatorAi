// P7.T2: the render worker with REAL FFmpeg on the fixture (ADAPTERS=fake otherwise:
// uploads go to the fake storage, a copy of each upload is kept for ffprobe).
import fs from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as realFfmpeg from '../../src/adapters/ffmpeg/real.js';
import * as fakeStorage from '../../src/adapters/storage/fake.js';
import { query } from '../../src/db/pool.js';
import { getAsset } from '../../src/modules/media/service.js';
import { getRender, requestRender } from '../../src/modules/render/service.js';
import { createVersion } from '../../src/modules/timeline/service.js';
import { resetRender } from '../../src/workers/render.js';
import { makeFixture } from '../fixtures/make-fixture.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { OUTPUT, insertOriginal, makeProject, makeTimeline, probeFile, reelDoc, tmpDir, useRealRender } from './helpers.js';

let project;
let asset;
let dirs;

beforeAll(async () => {
  makeFixture();
  await resetDb();
});
afterAll(closeAll);

beforeEach(async () => {
  await clearQueues();
  fakeStorage.reset();
  project = await makeProject();
  asset = await insertOriginal(project.projectId);
  dirs = { tmpRoot: tmpDir('tmp'), keepDir: tmpDir('keep') };
});
afterEach(async () => {
  resetRender();
  for (const d of Object.values(dirs)) await fs.rm(d, { recursive: true, force: true });
});

// Two clips: 2.0 s + 3.0 s = 5.0 s.
const TWO_CLIPS = () => reelDoc([[asset.id, 1_000, 3_000], [asset.id, 8_000, 11_000]]);

describe('real render of a 2-clip timeline', () => {
  it('final: output exists, duration = sum of clips (+-150 ms), resolution = output, audio + video', async () => {
    const { uploads, resolved } = await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS(), { sourceAssetId: asset.id });
    const { render, created } = await requestRender(project.projectId, timeline.id, { kind: 'final' });
    expect(created).toBe(true);
    expect(render).toMatchObject({ status: 'queued', progress: 0, version: 1, kind: 'final', outputAssetId: null });

    const results = await drainQueue();
    expect(results.map((r) => [r.name, r.state])).toEqual([['render.run', 'completed']]);

    const done = await getRender(project.projectId, render.id);
    expect(done).toMatchObject({ status: 'done', progress: 1, error: null, attempts: 1 });
    expect(resolved).toEqual([{ assetId: asset.id, kind: 'final', width: OUTPUT.width, height: OUTPUT.height }]);

    expect(uploads).toHaveLength(1);
    expect(uploads[0].options).toEqual({ folder: `proj/${project.projectId}/derived/renders`, resourceType: 'video' });
    const info = probeFile(uploads[0].kept);
    expect(Math.abs(info.durationMs - 5_000)).toBeLessThanOrEqual(150);
    expect(info.video).toMatchObject({ width: OUTPUT.width, height: OUTPUT.height });
    expect(info.audio).toBeTruthy();

    const out = await getAsset(project.projectId, done.outputAssetId);
    expect(out).toMatchObject({
      kind: 'render',
      parentAssetId: asset.id,
      publicId: uploads[0].resource.publicId,
      url: done.outputUrl,
      durationMs: 5_000,
      width: OUTPUT.width,
      height: OUTPUT.height,
      meta: { renderId: render.id, timelineId: timeline.id, version: 1, kind: 'final' },
    });
    expect(out.publicId.startsWith(`proj/${project.projectId}/derived/renders/`)).toBe(true);

    // temp dir removed
    expect(await fs.readdir(dirs.tmpRoot)).toEqual([]);
  });

  it('progress is parsed from -progress pipe:1 while FFmpeg runs', async () => {
    const seen = [];
    const ffmpeg = {
      ...realFfmpeg,
      run: (args, { onProgress }) => realFfmpeg.run(args, { onProgress: (p) => { seen.push(p); onProgress(p); } }),
    };
    await useRealRender({ ...dirs, ffmpeg });
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS());
    const { render } = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    await drainQueue();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toMatchObject({ done: true });
    expect(seen.at(-1).outTimeMs).toBeGreaterThan(4_000);
    expect((await getRender(project.projectId, render.id)).progress).toBe(1);
  });

  it('preview is lower resolution than final for the same timeline', async () => {
    const { uploads, resolved } = await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS());
    await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    await requestRender(project.projectId, timeline.id, { kind: 'final' });
    await drainQueue();

    expect(uploads).toHaveLength(2);
    const [preview, final] = uploads.map((u) => probeFile(u.kept)).sort((a, b) => a.video.width - b.video.width);
    expect(preview.video).toMatchObject({ width: 480, height: 854 });
    expect(final.video).toMatchObject({ width: OUTPUT.width, height: OUTPUT.height });
    expect(preview.video.width * preview.video.height).toBeLessThan(final.video.width * final.video.height);
    expect(resolved.map((r) => r.kind).sort()).toEqual(['final', 'preview']);
  });

  it('rendering version 1 after version 2 exists still uses version 1', async () => {
    const { uploads } = await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, reelDoc([[asset.id, 1_000, 3_000]]));
    await createVersion(project.projectId, timeline.id, {
      baseVersion: 1,
      doc: TWO_CLIPS(),
      summary: 'v2 adds a clip',
      authorType: 'ai',
    });
    const { render } = await requestRender(project.projectId, timeline.id, { kind: 'preview', version: 1 });
    expect(render.version).toBe(1);
    await drainQueue();
    expect((await getRender(project.projectId, render.id)).status).toBe('done');
    expect(Math.abs(probeFile(uploads[0].kept).durationMs - 2_000)).toBeLessThanOrEqual(150);
  });

  it('a render without a version pins the head at request time; a later save does not change it', async () => {
    const { uploads } = await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, reelDoc([[asset.id, 1_000, 3_000]]));
    const { render } = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    await createVersion(project.projectId, timeline.id, { baseVersion: 1, doc: TWO_CLIPS(), summary: 'v2', authorType: 'ai' });
    await drainQueue();
    expect(render.version).toBe(1);
    expect(Math.abs(probeFile(uploads[0].kept).durationMs - 2_000)).toBeLessThanOrEqual(150);
  });
});

describe('failures', () => {
  it('bad input -> failed with the stderr tail, temp files removed, the next job still runs', async () => {
    const bad = await insertOriginal(project.projectId);
    const { uploads } = await useRealRender({ ...dirs, badAssets: new Set([bad.id]) });
    const broken = await makeTimeline(project.projectId, reelDoc([[bad.id, 0, 1_000]]), { title: 'broken' });
    const fine = await makeTimeline(project.projectId, reelDoc([[asset.id, 0, 1_000]]), { title: 'fine' });
    const { render: r1 } = await requestRender(project.projectId, broken.id, { kind: 'preview' });
    const { render: r2 } = await requestRender(project.projectId, fine.id, { kind: 'preview' });

    const results = await drainQueue();
    expect(results.map((r) => r.state)).toEqual(['failed', 'completed']);

    const failed = await getRender(project.projectId, r1.id);
    expect(failed.status).toBe('failed');
    expect(failed.outputAssetId).toBeNull();
    expect(failed.error).toMatch(/^ffmpeg exited with code/);
    expect(failed.error).toMatch(/does-not-exist\.mp4/);
    expect(failed.finishedAt).not.toBeNull();

    expect((await getRender(project.projectId, r2.id)).status).toBe('done');
    expect(uploads).toHaveLength(1);
    expect(await fs.readdir(dirs.tmpRoot)).toEqual([]);
  });

  it('a failed render is not retried by the queue, and asking again creates a new render', async () => {
    const bad = await insertOriginal(project.projectId);
    await useRealRender({ ...dirs, badAssets: new Set([bad.id]) });
    const broken = await makeTimeline(project.projectId, reelDoc([[bad.id, 0, 1_000]]));
    const { render: first } = await requestRender(project.projectId, broken.id, { kind: 'preview' });
    await drainQueue();
    expect(await drainQueue()).toEqual([]);
    expect((await getRender(project.projectId, first.id)).attempts).toBe(1);

    const again = await requestRender(project.projectId, broken.id, { kind: 'preview' });
    expect(again.created).toBe(true);
    expect(again.render.id).not.toBe(first.id);
  });

  it('an asset deleted after the request -> failed with a clear error', async () => {
    const other = await insertOriginal(project.projectId);
    await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, reelDoc([[other.id, 0, 1_000]]));
    const { render } = await requestRender(project.projectId, timeline.id, { kind: 'final' });

    await query('DELETE FROM assets WHERE id = $1', [other.id]);
    await drainQueue();
    const failed = await getRender(project.projectId, render.id);
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.error).toContain(`asset ${other.id} not found`);
  });
});

describe('idempotency', () => {
  it('same { timeline, version, kind } while done -> the existing render, no new job', async () => {
    await useRealRender(dirs);
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS());
    const { render } = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    await drainQueue();

    const again = await requestRender(project.projectId, timeline.id, { kind: 'preview', version: 1 });
    expect(again.created).toBe(false);
    expect(again.render).toMatchObject({ id: render.id, status: 'done' });
    expect(await drainQueue()).toEqual([]);
  });

  it('while queued -> the same render; another kind or version -> a new one', async () => {
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS());
    const a = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    const b = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    expect(b).toMatchObject({ created: false, render: { id: a.render.id, status: 'queued' } });
    const c = await requestRender(project.projectId, timeline.id, { kind: 'final' });
    expect(c.created).toBe(true);
    await createVersion(project.projectId, timeline.id, { baseVersion: 1, doc: TWO_CLIPS(), summary: 'v2', authorType: 'ai' });
    const d = await requestRender(project.projectId, timeline.id, { kind: 'preview' });
    expect(d).toMatchObject({ created: true, render: { version: 2 } });
  });

  it('parallel identical requests -> one render, one job', async () => {
    const timeline = await makeTimeline(project.projectId, TWO_CLIPS());
    const out = await Promise.all([1, 2, 3].map(() => requestRender(project.projectId, timeline.id, { kind: 'final' })));
    expect(new Set(out.map((o) => o.render.id)).size).toBe(1);
    expect(out.filter((o) => o.created)).toHaveLength(1);
    await useRealRender(dirs);
    expect(await drainQueue()).toHaveLength(1);
  });
});
