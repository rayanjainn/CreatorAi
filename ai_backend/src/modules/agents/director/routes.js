// agents/director routes: Director Agent: content plans.
// Stubbed (501) until phase 4; replace stubRouter with a real Router then.
import { stubRouter } from '../../../lib/http.js';

export const router = stubRouter(4, [
  ['post', '/agents/director/plan'],
  ['get', '/plans'],
  ['get', '/plans/:planId'],
]);
