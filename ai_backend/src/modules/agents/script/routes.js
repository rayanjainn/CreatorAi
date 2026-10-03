// agents/script routes: Script Agent: hooks, script, CTA, shots and B-roll. Mounted at
// /projects/:projectId next to other routers, so requireRole goes on each route.
import { Router } from 'express';
import { validate } from '../../../lib/http.js';
import { requireRole } from '../../projects/service.js';
import { ScriptBody, ScriptPatch } from './schemas.js';
import { getScript, listScripts, requestScript, updateScript } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/agents/script', requireRole('editor'), validate(ScriptBody), async (req, res) => {
  const run = await requestScript(req.project.id, req.user.id, req.body);
  res.status(202).json({ runId: run.id, status: run.status });
});

router.get('/scripts', requireRole('viewer'), async (req, res) => {
  res.json({ scripts: await listScripts(req.project.id) });
});

router.get('/scripts/:scriptId', requireRole('viewer'), async (req, res) => {
  res.json({ script: await getScript(req.project.id, req.params.scriptId) });
});

router.patch('/scripts/:scriptId', requireRole('editor'), validate(ScriptPatch), async (req, res) => {
  res.json({ script: await updateScript(req.project.id, req.params.scriptId, req.user.id, req.body) });
});
