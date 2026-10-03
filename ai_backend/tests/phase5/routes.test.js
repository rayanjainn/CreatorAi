// P5.T3: timeline HTTP routes under /projects/:projectId, revert and diff.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { createTimeline, createVersion, diffTimelines, emptyTimelineDoc } from '../../src/modules/timeline/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { insertAsset, videoDoc } from './helpers.js';

const app = createApp({ log: { error() {} } });

let owner;
let editor;
let viewer;
let project;
let asset;

async function newProject(token, name = 'Timelines') {
  const res = await request(app).post('/projects').set(authHeader(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.project;
}

async function addMember(projectId, email, role) {
  const res = await request(app).post(`/projects/${projectId}/members`).set(authHeader(owner.token)).send({ email, role });
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app);
  editor = await createUser(app);
  viewer = await createUser(app);
  project = await newProject(owner.token);
  await addMember(project.id, editor.email, 'editor');
  await addMember(project.id, viewer.email, 'viewer');
  asset = await insertAsset(project.id, { durationMs: 20_000 });
});
afterAll(closeAll);

const base = () => `/projects/${project.id}/timelines`;
const as = (user) => authHeader(user.token);

async function postTimeline(body = { title: 'Reel' }, user = editor) {
  const res = await request(app).post(base()).set(as(user)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const saveVersion = (timelineId, body, user = editor) =>
  request(app).post(`${base()}/${timelineId}/versions`).set(as(user)).send(body);

const versionCount = async (timelineId) =>
  (await getPool().query('SELECT count(*)::int AS n FROM timeline_versions WHERE timeline_id = $1', [timelineId])).rows[0].n;

const clip = (id, startMs, extra = {}) => ({
  id, assetId: asset.id, sourceInMs: 0, sourceOutMs: 1_000, startMs, volume: 1, ...extra,
});
const docWith = (clips, captions = []) => ({
  schemaVersion: 1,
  output: { width: 1080, height: 1920, fps: 30 },
  tracks: [
    { id: 'v1', type: 'video', clips },
    ...(captions.length ? [{ id: 'cap', type: 'caption', clips: captions }] : []),
  ],
});

describe('POST /timelines', () => {
  it('without a doc creates v1 with the empty doc, authored by the caller', async () => {
    const { timeline, head } = await postTimeline({ title: 'Blank', sourceAssetId: asset.id });
    expect(timeline).toMatchObject({ projectId: project.id, title: 'Blank', sourceAssetId: asset.id, headVersion: 1, createdBy: editor.user.id });
    expect(head).toMatchObject({ version: 1, parentVersion: null, authorType: 'human', authorId: editor.user.id, doc: emptyTimelineDoc() });
  });

  it('with a doc creates v1 holding it', async () => {
    const { head } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    expect(head.doc).toEqual(videoDoc(asset.id));
  });

  it('a malformed doc -> 400 with the path under body.doc', async () => {
    const res = await request(app).post(base()).set(as(editor)).send({ title: 'x', doc: { ...videoDoc(asset.id), schemaVersion: 2 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ path: ['body', 'doc', 'schemaVersion'] }));
  });

  it('a semantically invalid doc -> 400 with the path under body.doc, nothing written', async () => {
    const res = await request(app).post(base()).set(as(editor)).send({ title: 'x', doc: videoDoc(randomUUID()) });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({
      code: 'asset_not_found', path: ['body', 'doc', 'tracks', 0, 'clips', 0, 'assetId'],
    }));
    expect((await getPool().query('SELECT count(*)::int AS n FROM timelines')).rows[0].n).toBe(0);
  });

  it('an unknown sourceAssetId -> 400', async () => {
    const res = await request(app).post(base()).set(as(editor)).send({ title: 'x', sourceAssetId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ path: ['body', 'sourceAssetId'] }));
  });

  it('unknown fields and a missing title -> 400', async () => {
    for (const body of [{}, { title: 'x', head: 3 }]) {
      const res = await request(app).post(base()).set(as(editor)).send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe('reads', () => {
  it('GET /timelines lists the project\'s timelines without docs', async () => {
    const a = await postTimeline({ title: 'A' });
    const b = await postTimeline({ title: 'B' });
    const other = await newProject(owner.token, 'Other');
    await request(app).post(`/projects/${other.id}/timelines`).set(as(owner)).send({ title: 'Elsewhere' });
    const res = await request(app).get(base()).set(as(viewer));
    expect(res.status).toBe(200);
    expect(res.body.timelines.map((t) => t.id).sort()).toEqual([a.timeline.id, b.timeline.id].sort());
    expect(res.body.timelines[0]).not.toHaveProperty('doc');
  });

  it('GET /timelines/:id returns the head with its doc', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.5 }), summary: 'quieter' });
    const res = await request(app).get(`${base()}/${timeline.id}`).set(as(viewer));
    expect(res.status).toBe(200);
    expect(res.body.timeline.headVersion).toBe(2);
    expect(res.body.head).toMatchObject({ version: 2, summary: 'quieter', doc: videoDoc(asset.id, { volume: 0.5 }) });
  });

  it('GET versions lists metadata oldest first; GET versions/:v returns that doc', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.5 }), summary: 'quieter' });
    const list = await request(app).get(`${base()}/${timeline.id}/versions`).set(as(viewer));
    expect(list.status).toBe(200);
    expect(list.body.versions.map((v) => [v.version, v.parentVersion])).toEqual([[1, null], [2, 1]]);
    expect(list.body.versions[0]).not.toHaveProperty('doc');
    const one = await request(app).get(`${base()}/${timeline.id}/versions/1`).set(as(viewer));
    expect(one.status).toBe(200);
    expect(one.body.version).toMatchObject({ version: 1, doc: videoDoc(asset.id) });
  });

  it('a missing or malformed version -> 404', async () => {
    const { timeline } = await postTimeline();
    for (const v of ['2', '0', 'abc', '1.5', '-1']) {
      const res = await request(app).get(`${base()}/${timeline.id}/versions/${v}`).set(as(viewer));
      expect(res.status, v).toBe(404);
    }
  });

  it('a missing or malformed timeline id -> 404', async () => {
    for (const id of [randomUUID(), 'nope']) {
      const res = await request(app).get(`${base()}/${id}`).set(as(viewer));
      expect(res.status).toBe(404);
    }
  });
});

