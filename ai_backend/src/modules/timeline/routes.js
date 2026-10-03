// timeline routes: versioned Timeline JSON, the source of truth for every edit.
// Mounted at /projects/:projectId next to other modules' routers, so there is no
// path-less middleware here: requireRole goes on each route (viewer reads, editor+
// writes) and runs before body validation, so a non-member gets 404 whatever the body.
// Versions are append-only: there is deliberately no PUT/PATCH/DELETE route for them.
import { Router } from 'express';
import { HttpError } from '../../lib/errors.js';
import { validate } from '../../lib/http.js';
import { requireRole } from '../projects/service.js';
import { CreateTimelineBody, CreateVersionBody, DiffQuery, RevertBody } from './schemas.js';
import {
  createTimeline,
  createVersion,
  diffVersions,
  getHead,
  getVersion,
  listTimelines,
  listVersions,
  revertTimeline,
} from './service.js';

export const router = Router({ mergeParams: true });

// The service reports doc issues relative to its input ({ doc, sourceAssetId, ... });
// over HTTP that input is the body, so prefix 'body' like validate() does.
async function underBody(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && err.code === 'validation_failed' && Array.isArray(err.details)) {
      err.details = err.details.map((i) => ({ ...i, path: ['body', ...(i.path ?? [])] }));
    }
    throw err;
  }
}

const human = (req) => ({ authorType: 'human', authorId: req.user.id });

router.post('/timelines', requireRole('editor'), validate(CreateTimelineBody), async (req, res) => {
  const created = await underBody(() => createTimeline(req.project.id, { ...req.body, ...human(req) }));
  res.status(201).json(created);
});

router.get('/timelines', requireRole('viewer'), async (req, res) => {
  res.json({ timelines: await listTimelines(req.project.id) });
});

router.get('/timelines/:timelineId', requireRole('viewer'), async (req, res) => {
  res.json(await getHead(req.project.id, req.params.timelineId));
});

router.get('/timelines/:timelineId/versions', requireRole('viewer'), async (req, res) => {
  res.json({ versions: await listVersions(req.project.id, req.params.timelineId) });
});

router.get('/timelines/:timelineId/versions/:version', requireRole('viewer'), async (req, res) => {
  res.json({ version: await getVersion(req.project.id, req.params.timelineId, req.params.version) });
});

router.post(
  '/timelines/:timelineId/versions',
  requireRole('editor'),
  validate(CreateVersionBody),
  async (req, res) => {
    const version = await underBody(() =>
      createVersion(req.project.id, req.params.timelineId, { ...req.body, ...human(req) }),
    );
    res.status(201).json({ version });
  },
);

// { toVersion, baseVersion?, summary? }: see revertTimeline for the baseVersion rule.
router.post('/timelines/:timelineId/revert', requireRole('editor'), validate(RevertBody), async (req, res) => {
  const version = await underBody(() =>
    revertTimeline(req.project.id, req.params.timelineId, { ...req.body, ...human(req) }),
  );
  res.status(201).json({ version });
});

router.get('/timelines/:timelineId/diff', requireRole('viewer'), validate({ query: DiffQuery }), async (req, res) => {
  const { from, to } = req.validQuery;
  res.json({ diff: await diffVersions(req.project.id, req.params.timelineId, from, to) });
});
