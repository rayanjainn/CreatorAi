// render routes: FFmpeg renders of a pinned timeline version.
// Mounted at /projects/:projectId next to other modules' routers, so requireRole goes on
// each route (viewer reads, editor+ starts renders) and runs before body validation.
import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireRole } from '../projects/service.js';
import { RequestRenderBody } from './schemas.js';
import { getRender, listRenders, requestRender } from './service.js';

export const router = Router({ mergeParams: true });

// 202 { renderId, render } for a new (queued) render; 200 with the existing live render
// when the same { timeline, version, kind } was already requested.
router.post('/timelines/:timelineId/render', requireRole('editor'), validate(RequestRenderBody), async (req, res) => {
  const { render, created } = await requestRender(req.project.id, req.params.timelineId, req.body, {
    requestedBy: req.user.id,
  });
  res.status(created ? 202 : 200).json({ renderId: render.id, render });
});

router.get('/timelines/:timelineId/renders', requireRole('viewer'), async (req, res) => {
  res.json({ renders: await listRenders(req.project.id, req.params.timelineId) });
});

router.get('/renders/:renderId', requireRole('viewer'), async (req, res) => {
  res.json({ render: await getRender(req.project.id, req.params.renderId) });
});
