// timeline service: the module's public API. Other modules import this file and nothing
// else from here. The Timeline JSON v1 schema and the pure validator are defined in
// schemas.js and re-exported here.
//
// Versioning: every save appends version head + 1 (append-only, enforced by a DB
// trigger). A save names the baseVersion it was made from; if that is not the current
// head the save is refused with 409 { headVersion } and nothing is written. The check
// runs under SELECT ... FOR UPDATE on the timeline row, so of two parallel saves on the
// same base exactly one wins; the (timeline_id, version) PK is the backstop.
import { isDeepStrictEqual } from 'node:util';
import { withTransaction } from '../../db/pool.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';
import { getAssetsByIds } from '../media/service.js';
import * as repo from './repo.js';
import {
  CreateTimelineInput,
  CreateVersionInput,
  RevertInput,
  Timeline,
  TimelineId,
  TimelineVersion,
  TimelineVersionMeta,
  collectAssetIds,
  emptyTimelineDoc,
  validateTimeline,
} from './schemas.js';

export {
  AUTHOR_TYPES,
  CaptionClip,
  TIMELINE_SCHEMA_VERSION,
  TimelineDoc,
  TimelineOutput,
  TimelineTrack,
  VideoClip,
  clipEndMs,
  collectAssetIds,
  emptyTimelineDoc,
  validateTimeline,
} from './schemas.js';

const invalid = (message, issues) => new HttpError(400, 'validation_failed', message, issues);

// Parses a service input with a Zod schema; failures become 400 validation_failed.
function parseInput(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw invalid('Invalid input', result.error.issues.map(({ code, path, message }) => ({ code, path, message })));
  }
  return result.data;
}

// checkTimelineDoc(projectId, doc) -> issues ([] when valid). Loads the referenced assets
// through media getAssetsByIds, so missing and other-project assets both come back as
// asset_not_found (no existence leak across projects).
export async function checkTimelineDoc(projectId, doc) {
  const assets = await getAssetsByIds(projectId, collectAssetIds(doc));
  return validateTimeline(doc, new Map(assets.map((a) => [a.id, a])), { projectId });
}

// assertTimelineDoc(projectId, doc, pathPrefix?) -> a copy of the doc, or throws
// 400 validation_failed whose details are the issues (paths prefixed with pathPrefix).
export async function assertTimelineDoc(projectId, doc, pathPrefix = []) {
  const issues = await checkTimelineDoc(projectId, doc);
  if (issues.length) {
    throw invalid('Timeline is invalid', issues.map((i) => ({ ...i, path: [...pathPrefix, ...i.path] })));
  }
  return structuredClone(doc);
}

const iso = (value) => new Date(value).toISOString();

const toTimeline = (row) =>
  Timeline.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    sourceAssetId: row.source_asset_id ?? null,
    headVersion: row.head_version,
    createdBy: row.created_by ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

const versionMeta = (row) => ({
  version: row.version,
  parentVersion: row.parent_version ?? null,
  authorType: row.author_type,
  authorId: row.author_id ?? null,
  agentRunId: row.agent_run_id ?? null,
  summary: row.summary,
  createdAt: iso(row.created_at),
});
const toVersionMeta = (row) => TimelineVersionMeta.parse(versionMeta(row));
const toVersion = (row) => TimelineVersion.parse({ ...versionMeta(row), doc: row.doc });

const timelineNotFound = () => notFound('Timeline not found');

// The timeline row, or 404 for a malformed id or a timeline outside the project.
async function loadTimeline(projectId, timelineId) {
  const row = TimelineId.safeParse(timelineId).success && TimelineId.safeParse(projectId).success
    ? await repo.findTimeline(projectId, timelineId)
    : null;
  if (!row) throw timelineNotFound();
  return row;
}

