// P3 end-to-end with the REAL step modules (no step injected): register -> drainQueue ->
// asset indexed, every step done, transcript + scenes indexed and embedded.
// NOTE: this test only passes once Track B (P3.T2 scenes + keyframes, P3.T3 faces +
// analysis) has replaced the step stubs in src/workers/steps/{scenes,faces,analysis}.js.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { getEnv } from '../../src/config/env.js';
import { query } from '../../src/db/pool.js';
import { resetPipeline } from '../../src/workers/process.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { assetStatus, registerOriginal, stepRows, team } from './helpers.js';

const app = createApp({ log: { error() {} } });

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  getStorage().reset();
  getTranscription().reset();
  getEmbeddings().reset();
  resetPipeline(); // the real step modules
});
afterAll(closeAll);

describe('pipeline with the real step modules (needs Track B)', () => {
  it('register -> drainQueue -> indexed; every step done; segments and scenes embedded', async () => {
    const t = await team(app);
    const asset = await registerOriginal(app, t.project, t.editor.token);
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
