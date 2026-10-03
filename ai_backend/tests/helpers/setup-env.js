// Runs before every test file: tests always use the *_test database and fake adapters.
import dotenv from 'dotenv';
import { resetEnv } from '../../src/config/env.js';

dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set: tests never run against the main database.');
}

Object.assign(process.env, {
  // Kept so tests of scripts that check both databases (preflight) can see the real one.
  DATABASE_URL_MAIN: process.env.DATABASE_URL_MAIN || process.env.DATABASE_URL,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST,
  ADAPTERS: 'fake',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret-not-for-production',
  SKIP_DOTENV: '1',
});
resetEnv();
