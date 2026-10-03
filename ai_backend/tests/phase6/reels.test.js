// P6.T3 Editing Agent reels: POST /agents/editing/reels -> 202 -> drainQueue -> N
// timelines, each an `ai` v1 built from cut decisions by deterministic code.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { query } from '../../src/db/pool.js';
import { resetEditing } from '../../src/modules/agents/editing/service.js';
import {
  checkTimelineDoc,
  clipEndMs,
  collectAssetIds,
  getHead,
  listTimelines,
} from '../../src/modules/timeline/service.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { scriptReply } from '../phase4/fixtures.js';
import {
  agentInput,
  getJob,
  momentsReply,
  reelReply,
  requestMoments,
  requestReels,
  seedIndexedAsset,
  seedScript,
  team,
  times,
} from './helpers.js';

const app = createApp({ log: { error() {} } });

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  getStorage().reset();
  getLlm().reset();
  resetEditing();
});
afterAll(closeAll);

const reelCalls = () => getLlm().calls.filter((c) => c.prompt.includes('"targetMs"'));
const videoTrack = (doc) => doc.tracks.find((t) => t.type === 'video');
const lengthOf = (doc) => clipEndMs('video', videoTrack(doc).clips.at(-1));

describe('reels', () => {
  it('count 3 -> exactly 3 ai v1 timelines: valid, source asset only, within +/-20% of target', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const { jobId, status } = await requestReels(app, t.project.id, t.editor.token, {
      assetId: asset.id,
      count: 3,
      targetSeconds: 30,
    });
    expect(status).toBe('queued');
    // no moments yet: the job generates them first (2 labelling batches), then 3 reels
    getLlm().queueResponse(momentsReply, momentsReply, ...times(3, reelReply()));
    await drainQueue();

    const job = await getJob(app, t.project.id, t.viewer.token, jobId);
    expect(job, JSON.stringify(job.error)).toMatchObject({ kind: 'reels', status: 'succeeded', assetId: asset.id });
    expect(job.result.timelineIds).toHaveLength(3);

    const timelines = await listTimelines(t.project.id);
    expect(timelines).toHaveLength(3);
    expect(timelines.map((tl) => tl.id).sort()).toEqual([...job.result.timelineIds].sort());

    const spans = [];
    for (const tl of timelines) {
      expect(tl.sourceAssetId).toBe(asset.id);
      expect(tl.headVersion).toBe(1);
      const { head } = await getHead(t.project.id, tl.id);
      expect(head).toMatchObject({ version: 1, parentVersion: null, authorType: 'ai', authorId: t.editor.user.id });
      expect(job.runIds).toContain(head.agentRunId);
      expect(await checkTimelineDoc(t.project.id, head.doc)).toEqual([]);
      expect(collectAssetIds(head.doc)).toEqual([asset.id]);
      const length = lengthOf(head.doc);
      expect(length).toBeGreaterThanOrEqual(30_000 * 0.8);
      expect(length).toBeLessThanOrEqual(30_000 * 1.2);
      const clips = videoTrack(head.doc).clips;
      spans.push([clips[0].sourceInMs, clips.at(-1).sourceOutMs]);
    }
    // reels come from non-overlapping moments
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);

    // the reel agent saw only its moment's transcript slice + scenes
    for (const call of reelCalls()) {
      const input = agentInput(call);
      for (const s of input.transcript) {
        expect(s.endMs).toBeGreaterThan(input.window.startMs);
        expect(s.startMs).toBeLessThan(input.window.endMs);
      }
      expect(input.scenes.length).toBeGreaterThan(0);
    }
  });

  it('reuses existing moments, passes the script, maps captions onto the timeline', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse(momentsReply, momentsReply);
    await drainQueue();
    getLlm().reset();

    const scriptId = await seedScript(t.project.id, scriptReply());
    const { jobId } = await requestReels(app, t.project.id, t.editor.token, {
      assetId: asset.id,
      count: 2,
      targetSeconds: 25,
      scriptId,
    });
    getLlm().queueResponse(...times(2, reelReply({ captions: true })));
    await drainQueue();

    const job = await getJob(app, t.project.id, t.editor.token, jobId);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
    expect(getLlm().calls).toHaveLength(2); // no moments relabelling
    expect(agentInput(getLlm().calls[0]).script.hooks).toEqual(scriptReply().hooks);
    for (const tl of await listTimelines(t.project.id)) {
      const { head } = await getHead(t.project.id, tl.id);
      const cap = head.doc.tracks.find((tr) => tr.type === 'caption');
      expect(cap.clips.length).toBeGreaterThan(0);
      expect(await checkTimelineDoc(t.project.id, head.doc)).toEqual([]);
    }
  });

  it('cuts outside the asset are clamped: never a broken timeline', async () => {
    const t = await team(app);
    // one 40 s asset: its only candidate window runs to the asset end
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 40_000, sceneMs: 20_000 });
    await requestReels(app, t.project.id, t.editor.token, { assetId: asset.id, count: 1, targetSeconds: 30 });
    const outside = () => [
      { startMs: 39_000, endMs: 55_000 },
      { startMs: 60_000, endMs: 90_000 },
    ];
    getLlm().queueResponse(momentsReply, reelReply({ fill: 0.85, extra: outside }));
    await drainQueue();

    const [tl] = await listTimelines(t.project.id);
    const { head } = await getHead(t.project.id, tl.id);
    expect(await checkTimelineDoc(t.project.id, head.doc)).toEqual([]);
    for (const clip of videoTrack(head.doc).clips) expect(clip.sourceOutMs).toBeLessThanOrEqual(40_000);
    expect(getLlm().calls).toHaveLength(2); // clamped, not retried
  });

  it('a reel far from the target length is retried with the problem quoted; twice -> failed, no timeline', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    await requestMoments(app, t.project.id, t.editor.token, asset.id);
    getLlm().queueResponse(momentsReply, momentsReply);
    await drainQueue();
    getLlm().reset();

    const ok = await requestReels(app, t.project.id, t.editor.token, { assetId: asset.id, count: 1, targetSeconds: 30 });
    getLlm().queueResponse(reelReply({ fill: 0.3 }), reelReply());
    await drainQueue();
    expect((await getJob(app, t.project.id, t.editor.token, ok.jobId)).status).toBe('succeeded');
    expect(getLlm().calls[1].prompt).toContain('previous reply was invalid');
    expect(getLlm().calls[1].prompt).toMatch(/24000.*36000/);

    getLlm().reset();
    const bad = await requestReels(app, t.project.id, t.editor.token, { assetId: asset.id, count: 1, targetSeconds: 30 });
    getLlm().queueResponse(reelReply({ fill: 0.3 }), { keep: [{ startMs: 5, endMs: 1 }] });
    await drainQueue();
    const job = await getJob(app, t.project.id, t.editor.token, bad.jobId);
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('invalid_output');
    expect(await listTimelines(t.project.id)).toHaveLength(1);
  });

  it('fewer fitting moments than requested -> job fails before any reel is cut', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id, { durationMs: 40_000, sceneMs: 20_000 });
    const { jobId } = await requestReels(app, t.project.id, t.editor.token, { assetId: asset.id, count: 3, targetSeconds: 30 });
    getLlm().queueResponse(momentsReply);
    await drainQueue();
    const job = await getJob(app, t.project.id, t.editor.token, jobId);
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('not_enough_moments');
    expect(await listTimelines(t.project.id)).toEqual([]);
  });
});

