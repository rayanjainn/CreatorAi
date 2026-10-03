// timeline service: the module's public API. Other modules import this file and nothing
// else from here. The Timeline JSON v1 schema and the pure validator are defined in
// schemas.js and re-exported here.
//
// Versioning: every save appends version head + 1 (append-only, enforced by a DB
// trigger). A save names the baseVersion it was made from; if that is not the current
// head the save is refused with 409 { headVersion } and nothing is written. The check
// runs under SELECT ... FOR UPDATE on the timeline row, so of two parallel saves on the
// same base exactly one wins; the (timeline_id, version) PK is the backstop.
import { withTransaction } from '../../db/pool.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';
import { getAssetsByIds } from '../media/service.js';
import * as repo from './repo.js';
import {
  CreateTimelineInput,
  CreateVersionInput,
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