// Appends a version on top of `baseVersion` (null = whatever the head is once locked).
// The doc must already be validated. Returns { timeline, version } rows.
async function appendOnBase(projectId, timelineId, baseVersion, version) {
  try {
    return await withTransaction(async (client) => {
      const row = await repo.lockTimeline(client, projectId, timelineId);
      if (!row) throw timelineNotFound();
      const head = row.head_version;
      if (baseVersion !== null && baseVersion !== head) {
        throw conflict(`baseVersion ${baseVersion} is not the current head (${head})`, { headVersion: head });
      }
      return repo.appendVersion(client, timelineId, {
        ...version,
        version: head + 1,
        parentVersion: head === 0 ? null : head,
      });
    });
  } catch (err) {
    if (err?.code === '23505') {
      const { head_version: headVersion } = await repo.findTimeline(projectId, timelineId);
      throw conflict('Another save won the race for this version', { headVersion });
    }
    throw err;
  }
}

// createTimeline(projectId, { title, sourceAssetId?, doc?, summary?, authorType,
//   authorId?, agentRunId? }) -> { timeline, head }
// Always writes v1: the given doc, or emptyTimelineDoc() when doc is omitted, so every
// timeline has a head. sourceAssetId must be an asset of the project. A human author
// needs authorId; timelines.created_by = authorId.
export async function createTimeline(projectId, input) {
  const data = parseInput(CreateTimelineInput, input);
  if (data.sourceAssetId) {
    const [found] = await getAssetsByIds(projectId, [data.sourceAssetId]);
    if (!found) {
      throw invalid('Timeline is invalid', [
        { code: 'asset_not_found', path: ['sourceAssetId'], message: `Asset ${data.sourceAssetId} not found in this project` },
      ]);
    }
  }
  const doc = await assertTimelineDoc(projectId, data.doc ?? emptyTimelineDoc(), ['doc']);
  const { timeline, version } = await withTransaction(async (client) => {
    const row = await repo.insertTimeline(client, {
      projectId,
      title: data.title,
      sourceAssetId: data.sourceAssetId,
      createdBy: data.authorId,
    });
    return repo.appendVersion(client, row.id, {
      version: 1,
      parentVersion: null,
      authorType: data.authorType,
      authorId: data.authorId,
      agentRunId: data.agentRunId,
      summary: data.summary ?? (data.doc ? 'Created' : 'Created empty timeline'),
      doc,
    });
  });
  return { timeline: toTimeline(timeline), head: toVersion(version) };
}

// createVersion(projectId, timelineId, { baseVersion, doc, summary, authorType,
//   authorId?, agentRunId? }) -> version (with doc).
// 404 timeline not in project; 400 invalid doc (paths under ['doc', ...]);
// 409 { headVersion } when baseVersion is not the head. Nothing is written on error.
export async function createVersion(projectId, timelineId, input) {
  await loadTimeline(projectId, timelineId);
  const data = parseInput(CreateVersionInput, input);
  const doc = await assertTimelineDoc(projectId, data.doc, ['doc']);
  const { version } = await appendOnBase(projectId, timelineId, data.baseVersion, {
    authorType: data.authorType,
    authorId: data.authorId,
    agentRunId: data.agentRunId,
    summary: data.summary,
    doc,
  });
  return toVersion(version);
}

// getHead(projectId, timelineId) -> { timeline, head } where head is the newest version
// with its doc. 404 when the timeline is not in the project.
export async function getHead(projectId, timelineId) {
  const row = await loadTimeline(projectId, timelineId);
  const head = await repo.findVersion(row.id, row.head_version);
  return { timeline: toTimeline(row), head: toVersion(head) };
}

// listTimelines(projectId) -> timelines (no docs), newest first.
export async function listTimelines(projectId) {
  return (await repo.listTimelines(projectId)).map(toTimeline);
}

// listVersions(projectId, timelineId) -> version metadata (no docs), oldest first.
export async function listVersions(projectId, timelineId) {
  const row = await loadTimeline(projectId, timelineId);
  return (await repo.listVersions(row.id)).map(toVersionMeta);
}

const VERSION_PARAM = /^[1-9]\d{0,8}$/;

// The version row, or 404 for a malformed number or a version that does not exist.
// `version` may be a number or the raw URL segment.
async function loadVersion(timelineId, version) {
  const text = String(version);
  const row = VERSION_PARAM.test(text) ? await repo.findVersion(timelineId, Number(text)) : null;
  if (!row) throw notFound('Version not found');
  return row;
}