describe('POST /timelines/:id/versions', () => {
  it('v1 ai -> v2 human -> v3 ai: parent chain and authors recorded', async () => {
    const runId = randomUUID();
    const { timeline } = await createTimeline(project.id, { title: 'AI reel', doc: videoDoc(asset.id), authorType: 'ai', agentRunId: runId });
    const v2 = await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { label: 'mine' }), summary: 'human edit' });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toMatchObject({ version: 2, parentVersion: 1, authorType: 'human', authorId: editor.user.id, agentRunId: null });
    await createVersion(project.id, timeline.id, {
      baseVersion: 2, doc: videoDoc(asset.id, { label: 'mine', volume: 0.7 }), summary: 'ai revise', authorType: 'ai', agentRunId: runId,
    });
    const list = await request(app).get(`${base()}/${timeline.id}/versions`).set(as(viewer));
    expect(list.body.versions.map((v) => [v.version, v.parentVersion, v.authorType, v.authorId, v.agentRunId])).toEqual([
      [1, null, 'ai', null, runId],
      [2, 1, 'human', editor.user.id, null],
      [3, 2, 'ai', null, runId],
    ]);
  });

  it('a stale baseVersion -> 409 with the current head and no row written', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    expect((await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.1 }), summary: 'a' })).status).toBe(201);
    const stale = await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.2 }), summary: 'b' }, owner);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'conflict', details: { headVersion: 2 } });
    expect(await versionCount(timeline.id)).toBe(2);
  });

  it('two parallel saves on the same base -> exactly one 201 and one 409', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    const results = await Promise.all([
      saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.1 }), summary: 'editor' }, editor),
      saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.2 }), summary: 'owner' }, owner),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await versionCount(timeline.id)).toBe(2);
  });

  it('an invalid doc -> 400 with specific paths, nothing written', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    const overlap = docWith([clip('a', 0), clip('b', 500)]);
    const res = await saveVersion(timeline.id, { baseVersion: 1, doc: overlap, summary: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ code: 'overlap', path: ['body', 'doc', 'tracks', 0, 'clips', 1, 'startMs'] }));
    const noSummary = await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id) });
    expect(noSummary.status).toBe(400);
    expect(await versionCount(timeline.id)).toBe(1);
  });

  it('old versions stay byte-identical after later saves', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    const readV1 = async () => ({
      api: (await request(app).get(`${base()}/${timeline.id}/versions/1`).set(as(viewer))).text,
      db: (await getPool().query('SELECT doc::text AS t, summary, created_at FROM timeline_versions WHERE timeline_id = $1 AND version = 1', [timeline.id])).rows[0],
    });
    const before = await readV1();
    for (let v = 1; v <= 3; v += 1) {
      const res = await saveVersion(timeline.id, { baseVersion: v, doc: videoDoc(asset.id, { volume: v / 10 }), summary: `v${v + 1}` });
      expect(res.status).toBe(201);
    }
    await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 2 });
    expect(await readV1()).toEqual(before);
  });

  it('no route updates or deletes a version', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    for (const method of ['put', 'patch', 'delete']) {
      for (const path of [`${base()}/${timeline.id}/versions/1`, `${base()}/${timeline.id}/versions`]) {
        const res = await request(app)[method](path).set(as(owner)).send({ doc: emptyTimelineDoc(), summary: 'x' });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await versionCount(timeline.id)).toBe(1);
  });
});

