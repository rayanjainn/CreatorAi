// search repo (phase 3). This is the only file that knows which VECTOR_BACKEND is active:
// pgvector stores vector(N) and uses the <=> operator, array stores float8[] and uses the
// cosine_distance() SQL function created by migration 001.
import pg from 'pg';
import { getEnv } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { vectorColumnType } from '../../db/migrate.js';

export function vectorType(env = getEnv()) {
  return vectorColumnType(env);
}

// The value to bind for a vector parameter.
export function toVectorParam(vector, env = getEnv()) {
  if (!vector.every(Number.isFinite)) throw new Error('vector contains non-finite values');
  return env.VECTOR_BACKEND === 'pgvector' ? `[${vector.join(',')}]` : vector;
}

// SQL for the cosine distance between a column and a bound parameter such as '$1'.
export function cosineDistanceSql(column, param, env = getEnv()) {
  return env.VECTOR_BACKEND === 'pgvector'
    ? `(${column} <=> ${param}::vector)`
    : `cosine_distance(${column}, ${param}::float8[])`;
}

// SQL turning a jsonb array of numbers (a column/expression) into the vector column type.
function jsonToVectorSql(expr, env) {
  return env.VECTOR_BACKEND === 'pgvector'
    ? `(${expr}::text)::vector`
    : `ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(${expr}) WITH ORDINALITY AS e(x, n) ORDER BY n)`;
}

// Nearest rows to `vector` by cosine distance. Table and column names come from code,
// never from requests, but are still quoted.
export async function nearest(db, { table, column = 'embedding', select = ['id'], vector, limit = 10 }, env = getEnv()) {
  const t = pg.escapeIdentifier(table);
  const c = pg.escapeIdentifier(column);
  const cols = select.map((s) => pg.escapeIdentifier(s)).join(', ');
  const distance = cosineDistanceSql(c, '$1', env);
  const { rows } = await db.query(
    `SELECT ${cols}, ${distance} AS distance FROM ${t} WHERE ${c} IS NOT NULL ORDER BY distance LIMIT $2`,
    [toVectorParam(vector, env), limit],
  );
  return rows;
}

const EMBEDDED_TABLES = new Set(['transcript_segments', 'scenes']);

// Writes embeddings by row id: setEmbeddings({ transcript_segments: [{ id, vector }], scenes: [...] }).
// One statement per table, all in one transaction.
export async function setEmbeddings(byTable, env = getEnv()) {
  await withTransaction(async (client) => {
    for (const [table, items] of Object.entries(byTable)) {
      if (!EMBEDDED_TABLES.has(table)) throw new Error(`no embedding column on ${table}`);
      if (!items.length) continue;
      for (const { vector } of items) toVectorParam(vector, env); // finite check
      const t = pg.escapeIdentifier(table);
      await client.query(
        `UPDATE ${t} AS t SET embedding = ${jsonToVectorSql('v.e', env)}
         FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, e jsonb) WHERE t.id = v.id`,
        [JSON.stringify(items.map(({ id, vector }) => ({ id, e: vector })))],
      );
    }
  });
}

// Project-scoped vector search over transcript segments and scenes. kinds: subset of
// ['transcript', 'scene']; assetIds: optional filter. Rows ordered by cosine distance.
export async function searchProject({ projectId, vector, kinds, assetIds, limit }, env = getEnv()) {
  const parts = [];
  if (kinds.includes('transcript')) {
    parts.push(`SELECT 'transcript' AS kind, ts.asset_id, ts.start_ms, ts.end_ms, ts.text, NULL::text AS caption,
        NULL::uuid AS keyframe_asset_id, ${cosineDistanceSql('ts.embedding', '$1', env)} AS distance
      FROM transcript_segments ts JOIN assets a ON a.id = ts.asset_id
      WHERE a.project_id = $2 AND ts.embedding IS NOT NULL AND ($3::uuid[] IS NULL OR ts.asset_id = ANY($3::uuid[]))`);
  }
  if (kinds.includes('scene')) {
    parts.push(`SELECT 'scene' AS kind, s.asset_id, s.start_ms, s.end_ms, NULL::text AS text, s.caption,
        s.keyframe_asset_id, ${cosineDistanceSql('s.embedding', '$1', env)} AS distance
      FROM scenes s JOIN assets a ON a.id = s.asset_id
      WHERE a.project_id = $2 AND s.embedding IS NOT NULL AND ($3::uuid[] IS NULL OR s.asset_id = ANY($3::uuid[]))`);
  }
  if (!parts.length) return [];
  const { rows } = await query(
    `SELECT * FROM (${parts.join(' UNION ALL ')}) hits ORDER BY distance, asset_id, start_ms LIMIT $4`,
    [toVectorParam(vector, env), projectId, assetIds ?? null, limit],
  );
  return rows;
}
