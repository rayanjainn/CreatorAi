import { describe, expect, it } from 'vitest';
import { runNode } from '../helpers/proc.js';

const PREFLIGHT = 'scripts/preflight.js';
const testUrl = process.env.DATABASE_URL_TEST;

function withPort(url, port) {
  const u = new URL(url);
  u.port = String(port);
  return u.toString();
}

function withDb(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe('scripts/preflight.js', () => {
  it('passes on this machine (Postgres, both databases, vector backend, ffmpeg)', async () => {
    const r = await runNode(PREFLIGHT, { args: ['--check'], env: { DATABASE_URL: process.env.DATABASE_URL_MAIN } });
    expect(r.output).toContain('preflight passed');
    expect(r.code).toBe(0);
  });

  it('fails with a clear message when Postgres is unreachable', async () => {
    const dead = withPort(testUrl, 1);
    const r = await runNode(PREFLIGHT, { env: { DATABASE_URL: dead, DATABASE_URL_TEST: dead } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/Postgres is not reachable at 127\.0\.0\.1:1|Postgres is not reachable at localhost:1/);
  });

  it('fails with a clear message when a database is missing (--check does not create it)', async () => {
    const missing = withDb(testUrl, 'aivideo_preflight_missing_db');
    const r = await runNode(PREFLIGHT, { args: ['--check'], env: { DATABASE_URL_TEST: missing } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('Database "aivideo_preflight_missing_db" does not exist');
  });

  it('fails with a clear message when FFmpeg is missing', async () => {
    const r = await runNode(PREFLIGHT, {
      args: ['--check'],
      env: { FFMPEG_PATH: 'definitely-not-ffmpeg-xyz', FFPROBE_PATH: 'definitely-not-ffprobe-xyz' },
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('ffmpeg not found');
    expect(r.stderr).toContain('ffprobe not found');
  });

  it('fails when VECTOR_BACKEND=pgvector but the extension is unavailable, or passes that check otherwise', async () => {
    const r = await runNode(PREFLIGHT, { args: ['--check'], env: { VECTOR_BACKEND: 'pgvector' } });
    const available = r.stdout.includes('pgvector extension: available');
    if (available) expect(r.stderr).not.toContain('VECTOR_BACKEND=pgvector but');
    else expect(r.stderr).toContain('VECTOR_BACKEND=pgvector but the pgvector extension is not installed');
  });
});
