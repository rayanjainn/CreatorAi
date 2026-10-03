// media service: the module's public API. Other modules import this file and nothing
// else from here.
import { getStorage } from '../../adapters/storage/index.js';
import { withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { enqueue } from '../../queue/boss.js';
import { JOBS } from '../../queue/jobs.js';
import * as repo from './repo.js';
import { Asset, AssetId, ListQuery, RegisterBody } from './schemas.js';

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

const FOLDER_RE = /^proj\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/originals\/(.+)$/;

// The project id of a public_id inside some project's originals folder, else null.
// Empty, '.' and '..' path segments are refused.
export function projectOfOriginal(publicId) {
  const m = typeof publicId === 'string' ? FOLDER_RE.exec(publicId) : null;
  if (!m || m[2].split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return m[1];
}

// registerUpload(projectId, { publicId }, { createdBy? }) -> { asset, created }.
// The single register path, used by POST /media and the Cloudinary webhook:
// - publicId must be inside proj/<projectId>/originals/ -> else 400;
// - already registered in this project -> the existing asset, created false, no job;
// - verified with storage.getResource (unknown upload -> 400), duration/dimensions stored,
//   kind original, status uploaded;
// - the row and its one media.process job are written in one transaction.
// A project that does not exist -> 404.
export async function registerUpload(projectId, input, { createdBy = null } = {}) {
  const { publicId } = RegisterBody.parse(input);
  if (projectOfOriginal(publicId) !== projectId) {
    throw badRequest(`publicId must be inside ${originalsFolder(projectId)}/`);
  }

  const existing = await repo.findByPublicId(projectId, publicId);
  if (existing) return { asset: toFullAsset(existing), created: false };

  const resource = await getStorage().getResource(publicId, { resourceType: 'video' });
  if (!resource) throw badRequest('No uploaded video with that publicId');

  try {
    return await withTransaction(async (client) => {
      const row = await repo.insertOriginal(client, {
        projectId,
        publicId,
        url: resource.url,
        durationMs: resource.durationMs ?? null,
        width: resource.width ?? null,
        height: resource.height ?? null,
        meta: { format: resource.format, bytes: resource.bytes, resourceType: resource.resourceType },
        createdBy,
      });
      if (!row) return { asset: toFullAsset(await repo.findByPublicId(projectId, publicId, client)), created: false };
      // Same transaction: the job exists if and only if the asset does.
      const db = { executeSql: (text, values) => client.query(text, values) };
      await enqueue(JOBS.MEDIA_PROCESS, { assetId: row.id, projectId }, { db });
      return { asset: toFullAsset(row), created: true };
    });
  } catch (err) {
    if (err?.code === '23503') throw notFound('Project not found');
    throw err;
  }
}

// Contract used by moments / the editing agent (P6), filled by the P3 workers:
// getAssetIndex(projectId, assetId) -> { asset, segments: [{ startMs, endMs, text, speaker }],
// scenes: [{ idx, startMs, endMs, keyframeAssetId, caption }] }, both ordered by time.
// Malformed id, missing or other project -> 404. Callers check asset.status === 'indexed'.
export async function getAssetIndex(projectId, assetId) {
  const asset = await getAsset(projectId, assetId);
  const [segments, scenes] = await Promise.all([repo.findSegments(asset.id), repo.findScenes(asset.id)]);
  return {
    asset,
    segments: segments.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, text: s.text, speaker: s.speaker ?? null })),
    scenes: scenes.map((s) => ({
      idx: s.idx,
      startMs: s.start_ms,
      endMs: s.end_ms,
      keyframeAssetId: s.keyframe_asset_id ?? null,
      caption: s.caption ?? null,
    })),
  };
}

// Cloudinary webhook: verifies the signature through the storage adapter.
export function verifyNotification({ body, timestamp, signature }) {
  return getStorage().verifyNotification({ body, timestamp, signature });
}

// handleNotification(notification) -> { registered, assetId? }. Upload notifications for a
// project's originals folder go through registerUpload; anything else (other types,
// other folders, unknown projects or uploads) is acknowledged and ignored.
export async function handleNotification(notification) {
  if (notification.notification_type !== 'upload') return { registered: false };
  const projectId = projectOfOriginal(notification.public_id);
  if (!projectId) return { registered: false };
  try {
    const { asset } = await registerUpload(projectId, { publicId: notification.public_id });
    return { registered: true, assetId: asset.id };
  } catch (err) {
    if (err?.status === 400 || err?.status === 404) return { registered: false };
    throw err;
  }
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
