// agents/research repo: SQL for research_briefs.
import { getPool } from '../../../db/pool.js';

export async function insertBrief(db, { projectId, userId, runId, planId, ideaIndex, topic, input, doc }) {
  const { rows } = await db.query(
    `INSERT INTO research_briefs (project_id, created_by, run_id, plan_id, idea_index, topic, input, doc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      projectId,
      userId ?? null,
      runId ?? null,
      planId ?? null,
      ideaIndex ?? null,
      topic,
      JSON.stringify(input),
      JSON.stringify(doc),
    ],
  );
  return rows[0];
}

export async function listBriefs(projectId) {
  const { rows } = await getPool().query(
    'SELECT * FROM research_briefs WHERE project_id = $1 ORDER BY created_at DESC, id',
    [projectId],
  );
  return rows;
}

export async function findBrief(projectId, briefId) {
  const { rows } = await getPool().query('SELECT * FROM research_briefs WHERE id = $1 AND project_id = $2', [
    briefId,
    projectId,
  ]);
  return rows[0] ?? null;
}
