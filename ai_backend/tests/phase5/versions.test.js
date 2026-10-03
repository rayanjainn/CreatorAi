// P5.T2: timelines + append-only timeline_versions, optimistic concurrency, through the
// service API the editing agent (P6) will call.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getPool } from '../../src/db/pool.js';
import { createProject, deleteProject } from '../../src/modules/projects/service.js';
import { createTimeline, createVersion, emptyTimelineDoc, getHead } from '../../src/modules/timeline/service.js';
import { createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { insertAsset, videoDoc } from './helpers.js';

const app = createApp({ log: { error() {} } });

let alice;
let project;
let asset;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app);
  project = await createProject(alice.user.id, { name: 'Timelines' });
  asset = await insertAsset(project.id, { durationMs: 20_000 });
});
afterAll(closeAll);

const versionRows = async (timelineId) =>
  (await getPool().query(
    `SELECT version, parent_version, author_type, author_id, agent_run_id, summary, doc::text AS doc_text
     FROM timeline_versions WHERE timeline_id = $1 ORDER BY version`,
    [timelineId],
  )).rows;

const aiTimeline = (doc = videoDoc(asset.id), extra = {}) =>
  createTimeline(project.id, {
    title: 'Reel 1', sourceAssetId: asset.id, doc, summary: 'First cut', authorType: 'ai', authorId: alice.user.id, ...extra,
  });

