// Shared setup for the phase 7 tests (not a test file: vitest only runs *.test.js).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as realFfmpeg from '../../src/adapters/ffmpeg/real.js';
import * as fakeStorage from '../../src/adapters/storage/fake.js';
import { query } from '../../src/db/pool.js';
import { register } from '../../src/modules/auth/service.js';
import { createProject } from '../../src/modules/projects/service.js';
import { createTimeline } from '../../src/modules/timeline/service.js';
import { configureRender } from '../../src/workers/render.js';
import { FIXTURE } from '../fixtures/make-fixture.js';
import { ROOT } from '../helpers/proc.js';

export const OUTPUT = { width: 720, height: 1280, fps: 30 };

// -> { projectId, userId }
export async function makeProject(name = 'P7 render') {
  const { user } = await register({ email: `p7-${randomUUID()}@example.test`, password: 'correct-horse-battery', name: 'P7' });
  const project = await createProject(user.id, { name });
  return { projectId: project.id, userId: user.id };
}

// An original asset row standing for the fixture (20 s, 640x360).
export async function insertOriginal(projectId) {
  const publicId = `proj/${projectId}/originals/fixture-${randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO assets (project_id, kind, cloudinary_public_id, url, duration_ms, width, height, status)
     VALUES ($1, 'original', $2, $3, $4, $5, $6, 'indexed') RETURNING id`,
    [projectId, publicId, `https://res.fake-cloudinary.test/demo/video/upload/${publicId}.mp4`, FIXTURE.durationMs, FIXTURE.width, FIXTURE.height],
  );
  return { id: rows[0].id, publicId };
}

// clips: [[assetId, sourceInMs, sourceOutMs], ...] laid out back to back from 0.
export function reelDoc(clips, output = OUTPUT) {
  let startMs = 0;
  return {
    schemaVersion: 1,
    output,
    tracks: [
      {
        id: 'v1',
        type: 'video',
        clips: clips.map(([assetId, sourceInMs, sourceOutMs], i) => {
          const clip = { id: `c${i + 1}`, assetId, sourceInMs, sourceOutMs, startMs, volume: 1 };
          startMs += sourceOutMs - sourceInMs;
          return clip;
        }),
      },
    ],
  };
}

export async function makeTimeline(projectId, doc, { title = 'Reel', sourceAssetId } = {}) {
  const { timeline } = await createTimeline(projectId, { title, doc, sourceAssetId, authorType: 'ai', summary: 'v1' });
  return timeline;
}

// Points the render worker at real FFmpeg and the fixture, uploads through the fake
// storage, and keeps a copy of every uploaded file under keepDir (the worker deletes its
// temp dir). badAssets: asset ids whose input resolves to a missing file.
export async function useRealRender({ tmpRoot, keepDir, badAssets = new Set(), ffmpeg = realFfmpeg } = {}) {
  await fs.mkdir(tmpRoot, { recursive: true });
  await fs.mkdir(keepDir, { recursive: true });
  const uploads = [];
  const storage = {
    ...fakeStorage,
    async uploadFile(file, options) {
      const kept = path.join(keepDir, path.basename(file));
      await fs.copyFile(file, kept);
      const resource = await fakeStorage.uploadFile(file, options);
      uploads.push({ kept, options, resource });
      return resource;
    },
  };
  const resolved = [];
  configureRender({
    ffmpeg,
    storage,
    tmpRoot,
    resolveInput: (asset, size) => {
      resolved.push({ assetId: asset.id, ...size });
      return badAssets.has(asset.id) ? path.join(tmpRoot, 'does-not-exist.mp4') : FIXTURE.path;
    },
  });
  return { uploads, resolved };
}

export const tmpDir = (name) => path.join(ROOT, 'tmp', 'phase7', `${name}-${randomUUID().slice(0, 8)}`);

// ffprobe a file -> { durationMs, video: { width, height } | undefined, audio: {} | undefined }
export function probeFile(file) {
  const bin = process.env.FFPROBE_PATH || 'ffprobe';
  const r = spawnSync(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const data = JSON.parse(r.stdout);
  return {
    durationMs: Math.round(Number(data.format.duration) * 1000),
    video: data.streams.find((s) => s.codec_type === 'video'),
    audio: data.streams.find((s) => s.codec_type === 'audio'),
  };
}
