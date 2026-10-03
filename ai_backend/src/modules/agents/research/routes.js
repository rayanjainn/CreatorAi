// agents/research routes: Research Agent: research briefs with web sources. Mounted at
// /projects/:projectId next to other routers, so requireRole goes on each route.
import { Router } from 'express';
import { validate } from '../../../lib/http.js';
import { requireRole } from '../../projects/service.js';
import { ResearchBody } from './schemas.js';
import { getBrief, listBriefs, requestResearch } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/agents/research', requireRole('editor'), validate(ResearchBody), async (req, res) => {
  const run = await requestResearch(req.project.id, req.user.id, req.body);
  res.status(202).json({ runId: run.id, status: run.status });
});

router.get('/briefs', requireRole('viewer'), async (req, res) => {
  res.json({ briefs: await listBriefs(req.project.id) });
});

router.get('/briefs/:briefId', requireRole('viewer'), async (req, res) => {
  res.json({ brief: await getBrief(req.project.id, req.params.briefId) });
});
