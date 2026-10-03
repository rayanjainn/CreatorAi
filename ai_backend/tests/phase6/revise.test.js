// P6.T3 Editing Agent revisions: POST /agents/editing/revise { timelineId, instruction }
// -> 202 -> drainQueue -> a new `ai` version on top of the head (human edits kept).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { buildTimelineDoc, resetEditing } from '../../src/modules/agents/editing/service.js';
import {
  checkTimelineDoc,
  clipEndMs,
  createTimeline,
  createVersion,
  getHead,
  listVersions,
} from '../../src/modules/timeline/service.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import {
  agentInput,
  getJob,
  momentsReply,
  reelReply,
  requestReels,
  requestRevise,
  seedIndexedAsset,
  team,
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

const video = (doc) => doc.tracks.find((t) => t.type === 'video');

function expectContiguous(doc) {
  const clips = video(doc).clips;
  expect(clips[0].startMs).toBe(0);
  for (let i = 1; i < clips.length; i++) expect(clips[i].startMs).toBe(clipEndMs('video', clips[i - 1]));
}

// An ai v1 with three clips (c1 0-5 s, c2 10-15 s, c3 20-25 s) and a caption per clip.
async function aiTimeline(t, asset) {
  const keep = [
    { startMs: 0, endMs: 5_000 },
    { startMs: 10_000, endMs: 15_000 },
    { startMs: 20_000, endMs: 25_000 },
  ];
  const doc = buildTimelineDoc({
    assetId: asset.id,
    durationMs: asset.durationMs,
    keep,
    captions: keep.map((k, i) => ({ startMs: k.startMs + 500, endMs: k.endMs - 500, text: `line ${i + 1}` })),
  });
  const { timeline } = await createTimeline(t.project.id, {
    title: 'Seeded reel',
    sourceAssetId: asset.id,
    doc,
    authorType: 'ai',
    authorId: t.editor.user.id,
  });
  return timeline;
}

