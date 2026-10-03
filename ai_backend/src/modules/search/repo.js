// search repo (phase 3). This is the only file that knows which VECTOR_BACKEND is active:
// pgvector stores vector(N) and uses the <=> operator, array stores float8[] and uses the
// cosine_distance() SQL function created by migration 001.
import pg from 'pg';
import { getEnv } from '../../config/env.js';
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
