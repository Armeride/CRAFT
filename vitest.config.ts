import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Native Git/worktree fixtures are I/O-heavy on Windows. Keep cross-file
    // pressure bounded; concurrency tests still create their own parallel runs.
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
