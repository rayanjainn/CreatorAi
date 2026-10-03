// media routes: Cloudinary signing, asset registration, listing, reading and deleting,
// plus the Cloudinary webhook. Mounted at /projects/:projectId, so paths are full
// sub-paths. requireRole runs before body validation (a non-member gets 404 whatever
// the body). The per-asset index and reprocess endpoints are phase-3 work and stay 501.
import { Router } from 'express';
import { unauthorized } from '../../lib/errors.js';
import { stubRouter, validate } from '../../lib/http.js';
import { requireRole } from '../projects/service.js';
import { CloudinaryNotification, ListQuery, RegisterBody, SignBody } from './schemas.js';
import {
  deleteAsset,
  getAsset,
  handleNotification,
  listAssets,
  registerUpload,
  signUpload,
  verifyNotification,
} from './service.js';

export const router = Router({ mergeParams: true });

router.post('/media/sign', requireRole('editor'), validate(SignBody), async (req, res) => {
  res.json({ upload: await signUpload(req.project.id) });
});

// 201 when the upload is registered now, 200 when it already was (idempotent).
router.post('/media', requireRole('editor'), validate(RegisterBody), async (req, res) => {
  const { asset, created } = await registerUpload(req.project.id, req.body, { createdBy: req.user.id });
  res.status(created ? 201 : 200).json({ asset });
});

router.get('/media', requireRole('viewer'), validate({ query: ListQuery }), async (req, res) => {
  res.json({ assets: await listAssets(req.project.id, req.validQuery) });
});

router.use(
  stubRouter(2, [
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

// Mounted at /webhooks. No user auth: the X-Cld-Signature check is the authentication.
// The signature covers the raw body; app.js parses JSON before this router runs, so the
// body is re-serialized (Cloudinary sends compact JSON, which round-trips unchanged).
export const webhookRouter = Router();

function requireCloudinarySignature(req, res, next) {
  const body = req.body === undefined ? '' : JSON.stringify(req.body);
  const ok = verifyNotification({
    body,
    timestamp: req.get('x-cld-timestamp'),
    signature: req.get('x-cld-signature'),
  });
  next(ok ? undefined : unauthorized('Invalid or missing Cloudinary signature'));
}

webhookRouter.post('/cloudinary', requireCloudinarySignature, validate(CloudinaryNotification), async (req, res) => {
  res.json({ received: true, ...(await handleNotification(req.body)) });
});
