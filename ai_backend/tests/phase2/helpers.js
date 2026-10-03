// Shared setup for the phase-2 tests: a project with an owner, editor, viewer and a
// non-member, and direct inserts of asset rows (derived assets are made by phase-3 workers).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { query } from '../../src/db/pool.js';
import { authHeader, createUser } from '../helpers/auth.js';

export async function createProject(app, token, name = 'Media') {
  const res = await request(app).post('/projects').set(authHeader(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.project;
}

export async function addMember(app, project, ownerToken, member, role) {
  const res = await request(app)
    .post(`/projects/${project.id}/members`)
    .set(authHeader(ownerToken))
    .send({ email: member.email, role });
  expect(res.status).toBe(201);
}

// { project, owner, editor, viewer, outsider }
export async function team(app) {
  const [owner, editor, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => createUser(app)));
  const project = await createProject(app, owner.token);
  await addMember(app, project, owner.token, editor, 'editor');
  await addMember(app, project, owner.token, viewer, 'viewer');
  return { project, owner, editor, viewer, outsider };
}

// Inserts an asset row directly. Returns { id, publicId }.
export async function insertAsset(projectId, { kind = 'original', parentId = null, status = 'uploaded', publicId } = {}) {
  const folder = kind === 'original' ? 'originals' : 'derived';
  const pid = publicId ?? `proj/${projectId}/${folder}/${kind}-${randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO assets (project_id, kind, parent_asset_id, cloudinary_public_id, url, duration_ms, width, height, status)
     VALUES ($1, $2, $3, $4, $5, 20000, 640, 360, $6) RETURNING id`,
    [projectId, kind, parentId, pid, `https://res.fake-cloudinary.test/demo/video/upload/${pid}.mp4`, status],
  );
  return { id: rows[0].id, publicId: pid };
}

export async function assetIds(projectId) {
  const { rows } = await query('SELECT id FROM assets WHERE project_id = $1', [projectId]);
  return rows.map((r) => r.id).sort();
}
