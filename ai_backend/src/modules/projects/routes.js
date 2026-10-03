// projects routes: projects, members and project-level RBAC (requireRole).
// Stubbed (501) until phase 1; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(1, [
  ['post', '/'],
  ['get', '/'],
  ['get', '/:projectId'],
  ['patch', '/:projectId'],
  ['delete', '/:projectId'],
  ['post', '/:projectId/members'],
  ['patch', '/:projectId/members/:userId'],
  ['delete', '/:projectId/members/:userId'],
  ['get', '/:projectId/activity'],
]);