describe('revise', () => {
  it('v1 AI -> v2 human edit -> revise -> v3 AI: parent v2, keeps the human-added clip', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const reels = await requestReels(app, t.project.id, t.editor.token, { assetId: asset.id, count: 1, targetSeconds: 30 });
    getLlm().queueResponse(momentsReply, momentsReply, reelReply());
    await drainQueue();
    const [timelineId] = (await getJob(app, t.project.id, t.editor.token, reels.jobId)).result.timelineIds;

    // v2: a human appends a clip
    const { head: v1 } = await getHead(t.project.id, timelineId);
    const doc = structuredClone(v1.doc);
    const humanClip = {
      id: 'h1',
      assetId: asset.id,
      sourceInMs: 150_000,
      sourceOutMs: 153_000,
      startMs: clipEndMs('video', video(doc).clips.at(-1)),
      volume: 1,
      label: 'human closer',
    };
    video(doc).clips.push(humanClip);
    const save = await request(app)
      .post(`/projects/${t.project.id}/timelines/${timelineId}/versions`)
      .set(authHeader(t.editor.token))
      .send({ baseVersion: 1, doc, summary: 'Add a closing shot' });
    expect(save.status, JSON.stringify(save.body)).toBe(201);

    // revise: the instruction only concerns the first clip
    const { jobId, status } = await requestRevise(app, t.project.id, t.owner.token, {
      timelineId,
      instruction: 'Cut the first sentence',
    });
    expect(status).toBe('queued');
    getLlm().queueResponse({ edits: [{ op: 'remove', clipId: 'c1' }], summary: 'Removed the first sentence' });
    await drainQueue();

    const job = await getJob(app, t.project.id, t.viewer.token, jobId);
    expect(job, JSON.stringify(job.error)).toMatchObject({ kind: 'revise', status: 'succeeded', timelineId });
    expect(job.result).toMatchObject({ timelineId, version: 3 });

    const versions = await listVersions(t.project.id, timelineId);
    expect(versions.map((v) => [v.version, v.parentVersion, v.authorType])).toEqual([
      [1, null, 'ai'],
      [2, 1, 'human'],
      [3, 2, 'ai'],
    ]);
    expect(versions[2].agentRunId).toBe(job.runIds[0]);
    expect(versions[2].summary).toBe('Removed the first sentence');

    const { head: v3 } = await getHead(t.project.id, timelineId);
    const ids = video(v3.doc).clips.map((c) => c.id);
    expect(ids).not.toContain('c1');
    expect(ids).toContain('h1');
    expect(ids).toHaveLength(video(v1.doc).clips.length); // -c1 +h1
    const h1 = video(v3.doc).clips.find((c) => c.id === 'h1');
    expect(h1).toMatchObject({ assetId: asset.id, sourceInMs: 150_000, sourceOutMs: 153_000, label: 'human closer' });
    expectContiguous(v3.doc);
    expect(await checkTimelineDoc(t.project.id, v3.doc)).toEqual([]);

    // the agent saw the head (with the human clip) and the instruction
    const input = agentInput(getLlm().calls.at(-1));
    expect(input.instruction).toBe('Cut the first sentence');
    expect(input.baseVersion).toBe(2);
    expect(input.head.tracks.flatMap((tr) => tr.clips.map((c) => c.id))).toContain('h1');
  });

  it('trim, move and add are applied by code; captions follow their clips', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const timeline = await aiTimeline(t, asset);
    const { jobId } = await requestRevise(app, t.project.id, t.editor.token, {
      timelineId: timeline.id,
      instruction: 'Tighten the second clip, open with the third, add the 60 s line after the first',
    });
    getLlm().queueResponse({
      edits: [
        { op: 'trim', clipId: 'c2', sourceInMs: 11_000, sourceOutMs: 14_000 },
        { op: 'move', clipId: 'c3', afterClipId: null },
        { op: 'add', sourceInMs: 60_000, sourceOutMs: 64_900, afterClipId: 'c1', label: 'new line' },
      ],
      summary: 'Tightened and reordered',
    });
    await drainQueue();
    expect((await getJob(app, t.project.id, t.editor.token, jobId)).status).toBe('succeeded');

    const { head } = await getHead(t.project.id, timeline.id);
    expect(head).toMatchObject({ version: 2, parentVersion: 1, authorType: 'ai' });
    const clips = video(head.doc).clips;
    expect(clips.map((c) => [c.sourceInMs, c.sourceOutMs])).toEqual([
      [20_000, 25_000],
      [0, 5_000],
      [60_000, 64_900],
      [11_000, 14_000],
    ]);
    expect(clips.map((c) => c.id).slice(0, 2)).toEqual(['c3', 'c1']);
    expect(clips[2].label).toBe('new line');
    expectContiguous(head.doc);
    expect(await checkTimelineDoc(t.project.id, head.doc)).toEqual([]);

    // line 3 now opens the reel, line 2 is cut to the trimmed range
    const captions = head.doc.tracks.find((tr) => tr.type === 'caption').clips;
    expect(captions.map((c) => [c.text, c.startMs, c.endMs])).toEqual([
      ['line 3', 500, 4_500],
      ['line 1', 5_500, 9_500],
      ['line 2', 14_900, 17_900],
    ]);
  });

  it('revise against a head that moved during the run -> clean conflict, no orphan version', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const timeline = await aiTimeline(t, asset);
    const { jobId } = await requestRevise(app, t.project.id, t.editor.token, {
      timelineId: timeline.id,
      instruction: 'Remove the last clip',
    });
    getLlm().queueResponse(async () => {
      // a human saves while the agent is thinking
      const { head } = await getHead(t.project.id, timeline.id);
      await createVersion(t.project.id, timeline.id, {
        baseVersion: head.version,
        doc: head.doc,
        summary: 'Human save during the run',
        authorType: 'human',
        authorId: t.owner.user.id,
      });
      return { edits: [{ op: 'remove', clipId: 'c3' }], summary: 'Removed the last clip' };
    });
    await drainQueue();

    const job = await getJob(app, t.project.id, t.editor.token, jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatchObject({ code: 'conflict', details: { headVersion: 2 } });
    const versions = await listVersions(t.project.id, timeline.id);
    expect(versions.map((v) => [v.version, v.authorType])).toEqual([
      [1, 'ai'],
      [2, 'human'],
    ]);
    const run = await request(app)
      .get(`/projects/${t.project.id}/agents/runs/${job.runIds[0]}`)
      .set(authHeader(t.editor.token));
    expect(run.body.run).toMatchObject({ status: 'failed', artifact: null });
  });

  it('edits naming unknown clips are retried with the problem quoted; twice -> failed, no version', async () => {
    const t = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const timeline = await aiTimeline(t, asset);

    const first = await requestRevise(app, t.project.id, t.editor.token, { timelineId: timeline.id, instruction: 'Drop c9' });
    getLlm().queueResponse(
      { edits: [{ op: 'remove', clipId: 'c9' }], summary: 'x' },
      { edits: [{ op: 'remove', clipId: 'c2' }], summary: 'Removed the middle clip' },
    );
    await drainQueue();
    expect((await getJob(app, t.project.id, t.editor.token, first.jobId)).status).toBe('succeeded');
    expect(getLlm().calls[1].prompt).toContain('previous reply was invalid');
    expect(getLlm().calls[1].prompt).toContain('c9');

    getLlm().reset();
    const second = await requestRevise(app, t.project.id, t.editor.token, { timelineId: timeline.id, instruction: 'Drop c9' });
    getLlm().queueResponse(
      { edits: [{ op: 'remove', clipId: 'c9' }], summary: 'x' },
      { edits: [{ op: 'remove', clipId: 'c1' }, { op: 'remove', clipId: 'c3' }], summary: 'Removed everything' },
    );
    await drainQueue();
    const job = await getJob(app, t.project.id, t.editor.token, second.jobId);
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('invalid_output');
    expect((await listVersions(t.project.id, timeline.id)).map((v) => v.version)).toEqual([1, 2]);
  });
});

describe('revise request rules', () => {
  it('viewer -> 403; other-project or unknown timeline -> 404; bad body -> 400', async () => {
    const t = await team(app);
    const other = await team(app);
    const asset = await seedIndexedAsset(t.project.id);
    const foreignAsset = await seedIndexedAsset(other.project.id);
    const timeline = await aiTimeline(t, asset);
    const foreign = await aiTimeline(other, foreignAsset);
    const post = (token, body) =>
      request(app).post(`/projects/${t.project.id}/agents/editing/revise`).set(authHeader(token)).send(body);

    expect((await post(t.viewer.token, { timelineId: timeline.id, instruction: 'x' })).status).toBe(403);
    expect((await post(t.editor.token, { timelineId: foreign.id, instruction: 'x' })).status).toBe(404);
    expect((await post(t.editor.token, { timelineId: '00000000-0000-4000-8000-000000000000', instruction: 'x' })).status).toBe(404);
    expect((await post(t.editor.token, { timelineId: timeline.id, instruction: '' })).status).toBe(400);
    expect((await post(t.editor.token, { timelineId: 'nope', instruction: 'x' })).status).toBe(400);
    expect(await drainQueue()).toEqual([]);
  });
});
