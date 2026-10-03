// timeline repo: SQL for the timelines and timeline_versions tables.
import { query } from '../../db/pool.js';

const TIMELINE = 'id, project_id, title, source_asset_id, head_version, created_by, created_at, updated_at';
const VERSION_META = 'version, parent_version, author_type, author_id, agent_run_id, summary, created_at';
const VERSION = `${VERSION_META}, doc`;

// Inserts a timeline with head_version 0 on the given transaction client.
export async function insertTimeline(client, { projectId, title, sourceAssetId, createdBy }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO timelines (project_id, title, source_asset_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING ${TIMELINE}`,
    [projectId, title, sourceAssetId ?? null, createdBy ?? null],
  );
  return row;
}

// Locks the timeline row for the rest of the transaction; null when it is not in the project.
export async function lockTimeline(client, projectId, timelineId) {
  const { rows } = await client.query(
    `SELECT ${TIMELINE} FROM timelines WHERE id = $1 AND project_id = $2 FOR UPDATE`,
    [timelineId, projectId],
  );
  return rows[0] ?? null;
}

// Appends version `version` and moves head_version to it. The caller holds the row lock
// and has checked that version = head + 1; the PK (timeline_id, version) is the backstop.
export async function appendVersion(client, timelineId, v) {
  const { rows: [version] } = await client.query(
    `INSERT INTO timeline_versions
       (timeline_id, version, parent_version, author_type, author_id, agent_run_id, summary, doc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING ${VERSION}`,
    [timelineId, v.version, v.parentVersion, v.authorType, v.authorId ?? null, v.agentRunId ?? null, v.summary,
      JSON.stringify(v.doc)],
  );
  const { rows: [timeline] } = await client.query(
    `UPDATE timelines SET head_version = $2, updated_at = now() WHERE id = $1 RETURNING ${TIMELINE}`,
    [timelineId, v.version],
  );
  return { timeline, version };
}

export async function findTimeline(projectId, timelineId) {
  const { rows } = await query(`SELECT ${TIMELINE} FROM timelines WHERE id = $1 AND project_id = $2`, [
    timelineId,
    projectId,
  ]);
  return rows[0] ?? null;
}

export async function listTimelines(projectId) {
  const { rows } = await query(
    `SELECT ${TIMELINE} FROM timelines WHERE project_id = $1 ORDER BY created_at DESC, id`,
    [projectId],
  );
  return rows;
}

export async function findVersion(timelineId, version) {
  const { rows } = await query(`SELECT ${VERSION} FROM timeline_versions WHERE timeline_id = $1 AND version = $2`, [
    timelineId,
    version,
  ]);
  return rows[0] ?? null;
}

// Version metadata without docs, oldest first.
export async function listVersions(timelineId) {
  const { rows } = await query(
    `SELECT ${VERSION_META} FROM timeline_versions WHERE timeline_id = $1 ORDER BY version`,
    [timelineId],
  );
  return rows;
}
