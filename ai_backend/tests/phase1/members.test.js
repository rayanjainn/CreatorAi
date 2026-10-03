import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { requireAuth } from '../../src/modules/auth/service.js';
import { requireRole } from '../../src/modules/projects/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

// The probe route is mounted the way later phases mount their project-scoped routers.
const app = createApp({
  log: { error() {} },
  configure: (a) =>
    a.get('/projects/:projectId/__probe', requireAuth(), requireRole('editor'), (req, res) =>
      res.json(req.project ?? { role: req.role }),
    ),
});

beforeEach(resetDb);
afterAll(closeAll);

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function createProject(token, body = { name: 'Demo' }) {
  const res = await request(app).post('/projects').set(authHeader(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.project;
}

async function addMember(project, ownerToken, member, role) {
  const res = await request(app)
    .post(`/projects/${project.id}/members`)
    .set(authHeader(ownerToken))
    .send({ email: member.email, role });
  expect(res.status).toBe(201);
  return res.body.member;
}

// alice owns a project; bob is an editor, carol a viewer, dave a non-member.
async function team() {
  const [alice, bob, carol, dave] = await Promise.all([1, 2, 3, 4].map(() => createUser(app)));
  const project = await createProject(alice.token);
  await addMember(project, alice.token, bob, 'editor');
  await addMember(project, alice.token, carol, 'viewer');
  return { project, alice, bob, carol, dave };
}

describe('requireRole at the seam (GET /projects/:projectId/__probe, editor+)', () => {
  it('owner and editor -> 200 with req.project = { id, role }', async () => {
    const { project, alice, bob } = await team();
    const owner = await request(app).get(`/projects/${project.id}/__probe`).set(authHeader(alice.token));
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual({ id: project.id, role: 'owner' });
    const editor = await request(app).get(`/projects/${project.id}/__probe`).set(authHeader(bob.token));
    expect(editor.status).toBe(200);
    expect(editor.body).toEqual({ id: project.id, role: 'editor' });
  });

  it('viewer -> 403', async () => {
    const { project, carol } = await team();
    const res = await request(app).get(`/projects/${project.id}/__probe`).set(authHeader(carol.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('non-member -> 404, same as a missing project', async () => {
    const { project, dave } = await team();
    const res = await request(app).get(`/projects/${project.id}/__probe`).set(authHeader(dave.token));
    expect(res.status).toBe(404);
    const missing = await request(app).get(`/projects/${MISSING_ID}/__probe`).set(authHeader(dave.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe(res.body.error.message);
  });

  it('anonymous -> 401', async () => {
    const { project } = await team();
    const res = await request(app).get(`/projects/${project.id}/__probe`);
    expect(res.status).toBe(401);
  });

  it('malformed project id -> 404', async () => {
    const { alice } = await team();
    const res = await request(app).get('/projects/not-a-uuid/__probe').set(authHeader(alice.token));
    expect(res.status).toBe(404);
  });

  it('works without requireAuth in front: anonymous -> 401, member -> 200', async () => {
    const bare = createApp({
      log: { error() {} },
      configure: (a) => a.get('/projects/:projectId/__bare', requireRole('viewer'), (req, res) => res.json(req.project)),
    });
    const { project, carol } = await team();
    expect((await request(bare).get(`/projects/${project.id}/__bare`)).status).toBe(401);
    const res = await request(bare).get(`/projects/${project.id}/__bare`).set(authHeader(carol.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: project.id, role: 'viewer' });
  });

  it('rejects an unknown minRole when the middleware is built', () => {
    expect(() => requireRole('admin')).toThrow(/Unknown role/);
  });
});

describe('POST /projects/:projectId/members (owner)', () => {
  it('adds a member by email -> 201 with the member', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app, { name: 'Bob' });
    const project = await createProject(alice.token);
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(alice.token))
      .send({ email: bob.email.toUpperCase(), role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.member).toEqual({
      userId: bob.user.id,
      email: bob.email,
      name: 'Bob',
      role: 'editor',
      createdAt: expect.any(String),
    });
  });

  it('the added member sees the project in GET /projects with their role', async () => {
    const { project, bob } = await team();
    const res = await request(app).get('/projects').set(authHeader(bob.token));
    expect(res.body.projects).toEqual([expect.objectContaining({ id: project.id, role: 'editor' })]);
  });

  it('unknown email -> 404', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(alice.token))
      .send({ email: 'nobody@example.test', role: 'viewer' });
    expect(res.status).toBe(404);
  });

  it('already a member -> 409 and the role is unchanged', async () => {
    const { project, alice, bob } = await team();
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(alice.token))
      .send({ email: bob.email, role: 'viewer' });
    expect(res.status).toBe(409);
    const self = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(alice.token))
      .send({ email: alice.email, role: 'viewer' });
    expect(self.status).toBe(409);
    const list = await request(app).get(`/projects/${project.id}/members`).set(authHeader(alice.token));
    expect(list.body.members.find((m) => m.userId === bob.user.id).role).toBe('editor');
  });

  it.each([
    ['invalid role', { email: 'x@example.test', role: 'admin' }],
    ['missing role', { email: 'x@example.test' }],
    ['invalid email', { email: 'not-an-email', role: 'viewer' }],
    ['unknown field', { email: 'x@example.test', role: 'viewer', userId: MISSING_ID }],
  ])('%s -> 400', async (_label, body) => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).post(`/projects/${project.id}/members`).set(authHeader(alice.token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('editor cannot add members -> 403', async () => {
    const { project, bob, dave } = await team();
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(bob.token))
      .send({ email: dave.email, role: 'viewer' });
    expect(res.status).toBe(403);
  });

  it('non-member -> 404 even with an invalid body', async () => {
    const { project, dave } = await team();
    const res = await request(app).post(`/projects/${project.id}/members`).set(authHeader(dave.token)).send({});
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:projectId/members (viewer+)', () => {
  it('lists every member with email, name and role, never a password hash', async () => {
    const { project, alice, bob, carol } = await team();
    const res = await request(app).get(`/projects/${project.id}/members`).set(authHeader(carol.token));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m) => [m.userId, m.email, m.role])).toEqual([
      [alice.user.id, alice.email, 'owner'],
      [bob.user.id, bob.email, 'editor'],
      [carol.user.id, carol.email, 'viewer'],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('non-member -> 404', async () => {
    const { project, dave } = await team();
    const res = await request(app).get(`/projects/${project.id}/members`).set(authHeader(dave.token));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /projects/:projectId/members/:userId (owner)', () => {
  const patch = (project, token, userId, body) =>
    request(app).patch(`/projects/${project.id}/members/${userId}`).set(authHeader(token)).send(body);

  it('changes a role -> 200 with the member; the change is visible to that member', async () => {
    const { project, alice, carol } = await team();
    const res = await patch(project, alice.token, carol.user.id, { role: 'editor' });
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ userId: carol.user.id, email: carol.email, role: 'editor' });
    const seen = await request(app).get(`/projects/${project.id}`).set(authHeader(carol.token));
    expect(seen.body.project.role).toBe('editor');
  });

  it('cannot demote the last owner -> 409', async () => {
    const { project, alice } = await team();
    const res = await patch(project, alice.token, alice.user.id, { role: 'editor' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    const seen = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(seen.body.project.role).toBe('owner');
  });

  it('with two owners, one can be demoted; then the other is the last owner', async () => {
    const { project, alice, bob } = await team();
    expect((await patch(project, alice.token, bob.user.id, { role: 'owner' })).status).toBe(200);
    const demote = await patch(project, bob.token, alice.user.id, { role: 'viewer' });
    expect(demote.status).toBe(200);
    expect(demote.body.member.role).toBe('viewer');
    expect((await patch(project, bob.token, bob.user.id, { role: 'editor' })).status).toBe(409);
  });

  it('two owners demoting each other at once: one wins, one owner remains', async () => {
    const { project, alice, bob } = await team();
    await patch(project, alice.token, bob.user.id, { role: 'owner' });
    const results = await Promise.all([
      patch(project, alice.token, bob.user.id, { role: 'editor' }),
      patch(project, bob.token, alice.user.id, { role: 'editor' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // The loser hits the last-owner rule (409), or 403 when the winner committed before
    // the loser's role check ran.
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const members = await request(app).get(`/projects/${project.id}/members`).set(authHeader(alice.token));
    expect(members.body.members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it.each([
    ['viewer', 'carol', 'bob'],
    ['editor', 'bob', 'carol'],
  ])('%s cannot change roles -> 403', async (_role, actor, target) => {
    const t = await team();
    const res = await patch(t.project, t[actor].token, t[target].user.id, { role: 'owner' });
    expect(res.status).toBe(403);
  });

  it('target not a member -> 404', async () => {
    const { project, alice, dave } = await team();
    expect((await patch(project, alice.token, dave.user.id, { role: 'viewer' })).status).toBe(404);
    expect((await patch(project, alice.token, MISSING_ID, { role: 'viewer' })).status).toBe(404);
  });

  it('malformed userId -> 404', async () => {
    const { project, alice } = await team();
    expect((await patch(project, alice.token, 'not-a-uuid', { role: 'viewer' })).status).toBe(404);
  });

  it.each([
    ['invalid role', { role: 'admin' }],
    ['empty body', {}],
    ['unknown field', { role: 'viewer', email: 'x@example.test' }],
  ])('%s -> 400', async (_label, body) => {
    const { project, alice, carol } = await team();
    const res = await patch(project, alice.token, carol.user.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('DELETE /projects/:projectId/members/:userId (owner, or self to leave)', () => {
  const remove = (project, token, userId) =>
    request(app).delete(`/projects/${project.id}/members/${userId}`).set(authHeader(token));

  it('owner removes a member -> 204; the removed member then gets 404 on the project', async () => {
    const { project, alice, bob } = await team();
    expect((await remove(project, alice.token, bob.user.id)).status).toBe(204);
    expect((await request(app).get(`/projects/${project.id}`).set(authHeader(bob.token))).status).toBe(404);
    const list = await request(app).get('/projects').set(authHeader(bob.token));
    expect(list.body.projects).toEqual([]);
  });

  it('a viewer can leave -> 204', async () => {
    const { project, alice, carol } = await team();
    expect((await remove(project, carol.token, carol.user.id)).status).toBe(204);
    const members = await request(app).get(`/projects/${project.id}/members`).set(authHeader(alice.token));
    expect(members.body.members.map((m) => m.userId)).not.toContain(carol.user.id);
  });

  it('cannot remove the last owner, also not by leaving -> 409', async () => {
    const { project, alice } = await team();
    const res = await remove(project, alice.token, alice.user.id);
    expect(res.status).toBe(409);
    expect((await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token))).status).toBe(200);
  });

  it('with two owners, one owner can be removed', async () => {
    const { project, alice, bob } = await team();
    await request(app)
      .patch(`/projects/${project.id}/members/${bob.user.id}`)
      .set(authHeader(alice.token))
      .send({ role: 'owner' });
    expect((await remove(project, bob.token, alice.user.id)).status).toBe(204);
    expect((await remove(project, bob.token, bob.user.id)).status).toBe(409);
  });

  it.each([
    ['editor', 'bob', 'carol'],
    ['viewer', 'carol', 'bob'],
  ])('%s cannot remove someone else -> 403', async (_role, actor, target) => {
    const t = await team();
    const res = await remove(t.project, t[actor].token, t[target].user.id);
    expect(res.status).toBe(403);
  });

  it('non-member -> 404', async () => {
    const { project, alice, dave } = await team();
    expect((await remove(project, dave.token, alice.user.id)).status).toBe(404);
    expect((await remove(project, dave.token, dave.user.id)).status).toBe(404);
  });

  it('target not a member, or malformed userId -> 404', async () => {
    const { project, alice, dave } = await team();
    expect((await remove(project, alice.token, dave.user.id)).status).toBe(404);
    expect((await remove(project, alice.token, 'not-a-uuid')).status).toBe(404);
  });

  it('anonymous -> 401', async () => {
    const { project, bob } = await team();
    expect((await request(app).delete(`/projects/${project.id}/members/${bob.user.id}`)).status).toBe(401);
  });
});
