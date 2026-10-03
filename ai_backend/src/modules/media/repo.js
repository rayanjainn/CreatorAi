// media repo: SQL for the assets table.
import { query } from '../../db/pool.js';

export async function findByIds(projectId, ids) {
  const { rows } = await query(
    `SELECT id, project_id, kind, duration_ms, width, height, status
     FROM assets WHERE project_id = $1 AND id = ANY($2::uuid[])`,
    [projectId, ids],
  );
  return rows;
}
