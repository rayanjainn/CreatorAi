// Analysis step (P3.T3): vision captions per keyframe (batched) -> scenes.caption, then one
// summary call -> asset_analysis. Fake LLM replies are scripted; output is Zod-validated
// and an invalid reply is retried once.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getEnv } from '../../src/config/env.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { query } from '../../src/db/pool.js';
import { CAPTION_BATCH, run } from '../../src/workers/steps/analysis.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { analysisOf, analysisReply, insertOriginal, makeProject, scenesOf, seedScenes } from './helpers-b.js';

const llm = getLlm();
const THREE = [[0, 7000], [7000, 14000], [14000, 20000]];

beforeEach(async () => {
  await resetDb();
  llm.reset();
});
afterAll(closeAll);

async function setup(spans = THREE) {
  const { projectId } = await makeProject();
  const asset = await insertOriginal(projectId);
  const scenes = await seedScenes(projectId, asset.id, spans);
  return { projectId, asset, scenes };
}

describe('analysis step', () => {
  it('stores a caption per scene and the asset summary + topics', async () => {
    const { projectId, asset, scenes } = await setup();
    llm.queueResponse(
      { captions: ['A test pattern', 'A plain blue screen', 'Colour bars'] },
      { summary: 'Three test screens in a row.', topics: ['test pattern', 'colour bars'] },
    );

    const out = await run({ assetId: asset.id, projectId });
    expect(out).toMatchObject({ captions: 3, topics: 2 });

    expect((await scenesOf(asset.id)).map((s) => s.caption)).toEqual(['A test pattern', 'A plain blue screen', 'Colour bars']);
    expect(await analysisOf(asset.id)).toEqual({ summary: 'Three test screens in a row.', topics: ['test pattern', 'colour bars'] });

    const [captionCall, summaryCall] = llm.calls;
    expect(captionCall.model).toBe(getEnv().VISION_MODEL);
    expect(captionCall.images).toEqual(scenes.map((s) => `https://res.fake-cloudinary.test/demo/image/upload/${s.keyframePublicId}.jpg`));
    expect(summaryCall.images ?? []).toEqual([]);
    expect(summaryCall.prompt).toContain('A plain blue screen');
    expect(llm.calls).toHaveLength(2);
  });

  it(`batches keyframes: at most ${CAPTION_BATCH} images per call`, async () => {
    const spans = Array.from({ length: CAPTION_BATCH + 2 }, (_, i) => [i * 1000, (i + 1) * 1000]);
    const { projectId, asset } = await setup(spans);
    llm.queueResponse(analysisReply, analysisReply, analysisReply);
    await run({ assetId: asset.id, projectId });
    const visionCalls = llm.calls.filter((c) => c.images?.length);
    expect(visionCalls.map((c) => c.images.length)).toEqual([CAPTION_BATCH, 2]);
    expect((await scenesOf(asset.id)).every((s) => s.caption)).toBe(true);
  });

  it('includes the transcript text in the summary prompt when segments exist', async () => {
    const { projectId, asset } = await setup();
    await query(`INSERT INTO transcript_segments (asset_id, start_ms, end_ms, text) VALUES ($1, 0, 5000, 'hello and welcome to the channel')`, [
      asset.id,
    ]);
    llm.queueResponse(analysisReply, analysisReply);
    await run({ assetId: asset.id, projectId });
    expect(llm.calls.at(-1).prompt).toContain('hello and welcome to the channel');
  });

  it('invalid LLM JSON once -> retried and stored', async () => {
    const { projectId, asset } = await setup();
    llm.queueResponse('not json at all', { captions: ['a', 'b', 'c'] }, { summary: 'S', topics: [] });
    await run({ assetId: asset.id, projectId });
    expect(llm.calls).toHaveLength(3);
    expect((await scenesOf(asset.id)).map((s) => s.caption)).toEqual(['a', 'b', 'c']);
    expect(await analysisOf(asset.id)).toEqual({ summary: 'S', topics: [] });
  });

  it('schema-invalid output (wrong caption count) once -> retried, the retry quotes the problem', async () => {
    const { projectId, asset } = await setup();
    llm.queueResponse({ captions: ['only one'] }, { captions: ['a', 'b', 'c'] }, { summary: 'nope' }, { summary: 'S', topics: ['t'] });
    await run({ assetId: asset.id, projectId });
    expect(llm.calls).toHaveLength(4);
    expect(llm.calls[1].prompt).toMatch(/invalid/i);
    expect(await analysisOf(asset.id)).toEqual({ summary: 'S', topics: ['t'] });
  });

  it('invalid twice -> the step throws and writes nothing', async () => {
    const { projectId, asset } = await setup();
    llm.queueResponse('bad', { captions: 'not an array' });
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow(/invalid/i);
    expect((await scenesOf(asset.id)).map((s) => s.caption)).toEqual([null, null, null]);
    expect(await analysisOf(asset.id)).toBeNull();

    llm.reset();
    llm.queueResponse({ captions: ['a', 'b', 'c'] }, 'bad', 'still bad');
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow(/invalid/i);
    expect(await analysisOf(asset.id)).toBeNull();
  });

  it('re-run overwrites: one asset_analysis row, new captions', async () => {
    const { projectId, asset } = await setup();
    llm.queueResponse({ captions: ['a', 'b', 'c'] }, { summary: 'first', topics: ['x'] });
    await run({ assetId: asset.id, projectId });
    llm.queueResponse({ captions: ['d', 'e', 'f'] }, { summary: 'second', topics: ['y'] });
    await run({ assetId: asset.id, projectId });
    expect((await scenesOf(asset.id)).map((s) => s.caption)).toEqual(['d', 'e', 'f']);
    const { rows } = await query('SELECT summary FROM asset_analysis WHERE asset_id = $1', [asset.id]);
    expect(rows).toEqual([{ summary: 'second' }]);
  });

  it('an LLM error (e.g. 429) propagates so the step is retried', async () => {
    const { projectId, asset } = await setup();
    llm.queueResponse(new Error('429 Too Many Requests'));
    await expect(run({ assetId: asset.id, projectId })).rejects.toThrow('429');
  });

  it('missing asset -> NonRetryableError', async () => {
    const { projectId } = await makeProject();
    await expect(run({ assetId: '00000000-0000-4000-8000-000000000000', projectId })).rejects.toMatchObject({ retryable: false });
  });
});
