// projects service: the module's public API. Other modules import this file and
// nothing else from here.
import { withTransaction } from '../../db/pool.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { findUserByEmail, requireAuth } from '../auth/service.js';
import * as repo from './repo.js';
import {
  AddMemberBody,
  CreateProjectBody,
  Member,
  Project,
  ProjectId,
  ROLES,
  UpdateMemberBody,
  UpdateProjectBody,
  UserId,
} from './schemas.js';

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

// requireRole(minRole): THE authorization middleware for every route under
// /projects/:projectId (routers need Router({ mergeParams: true })).
// - Needs a user: when req.user is not set yet it runs requireAuth() itself, so it works
//   both alone and chained after requireAuth(). No/bad token -> 401.
// - Reads req.params.projectId. Malformed id, missing project or non-member -> 404 (no
//   existence leak); member below minRole -> 403.
// - On success sets req.project = { id, role } and req.role = role (the caller's role).
// An unknown minRole throws when the middleware is built, not per request.
export function requireRole(minRole) {
  if (!Object.hasOwn(RANK, minRole)) throw new Error(`Unknown role: ${minRole}`);
  const authenticate = requireAuth();
  const authorize = async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      const role = await assertRole(projectId, req.user.id, minRole);
      req.project = { id: projectId, role };
      req.role = role;
      next();
    } catch (err) {
      next(err);
    }
  };
  return (req, res, next) => {
    if (req.user) return authorize(req, res, next);
    authenticate(req, res, (err) => (err ? next(err) : authorize(req, res, next)));
  };
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

// The functions below take a project the caller is already authorized for: routes run
// requireRole(minRole) first and pass req.project ({ id, role }) or its id. requireRole
// is the single authorization path; these functions do not re-check membership.

// updateProject(project, { name?, description? }) -> project. Route: requireRole('editor').
export async function updateProject(project, input) {
  const fields = UpdateProjectBody.parse(input);
  const row = await repo.updateProject(project.id, fields);
  if (!row) throw notFound('Project not found');
  return toProject(row, project.role);
}

// deleteProject(projectId). Route: requireRole('owner'). Memberships cascade.
export async function deleteProject(projectId) {
  if (!(await repo.deleteProject(projectId))) throw notFound('Project not found');
}

const toMember = (row) =>
  Member.parse({
    userId: row.user_id,
    email: row.email,
    name: row.name ?? null,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString(),
  });

const memberNotFound = () => notFound('Member not found');

// listMembers(projectId) -> [{ userId, email, name, role, createdAt }], oldest first.
// Route: requireRole('viewer').
export async function listMembers(projectId) {
  return (await repo.listMembers(projectId)).map(toMember);
}

// addMember(projectId, { email, role }) -> member. Route: requireRole('owner').
// Unknown email -> 404; already a member -> 409.
export async function addMember(projectId, input) {
  const { email, role } = AddMemberBody.parse(input);
  const user = await findUserByEmail(email);
  if (!user) throw notFound('No user with that email');
  if (!(await repo.insertMember(projectId, user.id, role))) throw conflict('User is already a member');
  return toMember(await repo.findMember(projectId, user.id));
}

// Runs fn(client, currentRole) in a transaction that has locked the project's owner rows
// and the target's row. Malformed userId or non-member -> 404. If the change would leave
// the project without an owner (willRemainOwner false for the last owner) -> 409.
async function withMemberChange(projectId, userId, willRemainOwner, fn) {
  if (!UserId.safeParse(userId).success) throw memberNotFound();
  return withTransaction(async (client) => {
    const owners = await repo.lockOwners(client, projectId);
    const current = await repo.lockMemberRole(client, projectId, userId);
    if (!current) throw memberNotFound();
    if (current === 'owner' && !willRemainOwner && owners.length <= 1) {
      throw conflict('A project must keep at least one owner');
    }
    return fn(client, current);
  });
}

// changeMemberRole(projectId, userId, { role }) -> member. Route: requireRole('owner').
// Not a member -> 404; demoting the last owner -> 409.
export async function changeMemberRole(projectId, userId, input) {
  const { role } = UpdateMemberBody.parse(input);
  return withMemberChange(projectId, userId, role === 'owner', async (client) => {
    await repo.updateMemberRole(client, projectId, userId, role);
    return toMember(await repo.findMember(projectId, userId, client));
  });
}

// removeMember(project, actorUserId, userId). Route: requireRole('viewer'); owners may
// remove anyone, any member may remove themselves (leave), others -> 403.
// Not a member -> 404; removing the last owner -> 409.
export async function removeMember(project, actorUserId, userId) {
  if (userId !== actorUserId && !hasRole(project.role, 'owner')) {
    if (!UserId.safeParse(userId).success) throw memberNotFound();
    throw forbidden('Requires the owner role to remove other members');
  }
  await withMemberChange(project.id, userId, false, (client) => repo.deleteMember(client, project.id, userId));
}
