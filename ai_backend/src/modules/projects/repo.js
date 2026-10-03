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

// Members joined with their public user fields (never the password hash).
const MEMBER_COLUMNS = 'm.user_id, u.email, u.name, m.role, m.created_at';

export async function listMembers(projectId) {
  const { rows } = await query(
    `SELECT ${MEMBER_COLUMNS} FROM project_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1
     ORDER BY m.created_at, u.email`,
    [projectId],
  );
  return rows;
}

export async function findMember(projectId, userId, client = { query }) {
  const { rows } = await client.query(
    `SELECT ${MEMBER_COLUMNS} FROM project_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 AND m.user_id = $2`,
    [projectId, userId],
  );
  return rows[0] ?? null;
}

// Returns true when inserted, false when the user is already a member.
export async function insertMember(projectId, userId, role) {
  const { rowCount } = await query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, userId, role],
  );
  return rowCount > 0;
}

// Locks the project's owner rows (FOR UPDATE) on the transaction client and returns the
// owner user ids. Callers that may remove an owner count these before changing anything,
// so two concurrent demotions cannot both see a second owner.
export async function lockOwners(client, projectId) {
  const { rows } = await client.query(
    `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'owner' FOR UPDATE`,
    [projectId],
  );
  return rows.map((r) => r.user_id);
}

// Locks and returns the member's role, or null when not a member.
export async function lockMemberRole(client, projectId, userId) {
  const { rows } = await client.query(
    'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE',
    [projectId, userId],
  );
  return rows[0]?.role ?? null;
}

export async function updateMemberRole(client, projectId, userId, role) {
  await client.query('UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2', [
    projectId,
    userId,
    role,
  ]);
}

export async function deleteMember(client, projectId, userId) {
  await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
}
