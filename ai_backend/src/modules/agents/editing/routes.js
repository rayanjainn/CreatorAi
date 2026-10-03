// agents/editing routes: moments, scoring and the Editing Agent (reels and revisions).
// Stubbed (501) until phase 6; replace stubRouter with a real Router then.
import { stubRouter } from '../../../lib/http.js';

export const router = stubRouter(6, [
  ['post', '/media/:assetId/moments'],
  ['get', '/media/:assetId/moments'],
  ['post', '/agents/editing/reels'],
  ['post', '/agents/editing/revise'],
]);
