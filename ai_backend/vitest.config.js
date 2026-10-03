import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/phase*/**/*.test.js'],
    setupFiles: ['tests/helpers/setup-env.js'],
    // One shared test database: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
