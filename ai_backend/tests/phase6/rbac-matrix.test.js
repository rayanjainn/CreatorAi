// Phase-6 role matrix: moments, reels, revise and job polling x { owner, editor, viewer,
// nonMember, anonymous } -> status, in the shape of tests/phase1/rbac-matrix.test.js.
// Each cell runs against a fresh project with an indexed asset, an ai timeline and a job.
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { buildTimelineDoc, requestMoments } from '../../src/modules/agents/editing/service.js';
import { createTimeline } from '../../src/modules/timeline/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues } from '../helpers/queue.js';
import { addMember, createProject, seedIndexedAsset } from './helpers.js';

export const ACTORS = ['owner', 'editor', 'viewer', 'nonMember', 'anonymous'];

// ---- MATRIX ----------------------------------------------------------------------
// method, path: the route as registered (":projectId", ":assetId", ":jobId" are filled in
// per cell). body(ctx): request body. expect: status per actor.
export const MATRIX = [
  {
    method: 'post',
    path: '/projects/:projectId/media/:assetId/moments',
    body: () => ({}),
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/media/:assetId/moments',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/agents/editing/reels',
    body: (ctx) => ({ assetId: ctx.asset.id, count: 2, targetSeconds: 30 }),
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'post',
    path: '/projects/:projectId/agents/editing/revise',
    body: (ctx) => ({ timelineId: ctx.timeline.id, instruction: 'Make it punchier' }),
    expect: { owner: 202, editor: 202, viewer: 403, nonMember: 404, anonymous: 401 },
  },
  {
    method: 'get',
    path: '/projects/:projectId/agents/editing/jobs/:jobId',
    expect: { owner: 200, editor: 200, viewer: 200, nonMember: 404, anonymous: 401 },
  },
];
// ---- end MATRIX ------------------------------------------------------------------

const app = createApp({ log: { error() {} } });
const ctx = { users: {} };

beforeAll(async () => {
  await resetDb();
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
  const asset = await seedIndexedAsset(project.id, { durationMs: 60_000 });
  const { timeline } = await createTimeline(project.id, {
    title: 'Matrix reel',
    sourceAssetId: asset.id,
    doc: buildTimelineDoc({ assetId: asset.id, durationMs: asset.durationMs, keep: [{ startMs: 0, endMs: 5_000 }] }),
    authorType: 'ai',
  });
  const job = await requestMoments(project.id, owner.user.id, asset.id);
  return { project, asset, timeline, job };
}

const cells = MATRIX.flatMap((row) => ACTORS.map((actor) => [row.method.toUpperCase(), row.path, actor, row]));

describe('phase 6 role matrix', () => {
  it('covers every actor in every row', () => {
    for (const row of MATRIX) expect(Object.keys(row.expect).sort()).toEqual([...ACTORS].sort());
  });

  it.each(cells)('%s %s as %s', async (_method, _path, actor, row) => {
    const fixture = await freshProject();
    const url = row.path
      .replace(':projectId', fixture.project.id)
      .replace(':assetId', fixture.asset.id)
      .replace(':jobId', fixture.job.id);
    let req = request(app)[row.method](url);
    if (actor !== 'anonymous') req = req.set(authHeader(ctx.users[actor].token));
    if (row.body) req = req.send(row.body({ ...ctx, ...fixture }));
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
  });
});
