import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { query } from '../../src/db/pool.js';
import { findUserByEmail, getUserById } from '../../src/modules/auth/service.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

const app = createApp({ log: { error() {} } });
const PASSWORD = 'correct-horse-battery';

beforeEach(resetDb);
afterAll(closeAll);

function expectNoSecrets(body) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/password/i);
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toMatch(/\$2[aby]\$/);
}

describe('POST /auth/register', () => {
  it('creates a user and returns 201 with user and token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'Alice@Example.com', password: PASSWORD, name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(res.body.user.id).toBeTruthy();
    expect(typeof res.body.token).toBe('string');
    expectNoSecrets(res.body);
  });

  it('name is optional', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'n@example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.name).toBeNull();
  });

  it('duplicate email -> 409, case-insensitively', async () => {
    await createUser(app, { email: 'bob@example.com' });
    const res = await request(app).post('/auth/register').send({ email: 'BOB@example.COM', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it.each([
    ['missing email', { password: PASSWORD }],
    ['bad email', { email: 'not-an-email', password: PASSWORD }],
    ['short password', { email: 'c@example.com', password: 'short' }],
    ['missing password', { email: 'c@example.com' }],
    ['non-string name', { email: 'c@example.com', password: PASSWORD, name: 42 }],
  ])('invalid body (%s) -> 400', async (_label, body) => {
    const res = await request(app).post('/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('stores the password hashed (bcrypt), never plaintext', async () => {
    const { user } = await createUser(app, { password: PASSWORD });
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).not.toBe(PASSWORD);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(JSON.stringify(rows[0])).not.toContain(PASSWORD);
  });
});

describe('POST /auth/login', () => {
  it('returns 200 with user and a token that works on /auth/me', async () => {
    const { user, email } = await createUser(app, { password: PASSWORD });
    const res = await request(app).post('/auth/login').send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(user);
    expectNoSecrets(res.body);

    const me = await request(app).get('/auth/me').set(authHeader(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual(user);
  });

  it('wrong password and unknown email -> 401 with the same message', async () => {
    const { email } = await createUser(app);
    const wrong = await request(app).post('/auth/login').send({ email, password: 'wrong-password' });
    const unknown = await request(app).post('/auth/login').send({ email: 'ghost@example.com', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('unauthorized');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('invalid body -> 400', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'x@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('GET /auth/me and requireAuth', () => {
  it('returns the current user without secrets', async () => {
    const { user, token } = await createUser(app);
    const res = await request(app).get('/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user });
    expectNoSecrets(res.body);
  });

  async function expect401(headers) {
    const res = await request(app).get('/auth/me').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.body.error.requestId).toBeTruthy();
  }

  it('missing token -> 401', () => expect401({}));
  it('garbage token -> 401', () => expect401(authHeader('not.a.jwt')));
  it('non-bearer scheme -> 401', async () => {
    const { token } = await createUser(app);
    await expect401({ Authorization: `Basic ${token}` });
  });

  it('expired token -> 401', async () => {
    const { user } = await createUser(app);
    const token = jwt.sign({ sub: user.id, exp: Math.floor(Date.now() / 1000) - 60 }, getEnv().JWT_SECRET, {
      algorithm: 'HS256',
    });
    await expect401(authHeader(token));
  });

  it('token signed with the wrong secret -> 401', async () => {
    const { user } = await createUser(app);
    const token = jwt.sign({ sub: user.id }, 'some-other-secret', { algorithm: 'HS256', expiresIn: '1h' });
    await expect401(authHeader(token));
  });

  it('unsigned (alg none) token -> 401', async () => {
    const { user } = await createUser(app);
    const token = jwt.sign({ sub: user.id }, null, { algorithm: 'none' });
    await expect401(authHeader(token));
  });

  it('token for a user that no longer exists -> 401', async () => {
    const { user, token } = await createUser(app);
    await query('DELETE FROM users WHERE id = $1', [user.id]);
    await expect401(authHeader(token));
  });
});

describe('auth service public API', () => {
  it('findUserByEmail and getUserById return the public user or null', async () => {
    const { user, email } = await createUser(app);
    expect(await findUserByEmail(email.toUpperCase())).toEqual(user);
    expect(await getUserById(user.id)).toEqual(user);
    expect(await findUserByEmail('nobody@example.com')).toBeNull();
    expect(await getUserById('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await getUserById('not-a-uuid')).toBeNull();
  });
});
