// media routes: asset registration, Cloudinary signing, per-asset index and reprocess.
// Stubbed (501) until phase 2; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(2, [
  ['post', '/media/sign'],
  ['post', '/media'],
  ['get', '/media'],
  ['get', '/media/:assetId'],
  ['delete', '/media/:assetId'],
  ['get', '/media/:assetId/index'],
  ['post', '/media/:assetId/reprocess'],
]);

export const webhookRouter = stubRouter(2, [
  ['post', '/cloudinary'],
]);