describe('POST /timelines/:id/revert', () => {
  it('creates a new version whose doc equals the target', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.5 }), summary: 'v2' });
    await saveVersion(timeline.id, { baseVersion: 2, doc: videoDoc(asset.id, { volume: 0.25 }), summary: 'v3' });
    const res = await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 1 });
    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({
      version: 4, parentVersion: 3, authorType: 'human', authorId: editor.user.id, summary: 'Revert to v1', doc: videoDoc(asset.id),
    });
    const v1 = (await request(app).get(`${base()}/${timeline.id}/versions/1`).set(as(viewer))).body.version;
    expect(res.body.version.doc).toEqual(v1.doc);
    const head = (await request(app).get(`${base()}/${timeline.id}`).set(as(viewer))).body;
    expect(head.timeline.headVersion).toBe(4);
    expect(head.head.doc).toEqual(v1.doc);
  });

  it('with a stale baseVersion -> 409, nothing written; with the head -> 201', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.5 }), summary: 'v2' });
    const stale = await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 1, baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({ headVersion: 2 });
    expect(await versionCount(timeline.id)).toBe(2);
    const ok = await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 1, baseVersion: 2, summary: 'back' });
    expect(ok.status).toBe(201);
    expect(ok.body.version).toMatchObject({ version: 3, summary: 'back' });
  });

  it('a missing target version -> 404; a bad body -> 400', async () => {
    const { timeline } = await postTimeline();
    expect((await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 5 })).status).toBe(404);
    expect((await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 'one' })).status).toBe(400);
    expect(await versionCount(timeline.id)).toBe(1);
  });

  it('a target that no longer validates (asset deleted) -> 400', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    await saveVersion(timeline.id, { baseVersion: 1, doc: emptyTimelineDoc(), summary: 'cleared' });
    await getPool().query('DELETE FROM assets WHERE id = $1', [asset.id]);
    const res = await request(app).post(`${base()}/${timeline.id}/revert`).set(as(editor)).send({ toVersion: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ code: 'asset_not_found' }));
  });
});

