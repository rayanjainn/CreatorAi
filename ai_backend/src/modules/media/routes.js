// media routes: Cloudinary signing, asset registration, listing, reading and deleting.
// Mounted at /projects/:projectId, so paths are full sub-paths. requireRole runs before
// body validation (a non-member gets 404 whatever the body).
// The per-asset index and reprocess endpoints are phase-3 work and stay 501 here.
import { Router } from 'express';
import { stubRouter, validate } from '../../lib/http.js';
import { requireRole } from '../projects/service.js';
import { ListQuery, SignBody } from './schemas.js';
import { deleteAsset, getAsset, listAssets, signUpload } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/media/sign', requireRole('editor'), validate(SignBody), async (req, res) => {
  res.json({ upload: await signUpload(req.project.id) });
});

router.get('/media', requireRole('viewer'), validate({ query: ListQuery }), async (req, res) => {
  res.json({ assets: await listAssets(req.project.id, req.validQuery) });
});

router.use(
  stubRouter(2, [
    ['post', '/media'],
    ['get', '/media/:assetId/index'],
    ['post', '/media/:assetId/reprocess'],
  ]),
);

router.get('/media/:assetId', requireRole('viewer'), async (req, res) => {
  res.json({ asset: await getAsset(req.project.id, req.params.assetId) });
});

router.delete('/media/:assetId', requireRole('editor'), async (req, res) => {
  await deleteAsset(req.project.id, req.params.assetId);
  res.status(204).end();
});

export const webhookRouter = stubRouter(2, [['post', '/cloudinary']]);
