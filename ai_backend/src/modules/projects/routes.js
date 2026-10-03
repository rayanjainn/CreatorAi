// projects routes: projects CRUD. Members and activity are still 501 stubs (P1.T3+).
// This router is mounted at /projects BEFORE the routers that share /projects/:projectId,
// so it must not have path-less middleware: requireAuth and role checks go per route.
import { Router } from 'express';
import { notFound } from '../../lib/errors.js';
import { stubRouter, validate } from '../../lib/http.js';
import { requireAuth } from '../auth/service.js';
import { CreateProjectBody, ProjectId, UpdateProjectBody } from './schemas.js';
import { createProject, deleteProject, getProject, listProjects, updateProject } from './service.js';

export const router = Router({ mergeParams: true });

// Validates :projectId as a uuid. A malformed id is a 404 (like a missing project),
// never a 400, so the response does not depend on whether the id could exist.
function projectIdParam() {
  return (req, res, next) => {
    const result = ProjectId.safeParse(req.params.projectId);
    if (!result.success) return next(notFound('Project not found'));
    req.params.projectId = result.data;
    next();
  };
}

router.post('/', requireAuth(), validate(CreateProjectBody), async (req, res) => {
  res.status(201).json({ project: await createProject(req.user.id, req.body) });
});

router.get('/', requireAuth(), async (req, res) => {
  res.json({ projects: await listProjects(req.user.id) });
});

router.get('/:projectId', requireAuth(), projectIdParam(), async (req, res) => {
  res.json({ project: await getProject(req.params.projectId, req.user.id) });
});

router.patch('/:projectId', requireAuth(), projectIdParam(), validate(UpdateProjectBody), async (req, res) => {
  res.json({ project: await updateProject(req.params.projectId, req.user.id, req.body) });
});

router.delete('/:projectId', requireAuth(), projectIdParam(), async (req, res) => {
  await deleteProject(req.params.projectId, req.user.id);
  res.status(204).end();
});

// Planned endpoints, 501 until their task lands (members: P1.T3).
router.use(
  stubRouter(1, [
    ['post', '/:projectId/members'],
    ['patch', '/:projectId/members/:userId'],
    ['delete', '/:projectId/members/:userId'],
    ['get', '/:projectId/activity'],
  ]),
);
