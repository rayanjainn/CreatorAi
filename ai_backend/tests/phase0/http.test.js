import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createPool } from '../../src/db/pool.js';
import { validate } from '../../src/lib/http.js';
import { closeAll, resetDb } from '../helpers/db.js';

const silent = { error() {} };

const app = createApp({
  log: silent,
  configure(a) {
    a.get('/_test/boom', () => {
      throw new Error('kaboom with internal detail');
    });
    a.post('/_test/echo', validate(z.object({ name: z.string().min(1), count: z.number().int() })), (req, res) =>
      res.json(req.body),
    );
  },
});

beforeAll(resetDb);
afterAll(closeAll);

describe('GET /health', () => {
  it('returns 200 with db ok when Postgres answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const deadPool = createPool('postgres://nobody:nothing@127.0.0.1:1/nowhere', { connectionTimeoutMillis: 1000 });
    try {
      const res = await request(createApp({ pool: deadPool, log: silent })).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ db: 'down' });
    } finally {
      await deadPool.end();
    }
  });
});

describe('error handling', () => {
  it('unknown route -> 404 JSON with a request id', async () => {
    const res = await request(app).get('/definitely/not/a/route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toMatchObject({ code: 'not_found' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('thrown error -> 500 JSON with the request id and no internal detail', async () => {
    const res = await request(app).get('/_test/boom').set('x-request-id', 'req-abc-123');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'internal', message: 'Internal Server Error', requestId: 'req-abc-123' });
    expect(JSON.stringify(res.body)).not.toContain('kaboom');
  });

  it('invalid body -> 400 with the Zod issues', async () => {
    const res = await request(app).post('/_test/echo').send({ name: '', count: 'three' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    const paths = res.body.error.details.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['body.name', 'body.count']));
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('valid body passes through validate()', async () => {
    const res = await request(app).post('/_test/echo').send({ name: 'a', count: 2, extra: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'a', count: 2 });
  });

  it('malformed JSON -> 400 invalid_json', async () => {
    const res = await request(app).post('/_test/echo').set('content-type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('generates a request id when the client sends none, and ignores unsafe ones', async () => {
    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const unsafe = await request(app).get('/health').set('x-request-id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).not.toContain('<');
  });
});

describe('module routers are mounted as 501 stubs', () => {
  const planned = [
    ['post', '/mcp', 8],
  ];

  it.each(planned)('%s %s -> 501 (phase %i)', async (method, path, phase) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('not_implemented');
    expect(res.body.error.message).toContain(`phase ${phase}`);
  });

  it('a wrong method on a planned path is still a 404, not a stub', async () => {
    const res = await request(app).put('/projects/p1/search');
    expect(res.status).toBe(404);
  });
});
