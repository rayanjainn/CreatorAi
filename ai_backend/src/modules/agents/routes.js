// agents routes: shared agent runner (run.js) and agent_runs.
// Stubbed (501) until phase 4; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(4, [
  ['get', '/agents/runs/:runId'],
]);
