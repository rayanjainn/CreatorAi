// search service (phase 3): the module's public API. Other modules import this file and
// nothing else from here.
import { getEmbeddings } from '../../adapters/embeddings/index.js';
import { embeddingsOutput } from '../../adapters/embeddings/contract.js';
import { getEnv } from '../../config/env.js';
import * as repo from './repo.js';
import { Hit, KINDS, SearchBody } from './schemas.js';

const toHit = (r) =>
  Hit.parse(
    r.kind === 'transcript'
      ? { kind: r.kind, assetId: r.asset_id, startMs: r.start_ms, endMs: r.end_ms, text: r.text, score: 1 - r.distance }
      : {
          kind: r.kind,
          assetId: r.asset_id,
          startMs: r.start_ms,
          endMs: r.end_ms,
          caption: r.caption ?? null,
          keyframeAssetId: r.keyframe_asset_id ?? null,
          score: 1 - r.distance,
        },
  );

// search(projectId, { query, kinds?, assetIds?, limit? }) -> hits, best first:
// [{ kind: 'transcript', assetId, startMs, endMs, text, score }
//  | { kind: 'scene', assetId, startMs, endMs, caption, keyframeAssetId, score }].
// The query is embedded with the embeddings adapter; score = 1 - cosine distance.
// Only assets of projectId are searched (the caller has already authorized the project).
export async function search(projectId, input) {
  const { query, kinds = KINDS, assetIds, limit } = SearchBody.parse(input);
  const [vector] = embeddingsOutput(getEnv().EMBED_DIM).parse(await getEmbeddings().embedTexts([query]));
  const rows = await repo.searchProject({ projectId, vector, kinds, assetIds, limit });
  return rows.map(toHit);
}

// Contract for the P3 embeddings step: storeEmbeddings({ segments: [{ id, vector }],
// scenes: [{ id, vector }] }) writes the vectors onto transcript_segments / scenes rows.
export async function storeEmbeddings({ segments = [], scenes = [] }) {
  await repo.setEmbeddings({ transcript_segments: segments, scenes });
}
