// Media routes (P2.T2): signing, listing, reading and deleting assets.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { SignUploadOutput } from '../../src/adapters/storage/contract.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { assetIds, createProject, insertAsset, team } from './helpers.js';

const app = createApp({ log: { error() {} } });
const storage = getStorage();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetDb();
  storage.reset();
});
afterAll(closeAll);

describe('POST /projects/:projectId/media/sign', () => {
  it('returns upload params restricted to the project originals folder', async () => {
    const { project, editor, owner } = await team(app);
    for (const user of [editor, owner]) {
      const res = await request(app).post(`/projects/${project.id}/media/sign`).set(authHeader(user.token)).send({});
      expect(res.status).toBe(200);
      const upload = SignUploadOutput.parse(res.body.upload);
      expect(upload.folder).toBe(`proj/${project.id}/originals`);
      expect(upload.resourceType).toBe('video');
    }
  });

  it('works without a body', async () => {
    const { project, editor } = await team(app);
    const res = await request(app).post(`/projects/${project.id}/media/sign`).set(authHeader(editor.token));
    expect(res.status).toBe(200);
  });

  it('the client cannot choose the folder: unknown body fields -> 400', async () => {
    const { project, editor } = await team(app);
    const res = await request(app)
      .post(`/projects/${project.id}/media/sign`)
      .set(authHeader(editor.token))
      .send({ folder: 'proj/other/originals' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('viewer -> 403, non-member -> 404, anonymous -> 401', async () => {
    const { project, viewer, outsider } = await team(app);
    const url = `/projects/${project.id}/media/sign`;
    expect((await request(app).post(url).set(authHeader(viewer.token)).send({})).status).toBe(403);
    expect((await request(app).post(url).set(authHeader(outsider.token)).send({})).status).toBe(404);
    expect((await request(app).post(url).send({})).status).toBe(401);
  });
});

describe('GET /projects/:projectId/media', () => {
  it('lists originals of this project only, newest first', async () => {
    const { project, viewer, owner } = await team(app);
    const other = await createProject(app, owner.token, 'Other');
    const a = await insertAsset(project.id);
    const b = await insertAsset(project.id);
    await insertAsset(project.id, { kind: 'keyframe', parentId: a.id });
    await insertAsset(other.id);

    const res = await request(app).get(`/projects/${project.id}/media`).set(authHeader(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.assets.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    for (const asset of res.body.assets) {
      expect(asset).toMatchObject({ projectId: project.id, kind: 'original', status: 'uploaded', durationMs: 20000 });
    }
  });

  it('filters by kind and parent', async () => {
    const { project, viewer } = await team(app);
    const a = await insertAsset(project.id);
    const b = await insertAsset(project.id);
    const k1 = await insertAsset(project.id, { kind: 'keyframe', parentId: a.id });
    await insertAsset(project.id, { kind: 'keyframe', parentId: b.id });
    await insertAsset(project.id, { kind: 'proxy', parentId: a.id });

    const res = await request(app)
      .get(`/projects/${project.id}/media?kind=keyframe&parentAssetId=${a.id}`)
      .set(authHeader(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.assets.map((x) => x.id)).toEqual([k1.id]);
    expect(res.body.assets[0].parentAssetId).toBe(a.id);
  });

  it('rejects an unknown kind', async () => {
    const { project, viewer } = await team(app);
    const res = await request(app).get(`/projects/${project.id}/media?kind=nope`).set(authHeader(viewer.token));
    expect(res.status).toBe(400);
  });

  it('another user sees nothing of a project they are not in', async () => {
    const { project, outsider } = await team(app);
    await insertAsset(project.id);
    const res = await request(app).get(`/projects/${project.id}/media`).set(authHeader(outsider.token));
    expect(res.status).toBe(404);
    const own = await createProject(app, outsider.token, 'Mine');
    const mine = await request(app).get(`/projects/${own.id}/media`).set(authHeader(outsider.token));
    expect(mine.body.assets).toEqual([]);
  });
});

describe('GET /projects/:projectId/media/:assetId', () => {
  it('returns the asset to a viewer', async () => {
    const { project, viewer } = await team(app);
    const a = await insertAsset(project.id);
    const res = await request(app).get(`/projects/${project.id}/media/${a.id}`).set(authHeader(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.asset).toMatchObject({
      id: a.id,
      projectId: project.id,
      kind: 'original',
      publicId: a.publicId,
      parentAssetId: null,
      width: 640,
      height: 360,
    });
  });

  it("another project's asset, a missing id and a malformed id -> 404", async () => {
    const { project, owner } = await team(app);
    const other = await createProject(app, owner.token, 'Other');
    const foreign = await insertAsset(other.id);
    for (const id of [foreign.id, MISSING_ID, 'not-a-uuid']) {
      const res = await request(app).get(`/projects/${project.id}/media/${id}`).set(authHeader(owner.token));
      expect(res.status, id).toBe(404);
    }
  });
});

describe('DELETE /projects/:projectId/media/:assetId', () => {
  it('removes the asset and its derived children and destroys each in storage', async () => {
    const { project, editor } = await team(app);
    const a = await insertAsset(project.id);
    storage.putResource({ publicId: a.publicId });
    const proxy = await insertAsset(project.id, { kind: 'proxy', parentId: a.id });
    const k1 = await insertAsset(project.id, { kind: 'keyframe', parentId: a.id });
    const k2 = await insertAsset(project.id, { kind: 'keyframe', parentId: a.id });
    const keep = await insertAsset(project.id);

    const res = await request(app).delete(`/projects/${project.id}/media/${a.id}`).set(authHeader(editor.token));
    expect(res.status).toBe(204);
    expect(await assetIds(project.id)).toEqual([keep.id]);
    expect([...storage.destroyed].sort()).toEqual([a.publicId, proxy.publicId, k1.publicId, k2.publicId].sort());
  });

  it('viewer cannot delete; nothing is removed or destroyed', async () => {
    const { project, viewer } = await team(app);
    const a = await insertAsset(project.id);
    const res = await request(app).delete(`/projects/${project.id}/media/${a.id}`).set(authHeader(viewer.token));
    expect(res.status).toBe(403);
    expect(await assetIds(project.id)).toEqual([a.id]);
    expect(storage.destroyed).toEqual([]);
  });

  it("another project's asset -> 404 and it survives", async () => {
    const { project, owner } = await team(app);
    const other = await createProject(app, owner.token, 'Other');
    const foreign = await insertAsset(other.id);
    const res = await request(app).delete(`/projects/${project.id}/media/${foreign.id}`).set(authHeader(owner.token));
    expect(res.status).toBe(404);
    expect(await assetIds(other.id)).toEqual([foreign.id]);
    expect(storage.destroyed).toEqual([]);
  });

  it('if storage fails, the rows stay so the delete can be retried', async () => {
    const { project, owner } = await team(app);
    const a = await insertAsset(project.id);
    storage.failNextDestroy(new Error('cloudinary down'));
    const res = await request(app).delete(`/projects/${project.id}/media/${a.id}`).set(authHeader(owner.token));
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal Server Error');
    expect(await assetIds(project.id)).toEqual([a.id]);
  });
});

describe('Phase 3 routes stay 501 on the real router', () => {
  it.each([
    ['get', 'index'],
    ['post', 'reprocess'],
  ])('%s /media/:assetId/%s -> 501', async (method, sub) => {
    const { project, owner } = await team(app);
    const a = await insertAsset(project.id);
    const res = await request(app)[method](`/projects/${project.id}/media/${a.id}/${sub}`).set(authHeader(owner.token));
    expect(res.status).toBe(501);
  });
});
