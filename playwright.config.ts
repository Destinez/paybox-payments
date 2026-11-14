import { defineConfig, devices } from '@playwright/test';

const database = process.env.E2E_DATABASE_URL ?? 'postgres://paybox:paybox@localhost:55432/paybox_test';
export default defineConfig({
  testDir: 'apps/web/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHROME_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm test:e2e:prepare && pnpm demo:seed && pnpm --filter api start',
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: false,
      timeout: 120000,
      env: { DATABASE_URL: database, TEST_DATABASE_URL: database, PAYSTACK_MODE: 'fake', DEMO_MODE: 'true' },
    },
    {
      command: 'pnpm --filter @paybox/web start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: false,
      timeout: 60000,
      env: { API_URL: 'http://localhost:4000', NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
