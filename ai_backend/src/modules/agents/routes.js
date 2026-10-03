// agents routes: polling agent runs. Mounted at /projects/:projectId alongside other
// routers, so no path-less middleware: requireRole goes on each route.
import { Router } from 'express';
import { requireRole } from '../projects/service.js';
import { getRun } from './service.js';

export const router = Router({ mergeParams: true });

router.get('/agents/runs/:runId', requireRole('viewer'), async (req, res) => {
  res.json({ run: await getRun(req.project.id, req.params.runId) });
});
