// auth routes: users, register/login, requireAuth.
// Stubbed (501) until phase 1; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(1, [
  ['post', '/register'],
  ['post', '/login'],
  ['get', '/me'],
]);
