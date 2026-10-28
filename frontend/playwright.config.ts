import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Scenarios a–d upload to Onshore TEST Maximo; they run only when explicitly allowed.
  testIgnore: process.env.E2E_ALLOW_TEST_WRITES === '1' ? [] : ['**/[a-d]-*.spec.ts'],
  outputDir: './e2e/results/test-artifacts',
  timeout: 600_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'https://localhost:5173',
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
    launchOptions: {
      args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
