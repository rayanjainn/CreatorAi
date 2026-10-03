// agents/editing repo: SQL for moments and editing_jobs. Functions that take `db` accept
// a pool or a client.
import { getPool, withTransaction } from '../../../db/pool.js';

// ---- editing_jobs -----------------------------------------------------------------------

export async function insertJob({ projectId, userId, kind, assetId = null, timelineId = null, input }, db = getPool()) {
  const { rows } = await db.query(
    `INSERT INTO editing_jobs (project_id, created_by, kind, asset_id, timeline_id, input)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [projectId, userId ?? null, kind, assetId, timelineId, JSON.stringify(input ?? {})],
  );
  return rows[0];
}

export async function findJob(projectId, jobId, db = getPool()) {
  const { rows } = await db.query('SELECT * FROM editing_jobs WHERE id = $1 AND project_id = $2', [jobId, projectId]);
  return rows[0] ?? null;
}

// queued -> running. Null when the job is missing or no longer queued.
export async function markJobRunning(jobId, db = getPool()) {
  const { rows } = await db.query(
    `UPDATE editing_jobs SET status = 'running', started_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'queued' RETURNING *`,
    [jobId],
  );
  return rows[0] ?? null;
}

export async function finishJob(jobId, { status, result = null, error = null, runIds = [] }, db = getPool()) {
  const { rows } = await db.query(
    `UPDATE editing_jobs SET status = $2, result = $3, error = $4, run_ids = $5, finished_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      jobId,
      status,
      result == null ? null : JSON.stringify(result),
      error == null ? null : JSON.stringify(error),
      JSON.stringify(runIds),
    ],
  );
  return rows[0];
}

// ---- moments ----------------------------------------------------------------------------

// Replaces every moment of the asset with `moments` in one transaction.
export async function replaceMoments(assetId, projectId, jobId, moments) {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM moments WHERE asset_id = $1', [assetId]);
    const out = [];
    for (const m of moments) {
      const { rows } = await client.query(
        `INSERT INTO moments (asset_id, project_id, start_ms, end_ms, title, hook_line, summary, scores, score, status, job_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [assetId, projectId, m.startMs, m.endMs, m.title, m.hookLine, m.summary, JSON.stringify(m.scores), m.score, m.status, jobId],
      );
      out.push(rows[0]);
    }
    return out;
  });
}

export async function listMoments(projectId, assetId, db = getPool()) {
  const { rows } = await db.query(
    'SELECT * FROM moments WHERE asset_id = $1 AND project_id = $2 ORDER BY score DESC, start_ms',
    [assetId, projectId],
  );
  return rows;
}
