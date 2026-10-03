// Checks the local machine can run the backend:
//   Postgres reachable on DATABASE_URL, both databases exist (created if missing),
//   pgvector availability vs VECTOR_BACKEND, ffmpeg and ffprobe callable.
// Usage: node scripts/preflight.js [--check]   (--check: report missing databases, don't create them)
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

function dbName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function withDb(url, name) {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

function where(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || 5432}`;
}

function checkBinary(label, bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (r.error || r.status !== 0) {
    return {
      problem:
        `${label} not found or not runnable ("${bin}"). Install FFmpeg (Windows: winget install Gyan.FFmpeg, ` +
        `then open a new terminal) or set ${label === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'} to the binary.`,
    };
  }
  return { note: `${label}: ${r.stdout.split(/\r?\n/)[0]}` };
}

export async function preflight({ env = process.env, create = true } = {}) {
  const problems = [];
  const notes = [];

  const urls = { DATABASE_URL: env.DATABASE_URL, DATABASE_URL_TEST: env.DATABASE_URL_TEST };
  for (const [key, value] of Object.entries(urls)) {
    if (!value) problems.push(`${key} is not set (see .env.example).`);
  }

  if (urls.DATABASE_URL) {
    const admin = new pg.Client({ connectionString: withDb(urls.DATABASE_URL, 'postgres'), connectionTimeoutMillis: 5000 });
    let connected = false;
    try {
      await admin.connect();
      connected = true;
    } catch (err) {
      problems.push(
        `Postgres is not reachable at ${where(urls.DATABASE_URL)} (${err.code || err.message}). ` +
          'Start the PostgreSQL service and check the user/password in DATABASE_URL.',
      );
    }

    if (connected) {
      try {
        const { rows } = await admin.query('SHOW server_version');
        notes.push(`postgres ${rows[0].server_version} at ${where(urls.DATABASE_URL)}`);

        for (const url of Object.values(urls).filter(Boolean)) {
          const name = dbName(url);
          const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount > 0;
          if (exists) notes.push(`database ${name}: present`);
          else if (create) {
            await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
            notes.push(`database ${name}: created`);
          } else problems.push(`Database "${name}" does not exist. Run "node scripts/preflight.js" without --check to create it.`);
        }

        const hasVector =
          (await admin.query("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")).rowCount > 0;
        const backend = env.VECTOR_BACKEND || 'pgvector';
        notes.push(`pgvector extension: ${hasVector ? 'available' : 'not installed'}; VECTOR_BACKEND=${backend}`);
        if (backend === 'pgvector' && !hasVector) {
          problems.push(
            'VECTOR_BACKEND=pgvector but the pgvector extension is not installed on this Postgres. ' +
              'Install pgvector for Windows, or set VECTOR_BACKEND=array in .env (float8[] + SQL cosine, fine at MVP scale).',
          );
        } else if (backend === 'array' && hasVector) {
          notes.push('pgvector is available: you can switch to VECTOR_BACKEND=pgvector for HNSW indexes.');
        }
      } catch (err) {
        problems.push(`Postgres check failed: ${err.message}`);
      } finally {
        await admin.end().catch(() => {});
      }
    }
  }

  for (const [label, bin] of [
    ['ffmpeg', env.FFMPEG_PATH || 'ffmpeg'],
    ['ffprobe', env.FFPROBE_PATH || 'ffprobe'],
  ]) {
    const r = checkBinary(label, bin);
    if (r.problem) problems.push(r.problem);
    else notes.push(r.note);
  }

  return { ok: problems.length === 0, problems, notes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.SKIP_DOTENV !== '1') dotenv.config({ quiet: true });
  const result = await preflight({ create: !process.argv.includes('--check') });
  for (const n of result.notes) console.log(`  ok  ${n}`);
  for (const p of result.problems) console.error(`  FAIL  ${p}`);
  console.log(result.ok ? 'preflight passed' : `preflight failed: ${result.problems.length} problem(s)`);
  process.exitCode = result.ok ? 0 : 1;
}
