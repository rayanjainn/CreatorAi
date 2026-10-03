// auth service: the module's public API. Other modules import this file and nothing
// else from here.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getEnv } from '../../config/env.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import * as repo from './repo.js';
import { LoginBody, PublicUser, RegisterBody } from './schemas.js';

const BCRYPT_ROUNDS = 10;
const JWT_ALGORITHM = 'HS256';
const DEFAULT_EXPIRES_IN = '7d';
const INVALID_CREDENTIALS = 'Invalid email or password';
// Compared against when the email is unknown so both failures cost the same time.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

const toPublic = (row) => (row ? PublicUser.parse({ id: row.id, email: row.email, name: row.name ?? null }) : null);

export function signToken(user, { expiresIn = DEFAULT_EXPIRES_IN } = {}) {
  return jwt.sign({ email: user.email }, getEnv().JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    subject: String(user.id),
    expiresIn,
  });
}

// register({ email, password, name? }) -> { user, token }. Duplicate email -> 409.
export async function register(input) {
  const { email, password, name } = RegisterBody.parse(input);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const row = await repo.insertUser({ email, passwordHash, name });
  if (!row) throw conflict('Email is already registered');
  const user = toPublic(row);
  return { user, token: signToken(user) };
}

// login({ email, password }) -> { user, token }. Unknown email or wrong password -> 401.
export async function login(input) {
  const { email, password } = LoginBody.parse(input);
  const row = await repo.findCredentialsByEmail(email);
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthorized(INVALID_CREDENTIALS);
  const user = toPublic(row);
  return { user, token: signToken(user) };
}

export async function getUserById(id) {
  return toPublic(await repo.findById(id));
}

export async function findUserByEmail(email) {
  if (typeof email !== 'string') return null;
  return toPublic(await repo.findByEmail(email.trim().toLowerCase()));
}

// Verifies a bearer token and loads its user. Returns the public user or null.
async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, getEnv().JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return null;
  }
  return typeof payload?.sub === 'string' ? getUserById(payload.sub) : null;
}

// Middleware factory: requires `Authorization: Bearer <jwt>` for an existing user and
// sets req.user = { id, email, name }. Any failure -> 401 unauthorized.
export function requireAuth() {
  return async (req, res, next) => {
    try {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      const user = match ? await userFromToken(match[1]) : null;
      if (!user) return next(unauthorized());
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
