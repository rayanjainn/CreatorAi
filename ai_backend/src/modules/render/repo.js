// render repo: SQL for the renders table (070_renders.sql).
import { query } from '../../db/pool.js';

const COLUMNS = `id, project_id, timeline_id, version, kind, status, progress, output_asset_id, error,
  attempts, requested_by, created_at, updated_at, started_at, finished_at`;

// Inserts a queued render unless a live one (not failed) exists for the same
// { timeline, version, kind }. -> the new row, or null on conflict.
export async function insertQueued(db, { projectId, timelineId, version, kind, requestedBy }) {
  const { rows } = await db.query(
    `INSERT INTO renders (project_id, timeline_id, version, kind, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (timeline_id, version, kind) WHERE status <> 'failed' DO NOTHING
     RETURNING ${COLUMNS}`,
    [projectId, timelineId, version, kind, requestedBy],
  );
  return rows[0] ?? null;
}

// The live render for { timeline, version, kind }, locked for the rest of the transaction.
export async function findLive(db, { timelineId, version, kind }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM renders
     WHERE timeline_id = $1 AND version = $2 AND kind = $3 AND status <> 'failed'
     FOR UPDATE`,
    [timelineId, version, kind],
  );
  return rows[0] ?? null;
}

// A done render whose output asset is gone goes back to the queue.
export async function requeue(db, id) {
  const { rows } = await db.query(
    `UPDATE renders SET status = 'queued', progress = 0, error = NULL, output_asset_id = NULL,
       started_at = NULL, finished_at = NULL, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findOne(projectId, id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM renders WHERE id = $1 AND project_id = $2`, [id, projectId]);
  return rows[0] ?? null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM renders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listForTimeline(projectId, timelineId) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM renders WHERE project_id = $1 AND timeline_id = $2 ORDER BY created_at DESC, id`,
    [projectId, timelineId],
  );
  return rows;
}

// queued (or rendering, after a crashed worker) -> rendering. done/failed -> null.
export async function claim(id) {
  const { rows } = await query(
    `UPDATE renders SET status = 'rendering', attempts = attempts + 1, progress = 0, error = NULL,
       started_at = now(), finished_at = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('queued', 'rendering')
     RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function setProgress(id, progress) {
  await query(
    `UPDATE renders SET progress = $2, updated_at = now() WHERE id = $1 AND status = 'rendering'`,
    [id, progress],
  );
}

export async function markDone(id, outputAssetId) {
  const { rows } = await query(
    `UPDATE renders SET status = 'done', progress = 1, output_asset_id = $2, error = NULL,
       finished_at = now(), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, outputAssetId],
  );
  return rows[0] ?? null;
}

export async function markFailed(id, error) {
  const { rows } = await query(
    `UPDATE renders SET status = 'failed', error = $2, finished_at = now(), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, error],
  );
  return rows[0] ?? null;
}
