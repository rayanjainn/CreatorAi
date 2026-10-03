// agents/editing routes: moments, scoring and the Editing Agent (reels and revisions).
// Mounted at /projects/:projectId next to other routers, so requireRole goes on each route.
import { Router } from 'express';
import { validate } from '../../../lib/http.js';
import { requireRole } from '../../projects/service.js';
import { MomentsBody, ReelsBody, ReviseBody } from './schemas.js';
import { getJob, listMoments, requestMoments, requestReels, requestRevise } from './service.js';

export const router = Router({ mergeParams: true });

const accepted = (res, job) => res.status(202).json({ jobId: job.id, status: job.status });

router.post('/media/:assetId/moments', requireRole('editor'), validate(MomentsBody), async (req, res) => {
  accepted(res, await requestMoments(req.project.id, req.user.id, req.params.assetId, req.body));
});

router.get('/media/:assetId/moments', requireRole('viewer'), async (req, res) => {
  res.json({ moments: await listMoments(req.project.id, req.params.assetId) });
});

router.get('/agents/editing/jobs/:jobId', requireRole('viewer'), async (req, res) => {
  res.json({ job: await getJob(req.project.id, req.params.jobId) });
});

router.post('/agents/editing/reels', requireRole('editor'), validate(ReelsBody), async (req, res) => {
  accepted(res, await requestReels(req.project.id, req.user.id, req.body));
});

router.post('/agents/editing/revise', requireRole('editor'), validate(ReviseBody), async (req, res) => {
  accepted(res, await requestRevise(req.project.id, req.user.id, req.body));
});
