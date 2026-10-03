import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '../../src/config/env.js';
import { migrate, renderMigration } from '../../src/db/migrate.js';
import { getPool } from '../../src/db/pool.js';
import { closeAll, resetDb } from '../helpers/db.js';

beforeAll(resetDb);
afterAll(closeAll);

describe('migrations', () => {
  it('run twice without error; the second run applies nothing', async () => {
    await migrate();
    const second = await migrate();
    expect(second).toEqual([]);
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM schema_migrations WHERE id = '001'");
    expect(rows[0].n).toBe(1);
  });

  it('two migrators racing do not double-apply', async () => {
    const [a, b] = await Promise.all([migrate(), migrate()]);
    expect([...a, ...b]).toEqual([]);
  });

  it('set up the active vector backend', async () => {
    const pool = getPool();
    if (getEnv().VECTOR_BACKEND === 'pgvector') {
      const { rowCount } = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
      expect(rowCount).toBe(1);
    } else {
      const { rows } = await pool.query("SELECT cosine_distance(ARRAY[1,0]::float8[], ARRAY[0,1]::float8[]) AS d");
      expect(rows[0].d).toBeCloseTo(1, 6);
    }
  });

  it('keeps only the blocks for the active backend', () => {
    const sql = ['a;', '-- @if pgvector', 'pg;', '-- @endif', '-- @if array', 'arr;', '-- @endif', 'col {{VECTOR}};'].join('\n');
    expect(renderMigration(sql, { VECTOR_BACKEND: 'pgvector', EMBED_DIM: 4 })).toBe('a;\npg;\ncol vector(4);');
    expect(renderMigration(sql, { VECTOR_BACKEND: 'array', EMBED_DIM: 4 })).toBe('a;\narr;\ncol float8[];');
  });
});