describe('reels request rules', () => {
  it('asset not indexed -> 409; viewer -> 403; other-project asset or script -> 404; bad body -> 400', async () => {
    const t = await team(app);
    const other = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const pending = await seedIndexedAsset(t.project.id, { status: 'uploaded' });
    const foreign = await seedIndexedAsset(other.project.id);
    const foreignScript = await seedScript(other.project.id, scriptReply());
    const post = (token, body) =>
      request(app).post(`/projects/${t.project.id}/agents/editing/reels`).set(authHeader(token)).send(body);
    const body = (o = {}) => ({ assetId: asset.id, count: 3, targetSeconds: 30, ...o });

    const notIndexed = await post(t.editor.token, body({ assetId: pending.id }));
    expect(notIndexed.status).toBe(409);
    expect(notIndexed.body.error.code).toBe('conflict');
    expect((await post(t.viewer.token, body())).status).toBe(403);
    expect((await post(t.editor.token, body({ assetId: foreign.id }))).status).toBe(404);
    expect((await post(t.editor.token, body({ scriptId: foreignScript }))).status).toBe(404);
    expect((await post(t.editor.token, body({ count: 0 }))).status).toBe(400);
    expect((await post(t.editor.token, body({ targetSeconds: 600 }))).status).toBe(400);
    expect((await post(t.editor.token, { assetId: asset.id })).status).toBe(400);
    expect(await drainQueue()).toEqual([]);
    const { rows } = await query('SELECT count(*)::int AS n FROM editing_jobs');
    expect(rows[0].n).toBe(0);
  });
});
