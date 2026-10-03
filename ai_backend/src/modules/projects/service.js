// projects service: the module's public API. Other modules import this file and
// nothing else from here.
import { withTransaction } from '../../db/pool.js';
import { forbidden, notFound } from '../../lib/errors.js';
import * as repo from './repo.js';
import { CreateProjectBody, Project, ProjectId, ROLES, UpdateProjectBody } from './schemas.js';

export { ROLES };

// owner > editor > viewer. Higher number = more rights.
const RANK = { viewer: 1, editor: 2, owner: 3 };

// True when `role` is at least `minRole`. A null or unknown role never qualifies.
export function hasRole(role, minRole) {
  if (!Object.hasOwn(RANK, minRole)) throw new Error(`Unknown role: ${minRole}`);
  return Object.hasOwn(RANK, role ?? '') && RANK[role] >= RANK[minRole];
}

export function isProjectId(value) {
  return ProjectId.safeParse(value).success;
}

// The user's role in the project ('owner' | 'editor' | 'viewer'), or null when the user
// is not a member, the project does not exist, or either id is not a uuid.
export async function getMembership(projectId, userId) {
  if (!isProjectId(projectId) || !isProjectId(userId)) return null;
  return repo.findMemberRole(projectId, userId);
}

// Throws 404 for a malformed id, a missing project or a non-member (no existence leak)
// and 403 for a member below minRole. Returns the caller's role.
export async function assertRole(projectId, userId, minRole) {
  const role = await getMembership(projectId, userId);
  if (!role) throw notFound('Project not found');
  if (!hasRole(role, minRole)) throw forbidden(`Requires the ${minRole} role or higher`);
  return role;
}

const toProject = (row, role = row.role) =>
  Project.parse({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdBy: row.created_by ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    role,
  });

// createProject(userId, { name, description? }) -> project with role 'owner'.
// The project and the owner membership are written in one transaction.
export async function createProject(userId, input) {
  const { name, description } = CreateProjectBody.parse(input);
  const row = await withTransaction((client) =>
    repo.insertProjectWithOwner(client, { name, description, userId }),
  );
  return toProject(row);
}

// Projects the user is a member of, each with the user's role. Newest first.
export async function listProjects(userId) {
  return (await repo.listForUser(userId)).map((row) => toProject(row));
}

// getProject(projectId, userId) -> project with the caller's role. Non-member -> 404.
export async function getProject(projectId, userId) {
  const row = isProjectId(projectId) && isProjectId(userId) ? await repo.findForUser(projectId, userId) : null;
  if (!row) throw notFound('Project not found');
  return toProject(row);
}

// updateProject(projectId, userId, { name?, description? }). Editor or higher.
export async function updateProject(projectId, userId, input) {
  const role = await assertRole(projectId, userId, 'editor');
  const fields = UpdateProjectBody.parse(input);
  const row = await repo.updateProject(projectId, fields);
  if (!row) throw notFound('Project not found');
  return toProject(row, role);
}

// deleteProject(projectId, userId). Owner only; memberships cascade.
export async function deleteProject(projectId, userId) {
  await assertRole(projectId, userId, 'owner');
  if (!(await repo.deleteProject(projectId))) throw notFound('Project not found');
}
