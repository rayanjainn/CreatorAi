// Phase-2 role matrix: every media route x { owner, editor, viewer, nonMember, anonymous }
// -> status, in the shape of tests/phase1/rbac-matrix.test.js. Each cell runs against a
// fresh project, so destructive rows do not interfere.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { addMember, createProject, insertAsset } from './helpers.js';

// Same actors as tests/phase1/rbac-matrix.test.js (importing that file would also run
// its suite here).
export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId" and ":assetId" are filled in per
// cell: a fresh project and an original asset in it). body(ctx): request body; ctx has
// the fixture users, the project and the asset, plus `upload`, a fresh direct upload in
// the project's originals folder. expect: status per actor.
export const MATRIX = [
  {
    method: 'post',
    path: '/projects/:projectId/media/sign',
    body: () => ({}),
    expect: { owner: 200, editor: 200, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/media',
    body: (ctx) => ({ publicId: ctx.upload.publicId }),
    expect: { owner: 201, editor: 201, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/media',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/media/:assetId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'delete',
    path: '/projects/:projectId/media/:assetId',
    expect: { owner: 204, editor: 204, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  // Phase-3 routes, still 501 stubs for everyone; phase 3 replaces these expectations.
  {
    method: 'get',
    path: '/projects/:projectId/media/:assetId/index',
    expect: { owner: 501, editor: 501, viewer: 501, nonMember: 501, anonymous: 501 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/media/:assetId/reprocess',
    expect: { owner: 501, editor: 501, viewer: 501, nonMember: 501, anonymous: 501 },
  },
  // Not project-scoped: a user token is not a Cloudinary signature.
  {
    method: 'post',
    path: '/webhooks/cloudinary',
    body: (ctx) => ({ notification_type: 'upload', public_id: ctx.upload.publicId }),
    expect: { owner: 401, editor: 401, viewer: 401, nonMember: 401, anonymous: 401 },
  },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const storage = getStorage();
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  storage.reset();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember']) ctx.users[name] = await createUser(app);
});
afterAll(closeAll);

// A fresh project owned by `owner` with editor and viewer members, one original asset,
// and one not-yet-registered upload in its originals folder.
async function freshProject() {
  const { owner } = ctx.users;
  const project = await createProject(app, owner.token, 'Matrix');
  await addMember(app, project, owner.token, ctx.users.editor, 'editor');
  await addMember(app, project, owner.token, ctx.users.viewer, 'viewer');
  const asset = await insertAsset(project.id);
  const upload = storage.putResource({
    publicId: `proj/${project.id}/originals/m-${randomUUID()}`,
    durationMs: 1000,
    width: 320,
    height: 240,
  });
  return { project, asset, upload };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 2 role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const fixture = await freshProject();
    const url = row.path.replace(':projectId', fixture.project.id).replace(':assetId', fixture.asset.id);
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body({ ...ctx, ...fixture }));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