describe('GET /timelines/:id/diff', () => {
  it('reports clips added, removed and changed by clip id', async () => {
    const v1 = docWith([clip('keep', 0), clip('gone', 1_000), clip('moved', 2_000)], [{ id: 't1', startMs: 0, endMs: 500, text: 'hi' }]);
    const v2 = docWith([clip('keep', 0), clip('moved', 5_000), clip('new', 2_000)], [{ id: 't1', startMs: 0, endMs: 500, text: 'hello' }]);
    const { timeline } = await postTimeline({ title: 'Reel', doc: v1 });
    expect((await saveVersion(timeline.id, { baseVersion: 1, doc: v2, summary: 'v2' })).status).toBe(201);

    const res = await request(app).get(`${base()}/${timeline.id}/diff?from=1&to=2`).set(as(viewer));
    expect(res.status).toBe(200);
    const { diff } = res.body;
    expect(diff).toMatchObject({ from: 1, to: 2 });
    expect(diff.added.map((c) => c.id)).toEqual(['new']);
    expect(diff.removed.map((c) => c.id)).toEqual(['gone']);
    expect(diff.changed.map((c) => c.id)).toEqual(['moved', 't1']);
    expect(diff.changed[0]).toMatchObject({ trackId: 'v1', fields: ['startMs'], before: { startMs: 2_000 }, after: { startMs: 5_000 } });
    expect(diff.changed[1]).toMatchObject({ trackId: 'cap', fields: ['text'] });
    expect(diff.added[0]).toMatchObject({ trackId: 'v1', clip: clip('new', 2_000) });

    const back = await request(app).get(`${base()}/${timeline.id}/diff?from=2&to=1`).set(as(viewer));
    expect(back.body.diff.added.map((c) => c.id)).toEqual(['gone']);
    expect(back.body.diff.removed.map((c) => c.id)).toEqual(['new']);
  });

  it('same version -> empty diff; bad query -> 400; missing version -> 404', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    const same = await request(app).get(`${base()}/${timeline.id}/diff?from=1&to=1`).set(as(viewer));
    expect(same.body.diff).toMatchObject({ added: [], removed: [], changed: [], outputChanged: false });
    for (const qs of ['', '?from=1', '?from=abc&to=1', '?from=0&to=1', '?from=1&to=1&x=2']) {
      const res = await request(app).get(`${base()}/${timeline.id}/diff${qs}`).set(as(viewer));
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect((await request(app).get(`${base()}/${timeline.id}/diff?from=1&to=9`).set(as(viewer))).status).toBe(404);
  });

  it('diffTimelines is pure and reports a clip moved between tracks and output changes', () => {
    const a = docWith([clip('x', 0)]);
    const b = { ...docWith([]), output: { width: 720, height: 1280, fps: 30 } };
    b.tracks.push({ id: 'v2', type: 'video', clips: [clip('x', 0)] });
    const diff = diffTimelines(a, b);
    expect(diff.outputChanged).toBe(true);
    expect(diff.changed).toEqual([expect.objectContaining({ id: 'x', fromTrackId: 'v1', trackId: 'v2', fields: ['trackId'] })]);
  });
});

describe('roles and projects', () => {
  it('viewer reads but cannot write; editor writes', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    expect((await request(app).get(`${base()}/${timeline.id}`).set(as(viewer))).status).toBe(200);
    expect((await request(app).post(base()).set(as(viewer)).send({ title: 'x' })).status).toBe(403);
    expect((await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id), summary: 'v' }, viewer)).status).toBe(403);
    expect((await request(app).post(`${base()}/${timeline.id}/revert`).set(as(viewer)).send({ toVersion: 1 })).status).toBe(403);
    expect((await saveVersion(timeline.id, { baseVersion: 1, doc: videoDoc(asset.id), summary: 'v' }, editor)).status).toBe(201);
    expect(await versionCount(timeline.id)).toBe(2);
  });

  it('a timeline of another project -> 404 on every route, even for a member of both', async () => {
    const { timeline } = await postTimeline({ title: 'Reel', doc: videoDoc(asset.id) });
    const other = await newProject(owner.token, 'Other');
    const p = `/projects/${other.id}/timelines/${timeline.id}`;
    const calls = [
      request(app).get(p),
      request(app).get(`${p}/versions`),
      request(app).get(`${p}/versions/1`),
      request(app).get(`${p}/diff?from=1&to=1`),
      request(app).post(`${p}/versions`).send({ baseVersion: 1, doc: emptyTimelineDoc(), summary: 'x' }),
      request(app).post(`${p}/revert`).send({ toVersion: 1 }),
    ];
    for (const call of calls) expect((await call.set(as(owner))).status).toBe(404);
    expect(await versionCount(timeline.id)).toBe(1);
  });

  it('a doc referencing another project\'s asset is rejected', async () => {
    const other = await newProject(owner.token, 'Other');
    const foreign = await insertAsset(other.id);
    const res = await request(app).post(base()).set(as(owner)).send({ title: 'x', doc: videoDoc(foreign.id) });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ code: 'asset_not_found' }));
  });
});
