// P7.T3: render routes under /projects/:projectId (supertest), status/progress/failure
// as seen over HTTP. Jobs that are drained run real FFmpeg on the fixture.
import fs from 'node:fs/promises';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import * as fakeStorage from '../../src/adapters/storage/fake.js';
import { resetRender } from '../../src/workers/render.js';
import { makeFixture } from '../fixtures/make-fixture.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { insertOriginal, makeTimeline, reelDoc, tmpDir, useRealRender } from './helpers.js';

const app = createApp({ log: { error() {} } });
const users = {};
let project;
let asset;
let timeline;
let dirs;

const as = (name) => authHeader(users[name].token);
const base = () => `/projects/${project.id}`;

beforeAll(async () => {
  makeFixture();
  await resetDb();
  for (const name of ['owner', 'editor', 'viewer', 'stranger']) users[name] = await createUser(app);
});
afterAll(closeAll);

beforeEach(async () => {
  await clearQueues();
  fakeStorage.reset();
  const res = await request(app).post('/projects').set(as('owner')).send({ name: 'Render routes' });
  project = res.body.project;
  for (const role of ['editor', 'viewer']) {
    await request(app).post(`${base()}/members`).set(as('owner')).send({ email: users[role].email, role });
  }
  asset = await insertOriginal(project.id);
  timeline = await makeTimeline(project.id, reelDoc([[asset.id, 1_000, 2_000], [asset.id, 8_000, 9_000]]));
  dirs = { tmpRoot: tmpDir('tmp'), keepDir: tmpDir('keep') };
});
afterEach(async () => {
  resetRender();
  for (const d of Object.values(dirs)) await fs.rm(d, { recursive: true, force: true });
});

const startRender = (body, who = 'editor', tl = timeline) =>
  request(app).post(`${base()}/timelines/${tl.id}/render`).set(as(who)).send(body);

