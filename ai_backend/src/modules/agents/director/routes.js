// agents/director routes: Director Agent: content plans. Mounted at /projects/:projectId
// next to other routers, so requireRole goes on each route (no path-less middleware).
import { Router } from 'express';
import { validate } from '../../../lib/http.js';
import { requireRole } from '../../projects/service.js';
import { DirectorInput } from './schemas.js';
import { getPlan, listPlans, requestPlan } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/agents/director/plan', requireRole('editor'), validate(DirectorInput), async (req, res) => {
  const run = await requestPlan(req.project.id, req.user.id, req.body);
  res.status(202).json({ runId: run.id, status: run.status });
});

router.get('/plans', requireRole('viewer'), async (req, res) => {
  res.json({ plans: await listPlans(req.project.id) });
});

router.get('/plans/:planId', requireRole('viewer'), async (req, res) => {
  res.json({ plan: await getPlan(req.project.id, req.params.planId) });
});
