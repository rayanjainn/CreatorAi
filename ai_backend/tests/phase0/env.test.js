import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../../src/config/env.js';
import { runNode } from '../helpers/proc.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/aivideo', JWT_SECRET: 's', ADAPTERS: 'fake' };

describe('config/env', () => {
  it('accepts a minimal fake-adapter environment and applies defaults', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ PORT: 4000, EMBED_DIM: 768, VECTOR_BACKEND: 'pgvector' });
  });

  it.each(['DATABASE_URL', 'JWT_SECRET'])('missing %s is rejected by name', (key) => {
    const env = { ...base, [key]: undefined };
    expect(() => loadEnv(env)).toThrow(EnvError);
    expect(() => loadEnv(env)).toThrow(key);
  });

  it('ADAPTERS=real requires every provider key', () => {
    try {
      loadEnv({ ...base, ADAPTERS: 'real', SEARCH_PROVIDER: 'serper' });
      expect.unreachable();
    } catch (err) {
      const missing = err.issues.map((i) => i.path[0]);
      expect(missing).toEqual(
        expect.arrayContaining(['GEMINI_API_KEY', 'GROQ_API_KEY', 'CLOUDINARY_API_SECRET', 'SERPER_API']),
      );
    }
  });

  it('rejects bad enum values', () => {
    expect(() => loadEnv({ ...base, VECTOR_BACKEND: 'faiss' })).toThrow('VECTOR_BACKEND');
  });
});

describe('process refuses to start with missing required env', () => {
  it.each(['src/server.js', 'src/worker.js'])('%s exits non-zero and names the variable', async (script) => {
    const r = await runNode(script, { env: { DATABASE_URL: undefined, JWT_SECRET: undefined } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('DATABASE_URL');
    expect(r.stderr).toContain('JWT_SECRET');
  });
});
