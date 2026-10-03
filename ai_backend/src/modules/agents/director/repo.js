// agents/director repo: SQL for content_plans.
import { getPool } from '../../../db/pool.js';

export async function insertPlan(db, { projectId, userId, runId, input, doc }) {
  const { rows } = await db.query(
    `INSERT INTO content_plans (project_id, created_by, run_id, input, doc)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [projectId, userId ?? null, runId ?? null, JSON.stringify(input), JSON.stringify(doc)],
  );
  return rows[0];
}

export async function listPlans(projectId) {
  const { rows } = await getPool().query(
    'SELECT * FROM content_plans WHERE project_id = $1 ORDER BY created_at DESC, id',
    [projectId],
  );
  return rows;
}

export async function findPlan(projectId, planId) {
  const { rows } = await getPool().query('SELECT * FROM content_plans WHERE id = $1 AND project_id = $2', [
    planId,
    projectId,
  ]);
  return rows[0] ?? null;
}