describe('createTimeline', () => {
  it('creates the timeline with v1 holding the doc', async () => {
    const runId = randomUUID();
    const { timeline, head } = await aiTimeline(videoDoc(asset.id), { agentRunId: runId });
    expect(timeline).toMatchObject({
      projectId: project.id, title: 'Reel 1', sourceAssetId: asset.id, headVersion: 1, createdBy: alice.user.id,
    });
    expect(head).toMatchObject({
      version: 1, parentVersion: null, authorType: 'ai', authorId: alice.user.id, agentRunId: runId,
      summary: 'First cut', doc: videoDoc(asset.id),
    });
  });

  it('without a doc, v1 is the empty doc', async () => {
    const { head } = await createTimeline(project.id, { title: 'Blank', authorType: 'human', authorId: alice.user.id });
    expect(head).toMatchObject({ version: 1, doc: emptyTimelineDoc(), authorType: 'human' });
  });

  it('rejects an invalid doc with 400 and writes nothing', async () => {
    const err = await aiTimeline(videoDoc(asset.id, { sourceOutMs: 30_000 })).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(err.details).toContainEqual(expect.objectContaining({ path: ['doc', 'tracks', 0, 'clips', 0, 'sourceOutMs'] }));
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM timelines');
    expect(rows[0].n).toBe(0);
  });

  it('rejects a sourceAssetId outside the project', async () => {
    const other = await createProject(alice.user.id, { name: 'Other' });
    const foreign = await insertAsset(other.id);
    const err = await createTimeline(project.id, {
      title: 'x', sourceAssetId: foreign.id, authorType: 'human', authorId: alice.user.id,
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(err.details).toContainEqual(expect.objectContaining({ path: ['sourceAssetId'] }));
  });

  it('a human version needs an authorId', async () => {
    const err = await createTimeline(project.id, { title: 'x', authorType: 'human' }).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed' });
  });
});

describe('createVersion', () => {
  it('v1 ai -> v2 human -> v3 ai: sequential versions, parent chain and authors recorded', async () => {
    const bob = await createUser(app);
    const runId = randomUUID();
    const { timeline } = await aiTimeline();
    const v2 = await createVersion(project.id, timeline.id, {
      baseVersion: 1, doc: videoDoc(asset.id, { volume: 0.5 }), summary: 'Quieter', authorType: 'human', authorId: bob.user.id,
    });
    const v3 = await createVersion(project.id, timeline.id, {
      baseVersion: 2, doc: videoDoc(asset.id, { volume: 0.5, label: 'hook' }), summary: 'Label', authorType: 'ai', agentRunId: runId,
    });
    expect(v2).toMatchObject({ version: 2, parentVersion: 1, authorType: 'human', authorId: bob.user.id });
    expect(v3).toMatchObject({ version: 3, parentVersion: 2, authorType: 'ai', authorId: null, agentRunId: runId });

    const rows = await versionRows(timeline.id);
    expect(rows.map((r) => [r.version, r.parent_version, r.author_type, r.author_id, r.agent_run_id])).toEqual([
      [1, null, 'ai', alice.user.id, null],
      [2, 1, 'human', bob.user.id, null],
      [3, 2, 'ai', null, runId],
    ]);
    const { timeline: after, head } = await getHead(project.id, timeline.id);
    expect(after.headVersion).toBe(3);
    expect(head).toMatchObject({ version: 3, summary: 'Label', doc: videoDoc(asset.id, { volume: 0.5, label: 'hook' }) });
  });

  it('a stale baseVersion -> 409 with the current head, and no row written', async () => {
    const { timeline } = await aiTimeline();
    await createVersion(project.id, timeline.id, { baseVersion: 1, doc: videoDoc(asset.id), summary: 'v2', authorType: 'ai' });
    const err = await createVersion(project.id, timeline.id, {
      baseVersion: 1, doc: videoDoc(asset.id, { volume: 0 }), summary: 'stale', authorType: 'ai',
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'conflict', details: { headVersion: 2 } });
    expect((await versionRows(timeline.id)).map((r) => r.version)).toEqual([1, 2]);
    expect((await getHead(project.id, timeline.id)).timeline.headVersion).toBe(2);
  });

  it('a baseVersion ahead of head is also a 409', async () => {
    const { timeline } = await aiTimeline();
    const err = await createVersion(project.id, timeline.id, {
      baseVersion: 7, doc: videoDoc(asset.id), summary: 'future', authorType: 'ai',
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, details: { headVersion: 1 } });
  });

  it('two parallel saves on the same base: exactly one wins, the other gets 409', async () => {
    const { timeline } = await aiTimeline();
    const save = (volume) => createVersion(project.id, timeline.id, {
      baseVersion: 1, doc: videoDoc(asset.id, { volume }), summary: `vol ${volume}`, authorType: 'ai',
    });
    for (let round = 0; round < 3; round += 1) {
      const head = (await getHead(project.id, timeline.id)).timeline.headVersion;
      const results = await Promise.allSettled([0.1, 0.2].map((volume) => createVersion(project.id, timeline.id, {
        baseVersion: head, doc: videoDoc(asset.id, { volume }), summary: `vol ${volume}`, authorType: 'ai',
      })));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toMatchObject({ status: 409 });
      expect(ok[0].value.version).toBe(head + 1);
    }
    expect((await versionRows(timeline.id)).map((r) => r.version)).toEqual([1, 2, 3, 4]);
    await expect(save(0.3)).rejects.toMatchObject({ status: 409, details: { headVersion: 4 } });
  });

  it('an invalid doc -> 400 and no row written', async () => {
    const { timeline } = await aiTimeline();
    const err = await createVersion(project.id, timeline.id, {
      baseVersion: 1, doc: videoDoc(asset.id, {}, [{ id: 'c2', assetId: asset.id, sourceInMs: 0, sourceOutMs: 1_000, startMs: 1_000, volume: 1 }]),
      summary: 'overlap', authorType: 'ai',
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(err.details).toContainEqual(expect.objectContaining({ code: 'overlap', path: ['doc', 'tracks', 0, 'clips', 1, 'startMs'] }));
    expect(await versionRows(timeline.id)).toHaveLength(1);
  });

  it('a timeline of another project, a missing one or a malformed id -> 404', async () => {
    const { timeline } = await aiTimeline();
    const other = await createProject(alice.user.id, { name: 'Other' });
    const input = { baseVersion: 1, doc: emptyTimelineDoc(), summary: 'x', authorType: 'ai' };
    for (const [pid, tid] of [[other.id, timeline.id], [project.id, randomUUID()], [project.id, 'nope']]) {
      await expect(createVersion(pid, tid, input)).rejects.toMatchObject({ status: 404 });
      await expect(getHead(pid, tid)).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe('immutability', () => {
  it('old versions are byte-identical after later saves', async () => {
    const { timeline } = await aiTimeline();
    const before = await versionRows(timeline.id);
    for (let v = 1; v <= 3; v += 1) {
      await createVersion(project.id, timeline.id, {
        baseVersion: v, doc: videoDoc(asset.id, { volume: v / 10 }), summary: `v${v + 1}`, authorType: 'ai',
      });
    }
    const after = await versionRows(timeline.id);
    expect(after).toHaveLength(4);
    expect(after[0]).toEqual(before[0]);
  });

  it('the database refuses UPDATE and DELETE on timeline_versions', async () => {
    const { timeline } = await aiTimeline();
    const pool = getPool();
    await expect(pool.query(`UPDATE timeline_versions SET summary = 'hacked' WHERE timeline_id = $1`, [timeline.id]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM timeline_versions WHERE timeline_id = $1`, [timeline.id]))
      .rejects.toThrow(/append-only/);
    expect(await versionRows(timeline.id)).toHaveLength(1);
  });

  it('deleting the timeline (or its project) cascades to its versions', async () => {
    const { timeline } = await aiTimeline();
    const { timeline: second } = await aiTimeline();
    await getPool().query('DELETE FROM timelines WHERE id = $1', [timeline.id]);
    expect(await versionRows(timeline.id)).toHaveLength(0);
    await deleteProject(project.id);
    expect(await versionRows(second.id)).toHaveLength(0);
  });

  it('deleting the source asset keeps the timeline and its versions', async () => {
    const { timeline } = await aiTimeline(emptyTimelineDoc());
    await getPool().query('DELETE FROM assets WHERE id = $1', [asset.id]);
    const { timeline: after } = await getHead(project.id, timeline.id);
    expect(after.sourceAssetId).toBeNull();
    expect(await versionRows(timeline.id)).toHaveLength(1);
  });
});
