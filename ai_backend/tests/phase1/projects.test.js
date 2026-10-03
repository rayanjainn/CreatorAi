import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

const app = createApp({ log: { error() {} } });

beforeEach(resetDb);
afterAll(closeAll);

async function createProject(token, body = { name: 'Demo', description: 'A demo project' }) {
  const res = await request(app).post('/projects').set(authHeader(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.project;
}

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// The members endpoints land in P1.T3; until then, memberships are inserted directly.
async function addMember(projectId, userId, role) {
  await getPool().query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [
    projectId,
    userId,
    role,
  ]);
}

describe('POST /projects', () => {
  it('creates a project and the caller becomes its owner', async () => {
    const alice = await createUser(app);
    const res = await request(app)
      .post('/projects')
      .set(authHeader(alice.token))
      .send({ name: 'Launch video', description: 'Q4 launch' });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: 'Launch video',
      description: 'Q4 launch',
      createdBy: alice.user.id,
      role: 'owner',
    });
    expect(res.body.project.id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await getPool().query(
      'SELECT user_id, role FROM project_members WHERE project_id = $1',
      [res.body.project.id],
    );
    expect(rows).toEqual([{ user_id: alice.user.id, role: 'owner' }]);
  });

  it('description is optional', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token, { name: 'No description' });
    expect(project.description).toBeNull();
  });

  it('anonymous -> 401', async () => {
    const res = await request(app).post('/projects').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing name', {}],
    ['empty name', { name: '   ' }],
    ['non-string name', { name: 42 }],
    ['unknown field', { name: 'x', owner: 'me' }],
  ])('invalid body (%s) -> 400', async (_label, body) => {
    const alice = await createUser(app);
    const res = await request(app).post('/projects').set(authHeader(alice.token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('GET /projects', () => {
  it('lists only the projects the caller is a member of, with the caller role', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const a1 = await createProject(alice.token, { name: 'Alice 1' });
    const a2 = await createProject(alice.token, { name: 'Alice 2' });
    const b1 = await createProject(bob.token, { name: 'Bob 1' });

    const res = await request(app).get('/projects').set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p) => p.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(res.body.projects.every((p) => p.role === 'owner')).toBe(true);

    const bobs = await request(app).get('/projects').set(authHeader(bob.token));
    expect(bobs.body.projects.map((p) => p.id)).toEqual([b1.id]);
  });

  it('includes projects where the caller is an editor, with role editor', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    await addMember(project.id, bob.user.id, 'editor');

    const res = await request(app).get('/projects').set(authHeader(bob.token));
    expect(res.body.projects).toEqual([expect.objectContaining({ id: project.id, role: 'editor' })]);
  });

  it('empty list for a user with no projects', async () => {
    const alice = await createUser(app);
    const res = await request(app).get('/projects').set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  it('anonymous -> 401', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(401);
  });
});

describe('GET /projects/:projectId', () => {
  it('owner gets the project with role owner', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.project).toEqual(project);
  });

  it('viewer gets the project with role viewer', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    await addMember(project.id, bob.user.id, 'viewer');
    const res = await request(app).get(`/projects/${project.id}`).set(authHeader(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.project.role).toBe('viewer');
  });

  it('non-member -> 404, same as a project that does not exist', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).get(`/projects/${project.id}`).set(authHeader(bob.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');

    const missing = await request(app).get(`/projects/${MISSING_ID}`).set(authHeader(bob.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe(res.body.error.message);
  });

  it('anonymous -> 401', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).get(`/projects/${project.id}`);
    expect(res.status).toBe(401);
  });

  it.each(['not-a-uuid', '123', "1' OR '1'='1"])('malformed id %s -> 404', async (id) => {
    const alice = await createUser(app);
    const res = await request(app).get(`/projects/${encodeURIComponent(id)}`).set(authHeader(alice.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('PATCH /projects/:projectId', () => {
  it('owner can rename and change the description', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(authHeader(alice.token))
      .send({ name: 'Renamed', description: 'New text' });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ id: project.id, name: 'Renamed', description: 'New text', role: 'owner' });
    expect(new Date(res.body.project.updatedAt) >= new Date(project.updatedAt)).toBe(true);

    const again = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(again.body.project.name).toBe('Renamed');
  });

  it('description: null clears the description', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(authHeader(alice.token))
      .send({ description: null });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ name: project.name, description: null });
  });

  it('editor can update', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    await addMember(project.id, bob.user.id, 'editor');
    const res = await request(app).patch(`/projects/${project.id}`).set(authHeader(bob.token)).send({ name: 'By Bob' });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ name: 'By Bob', role: 'editor' });
  });

  it('viewer -> 403 and nothing changes', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    await addMember(project.id, bob.user.id, 'viewer');
    const res = await request(app).patch(`/projects/${project.id}`).set(authHeader(bob.token)).send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    const again = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(again.body.project.name).toBe(project.name);
  });

  it('non-member -> 404', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).patch(`/projects/${project.id}`).set(authHeader(bob.token)).send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('anonymous -> 401', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).patch(`/projects/${project.id}`).send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('malformed id -> 404', async () => {
    const alice = await createUser(app);
    const res = await request(app).patch('/projects/not-a-uuid').set(authHeader(alice.token)).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['empty body', {}],
    ['empty name', { name: '' }],
    ['non-string name', { name: 5 }],
    ['unknown field', { name: 'x', createdBy: MISSING_ID }],
  ])('invalid body (%s) -> 400', async (_label, body) => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).patch(`/projects/${project.id}`).set(authHeader(alice.token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('DELETE /projects/:projectId', () => {
  it('owner deletes -> 204, then the project is gone', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).delete(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(res.status).toBe(204);

    const again = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(again.status).toBe(404);
    const { rows } = await getPool().query('SELECT 1 FROM project_members WHERE project_id = $1', [project.id]);
    expect(rows).toHaveLength(0);
  });

  it.each(['editor', 'viewer'])('%s -> 403 and the project survives', async (role) => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    await addMember(project.id, bob.user.id, role);
    const res = await request(app).delete(`/projects/${project.id}`).set(authHeader(bob.token));
    expect(res.status).toBe(403);
    const again = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(again.status).toBe(200);
  });

  it('non-member -> 404 and the project survives', async () => {
    const alice = await createUser(app);
    const bob = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).delete(`/projects/${project.id}`).set(authHeader(bob.token));
    expect(res.status).toBe(404);
    const again = await request(app).get(`/projects/${project.id}`).set(authHeader(alice.token));
    expect(again.status).toBe(200);
  });

  it('anonymous -> 401', async () => {
    const alice = await createUser(app);
    const project = await createProject(alice.token);
    const res = await request(app).delete(`/projects/${project.id}`);
    expect(res.status).toBe(401);
  });

  it('malformed id -> 404', async () => {
    const alice = await createUser(app);
    const res = await request(app).delete('/projects/not-a-uuid').set(authHeader(alice.token));
    expect(res.status).toBe(404);
  });
});

describe('routes not yet implemented', () => {
  it.each([
    ['post', '/projects/p1/members'],
    ['patch', '/projects/p1/members/u1'],
    ['delete', '/projects/p1/members/u1'],
    ['get', '/projects/p1/activity'],
  ])('%s %s is still a 501 stub', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(501);
  });
});
