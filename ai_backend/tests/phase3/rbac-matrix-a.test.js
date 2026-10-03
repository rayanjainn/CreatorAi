// Phase-3 Track A role matrix: index, reprocess and search x { owner, editor, viewer,
// nonMember, anonymous } -> status, in the shape of tests/phase1/rbac-matrix.test.js.
// Each cell runs against a fresh project with one original asset.
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues } from '../helpers/queue.js';
import { addMember, createProject, registerOriginal } from './helpers.js';

// Same actors as tests/phase1/rbac-matrix.test.js (importing that file would also run
// its suite here).
export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId" and ":assetId" are filled in per
// cell: a fresh project and a registered original in it). body(ctx): request body.
// expect: status per actor.
export const MATRIX = [
  {
    method: 'get',
    path: '/projects/:projectId/media/:assetId/index',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/media/:assetId/reprocess',
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/search',
    body: () => ({ query: 'hooks that keep viewers watching' }),
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  getStorage().reset();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember']) ctx.users[name] = await createUser(app);
});
beforeEach(clearQueues);
afterAll(async () => {
  await clearQueues();
  await closeAll();
});

async function freshProject() {
  const { owner } = ctx.users;
  const project = await createProject(app, owner.token, 'Matrix');
  await addMember(app, project, owner.token, ctx.users.editor, 'editor');
  await addMember(app, project, owner.token, ctx.users.viewer, 'viewer');
  const asset = await registerOriginal(app, project, owner.token);
  return { project, asset };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 3 (Track A) role matrix', () => {
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
