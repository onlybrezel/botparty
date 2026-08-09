import { defineConfig } from '@playwright/test';

const usesExternalServers = process.env['PLAYWRIGHT_EXTERNAL_SERVERS'] === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['multi-instance/**', 'responsive/**', 'visual/**'],
  outputDir: process.env['PLAYWRIGHT_OUTPUT_DIR'] ?? './test-results',
  timeout: 60_000,
  // The browser suite intentionally shares one deterministic seeded account and
  // robot lifecycle. Parallelism belongs in isolated projects, not within this stateful flow.
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['line']],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3000',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  ...(!usesExternalServers ? { webServer: [
    {
      command: 'pnpm --filter @botparty/api dev',
      url: `${process.env['API_URL'] ?? 'http://127.0.0.1:4000'}/api/v1/health/live`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      url: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_LEGAL_OPERATOR_NAME:
          process.env['NEXT_PUBLIC_LEGAL_OPERATOR_NAME'] ?? 'BotParty Test Operator',
        NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL:
          process.env['NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL'] ?? 'legal@botparty.test',
        NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS:
          process.env['NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS'] ?? 'Teststrasse 1, 10115 Berlin',
      },
    },
  ] } : {}),
});
