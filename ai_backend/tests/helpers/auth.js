import { randomUUID } from 'node:crypto';
import request from 'supertest';

// Registers a fresh user through POST /auth/register (unique email each call).
// Returns { user, token, email, password }.
export async function createUser(app, overrides = {}) {
  const body = {
    email: `user-${randomUUID()}@example.test`,
    password: 'correct-horse-battery',
    name: 'Test User',
    ...overrides,
  };
  const res = await request(app).post('/auth/register').send(body);
  if (res.status !== 201) {
    throw new Error(`createUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { user: res.body.user, token: res.body.token, email: body.email, password: body.password };
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
