// agents/script repo: SQL for scripts.
import { getPool } from '../../../db/pool.js';

export async function insertScript(db, { projectId, userId, runId, briefId, input, doc }) {
  const { rows } = await db.query(
    `INSERT INTO scripts (project_id, created_by, run_id, brief_id, input, doc)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [projectId, userId ?? null, runId ?? null, briefId, JSON.stringify(input), JSON.stringify(doc)],
  );
  return rows[0];
}

export async function listScripts(projectId) {
  const { rows } = await getPool().query(
    'SELECT * FROM scripts WHERE project_id = $1 ORDER BY created_at DESC, id',
    [projectId],
  );
  return rows;
}

export async function findScript(projectId, scriptId, db = getPool(), { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM scripts WHERE id = $1 AND project_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [scriptId, projectId],
  );
  return rows[0] ?? null;
}

export async function updateScriptDoc(db, scriptId, { doc, userId }) {
  const { rows } = await db.query(
    `UPDATE scripts SET doc = $2, edited_by = $3, edited_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [scriptId, JSON.stringify(doc), userId ?? null],
  );
  return rows[0];
}
