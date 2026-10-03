// P3 pipeline step: scene detection + keyframes: writes scenes rows (contiguous, covering the full duration) and one keyframe asset per scene via media createDerivedAsset.
// Contract shared by every step (owned by the P3 orchestrator, implemented per step):
//   run({ assetId, projectId }) -> plain JSON object (stored as the step output).
// - Idempotent: a re-run replaces this step's own rows, never duplicates them.
// - Throws to fail the step (retried); throws NonRetryableError (src/lib/errors.js) when
//   retrying cannot help.
// - Reads earlier steps' results from the database, never from the caller.
//
// Input: the asset's low-res proxy (storage.proxyUrl). Tests and the pipeline test point the
// step at a local file instead with configureScenes({ ffmpeg, resolveInput, tmpRoot }).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFfmpeg } from '../../adapters/ffmpeg/index.js';
import { getStorage } from '../../adapters/storage/index.js';
import { withTransaction } from '../../db/pool.js';
import { NonRetryableError } from '../../lib/errors.js';
import { createDerivedAsset, deleteAsset, derivedFolder, listAssets } from '../../modules/media/service.js';
import { buildSpans, keyframeAtMs, loadAsset } from './lib/scenes-shared.js';

export const SCENE_THRESHOLD = 0.35;

const defaults = () => ({
  ffmpeg: null, // null -> getFfmpeg() at run time (real | fake by ADAPTERS)
  resolveInput: (asset) => getStorage().proxyUrl(asset.publicId),
  tmpRoot: null, // null -> os.tmpdir()
});
let config = defaults();

// configureScenes({ ffmpeg?, resolveInput?(asset) -> path|url, tmpRoot? }): overrides for
// tests (e.g. real FFmpeg on tests/fixtures/fixture.mp4). resetScenes() restores defaults.
export function configureScenes(overrides = {}) {
  config = { ...config, ...overrides };
}

export function resetScenes() {
  config = defaults();
}

export async function run({ assetId, projectId }) {
  const ffmpeg = config.ffmpeg ?? getFfmpeg();
  const storage = getStorage();
  const asset = await loadAsset(projectId, assetId);
  const input = await config.resolveInput(asset);

  const durationMs = asset.durationMs ?? (await ffmpeg.probe(input)).durationMs;
  if (!durationMs || durationMs <= 0) throw new NonRetryableError(`asset ${assetId} has no known duration`);

  const cutsMs = await ffmpeg.detectScenes(input, { threshold: SCENE_THRESHOLD });
  const spans = buildSpans(cutsMs, durationMs);
  const previous = await listAssets(projectId, { kind: 'keyframe', parentAssetId: assetId });

  const dir = await fs.mkdtemp(path.join(config.tmpRoot ?? os.tmpdir(), 'scenes-'));
  const keyframes = [];
  try {
    for (const span of spans) {
      const atMs = keyframeAtMs(span);
      const file = path.join(dir, `${assetId}-scene-${span.idx}.jpg`);
      await ffmpeg.extractFrame(input, atMs, file);
      const uploaded = await storage.uploadFile(file, { folder: `${derivedFolder(projectId)}/keyframes`, resourceType: 'image' });
      keyframes.push(
        await createDerivedAsset(projectId, {
          kind: 'keyframe',
          parentAssetId: assetId,
          publicId: uploaded.publicId,
          url: uploaded.url,
          width: uploaded.width,
          height: uploaded.height,
          meta: { sceneIdx: span.idx, atMs },
        }),
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  await withTransaction(async (client) => {
    await client.query('DELETE FROM scenes WHERE asset_id = $1', [assetId]);
    for (const [i, span] of spans.entries()) {
      await client.query(
        'INSERT INTO scenes (asset_id, idx, start_ms, end_ms, keyframe_asset_id) VALUES ($1, $2, $3, $4, $5)',
        [assetId, span.idx, span.startMs, span.endMs, keyframes[i].id],
      );
    }
  });

  // Keyframes from an earlier run that this run did not reuse (the real storage gives
  // every upload a new public_id) are removed from storage and the assets table.
  const kept = new Set(keyframes.map((k) => k.id));
  for (const old of previous) if (!kept.has(old.id)) await deleteAsset(projectId, old.id);

  return { durationMs, cutsMs: spans.slice(1).map((s) => s.startMs), scenes: spans.length, keyframes: keyframes.length };
}