describe('POST /timelines/:timelineId/render', () => {
  it('202 { renderId } and a queued render pinned to the head', async () => {
    const res = await startRender({ kind: 'preview' });
    expect(res.status).toBe(202);
    expect(res.body.renderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.render).toMatchObject({ id: res.body.renderId, status: 'queued', version: 1, kind: 'preview', progress: 0 });

    const get = await request(app).get(`${base()}/renders/${res.body.renderId}`).set(as('viewer'));
    expect(get.status).toBe(200);
    expect(get.body.render).toMatchObject({ id: res.body.renderId, timelineId: timeline.id, status: 'queued' });
  });

  it('runs to done: status, progress 1 and the output asset url over HTTP', async () => {
    await useRealRender(dirs);
    const { body } = await startRender({ kind: 'preview' });
    await drainQueue();
    const res = await request(app).get(`${base()}/renders/${body.renderId}`).set(as('viewer'));
    expect(res.body.render).toMatchObject({ status: 'done', progress: 1, error: null });
    expect(res.body.render.outputAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.render.outputUrl).toContain(`proj/${project.id}/derived/renders/`);

    const media = await request(app).get(`${base()}/media/${res.body.render.outputAssetId}`).set(as('viewer'));
    expect(media.status).toBe(200);
    expect(media.body.asset ?? media.body).toMatchObject({ kind: 'render' });
  });

  it('asking again while done -> 200 with the existing renderId', async () => {
    await useRealRender(dirs);
    const first = await startRender({ kind: 'final' });
    await drainQueue();
    const again = await startRender({ kind: 'final', version: 1 }, 'owner');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ renderId: first.body.renderId, render: { status: 'done' } });
    expect(await drainQueue()).toEqual([]);
  });

  it('a failed render shows status failed and the stderr tail', async () => {
    const bad = await insertOriginal(project.id);
    await useRealRender({ ...dirs, badAssets: new Set([bad.id]) });
    const broken = await makeTimeline(project.id, reelDoc([[bad.id, 0, 1_000]]));
    const { body } = await startRender({ kind: 'preview' }, 'editor', broken);
    await drainQueue();
    const res = await request(app).get(`${base()}/renders/${body.renderId}`).set(as('editor'));
    expect(res.body.render.status).toBe('failed');
    expect(res.body.render.error).toMatch(/ffmpeg exited with code[\s\S]*does-not-exist\.mp4/);
  });

  it('an explicit older version is pinned', async () => {
    const save = await request(app)
      .post(`${base()}/timelines/${timeline.id}/versions`)
      .set(as('editor'))
      .send({ baseVersion: 1, doc: reelDoc([[asset.id, 0, 1_000]]), summary: 'v2' });
    expect(save.status).toBe(201);
    const v1 = await startRender({ kind: 'preview', version: 1 });
    const head = await startRender({ kind: 'preview' });
    expect(v1.body.render.version).toBe(1);
    expect(head.body.render.version).toBe(2);
    expect(head.body.renderId).not.toBe(v1.body.renderId);
  });

  it.each([
    ['missing kind', {}],
    ['unknown kind', { kind: 'draft' }],
    ['version 0', { kind: 'final', version: 0 }],
    ['non-integer version', { kind: 'final', version: 1.5 }],
    ['unknown field', { kind: 'final', fps: 60 }],
  ])('400 on %s', async (_name, body) => {
    const res = await startRender(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('a version with no video clips -> 400; an unknown version -> 404', async () => {
    const empty = await request(app).post(`${base()}/timelines`).set(as('editor')).send({ title: 'empty' });
    const noClips = await startRender({ kind: 'preview' }, 'editor', empty.body.timeline);
    expect(noClips.status).toBe(400);
    expect(noClips.body.error.message).toMatch(/no video clips/);
    expect((await startRender({ kind: 'preview', version: 9 })).status).toBe(404);
  });

  it('viewer cannot start a render (403) but can read status and the list', async () => {
    const denied = await startRender({ kind: 'preview' }, 'viewer');
    expect(denied.status).toBe(403);
    const { body } = await startRender({ kind: 'preview' });
    expect((await request(app).get(`${base()}/renders/${body.renderId}`).set(as('viewer'))).status).toBe(200);
    const list = await request(app).get(`${base()}/timelines/${timeline.id}/renders`).set(as('viewer'));
    expect(list.status).toBe(200);
    expect(list.body.renders.map((r) => r.id)).toEqual([body.renderId]);
  });
});

describe('GET /timelines/:timelineId/renders and /renders/:renderId', () => {
  it('lists renders of the timeline only, newest first', async () => {
    const other = await makeTimeline(project.id, reelDoc([[asset.id, 0, 1_000]]));
    const a = await startRender({ kind: 'preview' });
    const b = await startRender({ kind: 'final' });
    await startRender({ kind: 'preview' }, 'editor', other);
    const res = await request(app).get(`${base()}/timelines/${timeline.id}/renders`).set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.renders.map((r) => r.id)).toEqual([b.body.renderId, a.body.renderId]);
  });

  it('cross-project, unknown and malformed ids -> 404', async () => {
    const { body } = await startRender({ kind: 'preview' });
    const elsewhere = (await request(app).post('/projects').set(as('owner')).send({ name: 'Other' })).body.project;
    const paths = [
      `/projects/${elsewhere.id}/renders/${body.renderId}`,
      `/projects/${elsewhere.id}/timelines/${timeline.id}/renders`,
      `${base()}/renders/00000000-0000-4000-8000-000000000000`,
      `${base()}/renders/not-a-uuid`,
      `${base()}/timelines/not-a-uuid/renders`,
    ];
    for (const p of paths) expect((await request(app).get(p).set(as('owner'))).status, p).toBe(404);
    const post = await request(app).post(`/projects/${elsewhere.id}/timelines/${timeline.id}/render`).set(as('owner')).send({ kind: 'preview' });
    expect(post.status).toBe(404);
  });

  it('non-member -> 404, anonymous -> 401', async () => {
    const { body } = await startRender({ kind: 'preview' });
    expect((await request(app).get(`${base()}/renders/${body.renderId}`).set(as('stranger'))).status).toBe(404);
    expect((await request(app).get(`${base()}/renders/${body.renderId}`)).status).toBe(401);
  });
});
