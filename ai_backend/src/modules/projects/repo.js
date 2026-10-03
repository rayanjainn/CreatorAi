// projects repo: SQL for the projects and project_members tables.
import { query } from '../../db/pool.js';

const RETURNING = 'id, name, description, created_by, created_at, updated_at';
const COLUMNS = 'p.id, p.name, p.description, p.created_by, p.created_at, p.updated_at';
const UPDATABLE = new Set(['name', 'description']);

// Inserts the project and its owner membership on the given transaction client.
export async function insertProjectWithOwner(client, { name, description, userId }) {
  const { rows: [project] } = await client.query(
    `INSERT INTO projects (name, description, created_by) VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [name, description ?? null, userId],
  );
  await client.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [project.id, userId],
  );
  return { ...project, role: 'owner' };
}

export async function listForUser(userId) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, m.role FROM projects p
     JOIN project_members m ON m.project_id = p.id
     WHERE m.user_id = $1
     ORDER BY p.created_at DESC, p.id`,
    [userId],
  );
  return rows;
}

export async function findForUser(projectId, userId) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, m.role FROM projects p
     JOIN project_members m ON m.project_id = p.id
     WHERE p.id = $1 AND m.user_id = $2`,
    [projectId, userId],
  );
  return rows[0] ?? null;
}

export async function findMemberRole(projectId, userId) {
  const { rows } = await query(
    'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return rows[0]?.role ?? null;
}

// fields: non-empty subset of { name, description }. Returns the project row or null.
export async function updateProject(projectId, fields) {
  const sets = [];
  const values = [projectId];
  for (const [column, value] of Object.entries(fields)) {
    if (!UPDATABLE.has(column)) throw new Error(`Not an updatable column: ${column}`);
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  const { rows } = await query(
    `UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${RETURNING}`,
    values,
  );
  return rows[0] ?? null;
}

export async function deleteProject(projectId) {
  const { rowCount } = await query('DELETE FROM projects WHERE id = $1', [projectId]);
  return rowCount > 0;
}