// getVersion(projectId, timelineId, version) -> version (with doc). 404 when missing.
export async function getVersion(projectId, timelineId, version) {
  const timeline = await loadTimeline(projectId, timelineId);
  return toVersion(await loadVersion(timeline.id, version));
}

// revertTimeline(projectId, timelineId, { toVersion, baseVersion?, summary?, authorType,
//   authorId?, agentRunId? }) -> the new version.
// Appends a new version whose doc is a copy of toVersion's doc (history is never
// rewritten). With baseVersion it follows the usual rule (409 { headVersion } if stale);
// without it the revert applies on whatever the head is when the row lock is taken.
// The copied doc is re-validated against today's assets, so a revert to a doc whose
// asset has since been deleted is a 400. Missing toVersion -> 404.
export async function revertTimeline(projectId, timelineId, input) {
  const timeline = await loadTimeline(projectId, timelineId);
  const data = parseInput(RevertInput, input);
  const target = await loadVersion(timeline.id, data.toVersion);
  const doc = await assertTimelineDoc(projectId, target.doc, ['doc']);
  const { version } = await appendOnBase(projectId, timelineId, data.baseVersion ?? null, {
    authorType: data.authorType,
    authorId: data.authorId,
    agentRunId: data.agentRunId,
    summary: data.summary ?? `Revert to v${data.toVersion}`,
    doc,
  });
  return toVersion(version);
}

const clipIndex = (doc) => {
  const index = new Map();
  for (const track of doc.tracks) {
    for (const clip of track.clips) index.set(clip.id, { trackId: track.id, clip });
  }
  return index;
};

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Key order does not matter (jsonb reorders keys).
const same = (a, b) => isDeepStrictEqual(a, b);

// diffTimelines(fromDoc, toDoc) -> { added, removed, changed, outputChanged, tracksAdded,
// tracksRemoved }. Pure. Clips are matched by id (unique across the doc):
// - added / removed: [{ id, trackId, clip }]
// - changed: [{ id, fromTrackId, trackId, fields, before, after }] where fields lists the
//   clip keys that differ (plus 'trackId' first when the clip moved track).
// Every list is sorted by id.
export function diffTimelines(fromDoc, toDoc) {
  const before = clipIndex(fromDoc);
  const after = clipIndex(toDoc);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, b] of after) {
    const a = before.get(id);
    if (!a) {
      added.push({ id, trackId: b.trackId, clip: b.clip });
      continue;
    }
    const keys = [...new Set([...Object.keys(a.clip), ...Object.keys(b.clip)])].filter((k) => k !== 'id').sort();
    const fields = keys.filter((k) => !same(a.clip[k], b.clip[k]));
    if (a.trackId !== b.trackId) fields.unshift('trackId');
    if (fields.length) changed.push({ id, fromTrackId: a.trackId, trackId: b.trackId, fields, before: a.clip, after: b.clip });
  }
  for (const [id, a] of before) {
    if (!after.has(id)) removed.push({ id, trackId: a.trackId, clip: a.clip });
  }
  const fromTracks = new Set(fromDoc.tracks.map((t) => t.id));
  const toTracks = new Set(toDoc.tracks.map((t) => t.id));
  return {
    added: added.sort(byId),
    removed: removed.sort(byId),
    changed: changed.sort(byId),
    outputChanged: !same(fromDoc.output, toDoc.output),
    tracksAdded: [...toTracks].filter((t) => !fromTracks.has(t)).sort(),
    tracksRemoved: [...fromTracks].filter((t) => !toTracks.has(t)).sort(),
  };
}

// diffVersions(projectId, timelineId, from, to) -> { from, to, ...diffTimelines }.
// 404 when the timeline or either version is missing.
export async function diffVersions(projectId, timelineId, from, to) {
  const timeline = await loadTimeline(projectId, timelineId);
  const a = await loadVersion(timeline.id, from);
  const b = await loadVersion(timeline.id, to);
  return { from: a.version, to: b.version, ...diffTimelines(a.doc, b.doc) };
}
