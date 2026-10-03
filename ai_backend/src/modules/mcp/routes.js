// mcp routes: MCP gateway: thin tool layer over the other services.
// Stubbed (501) until phase 8; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(8, [
  ['post', '/'],
]);
