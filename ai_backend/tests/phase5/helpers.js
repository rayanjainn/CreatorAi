// Shared fixtures for the phase 5 tests (not a test file: vitest only runs *.test.js).
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/db/pool.js';

// Inserts an uploaded original asset straight into the assets table (P2 owns the routes).
export async function insertAsset(projectId, { durationMs = 20_000, status = 'uploaded' } = {}) {
  const { rows: [row] } = await getPool().query(
    `INSERT INTO assets (project_id, kind, cloudinary_public_id, duration_ms, status)
     VALUES ($1, 'original', $2, $3, $4) RETURNING id`,
    [projectId, `test/${randomUUID()}`, durationMs, status],
  );
  return { id: row.id, durationMs };
}

// A one-clip video timeline on assetId, plus optional clip overrides.
export function videoDoc(assetId, clip = {}, extraClips = []) {
  return {
    schemaVersion: 1,
    output: { width: 1080, height: 1920, fps: 30 },
    tracks: [
      {
        id: 'v1',
        type: 'video',
        clips: [
          { id: 'c1', assetId, sourceInMs: 0, sourceOutMs: 2_000, startMs: 0, volume: 1, ...clip },
          ...extraClips,
        ],
      },
    ],
  };
}
