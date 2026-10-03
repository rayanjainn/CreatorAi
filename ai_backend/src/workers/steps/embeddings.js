// P3 pipeline step: embeddings (EMBED_DIM). Every transcript segment's text, and every
// scene: its keyframe image when the embeddings adapter supports images (falling back to
// the caption text if the image call is refused), else its caption text. A scene with
// neither gets a text describing its position, so every row ends up with a vector.
// Vectors are written through the search service (the only code that knows the vector
// backend). Step contract: see src/workers/process.js (re-running overwrites the vectors).
import { getEmbeddings } from '../../adapters/embeddings/index.js';
import { embeddingsOutput } from '../../adapters/embeddings/contract.js';
import { getEnv } from '../../config/env.js';
import { query } from '../../db/pool.js';
import { storeEmbeddings } from '../../modules/search/service.js';

const sceneText = (s) => s.caption?.trim() || `Scene ${s.idx + 1} from ${s.start_ms} ms to ${s.end_ms} ms`;

export async function run({ assetId }) {
  const dim = getEnv().EMBED_DIM;
  const adapter = getEmbeddings();
  const check = (vectors, n) => {
    const out = embeddingsOutput(dim).parse(vectors);
    if (out.length !== n) throw new Error(`embeddings adapter returned ${out.length} vectors for ${n} inputs`);
    return out;
  };

  const { rows: segments } = await query('SELECT id, text FROM transcript_segments WHERE asset_id = $1 ORDER BY start_ms', [
    assetId,
  ]);
  const { rows: scenes } = await query(
    `SELECT s.id, s.idx, s.start_ms, s.end_ms, s.caption, k.url AS keyframe_url
     FROM scenes s LEFT JOIN assets k ON k.id = s.keyframe_asset_id
     WHERE s.asset_id = $1 ORDER BY s.idx`,
    [assetId],
  );

  const segmentVectors = segments.length ? check(await adapter.embedTexts(segments.map((s) => s.text)), segments.length) : [];

  // Scenes: images where possible, text for the rest.
  const sceneVectors = new Array(scenes.length);
  let imageScenes = adapter.supportsImages?.() ? scenes.filter((s) => s.keyframe_url) : [];
  if (imageScenes.length) {
    try {
      const vectors = check(await adapter.embedImages(imageScenes.map((s) => s.keyframe_url)), imageScenes.length);
      imageScenes.forEach((s, i) => (sceneVectors[scenes.indexOf(s)] = vectors[i]));
    } catch (err) {
      if (err?.code !== 'unsupported') throw err;
      imageScenes = [];
    }
  }
  const textScenes = scenes.filter((_, i) => !sceneVectors[i]);
  if (textScenes.length) {
    const vectors = check(await adapter.embedTexts(textScenes.map(sceneText)), textScenes.length);
    textScenes.forEach((s, i) => (sceneVectors[scenes.indexOf(s)] = vectors[i]));
  }

  await storeEmbeddings({
    segments: segments.map((s, i) => ({ id: s.id, vector: segmentVectors[i] })),
    scenes: scenes.map((s, i) => ({ id: s.id, vector: sceneVectors[i] })),
  });
  return { segments: segments.length, scenes: scenes.length, imageScenes: imageScenes.length, dim };
}
