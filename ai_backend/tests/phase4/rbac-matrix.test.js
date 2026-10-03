// Phase 4 role matrix: every Phase 4 route x { owner, editor, viewer, nonMember,
// anonymous } -> status, in the shape of tests/phase1/rbac-matrix.test.js.
// Each cell runs against a fresh project that already holds one plan, brief and script
// (made through the agent runner with the fake LLM), so ":planId", ":briefId",
// ":scriptId" and ":runId" resolve to real rows of that project.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { runAgent } from '../../src/modules/agents/service.js';
import { directorAgent } from '../../src/modules/agents/director/service.js';
import { researchAgent } from '../../src/modules/agents/research/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues } from '../helpers/queue.js';
import { briefReply, directorBody, planReply } from './fixtures.js';

export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered under /projects/:projectId. Placeholders are
// filled per cell from that project's fixture rows. body(ctx): request body.
export const MATRIX = [
  {
    method: 'get',
    path: '/projects/:projectId/agents/runs/:runId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/agents/director/plan',
    body: () => directorBody(),
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/plans',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/plans/:planId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/agents/research',
    body: () => ({ topic: 'espresso grind size' }),
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/briefs',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/briefs/:briefId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const llm = getLlm();
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
  await clearQueues();
  for (const name of ['owner', 'editor', 'viewer', 'nonMember']) ctx.users[name] = await createUser(app);
});
afterAll(async () => {
  llm.reset();
  await clearQueues();
  await closeAll();
});

// A fresh project owned by `owner` (editor and viewer as members) with one plan.
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
  llm.reset();
  llm.queueResponse(planReply());
  const planned = await runAgent({
    ...directorAgent,
    name: 'director',
    projectId: project.id,
    userId: owner.user.id,
    input: directorBody(),
  });
  expect(planned.run.status).toBe('succeeded');
  const run = (def, name, input) => runAgent({ ...def, name, projectId: project.id, userId: owner.user.id, input });

  llm.queueResponse((req) => briefReply(req.prompt.match(/https:\/\/example\.com\/[^\s"]+/g).slice(0, 1)));
  const researched = await run(researchAgent, 'research', { topic: 'espresso grind size' });
  expect(researched.run.status).toBe('succeeded');

  return {
    project,
    params: { runId: planned.run.id, planId: planned.artifact.id, briefId: researched.artifact.id },
  };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 4 role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const { project, params } = await freshProject();
    const url = row.path
      .replace(':projectId', project.id)
      .replace(/:(\w+)/g, (_m, name) => params[name] ?? `missing-${name}`);
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body(ctx));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
