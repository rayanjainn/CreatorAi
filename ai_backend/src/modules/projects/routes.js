// projects routes: projects CRUD and members. Activity is still a 501 stub.
// This router is mounted at /projects BEFORE the routers that share /projects/:projectId,
// so it must not have path-less middleware: requireAuth and requireRole go per route.
// requireRole runs before body validation, so a non-member gets 404 whatever the body.
import { Router } from 'express';
import { stubRouter, validate } from '../../lib/http.js';
import { requireAuth } from '../auth/service.js';
import { AddMemberBody, CreateProjectBody, UpdateMemberBody, UpdateProjectBody } from './schemas.js';
import {
  addMember,
  changeMemberRole,
  createProject,
  deleteProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  requireRole,
  updateProject,
} from './service.js';

export const router = Router({ mergeParams: true });

router.post('/', requireAuth(), validate(CreateProjectBody), async (req, res) => {
  res.status(201).json({ project: await createProject(req.user.id, req.body) });
});

router.get('/', requireAuth(), async (req, res) => {
  res.json({ projects: await listProjects(req.user.id) });
});

router.get('/:projectId', requireAuth(), requireRole('viewer'), async (req, res) => {
  res.json({ project: await getProject(req.project.id, req.user.id) });
});

router.patch('/:projectId', requireAuth(), requireRole('editor'), validate(UpdateProjectBody), async (req, res) => {
  res.json({ project: await updateProject(req.project, req.body) });
});

router.delete('/:projectId', requireAuth(), requireRole('owner'), async (req, res) => {
  await deleteProject(req.project.id);
  res.status(204).end();
});

router.get('/:projectId/members', requireAuth(), requireRole('viewer'), async (req, res) => {
  res.json({ members: await listMembers(req.project.id) });
});

router.post('/:projectId/members', requireAuth(), requireRole('owner'), validate(AddMemberBody), async (req, res) => {
  res.status(201).json({ member: await addMember(req.project.id, req.body) });
});

router.patch(
  '/:projectId/members/:userId',
  requireAuth(),
  requireRole('owner'),
  validate(UpdateMemberBody),
  async (req, res) => {
    res.json({ member: await changeMemberRole(req.project.id, req.params.userId, req.body) });
  },
);

// Owners remove anyone; any member may remove themselves (leave). Checked in the service.
router.delete('/:projectId/members/:userId', requireAuth(), requireRole('viewer'), async (req, res) => {
  await removeMember(req.project, req.user.id, req.params.userId);
  res.status(204).end();
});

// Planned endpoints, 501 until their task lands.
router.use(stubRouter(1, [['get', '/:projectId/activity']]));
