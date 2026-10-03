// media service: the module's public API. Other modules import this file and nothing
// else from here.
import { getStorage } from '../../adapters/storage/index.js';
import { notFound } from '../../lib/errors.js';
import * as repo from './repo.js';
import { Asset, AssetId, ListQuery } from './schemas.js';

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

const toFullAsset = (row) =>
  Asset.parse({
    ...toAsset(row),
    parentAssetId: row.parent_asset_id ?? null,
    publicId: row.cloudinary_public_id,
    url: row.url ?? null,
    meta: row.meta ?? {},
    createdBy: row.created_by ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });

// Cloudinary keeps images and videos (audio included) under different resource types.
const resourceTypeOf = (kind) => (kind === 'keyframe' ? 'image' : 'video');

// Cloudinary folders for a project: originals are uploaded by clients, derived assets
// (proxies, keyframes, audio, renders) are written by workers.
export const originalsFolder = (projectId) => `proj/${projectId}/originals`;
export const derivedFolder = (projectId) => `proj/${projectId}/derived`;

// Contract used by the timeline validator (P5): returns the assets among `ids` that
// belong to `projectId`, as [{ id, projectId, kind, durationMs, width, height, status }].
// Ids that are malformed, missing or in another project are simply absent.
export async function getAssetsByIds(projectId, ids) {
  const valid = [...new Set(ids)].filter((id) => typeof id === 'string' && UUID.test(id));
  if (!valid.length || !UUID.test(projectId)) return [];
  return (await repo.findByIds(projectId, valid)).map(toAsset);
}

// The functions below take a project id the caller is already authorized for (routes
// run requireRole first).

// signUpload(projectId) -> signed params for a direct upload into the project's
// originals folder. The folder is part of the signature, so the client cannot change it.
export async function signUpload(projectId) {
  return getStorage().signUpload({ folder: originalsFolder(projectId), resourceType: 'video' });
}

// listAssets(projectId, { kind = 'original', parentAssetId? }) -> assets, newest first.
export async function listAssets(projectId, filters = {}) {
  const { kind, parentAssetId } = ListQuery.parse(filters);
  return (await repo.list(projectId, { kind, parentAssetId })).map(toFullAsset);
}

// getAsset(projectId, assetId) -> asset. Malformed id, missing or other project -> 404.
export async function getAsset(projectId, assetId) {
  const row = AssetId.safeParse(assetId).success ? await repo.findOne(projectId, assetId) : null;
  if (!row) throw notFound('Asset not found');
  return toFullAsset(row);
}

// deleteAsset(projectId, assetId): destroys the asset and every derived child in storage,
// then deletes the rows. Storage goes first, so a storage failure leaves the rows in
// place and the delete can be retried ('not found' in storage counts as done).
export async function deleteAsset(projectId, assetId) {
  const tree = AssetId.safeParse(assetId).success ? await repo.findTree(projectId, assetId) : [];
  if (!tree.length) throw notFound('Asset not found');
  const storage = getStorage();
  for (const node of tree.slice().reverse()) {
    await storage.destroy(node.cloudinary_public_id, { resourceType: resourceTypeOf(node.kind) });
  }
  if (!(await repo.deleteOne(projectId, assetId))) throw notFound('Asset not found');
}
