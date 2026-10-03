// agents/research routes: Research Agent: research briefs with web sources.
// Stubbed (501) until phase 4; replace stubRouter with a real Router then.
import { stubRouter } from '../../../lib/http.js';

export const router = stubRouter(4, [
  ['post', '/agents/research'],
  ['get', '/briefs'],
  ['get', '/briefs/:briefId'],
]);
