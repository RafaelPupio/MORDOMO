import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    // PGlite boots a Postgres per test file; under a full parallel run the first test in a
    // file regularly needs more than the 5 s default and failed as a flake three times on
    // 2026-09-05..08 (files pass alone every time).
    testTimeout: 20_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
