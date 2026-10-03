// render routes: FFmpeg renders of a pinned timeline version.
// Stubbed (501) until phase 7; replace stubRouter with a real Router then.
import { stubRouter } from '../../lib/http.js';

export const router = stubRouter(7, [
  ['post', '/timelines/:timelineId/render'],
  ['get', '/timelines/:timelineId/renders'],
  ['get', '/renders/:renderId'],
]);
