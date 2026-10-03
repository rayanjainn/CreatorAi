// Phase 7 role matrix: every render route x { owner, editor, viewer, nonMember,
// anonymous } -> status. Same shape as tests/phase5/rbac-matrix.test.js (P8 merges the
// exported MATRIX rows). Each cell runs against a fresh project holding one timeline
// with two clips and one queued preview render, so cells cannot see each other's renders.
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { requestRender } from '../../src/modules/render/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues } from '../helpers/queue.js';
import { insertOriginal, makeTimeline, reelDoc } from './helpers.js';

// Same actors as tests/phase1/rbac-matrix.test.js (not imported: importing a test file
// would register its suites here too).
export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

const READ = { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 };
const START = { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 };

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId", ":timelineId" and ":renderId" are
// filled in per cell). body(ctx): request body. expect: status per actor.
export const MATRIX = [
  { method: 'post', path: '/projects/:projectId/timelines/:timelineId/render', body: () => ({ kind: 'final' }), expect: START },
  { method: 'get', path: '/projects/:projectId/timelines/:timelineId/renders', expect: READ },
  { method: 'get', path: '/projects/:projectId/renders/:renderId', expect: READ },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember']) ctx.users[name] = await createUser(app);
});
beforeEach(clearQueues);
afterAll(closeAll);

// A fresh project owned by `owner` with editor and viewer members, one 2-clip timeline
// and one queued preview render of it.
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
  const asset = await insertOriginal(project.id);
  const timeline = await makeTimeline(project.id, reelDoc([[asset.id, 0, 1_000], [asset.id, 2_000, 3_000]]));
  const { render } = await requestRender(project.id, timeline.id, { kind: 'preview' });
  return { project, timeline, render };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 7 role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const { project, timeline, render } = await freshProject();
    const url = row.path.replace(':projectId', project.id).replace(':timelineId', timeline.id).replace(':renderId', render.id);
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body(ctx));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
