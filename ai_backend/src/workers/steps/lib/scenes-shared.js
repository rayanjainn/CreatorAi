// Helpers shared by the scenes, faces and analysis steps (Track B of phase 3).
import { NonRetryableError } from '../../../lib/errors.js';
import { query } from '../../../db/pool.js';
import { getAsset } from '../../../modules/media/service.js';

// Cuts closer than this to a scene boundary (or to the end) are dropped, so no scene is
// shorter than a few frames.
export const MIN_SCENE_MS = 250;

// Contiguous spans [0,c1),[c1,c2),...,[cN,duration): no gaps, no overlap.
export function buildSpans(cutsMs, durationMs) {
  const bounds = [0];
  for (const cut of [...cutsMs].sort((a, b) => a - b)) {
    if (cut - bounds.at(-1) >= MIN_SCENE_MS && durationMs - cut >= MIN_SCENE_MS) bounds.push(cut);
  }
  bounds.push(durationMs);
  return bounds.slice(0, -1).map((startMs, idx) => ({ idx, startMs, endMs: bounds[idx + 1] }));
}

// The time a scene's keyframe is taken at (its mid-point); faces rows use it as at_ms.
export const keyframeAtMs = ({ startMs, endMs }) => Math.floor((startMs + endMs) / 2);

// The asset, or a NonRetryableError when it is missing / in another project.
export async function loadAsset(projectId, assetId) {
  try {
    return await getAsset(projectId, assetId);
  } catch (err) {
    if (err?.status === 404) throw new NonRetryableError(`asset ${assetId} not found in project ${projectId}`);
    throw err;
  }
}

// Scenes of an asset ordered by idx: [{ id, idx, startMs, endMs, keyframeAssetId, caption }].
export async function loadScenes(assetId) {
  const { rows } = await query(
    `SELECT id, idx, start_ms, end_ms, keyframe_asset_id, caption FROM scenes WHERE asset_id = $1 ORDER BY idx`,
    [assetId],
  );
  return rows.map((r) => ({
    id: r.id,
    idx: r.idx,
    startMs: r.start_ms,
    endMs: r.end_ms,
    keyframeAssetId: r.keyframe_asset_id,
    caption: r.caption,
  }));
}
