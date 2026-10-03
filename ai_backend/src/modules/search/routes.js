// search routes (phase 3): POST /projects/:projectId/search (viewer+), vector search over
// the project's transcript segments and scenes.
import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireRole } from '../projects/service.js';
import { SearchBody } from './schemas.js';
import { search } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/search', requireRole('viewer'), validate(SearchBody), async (req, res) => {
  res.json({ hits: await search(req.project.id, req.body) });
});
