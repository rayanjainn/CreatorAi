// agents/twin routes: Creator Twin profile (stretch).
// Stubbed (501) until phase 8; replace stubRouter with a real Router then.
import { stubRouter } from '../../../lib/http.js';

export const router = stubRouter(8, [
  ['get', '/twin'],
  ['post', '/twin/rebuild'],
]);
