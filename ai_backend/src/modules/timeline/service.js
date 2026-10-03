// timeline service: the module's public API. Other modules import this file and nothing
// else from here. The Timeline JSON v1 schema and the pure validator are defined in
// schemas.js and re-exported here.
import { HttpError } from '../../lib/errors.js';
import { getAssetsByIds } from '../media/service.js';
import { collectAssetIds, validateTimeline } from './schemas.js';

export {
  CaptionClip,
  TIMELINE_SCHEMA_VERSION,
  TimelineDoc,
  TimelineOutput,
  TimelineTrack,
  VideoClip,
  clipEndMs,
  collectAssetIds,
  emptyTimelineDoc,
  validateTimeline,
} from './schemas.js';

// checkTimelineDoc(projectId, doc) -> issues ([] when valid). Loads the referenced assets
// through media getAssetsByIds, so missing and other-project assets both come back as
// asset_not_found (no existence leak across projects).
export async function checkTimelineDoc(projectId, doc) {
  const assets = await getAssetsByIds(projectId, collectAssetIds(doc));
  return validateTimeline(doc, new Map(assets.map((a) => [a.id, a])), { projectId });
}

// assertTimelineDoc(projectId, doc, pathPrefix?) -> the parsed doc, or throws
// 400 validation_failed whose details are the issues (paths prefixed with pathPrefix).
export async function assertTimelineDoc(projectId, doc, pathPrefix = []) {
  const issues = await checkTimelineDoc(projectId, doc);
  if (issues.length) {
    throw new HttpError(400, 'validation_failed', 'Timeline is invalid',
      issues.map((i) => ({ ...i, path: [...pathPrefix, ...i.path] })));
  }
  return structuredClone(doc);
}
