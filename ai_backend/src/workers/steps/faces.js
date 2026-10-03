// P3 pipeline step: face detection: Cloudinary face coordinates per keyframe -> faces rows (needs scenes).
// Contract shared by every step (owned by the P3 orchestrator, implemented per step):
//   run({ assetId, projectId }) -> plain JSON object (stored as the step output).
// - Idempotent: a re-run replaces this step's own rows, never duplicates them.
// - Throws to fail the step (retried); throws NonRetryableError (src/lib/errors.js) when
//   retrying cannot help.
// - Reads earlier steps' results from the database, never from the caller.
import { getStorage } from '../../adapters/storage/index.js';
import { FaceBoxes } from '../../adapters/storage/contract.js';
import { withTransaction } from '../../db/pool.js';
import { listAssets } from '../../modules/media/service.js';
import { keyframeAtMs, loadAsset, loadScenes } from './lib/scenes-shared.js';

export async function run({ assetId, projectId }) {
  await loadAsset(projectId, assetId);
  const storage = getStorage();
  const scenes = await loadScenes(assetId);
  const keyframes = new Map(
    (await listAssets(projectId, { kind: 'keyframe', parentAssetId: assetId })).map((k) => [k.id, k]),
  );

  // Detect everything first, so a storage failure leaves the previous rows untouched.
  const rows = [];
  let checked = 0;
  for (const scene of scenes) {
    const keyframe = scene.keyframeAssetId && keyframes.get(scene.keyframeAssetId);
    if (!keyframe) continue;
    checked += 1;
    const boxes = FaceBoxes.parse(await storage.detectFaces(keyframe.publicId));
    for (const bbox of boxes) rows.push({ sceneId: scene.id, atMs: keyframeAtMs(scene), bbox });
  }

  await withTransaction(async (client) => {
    await client.query('DELETE FROM faces WHERE asset_id = $1', [assetId]);
    for (const r of rows) {
      await client.query('INSERT INTO faces (asset_id, scene_id, at_ms, bbox) VALUES ($1, $2, $3, $4)', [
        assetId,
        r.sceneId,
        r.atMs,
        JSON.stringify(r.bbox),
      ]);
    }
  });

  return { keyframes: checked, faces: rows.length };
}
