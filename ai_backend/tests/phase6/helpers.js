// Shared setup for the phase 6 tests (not a test file): seeded indexed assets, fake LLM
// replies that read the agent input from the prompt, and job polling.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { query } from '../../src/db/pool.js';
import { authHeader } from '../helpers/auth.js';

export { addMember, createProject, registerOriginal, team } from '../phase3/helpers.js';
export { analysisReply } from '../phase3/helpers-b.js';

// The agent input runAgent() put into the prompt ("## Input\n<json>").
export function agentInput(req) {
  const after = req.prompt.split('## Input\n')[1];
  return JSON.parse(after.split('\n\n## ')[0]);
}

// Deterministic sub-scores for window `index` (all in [0, 1]).
export const seededScores = (index) => ({
  hook: ((index * 37) % 100) / 100,
  selfContained: ((index * 53 + 11) % 100) / 100,
  energy: ((index * 17 + 29) % 100) / 100,
  topicMatch: ((index * 71 + 5) % 100) / 100,
});

// Fake-LLM reply for a moments labelling call: one label per window in the input.
export function momentsReply(req) {
  const { windows } = agentInput(req);
  return {
    moments: windows.map((w) => ({
      index: w.index,
      title: `Moment ${w.index}`,
      hookLine: `Hook for moment ${w.index}`,
      summary: `Summary of moment ${w.index}`,
      scores: seededScores(w.index),
    })),
  };
}

// Queue `n` copies of a reply.
export const times = (n, reply) => Array.from({ length: n }, () => reply);

// Inserts an original asset with status `status` and a transcript of `segmentMs`-long
// sentences (100 ms gaps) plus scenes cut every `sceneMs`. -> { id, durationMs, segments, scenes }
export async function seedIndexedAsset(
  projectId,
  { durationMs = 180_000, segmentMs = 5_000, sceneMs = 30_000, status = 'indexed' } = {},
) {
  const publicId = `proj/${projectId}/originals/seeded-${randomUUID()}`;
  const { rows: [asset] } = await query(
    `INSERT INTO assets (project_id, kind, cloudinary_public_id, url, duration_ms, width, height, status)
     VALUES ($1, 'original', $2, $3, $4, 1920, 1080, $5) RETURNING id`,
    [projectId, publicId, `https://res.fake-cloudinary.test/demo/video/upload/${publicId}.mp4`, durationMs, status],
  );
  const segments = [];
  for (let start = 0; start + segmentMs <= durationMs; start += segmentMs) {
    segments.push({ startMs: start, endMs: start + segmentMs - 100, text: `Sentence starting at ${start / 1000} seconds.` });
  }
  const scenes = [];
  for (let start = 0, idx = 0; start < durationMs; start += sceneMs, idx++) {
    scenes.push({ idx, startMs: start, endMs: Math.min(start + sceneMs, durationMs) });
  }
  for (const s of segments) {
    await query('INSERT INTO transcript_segments (asset_id, start_ms, end_ms, text) VALUES ($1, $2, $3, $4)', [
      asset.id, s.startMs, s.endMs, s.text,
    ]);
  }
  for (const s of scenes) {
    await query('INSERT INTO scenes (asset_id, idx, start_ms, end_ms, caption) VALUES ($1, $2, $3, $4, $5)', [
      asset.id, s.idx, s.startMs, s.endMs, `Scene ${s.idx}`,
    ]);
  }
  return { id: asset.id, durationMs, segments, scenes };
}

export async function getJob(app, projectId, token, jobId) {
  const res = await request(app).get(`/projects/${projectId}/agents/editing/jobs/${jobId}`).set(authHeader(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.job;
}

export async function getMoments(app, projectId, token, assetId) {
  const res = await request(app).get(`/projects/${projectId}/media/${assetId}/moments`).set(authHeader(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.moments;
}

export async function requestMoments(app, projectId, token, assetId, body = {}) {
  const res = await request(app).post(`/projects/${projectId}/media/${assetId}/moments`).set(authHeader(token)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body;
}
