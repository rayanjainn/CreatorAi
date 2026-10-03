// P3 end-to-end with the REAL step modules (no step injected): register -> drainQueue ->
// asset indexed, every step done, transcript + scenes indexed and embedded.
// Uses Track B's real scenes / faces / analysis steps over the fake adapters (fake ffmpeg
// cuts at 7 s and 14 s; the fake LLM is queued with analysisReply).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { getEnv } from '../../src/config/env.js';
import { query } from '../../src/db/pool.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { resetPipeline } from '../../src/workers/process.js';
import { resetScenes } from '../../src/workers/steps/scenes.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { assetStatus, registerOriginal, stepRows, team } from './helpers.js';
import { analysisReply } from './helpers-b.js';

const app = createApp({ log: { error() {} } });

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  getStorage().reset();
  getTranscription().reset();
  getEmbeddings().reset();
  getLlm().reset();
  resetScenes(); // fake ffmpeg: cuts at 7 s and 14 s -> 3 scenes / keyframes
  resetPipeline(); // the real step modules
});
afterEach(resetScenes);
afterAll(closeAll);

describe('pipeline with the real step modules (needs Track B)', () => {
  it('register -> drainQueue -> indexed; every step done; segments and scenes embedded', async () => {
    const t = await team(app);
    const asset = await registerOriginal(app, t.project, t.editor.token);
    // analysis: one caption call (3 keyframes <= CAPTION_BATCH) + one summary call
    getLlm().queueResponse(analysisReply, analysisReply);
    await drainQueue();

    const steps = await stepRows(asset.id);
    expect(steps.map((s) => [s.step, s.status, s.error])).toEqual([
      ['analysis', 'done', null],
      ['embeddings', 'done', null],
      ['faces', 'done', null],
      ['scenes', 'done', null],
      ['transcription', 'done', null],
    ]);
    expect(await assetStatus(asset.id)).toBe('indexed');

    const dim = getEnv().EMBED_DIM;
    for (const table of ['transcript_segments', 'scenes']) {
      const { rows } = await query(`SELECT embedding FROM ${table} WHERE asset_id = $1`, [asset.id]);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const r of rows) {
        const e = typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding;
        expect(e).toHaveLength(dim);
      }
    }
  });
});
