import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: { LOG_LEVEL: 'silent' },
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts', 'packages/db/src/ledger.ts', 'apps/api/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'apps/api/src/server.ts',
        'apps/api/src/worker.ts',
        'apps/api/src/seed-cli.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { 'packages/shared/src/**': { lines: 90 }, 'apps/api/src/**': { lines: 80 } },
    },
  },
});
