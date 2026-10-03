// render service: the module's public API. Other modules import this file and nothing
// else from here.
//
// A render is pinned to one timeline version (the head when no version is given), so
// later edits never change it. requestRender writes the queued row and its render.run job
// in one transaction; src/workers/render.js runs it. One live (non-failed) render exists
// per { timeline, version, kind }: asking again returns it instead of rendering twice.
import { withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { enqueue } from '../../queue/boss.js';
import { JOBS } from '../../queue/jobs.js';
import { getAsset } from '../media/service.js';
import { getHead, getVersion } from '../timeline/service.js';
import { renderClips } from './ffmpeg-args.js';
import * as repo from './repo.js';
import { Render, RenderId, RequestRenderBody } from './schemas.js';

export { buildFfmpegArgs, renderClips, renderSize, RENDER_KINDS, PREVIEW_WIDTH } from './ffmpeg-args.js';

// render.run jobs are never retried by pg-boss: a failed render is final (stderr kept on
// the row) and the client asks again, which creates a fresh render.
const RUN_OPTIONS = Object.freeze({ retryLimit: 0 });

const iso = (v) => (v == null ? null : new Date(v).toISOString());

async function outputUrlOf(row) {
  if (!row.output_asset_id) return null;
  try {
    return (await getAsset(row.project_id, row.output_asset_id)).url;
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

async function toRender(row) {
  return Render.parse({
    id: row.id,
    projectId: row.project_id,
    timelineId: row.timeline_id,
    version: row.version,
    kind: row.kind,
    status: row.status,
    progress: Number(row.progress),
    outputAssetId: row.output_asset_id ?? null,
    outputUrl: await outputUrlOf(row),
    error: row.error ?? null,
    attempts: row.attempts,
    requestedBy: row.requested_by ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  });
}

// requestRender(projectId, timelineId, { version?, kind }, { requestedBy? })
//   -> { render, created }
// 404 timeline or version not in the project; 400 bad body or a version with no video
// clips. created false = the existing live render for { timeline, version, kind } (a
// done render whose output asset was deleted is re-queued, created true).
export async function requestRender(projectId, timelineId, input, { requestedBy = null } = {}) {
  const parsed = RequestRenderBody.safeParse(input ?? {});
  if (!parsed.success) throw badRequest('Invalid render request', parsed.error.issues);
  const { kind } = parsed.data;
  const { timeline, head } = await getHead(projectId, timelineId);
  const pinned = parsed.data.version === undefined ? head : await getVersion(projectId, timeline.id, parsed.data.version);
  if (!renderClips(pinned.doc).length) throw badRequest(`Timeline version ${pinned.version} has no video clips to render`);

  const key = { projectId, timelineId: timeline.id, version: pinned.version, kind, requestedBy };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await withTransaction(async (client) => {
      const db = { executeSql: (text, values) => client.query(text, values) };
      const inserted = await repo.insertQueued(client, key);
      if (inserted) {
        await enqueue(JOBS.RENDER_RUN, { renderId: inserted.id }, { ...RUN_OPTIONS, db });
        return { row: inserted, created: true };
      }
      const live = await repo.findLive(client, key);
      if (!live) return null; // it failed in between: insert again
      if (live.status === 'done' && !live.output_asset_id) {
        const row = await repo.requeue(client, live.id);
        await enqueue(JOBS.RENDER_RUN, { renderId: row.id }, { ...RUN_OPTIONS, db });
        return { row, created: true };
      }
      return { row: live, created: false };
    });
    if (result) return { render: await toRender(result.row), created: result.created };
  }
  throw new Error('requestRender: could not settle the render row');
}

// getRender(projectId, renderId) -> render. Malformed id, missing or other project -> 404.
export async function getRender(projectId, renderId) {
  const row = RenderId.safeParse(renderId).success ? await repo.findOne(projectId, renderId) : null;
  if (!row) throw notFound('Render not found');
  return toRender(row);
}

// listRenders(projectId, timelineId) -> renders of the timeline, newest first.
// 404 when the timeline is not in the project.
export async function listRenders(projectId, timelineId) {
  const { timeline } = await getHead(projectId, timelineId);
  const rows = await repo.listForTimeline(projectId, timeline.id);
  return Promise.all(rows.map(toRender));
}

// ---- worker contract (src/workers/render.js) -----------------------------------------

// claimRender(renderId) -> render row moved to 'rendering' ({ id, projectId, timelineId,
// version, kind }), or null when it is gone, done or failed.
export async function claimRender(renderId) {
  const row = await repo.claim(renderId);
  return row
    ? { id: row.id, projectId: row.project_id, timelineId: row.timeline_id, version: row.version, kind: row.kind }
    : null;
}

// setRenderProgress(renderId, progress 0..1): only while rendering.
export async function setRenderProgress(renderId, progress) {
  await repo.setProgress(renderId, Math.min(1, Math.max(0, progress)));
}

export async function completeRender(renderId, outputAssetId) {
  const row = await repo.markDone(renderId, outputAssetId);
  return row ? toRender(row) : null;
}

export async function failRender(renderId, error) {
  const row = await repo.markFailed(renderId, String(error).slice(-4000));
  return row ? toRender(row) : null;
}
