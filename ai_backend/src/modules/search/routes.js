// search routes: hybrid search over transcript segments and scenes; the only module that knows VECTOR_BACKEND.
// Stubbed (501) until phase 3; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(3, [
  ['post', '/search'],
]);
