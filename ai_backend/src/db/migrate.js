// Plain SQL migrations: src/db/migrations/NNN_name.sql, applied in order, each in its
// own transaction, recorded in schema_migrations. Safe to run any number of times.
//
// Two template features cover the vector backend (see plans.md "Vector storage"):
//   -- @if pgvector / -- @if array  ...  -- @endif   keeps the block only for that backend
//   {{VECTOR}}                                       becomes vector(EMBED_DIM) or float8[]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEnv } from '../config/env.js';
import { closePool, getPool } from './pool.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const FILE_PATTERN = /^(\d{3})_[\w-]+\.sql$/;
// Arbitrary constant so concurrent migrators (server + worker starting together) queue up.
const LOCK_KEY = 72_410_001;

export function vectorColumnType({ VECTOR_BACKEND, EMBED_DIM }) {
  return VECTOR_BACKEND === 'pgvector' ? `vector(${EMBED_DIM})` : 'float8[]';
}

export function renderMigration(sql, env) {
  const kept = [];
  let skipping = false;
  for (const line of sql.split(/\r?\n/)) {
    const directive = line.match(/^\s*--\s*@(if|endif)\b\s*(\w+)?/);
    if (directive?.[1] === 'if') {
      skipping = directive[2] !== env.VECTOR_BACKEND;
      continue;
    }
    if (directive?.[1] === 'endif') {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replaceAll('{{VECTOR}}', vectorColumnType(env));
}

export async function listMigrations(dir = MIGRATIONS_DIR) {
  const files = (await fs.readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
  const seen = new Set();
  for (const f of files) {
    const id = f.slice(0, 3);
    if (seen.has(id)) throw new Error(`Duplicate migration number ${id}`);
    seen.add(id);
  }
  return files;
}

export async function migrate({ pool = getPool(), env = getEnv(), dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT id FROM schema_migrations');
    const done = new Set(rows.map((r) => r.id));

    for (const file of await listMigrations(dir)) {
      const id = file.slice(0, 3);
      if (done.has(id)) continue;
      const sql = renderMigration(await fs.readFile(path.join(dir, file), 'utf8'), env);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [id, file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  migrate({ log: console.log })
    .then((applied) => console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
