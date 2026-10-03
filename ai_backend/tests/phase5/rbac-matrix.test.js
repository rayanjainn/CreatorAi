// Phase 5 role matrix: every timeline route x { owner, editor, viewer, nonMember,
// anonymous } -> status. Same shape as tests/phase1/rbac-matrix.test.js (P8 merges the
// exported MATRIX rows). Each cell runs against a fresh project holding one timeline
// at v1, so writes in one cell cannot move another cell's head.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { emptyTimelineDoc } from '../../src/modules/timeline/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

// Same actors as tests/phase1/rbac-matrix.test.js (not imported: importing a test file
// would register its suites here too).
export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

const READ = { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 };
const WRITE = { owner: 201, editor: 201, viewer: 403, nonMember: 404, anonymous: 401 };

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId" and ":timelineId" are filled in
// per cell, ":version" is 1). query: appended query string. body(ctx): request body.
// expect: status per actor.
export const MATRIX = [
  { method: 'post', path: '/projects/:projectId/timelines', body: () => ({ title: 'Matrix reel' }), expect: WRITE },
  { method: 'get', path: '/projects/:projectId/timelines', expect: READ },
  { method: 'get', path: '/projects/:projectId/timelines/:timelineId', expect: READ },
  { method: 'get', path: '/projects/:projectId/timelines/:timelineId/versions', expect: READ },
  { method: 'get', path: '/projects/:projectId/timelines/:timelineId/versions/:version', expect: READ },
  {
    method: 'post',
    path: '/projects/:projectId/timelines/:timelineId/versions',
    body: () => ({ baseVersion: 1, doc: emptyTimelineDoc(), summary: 'Matrix save' }),
    expect: WRITE,
  },
  {
    method: 'post',
    path: '/projects/:projectId/timelines/:timelineId/revert',
    body: () => ({ toVersion: 1 }),
    expect: WRITE,
  },
  { method: 'get', path: '/projects/:projectId/timelines/:timelineId/diff', query: '?from=1&to=1', expect: READ },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember']) ctx.users[name] = await createUser(app);
});
afterAll(closeAll);

// A fresh project owned by `owner` with editor and viewer members and one timeline (v1).
async function freshProject() {
  const { owner } = ctx.users;
  const res = await request(app).post('/projects').set(authHeader(owner.token)).send({ name: 'Matrix' });
  expect(res.status).toBe(201);
  const project = res.body.project;
  for (const role of ['editor', 'viewer']) {
    const add = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(owner.token))
      .send({ email: ctx.users[role].email, role });
    expect(add.status).toBe(201);
  }
  const tl = await request(app)
    .post(`/projects/${project.id}/timelines`)
    .set(authHeader(owner.token))
    .send({ title: 'Matrix timeline' });
  expect(tl.status).toBe(201);
  return { project, timeline: tl.body.timeline };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 5 role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const { project, timeline } = await freshProject();
    const url = row.path.replace(':projectId', project.id).replace(':timelineId', timeline.id).replace(':version', '1') + (row.query ?? '');
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body(ctx));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
