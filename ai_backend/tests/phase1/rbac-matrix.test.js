// Role matrix: every route x { owner, editor, viewer, nonMember, anonymous } -> status.
// Each cell runs against a fresh project, so destructive rows do not interfere.
// Later phases extend MATRIX with their routes; P8 checks every route in app.js is here.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId" and ":userId" are filled in per
// cell: a fresh project, and a viewer member "target" who is never the actor).
// body(ctx): request body; ctx has the fixture users. expect: status per actor.
export const MATRIX = [
  {
    method: 'post',
    path: '/projects',
    body: () => ({ name: 'Matrix project' }),
    expect: { owner: 201, editor: 201, viewer: 201, nonMember: 201, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 200, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'patch',
    path: '/projects/:projectId',
    body: () => ({ name: 'Renamed' }),
    expect: { owner: 200, editor: 200, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'delete',
    path: '/projects/:projectId',
    expect: { owner: 204, editor: 403, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/members',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/members',
    body: (ctx) => ({ email: ctx.users.newcomer.email, role: 'viewer' }),
    expect: { owner: 201, editor: 403, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'patch',
    path: '/projects/:projectId/members/:userId',
    body: () => ({ role: 'editor' }),
    expect: { owner: 200, editor: 403, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'delete',
    path: '/projects/:projectId/members/:userId',
    expect: { owner: 204, editor: 403, viewer: 403, nonMember: 404, anonymous: 401 },
  },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember', 'target', 'newcomer']) {
    ctx.users[name] = await createUser(app);
  }
});
afterAll(closeAll);

// A fresh project owned by `owner` with editor, viewer and target (viewer) as members.
async function freshProject() {
  const { owner } = ctx.users;
  const res = await request(app).post('/projects').set(authHeader(owner.token)).send({ name: 'Matrix' });
  expect(res.status).toBe(201);
  const project = res.body.project;
  for (const [name, role] of [['editor', 'editor'], ['viewer', 'viewer'], ['target', 'viewer']]) {
    const add = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(owner.token))
      .send({ email: ctx.users[name].email, role });
    expect(add.status).toBe(201);
  }
  return project;
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const project = await freshProject();
    const url = row.path.replace(':projectId', project.id).replace(':userId', ctx.users.target.user.id);
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body(ctx));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
