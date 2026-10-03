import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '../../src/config/env.js';
import { getPool } from '../../src/db/pool.js';
import { nearest, toVectorParam, vectorType } from '../../src/modules/search/repo.js';
import { closeAll, resetDb } from '../helpers/db.js';

const DIM = getEnv().EMBED_DIM;

// One-hot-ish vectors: a strong component on axis `axis`, a little noise elsewhere.
function vec(axis) {
  return Array.from({ length: DIM }, (_, i) => (i === axis ? 1 : 0.01 * ((i % 7) - 3)));
}

beforeAll(async () => {
  await resetDb();
  await getPool().query('DROP TABLE IF EXISTS vector_roundtrip');
  await getPool().query(`CREATE TABLE vector_roundtrip (id int PRIMARY KEY, label text, embedding ${vectorType()})`);
});

afterAll(async () => {
  await getPool().query('DROP TABLE IF EXISTS vector_roundtrip');
  await closeAll();
});

describe(`vector round-trip (VECTOR_BACKEND=${getEnv().VECTOR_BACKEND}, dim ${DIM})`, () => {
  it('nearest-neighbour query returns the closest of three stored vectors', async () => {
    const pool = getPool();
    for (const [id, label, axis] of [[1, 'alpha', 0], [2, 'beta', 1], [3, 'gamma', 2]]) {
      await pool.query('INSERT INTO vector_roundtrip VALUES ($1, $2, $3)', [id, label, toVectorParam(vec(axis))]);
    }

    const probe = vec(1).map((x, i) => (i === 2 ? x + 0.3 : x)); // closest to beta, then gamma
    const rows = await nearest(pool, { table: 'vector_roundtrip', select: ['id', 'label'], vector: probe, limit: 3 });

    expect(rows.map((r) => r.label)).toEqual(['beta', 'gamma', 'alpha']);
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
    expect(rows[0].distance).toBeGreaterThanOrEqual(0);
  });

  it('stores the full dimension', async () => {
    const { rows } = await getPool().query('SELECT embedding FROM vector_roundtrip WHERE id = 1');
    const stored = rows[0].embedding;
    const values = typeof stored === 'string' ? JSON.parse(stored) : stored;
    expect(values).toHaveLength(DIM);
  });
});
