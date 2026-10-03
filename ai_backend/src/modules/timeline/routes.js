// timeline routes: versioned Timeline JSON, the source of truth for every edit.
// Stubbed (501) until phase 5; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(5, [
  ['post', '/timelines'],
  ['get', '/timelines'],
  ['get', '/timelines/:timelineId'],
  ['get', '/timelines/:timelineId/versions'],
  ['get', '/timelines/:timelineId/versions/:version'],
  ['post', '/timelines/:timelineId/versions'],
  ['post', '/timelines/:timelineId/revert'],
  ['get', '/timelines/:timelineId/diff'],
]);
