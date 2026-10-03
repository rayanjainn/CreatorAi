import pg from 'pg';
import { getEnv } from '../config/env.js';

// Return bigint counts as numbers; nothing in this app needs values above 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

let pool;

export function createPool(connectionString, options = {}) {
  const p = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, ...options });
  // An idle client losing its connection must not crash the process.
  p.on('error', (err) => console.error('[pg] idle client error', err.message));
  return p;
}

export function getPool() {
  pool ??= createPool(getEnv().DATABASE_URL);
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn, p = getPool()) {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = undefined;
  await p.end();
}
