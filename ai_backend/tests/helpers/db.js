import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { stopBoss } from '../../src/queue/boss.js';

// Migrates the test database and empties every app table (schema_migrations and the
// pg-boss schema excepted). Refuses to touch a database whose name doesn't end in _test.
export async function resetDb() {
  const pool = getPool();
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  if (!db.endsWith('_test')) throw new Error(`resetDb refused: "${db}" is not a *_test database`);

  await migrate({ pool });
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (rows.length) {
    const tables = rows.map((r) => `public.${pg.escapeIdentifier(r.tablename)}`).join(', ');
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}

export async function closeAll() {
  await stopBoss();
  await closePool();
}
