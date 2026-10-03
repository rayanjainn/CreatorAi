// Shared setup for the phase-3 Track A tests: a project team, originals registered in the
// fake storage, and fake implementations of the Track B steps (scenes, faces, analysis)
// injected through the orchestrator's step registry.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { query, withTransaction } from '../../src/db/pool.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { setStepRunner } from '../../src/workers/process.js';
import { authHeader, createUser } from '../helpers/auth.js';

export const DURATION_MS = 20_000;

export async function createProject(app, token, name = 'Index') {
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

// Registers an original through POST /media (fake storage upload first), which enqueues
// exactly one media.process job. Returns the asset.
export async function registerOriginal(app, project, token, { durationMs = DURATION_MS } = {}) {
  const upload = getStorage().putResource({
    publicId: `proj/${project.id}/originals/clip-${randomUUID()}`,
    durationMs,
    width: 640,
    height: 360,
  });
  const res = await request(app).post(`/projects/${project.id}/media`).set(authHeader(token)).send({ publicId: upload.publicId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.asset;
}

// ---- fake Track B steps -------------------------------------------------------------
// Each one honours the step contract: idempotent (delete-then-insert), reads from the DB.

export const FAKE_CAPTIONS = ['A person talks to the camera in a kitchen', 'A close-up of a chart on a laptop screen'];

export async function fakeScenes({ assetId }) {
  const { rows } = await query('SELECT duration_ms FROM assets WHERE id = $1', [assetId]);
  const duration = rows[0].duration_ms;
  const cut = Math.floor(duration / 2);
  await withTransaction(async (c) => {
    await c.query('DELETE FROM scenes WHERE asset_id = $1', [assetId]);
    await c.query(
      `INSERT INTO scenes (asset_id, idx, start_ms, end_ms) VALUES ($1, 0, 0, $2), ($1, 1, $2, $3)`,
      [assetId, cut, duration],
    );
  });
  return { scenes: 2 };
}

export async function fakeFaces({ assetId }) {
  await withTransaction(async (c) => {
    await c.query('DELETE FROM faces WHERE asset_id = $1', [assetId]);
    await c.query(
      `INSERT INTO faces (asset_id, scene_id, at_ms, bbox)
       SELECT asset_id, id, start_ms, '{"x":10,"y":20,"width":30,"height":40}'::jsonb FROM scenes
       WHERE asset_id = $1 AND idx = 0`,
      [assetId],
    );
  });
  return { faces: 1 };
}

export async function fakeAnalysis({ assetId }) {
  await withTransaction(async (c) => {
    for (const [idx, caption] of FAKE_CAPTIONS.entries()) {
      await c.query('UPDATE scenes SET caption = $3 WHERE asset_id = $1 AND idx = $2', [assetId, idx, caption]);
    }
    await c.query(
      `INSERT INTO asset_analysis (asset_id, summary, topics) VALUES ($1, 'A short talking-head clip', '["hooks","retention"]')
       ON CONFLICT (asset_id) DO UPDATE SET summary = EXCLUDED.summary, topics = EXCLUDED.topics, updated_at = now()`,
      [assetId],
    );
  });
  return { analysed: true };
}

// Replaces the three Track B steps with the fakes above.
export function useFakeTrackB() {
  setStepRunner('scenes', fakeScenes);
  setStepRunner('faces', fakeFaces);
  setStepRunner('analysis', fakeAnalysis);
}

export async function countRows(assetId) {
  const counts = {};
  for (const table of ['transcript_segments', 'scenes', 'faces', 'asset_analysis']) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE asset_id = $1`, [assetId]);
    counts[table] = rows[0].n;
  }
  return counts;
}

export async function stepRows(assetId) {
  const { rows } = await query(
    'SELECT step, status, error, attempts FROM processing_jobs WHERE asset_id = $1 ORDER BY step',
    [assetId],
  );
  return rows;
}

export async function assetStatus(assetId) {
  const { rows } = await query('SELECT status FROM assets WHERE id = $1', [assetId]);
  return rows[0]?.status;
}
