// Shared setup for the Track B phase-3 tests (scenes, faces, analysis): a project with an
// owner, an original asset row inserted directly, and readers for the step tables.
import { randomUUID } from 'node:crypto';
import { query } from '../../src/db/pool.js';
import { register } from '../../src/modules/auth/service.js';
import { createProject } from '../../src/modules/projects/service.js';

// -> { projectId, userId }
export async function makeProject(name = 'P3 track B') {
  const { user } = await register({ email: `p3b-${randomUUID()}@example.test`, password: 'correct-horse-battery', name: 'P3B' });
  const project = await createProject(user.id, { name });
  return { projectId: project.id, userId: user.id };
}

// Inserts an original asset (status processing, 20 s, 640x360). -> { id, publicId }
export async function insertOriginal(projectId, { durationMs = 20_000 } = {}) {
  const publicId = `proj/${projectId}/originals/clip-${randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO assets (project_id, kind, cloudinary_public_id, url, duration_ms, width, height, status)
     VALUES ($1, 'original', $2, $3, $4, 640, 360, 'processing') RETURNING id`,
    [projectId, publicId, `https://res.fake-cloudinary.test/demo/video/upload/${publicId}.mp4`, durationMs],
  );
  return { id: rows[0].id, publicId };
}

export async function scenesOf(assetId) {
  const { rows } = await query(
    `SELECT id, idx, start_ms, end_ms, keyframe_asset_id, caption FROM scenes WHERE asset_id = $1 ORDER BY idx`,
    [assetId],
  );
  return rows;
}

export async function keyframesOf(assetId) {
  const { rows } = await query(
    `SELECT id, cloudinary_public_id, url, status, parent_asset_id FROM assets
     WHERE kind = 'keyframe' AND parent_asset_id = $1 ORDER BY cloudinary_public_id`,
    [assetId],
  );
  return rows;
}

export async function facesOf(assetId) {
  const { rows } = await query(`SELECT scene_id, at_ms, bbox FROM faces WHERE asset_id = $1 ORDER BY at_ms, id`, [assetId]);
  return rows;
}

export async function analysisOf(assetId) {
  const { rows } = await query(`SELECT summary, topics FROM asset_analysis WHERE asset_id = $1`, [assetId]);
  return rows[0] ?? null;
}

// A fake-LLM reply (queue it with getLlm().queueResponse) that fits whichever analysis call
// it meets: a caption batch (request has images) or the summary. Queue one per expected
// call, e.g. queueResponse(analysisReply, analysisReply) for <= CAPTION_BATCH keyframes.
export function analysisReply(req) {
  if (req.images?.length) return { captions: req.images.map((_, i) => `Fake caption ${i + 1}`) };
  return { summary: 'Fake summary of the video.', topics: ['fake topic'] };
}

// Inserts scenes with keyframe assets directly (for the faces / analysis tests).
// spans: [[startMs, endMs], ...]. -> [{ sceneId, keyframeId, keyframePublicId, idx, startMs, endMs }]
export async function seedScenes(projectId, assetId, spans) {
  const out = [];
  for (const [idx, [startMs, endMs]] of spans.entries()) {
    const publicId = `proj/${projectId}/derived/keyframes/${assetId}-${idx}`;
    const { rows: [kf] } = await query(
      `INSERT INTO assets (project_id, kind, parent_asset_id, cloudinary_public_id, url, width, height, status)
       VALUES ($1, 'keyframe', $2, $3, $4, 640, 360, 'uploaded') RETURNING id`,
      [projectId, assetId, publicId, `https://res.fake-cloudinary.test/demo/image/upload/${publicId}.jpg`],
    );
    const { rows: [scene] } = await query(
      `INSERT INTO scenes (asset_id, idx, start_ms, end_ms, keyframe_asset_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [assetId, idx, startMs, endMs, kf.id],
    );
    out.push({ sceneId: scene.id, keyframeId: kf.id, keyframePublicId: publicId, idx, startMs, endMs });
  }
  return out;
}
