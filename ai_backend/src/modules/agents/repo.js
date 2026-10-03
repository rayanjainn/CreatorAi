// agents repo: SQL for agent_runs. Functions that take `db` accept a pool or a client
// (so a run can be finished in the same transaction as the artifact it produced).
import { getPool } from '../../db/pool.js';

export async function insertRun({ projectId, userId, agent, input, status = 'queued' }, db = getPool()) {
  const { rows } = await db.query(
    `INSERT INTO agent_runs (project_id, created_by, agent, input, status, started_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'running' THEN now() END)
     RETURNING *`,
    [projectId, userId ?? null, agent, JSON.stringify(input ?? {}), status],
  );
  return rows[0];
}

export async function findRun(projectId, runId, db = getPool()) {
  const { rows } = await db.query('SELECT * FROM agent_runs WHERE id = $1 AND project_id = $2', [runId, projectId]);
  return rows[0] ?? null;
}

export async function findRunById(runId, db = getPool()) {
  const { rows } = await db.query('SELECT * FROM agent_runs WHERE id = $1', [runId]);
  return rows[0] ?? null;
}

// queued|running -> running. Null when the run is missing or already finished.
export async function markRunning(runId, db = getPool()) {
  const { rows } = await db.query(
    `UPDATE agent_runs SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
     WHERE id = $1 AND status IN ('queued', 'running') RETURNING *`,
    [runId],
  );
  return rows[0] ?? null;
}

export async function finishRun(runId, f, db = getPool()) {
  const { rows } = await db.query(
    `UPDATE agent_runs SET
       status = $2, output = $3, tool_results = $4, artifact_type = $5, artifact_id = $6, error = $7,
       attempts = $8, tokens_in = $9, tokens_out = $10, ms = $11, provider = $12, model = $13,
       finished_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      runId,
      f.status,
      f.output == null ? null : JSON.stringify(f.output),
      f.toolResults == null ? null : JSON.stringify(f.toolResults),
      f.artifact?.type ?? null,
      f.artifact?.id ?? null,
      f.error == null ? null : JSON.stringify(f.error),
      f.attempts,
      f.tokensIn,
      f.tokensOut,
      f.ms,
      f.provider ?? null,
      f.model ?? null,
    ],
  );
  return rows[0];
}
