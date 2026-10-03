// media service: the module's public API. Other modules import this file and nothing
// else from here.
import * as repo from './repo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toAsset = (row) => ({
  id: row.id,
  projectId: row.project_id,
  kind: row.kind,
  durationMs: row.duration_ms,
  width: row.width,
  height: row.height,
  status: row.status,
});

// Contract used by the timeline validator (P5): returns the assets among `ids` that
// belong to `projectId`, as [{ id, projectId, kind, durationMs, width, height, status }].
// Ids that are malformed, missing or in another project are simply absent.
export async function getAssetsByIds(projectId, ids) {
  const valid = [...new Set(ids)].filter((id) => typeof id === 'string' && UUID.test(id));
  if (!valid.length || !UUID.test(projectId)) return [];
  return (await repo.findByIds(projectId, valid)).map(toAsset);
}
