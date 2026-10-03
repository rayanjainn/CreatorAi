// media repo: SQL for the assets table.
import { query } from '../../db/pool.js';

const COLUMNS = `id, project_id, kind, parent_asset_id, cloudinary_public_id, url, duration_ms, width,
  height, status, meta, created_by, created_at, updated_at`;

export async function findByIds(projectId, ids) {
  const { rows } = await query(
    `SELECT id, project_id, kind, duration_ms, width, height, status
     FROM assets WHERE project_id = $1 AND id = ANY($2::uuid[])`,
    [projectId, ids],
  );
  return rows;
}

export async function findOne(projectId, assetId) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM assets WHERE project_id = $1 AND id = $2`, [
    projectId,
    assetId,
  ]);
  return rows[0] ?? null;
}

export async function list(projectId, { kind, parentAssetId }) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM assets
     WHERE project_id = $1 AND kind = $2 AND ($3::uuid IS NULL OR parent_asset_id = $3)
     ORDER BY created_at DESC, id`,
    [projectId, kind, parentAssetId ?? null],
  );
  return rows;
}

// The asset and every asset derived from it (any depth), within the project.
export async function findTree(projectId, assetId) {
  const { rows } = await query(
    `WITH RECURSIVE tree AS (
       SELECT id, kind, cloudinary_public_id FROM assets WHERE project_id = $1 AND id = $2
       UNION ALL
       SELECT a.id, a.kind, a.cloudinary_public_id FROM assets a JOIN tree t ON a.parent_asset_id = t.id
     )
     SELECT id, kind, cloudinary_public_id FROM tree`,
    [projectId, assetId],
  );
  return rows;
}

export async function findByPublicId(projectId, publicId, db = { query }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM assets WHERE project_id = $1 AND cloudinary_public_id = $2`,
    [projectId, publicId],
  );
  return rows[0] ?? null;
}

// Inserts an uploaded original. Returns the row, or null when this project already has
// an asset with that public_id (the unique index makes concurrent inserts wait, then
// do nothing).
export async function insertOriginal(client, { projectId, publicId, url, durationMs, width, height, meta, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO assets (project_id, kind, cloudinary_public_id, url, duration_ms, width, height, status, meta, created_by)
     VALUES ($1, 'original', $2, $3, $4, $5, $6, 'uploaded', $7, $8)
     ON CONFLICT (project_id, cloudinary_public_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [projectId, publicId, url, durationMs, width, height, meta, createdBy],
  );
  return rows[0] ?? null;
}

// Children cascade through parent_asset_id ON DELETE CASCADE.
export async function deleteOne(projectId, assetId) {
  const { rowCount } = await query('DELETE FROM assets WHERE project_id = $1 AND id = $2', [projectId, assetId]);
  return rowCount > 0;
}
