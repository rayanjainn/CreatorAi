// Register after upload (P2.T3): POST /media and the Cloudinary webhook share one path:
// verify with storage, store metadata, enqueue exactly one media.process job.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getBoss } from '../../src/queue/boss.js';
import { JOBS, parsePayload } from '../../src/queue/jobs.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { assetIds, createProject, team } from './helpers.js';

const app = createApp({ log: { error() {} } });
const storage = getStorage();

beforeEach(async () => {
  await resetDb();
  storage.reset();
  await (await getBoss()).deleteAllJobs(JOBS.MEDIA_PROCESS);
});
afterAll(closeAll);

async function processJobs(assetId) {
  const boss = await getBoss();
  return boss.findJobs(JOBS.MEDIA_PROCESS, { data: { assetId } });
}

async function allProcessJobs() {
  const { rows } = await (await getBoss()).getDb().executeSql(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1`,
    [JOBS.MEDIA_PROCESS],
  );
  return rows[0].n;
}

// Seeds a "direct upload" in the fake storage, in the project's originals folder.
function uploaded(projectId, overrides = {}) {
  return storage.putResource({
    publicId: `proj/${projectId}/originals/clip-${randomUUID()}`,
    durationMs: 20_040,
    width: 640,
    height: 360,
    bytes: 4321,
    ...overrides,
  });
}

const register = (projectId, token, body) =>
  request(app).post(`/projects/${projectId}/media`).set(authHeader(token)).send(body);

describe('media.process payload', () => {
  it('is { assetId, projectId } uuids, strict', () => {
    const ok = { assetId: randomUUID(), projectId: randomUUID() };
    expect(parsePayload(JOBS.MEDIA_PROCESS, ok)).toEqual(ok);
    expect(() => parsePayload(JOBS.MEDIA_PROCESS, { assetId: 'x', projectId: ok.projectId })).toThrow();
    expect(() => parsePayload(JOBS.MEDIA_PROCESS, { ...ok, extra: 1 })).toThrow();
    expect(() => parsePayload(JOBS.MEDIA_PROCESS, { assetId: ok.assetId })).toThrow();
  });
});

describe('POST /projects/:projectId/media (register)', () => {
  it('stores the storage metadata, status uploaded, and enqueues exactly one media.process', async () => {
    const { project, editor } = await team(app);
    const r = uploaded(project.id);
    const res = await register(project.id, editor.token, { publicId: r.publicId });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({
      projectId: project.id,
      kind: 'original',
      parentAssetId: null,
      publicId: r.publicId,
      url: r.url,
      durationMs: 20_040,
      width: 640,
      height: 360,
      status: 'uploaded',
      createdBy: editor.user.id,
    });
    expect(res.body.asset.meta).toMatchObject({ format: 'mp4', bytes: 4321, resourceType: 'video' });

    const jobs = await processJobs(res.body.asset.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ assetId: res.body.asset.id, projectId: project.id });
    expect(await allProcessJobs()).toBe(1);
  });

  it('registering the same public_id twice is idempotent: same asset, no second job', async () => {
    const { project, editor, owner } = await team(app);
    const r = uploaded(project.id);
    const first = await register(project.id, editor.token, { publicId: r.publicId });
    const second = await register(project.id, owner.token, { publicId: r.publicId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.asset.id).toBe(first.body.asset.id);
    expect(await assetIds(project.id)).toEqual([first.body.asset.id]);
    expect(await allProcessJobs()).toBe(1);
  });

  it('concurrent registrations of one upload still make one asset and one job', async () => {
    const { project, editor } = await team(app);
    const r = uploaded(project.id);
    const results = await Promise.all([1, 2, 3, 4].map(() => register(project.id, editor.token, { publicId: r.publicId })));
    expect(results.map((x) => x.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((x) => x.body.asset.id)).size).toBe(1);
    expect(await allProcessJobs()).toBe(1);
  });

  it('a public_id outside the project originals folder -> 400, nothing stored or enqueued', async () => {
    const { project, owner, editor } = await team(app);
    const other = await createProject(app, owner.token, 'Other');
    const foreign = uploaded(other.id);
    const derived = storage.putResource({ publicId: `proj/${project.id}/derived/k1` });
    const cases = [
      foreign.publicId,
      derived.publicId,
      `proj/${project.id}/originals`,
      `proj/${project.id}/originals/`,
      `proj/${project.id}/originals/../derived/k1`,
      `PROJ/${project.id}/originals/x`,
      `x/proj/${project.id}/originals/x`,
    ];
    for (const publicId of cases) {
      const res = await register(project.id, editor.token, { publicId });
      expect(res.status, publicId).toBe(400);
    }
    expect(await assetIds(project.id)).toEqual([]);
    expect(await allProcessJobs()).toBe(0);
  });

  it('an upload the storage does not know -> 400', async () => {
    const { project, editor } = await team(app);
    const res = await register(project.id, editor.token, { publicId: `proj/${project.id}/originals/never-uploaded` });
    expect(res.status).toBe(400);
    expect(await allProcessJobs()).toBe(0);
  });

  it('validates the body', async () => {
    const { project, editor } = await team(app);
    for (const body of [{}, { publicId: '' }, { publicId: 42 }, { publicId: `proj/${project.id}/originals/a`, url: 'x' }]) {
      const res = await register(project.id, editor.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
  });

  it('viewer -> 403, non-member -> 404, anonymous -> 401; nothing enqueued', async () => {
    const { project, viewer, outsider } = await team(app);
    const r = uploaded(project.id);
    expect((await register(project.id, viewer.token, { publicId: r.publicId })).status).toBe(403);
    expect((await register(project.id, outsider.token, { publicId: r.publicId })).status).toBe(404);
    expect((await request(app).post(`/projects/${project.id}/media`).send({ publicId: r.publicId })).status).toBe(401);
    expect(await allProcessJobs()).toBe(0);
  });

  it('the registered asset is listed and readable', async () => {
    const { project, editor, viewer } = await team(app);
    const r = uploaded(project.id);
    const { body } = await register(project.id, editor.token, { publicId: r.publicId });
    const list = await request(app).get(`/projects/${project.id}/media`).set(authHeader(viewer.token));
    expect(list.body.assets.map((a) => a.id)).toEqual([body.asset.id]);
    const one = await request(app).get(`/projects/${project.id}/media/${body.asset.id}`).set(authHeader(viewer.token));
    expect(one.body.asset).toEqual(body.asset);
  });
});

describe('POST /webhooks/cloudinary', () => {
  const now = () => Math.floor(Date.now() / 1000);

  function notify(payload, { timestamp = now(), signature } = {}) {
    const raw = JSON.stringify(payload);
    let req = request(app).post('/webhooks/cloudinary').set('content-type', 'application/json');
    if (timestamp !== null) req = req.set('X-Cld-Timestamp', String(timestamp));
    const sig = signature === undefined ? storage.signNotification(raw, timestamp) : signature;
    if (sig !== null) req = req.set('X-Cld-Signature', sig);
    return req.send(raw);
  }

  const uploadNote = (r) => ({
    notification_type: 'upload',
    public_id: r.publicId,
    resource_type: 'video',
    type: 'upload',
    secure_url: r.url,
  });

  it('bad, missing or stale signature -> 401, nothing registered', async () => {
    const { project } = await team(app);
    const r = uploaded(project.id);
    const note = uploadNote(r);
    const stale = now() - 3 * 3600;
    const responses = [
      await notify(note, { signature: 'f'.repeat(40) }),
      await notify(note, { signature: null }),
      await notify(note, { timestamp: null }),
      await notify(note, { timestamp: stale, signature: storage.signNotification(JSON.stringify(note), stale) }),
      await notify(note, { signature: storage.signNotification(JSON.stringify({ ...note, public_id: 'x' }), now()) }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    }
    expect(await assetIds(project.id)).toEqual([]);
    expect(await allProcessJobs()).toBe(0);
  });

  it('a valid upload notification registers through the same logic (one job, idempotent)', async () => {
    const { project } = await team(app);
    const r = uploaded(project.id);
    const res = await notify(uploadNote(r));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, registered: true });
    const ids = await assetIds(project.id);
    expect(ids).toHaveLength(1);
    expect(res.body.assetId).toBe(ids[0]);
    expect(await processJobs(ids[0])).toHaveLength(1);

    const again = await notify(uploadNote(r));
    expect(again.status).toBe(200);
    expect(again.body.assetId).toBe(ids[0]);
    expect(await assetIds(project.id)).toEqual(ids);
    expect(await allProcessJobs()).toBe(1);
  });

  it('webhook then client register: still one asset and one job', async () => {
    const { project, editor } = await team(app);
    const r = uploaded(project.id);
    await notify(uploadNote(r));
    const res = await register(project.id, editor.token, { publicId: r.publicId });
    expect(res.status).toBe(200);
    expect(res.body.asset.createdBy).toBeNull();
    expect(await allProcessJobs()).toBe(1);
  });

  it('valid notifications that are not project uploads are acknowledged and ignored', async () => {
    const { project } = await team(app);
    const missingProject = randomUUID();
    const notes = [
      { notification_type: 'delete', resources: [] },
      { notification_type: 'upload', public_id: `elsewhere/clip`, resource_type: 'video' },
      { notification_type: 'upload', public_id: `proj/${project.id}/derived/k1`, resource_type: 'image' },
      { notification_type: 'upload', public_id: `proj/${missingProject}/originals/a`, resource_type: 'video' },
      { notification_type: 'upload', public_id: `proj/${project.id}/originals/never-uploaded`, resource_type: 'video' },
    ];
    storage.putResource({ publicId: `proj/${missingProject}/originals/a` });
    for (const note of notes) {
      const res = await notify(note);
      expect(res.status, JSON.stringify(note)).toBe(200);
      expect(res.body).toMatchObject({ received: true, registered: false });
    }
    expect(await assetIds(project.id)).toEqual([]);
    expect(await allProcessJobs()).toBe(0);
  });

  it('a signed body that is not a notification object -> 400', async () => {
    for (const payload of [[1, 2], { public_id: 'x' }]) {
      const res = await notify(payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
  });
});
